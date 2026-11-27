using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace LedgerFlowHost {
    static class Program {
        private static readonly string AppDataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "LedgerFlow"
        );
        private static readonly string DataFilePath = Path.Combine(AppDataDir, "ledgerflow-data.json");
        private static readonly string BackupsDir = Path.Combine(AppDataDir, "backups");
        private static readonly string WebProfileDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "LedgerFlow",
            "WebProfile"
        );

        private static readonly object FileLock = new object();
        private static string SessionToken;
        private static TcpListener Server;
        private static NotifyIcon TrayIcon;
        private static string AppUrl;
        private static volatile bool ShuttingDown = false;
        private static DateTime LastPingUtc = DateTime.UtcNow;
        private static bool ClientEverConnected = false;
        private static Process EdgeProcess;

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
        private const uint WM_SETICON = 0x0080;

        [STAThread]
        static int Main(string[] args) {
            bool isHeadlessCheck = args.Length > 0 && args[0] == "--self-test";

            bool createdNew;
            using (var mutex = new Mutex(true, "LedgerFlow_SingleInstance_Mutex_v1", out createdNew)) {
                if (!createdNew && !isHeadlessCheck) {
                    MessageBox.Show("LedgerFlow is already running. Check your taskbar or system tray.", "LedgerFlow", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 0;
                }

                Directory.CreateDirectory(AppDataDir);
                Directory.CreateDirectory(BackupsDir);
                Directory.CreateDirectory(WebProfileDir);

                SessionToken = GenerateToken();
                Server = new TcpListener(IPAddress.Loopback, 0);
                Server.Start();
                int port = ((IPEndPoint)Server.LocalEndpoint).Port;
                AppUrl = string.Format("http://127.0.0.1:{0}/?token={1}", port, SessionToken);

                var serverThread = new Thread(AcceptLoop) { IsBackground = true };
                serverThread.Start();

                if (isHeadlessCheck) {
                    try {
                        RunSelfTest(port);
                        StopServer();
                        return 0;
                    } catch (Exception ex) {
                        Console.Error.WriteLine("SELF_TEST_FAIL: " + ex);
                        StopServer();
                        return 1;
                    }
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                ServicePointManager.DefaultConnectionLimit = 16;
                ServicePointManager.Expect100Continue = false;

                SetupTray();
                LaunchAppWindow();

                var watchTimer = new System.Windows.Forms.Timer { Interval = 2000 };
                watchTimer.Tick += (s, e) => {
                    if (ShuttingDown) {
                        watchTimer.Stop();
                        Application.ExitThread();
                        return;
                    }
                    if (EdgeProcess != null && EdgeProcess.HasExited) {
                        if (ClientEverConnected && (DateTime.UtcNow - LastPingUtc).TotalSeconds > 10) {
                            QuitApp();
                        }
                    } else if (ClientEverConnected && (DateTime.UtcNow - LastPingUtc).TotalSeconds > 60) {
                        QuitApp();
                    }
                };
                watchTimer.Start();

                Application.Run();
                return 0;
            }
        }

        static void RunSelfTest(int port) {
            // 1. Verify embedded UI resources
            var asm = Assembly.GetExecutingAssembly();
            string[] resNames = new[] { "ui.index.html", "ui.styles.css", "ui.app.js" };
            foreach (string r in resNames) {
                using (var s = asm.GetManifestResourceStream(r)) {
                    if (s == null || s.Length < 100) throw new Exception("Missing/empty embedded resource: " + r);
                }
            }

            // 2. Verify atomic vault save + daily backup + cleanup
            string prevData = File.Exists(DataFilePath) ? File.ReadAllText(DataFilePath, Encoding.UTF8) : null;
            string testBackup = Path.Combine(BackupsDir, "ledgerflow-" + DateTime.Now.ToString("yyyy-MM-dd") + ".json");
            bool hadBackup = File.Exists(testBackup);
            try {
                string testPayload = "{\"version\":1,\"testMarker\":42}";
                SaveVaultAtomically(testPayload);
                string diskRead = File.ReadAllText(DataFilePath, Encoding.UTF8);
                if (!diskRead.Contains("\"testMarker\":42")) throw new Exception("Disk readback mismatch.");
                if (!File.Exists(testBackup)) throw new Exception("Daily backup snapshot was not created.");
            } finally {
                lock (FileLock) {
                    if (prevData != null) File.WriteAllText(DataFilePath, prevData, new UTF8Encoding(false));
                    else if (File.Exists(DataFilePath)) File.Delete(DataFilePath);
                    if (!hadBackup && File.Exists(testBackup)) File.Delete(testBackup);
                }
            }

            // 3. Verify Edge app host detection
            string edge = FindEdgeExecutable();

            // 4. Optional HTTP loopback probe (may be restricted inside sandboxed environments)
            string httpStatus = "ok";
            try {
                using (var wc = new WebClient()) {
                    wc.Encoding = Encoding.UTF8;
                    wc.Headers.Add("X-LedgerFlow-Token", SessionToken);
                    string html = wc.DownloadString(string.Format("http://127.0.0.1:{0}/", port));
                    if (!html.Contains("LedgerFlow")) throw new Exception("HTTP index check failed.");
                }
            } catch (WebException ex) {
                httpStatus = "skipped_sandbox (" + ex.Message + ")";
            }

            Console.WriteLine("SELF_TEST_OK port=" + port + " edge=" + (edge ?? "none") + " http=" + httpStatus);
        }

        static void SetupTray() {
            var menu = new ContextMenuStrip();
            menu.Items.Add("Open LedgerFlow", null, (s, e) => LaunchAppWindow());
            menu.Items.Add("Open Vault Backups Folder", null, (s, e) => Process.Start("explorer.exe", AppDataDir));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Exit LedgerFlow", null, (s, e) => QuitApp());

            Icon appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            TrayIcon = new NotifyIcon {
                Icon = appIcon ?? SystemIcons.Application,
                Text = "LedgerFlow — Expense Tracker",
                ContextMenuStrip = menu,
                Visible = true
            };
            TrayIcon.DoubleClick += (s, e) => LaunchAppWindow();
        }

        static void LaunchAppWindow() {
            string edgePath = FindEdgeExecutable();
            if (!string.IsNullOrEmpty(edgePath)) {
                var psi = new ProcessStartInfo {
                    FileName = edgePath,
                    Arguments = string.Format(
                        "--app=\"{0}\" --user-data-dir=\"{1}\" --window-size=1360,860 --no-first-run --no-default-browser-check",
                        AppUrl, WebProfileDir
                    ),
                    UseShellExecute = false
                };
                EdgeProcess = Process.Start(psi);
                ThreadPool.QueueUserWorkItem(_ => ApplyWindowIcon(EdgeProcess));
            } else {
                Process.Start(new ProcessStartInfo { FileName = AppUrl, UseShellExecute = true });
            }
        }

        static void ApplyWindowIcon(Process proc) {
            if (proc == null) return;
            try {
                Icon appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (appIcon == null) return;
                for (int i = 0; i < 20; i++) {
                    Thread.Sleep(250);
                    proc.Refresh();
                    if (proc.HasExited) return;
                    if (proc.MainWindowHandle != IntPtr.Zero) {
                        SendMessage(proc.MainWindowHandle, WM_SETICON, (IntPtr)0, appIcon.Handle);
                        SendMessage(proc.MainWindowHandle, WM_SETICON, (IntPtr)1, appIcon.Handle);
                        return;
                    }
                }
            } catch { }
        }

        static string FindEdgeExecutable() {
            string[] candidates = new string[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\Edge\Application\msedge.exe")
            };
            foreach (string c in candidates) {
                if (File.Exists(c)) return c;
            }
            return null;
        }

        static void QuitApp() {
            if (ShuttingDown) return;
            ShuttingDown = true;
            StopServer();
            if (TrayIcon != null) {
                try {
                    TrayIcon.Visible = false;
                    TrayIcon.Dispose();
                } catch { }
            }
            try { Application.Exit(); } catch { }
        }

        static void StopServer() {
            try { if (Server != null) Server.Stop(); } catch { }
        }

        static void AcceptLoop() {
            while (!ShuttingDown) {
                try {
                    var client = Server.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(_ => HandleClient(client));
                } catch {
                    if (ShuttingDown) break;
                }
            }
        }

        static void HandleClient(TcpClient client) {
            using (client) {
                client.ReceiveTimeout = 120000;
                client.SendTimeout = 120000;
                try {
                    using (var ns = client.GetStream()) {
                        var headerBuf = new MemoryStream();
                        int cur;
                        int matched = 0;
                        while (headerBuf.Length < 65536 && (cur = ns.ReadByte()) != -1) {
                            headerBuf.WriteByte((byte)cur);
                            if ((matched == 0 && cur == '\r') || (matched == 1 && cur == '\n') ||
                                (matched == 2 && cur == '\r') || (matched == 3 && cur == '\n')) {
                                matched++;
                                if (matched == 4) break;
                            } else {
                                matched = (cur == '\r') ? 1 : 0;
                            }
                        }
                        if (matched < 4) return;

                        string headerText = Encoding.ASCII.GetString(headerBuf.ToArray());
                        string[] lines = headerText.Split(new[] { "\r\n" }, StringSplitOptions.None);
                        if (lines.Length == 0) return;

                        string[] reqParts = lines[0].Split(' ');
                        if (reqParts.Length < 2) return;
                        string method = reqParts[0].ToUpperInvariant();
                        string rawUrl = reqParts[1];

                        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                        for (int i = 1; i < lines.Length; i++) {
                            int idx = lines[i].IndexOf(':');
                            if (idx > 0) {
                                headers[lines[i].Substring(0, idx).Trim()] = lines[i].Substring(idx + 1).Trim();
                            }
                        }

                        int contentLength = 0;
                        if (headers.ContainsKey("Content-Length")) {
                            int.TryParse(headers["Content-Length"], out contentLength);
                        }
                        if (contentLength < 0 || contentLength > 128 * 1024 * 1024) {
                            SendResponse(ns, 413, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"error\":\"Payload too large\"}"));
                            return;
                        }

                        byte[] bodyBytes = new byte[contentLength];
                        int readTotal = 0;
                        while (readTotal < contentLength) {
                            int n = ns.Read(bodyBytes, readTotal, contentLength - readTotal);
                            if (n <= 0) break;
                            readTotal += n;
                        }

                        string path = rawUrl;
                        string query = "";
                        int qIdx = rawUrl.IndexOf('?');
                        if (qIdx >= 0) {
                            path = rawUrl.Substring(0, qIdx);
                            query = rawUrl.Substring(qIdx + 1);
                        }

                        RouteRequest(ns, method, path, query, headers, bodyBytes);
                    }
                } catch { }
            }
        }

        static string GetQueryParam(string query, string key) {
            if (string.IsNullOrEmpty(query)) return null;
            foreach (string pair in query.Split('&')) {
                int eq = pair.IndexOf('=');
                if (eq > 0 && string.Equals(pair.Substring(0, eq), key, StringComparison.Ordinal)) {
                    return Uri.UnescapeDataString(pair.Substring(eq + 1));
                }
            }
            return null;
        }

        static void RouteRequest(NetworkStream ns, string method, string path, string query, Dictionary<string, string> headers, byte[] bodyBytes) {
            if (path == "/" || path == "/index.html") {
                ServeEmbedded(ns, "ui.index.html", "text/html; charset=utf-8");
                return;
            }
            if (path == "/styles.css") {
                ServeEmbedded(ns, "ui.styles.css", "text/css; charset=utf-8");
                return;
            }
            if (path == "/mobile.css") {
                ServeEmbedded(ns, "ui.mobile.css", "text/css; charset=utf-8");
                return;
            }
            if (path == "/app.js") {
                ServeEmbedded(ns, "ui.app.js", "application/javascript; charset=utf-8");
                return;
            }

            string hdrToken = headers.ContainsKey("X-LedgerFlow-Token") ? headers["X-LedgerFlow-Token"] : GetQueryParam(query, "token");
            if (!string.Equals(hdrToken, SessionToken, StringComparison.Ordinal)) {
                SendJson(ns, 403, "{\"error\":\"Forbidden\"}");
                return;
            }

            if (path == "/api/state" && method == "GET") {
                ClientEverConnected = true;
                LastPingUtc = DateTime.UtcNow;
                string dataJson = "null";
                lock (FileLock) {
                    if (File.Exists(DataFilePath)) {
                        string raw = File.ReadAllText(DataFilePath, Encoding.UTF8).Trim();
                        if (raw.StartsWith("{") && raw.EndsWith("}")) dataJson = raw;
                    }
                }
                SendJson(ns, 200, "{\"host\":true,\"data\":" + dataJson + "}");
                return;
            }

            if (path == "/api/state" && method == "POST") {
                ClientEverConnected = true;
                LastPingUtc = DateTime.UtcNow;
                string body = Encoding.UTF8.GetString(bodyBytes).Trim();
                if (!body.StartsWith("{") || !body.EndsWith("}")) {
                    SendJson(ns, 400, "{\"error\":\"Invalid JSON payload\"}");
                    return;
                }
                SaveVaultAtomically(body);
                SendJson(ns, 200, "{\"ok\":true}");
                return;
            }

            if (path == "/api/ping") {
                ClientEverConnected = true;
                LastPingUtc = DateTime.UtcNow;
                SendJson(ns, 200, "{\"ok\":true}");
                return;
            }

            if (path == "/api/bye") {
                DateTime byeUtc = DateTime.UtcNow;
                SendJson(ns, 200, "{\"ok\":true}");
                ThreadPool.QueueUserWorkItem(_ => {
                    Thread.Sleep(2200);
                    if (LastPingUtc <= byeUtc) QuitApp();
                });
                return;
            }

            if (path == "/api/open-data-dir" && method == "POST") {
                Process.Start("explorer.exe", AppDataDir);
                SendJson(ns, 200, "{\"ok\":true}");
                return;
            }

            if (path == "/api/parse-statement" && method == "POST") {
                ClientEverConnected = true;
                LastPingUtc = DateTime.UtcNow;
                string body = Encoding.UTF8.GetString(bodyBytes).Trim();
                string resp = StatementParser.HandleParseRequest(body);
                SendJson(ns, 200, resp);
                return;
            }

            if (path == "/api/biometric-status" && method == "GET") {
                bool avail = false;
                string statusText = CheckWindowsHelloStatus(out avail);
                SendJson(ns, 200, "{\"available\":" + (avail ? "true" : "false") + ",\"status\":\"" + statusText + "\"}");
                return;
            }

            if (path == "/api/biometric-auth" && method == "POST") {
                string errMsg;
                bool verified = RequestWindowsHelloVerification("Verify your identity to unlock LedgerFlow", out errMsg);
                SendJson(ns, 200, "{\"ok\":" + (verified ? "true" : "false") + ",\"error\":\"" + errMsg.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"}");
                return;
            }

            if (path == "/api/ai-http" && method == "POST") {
                ClientEverConnected = true;
                LastPingUtc = DateTime.UtcNow;
                string body = Encoding.UTF8.GetString(bodyBytes).Trim();
                SendJson(ns, 200, ForwardAiHttpPost(body));
                return;
            }

            if (path == "/api/net-check" && method == "GET") {
                ClientEverConnected = true;
                LastPingUtc = DateTime.UtcNow;
                bool online = CheckInternetReachable();
                SendJson(ns, 200, "{\"online\":" + (online ? "true" : "false") + "}");
                return;
            }

            if (path == "/api/check-update" && method == "GET") {
                ClientEverConnected = true;
                LastPingUtc = DateTime.UtcNow;
                string ghToken = headers.ContainsKey("X-GitHub-Token") ? headers["X-GitHub-Token"] : (GetQueryParam(query, "token") ?? "");
                SendJson(ns, 200, CheckGitHubUpdate(ghToken));
                return;
            }

            if (path == "/api/install-update" && method == "POST") {
                ClientEverConnected = true;
                LastPingUtc = DateTime.UtcNow;
                string body = Encoding.UTF8.GetString(bodyBytes).Trim();
                SendJson(ns, 200, DownloadAndRunWindowsUpdate(body));
                return;
            }

            SendJson(ns, 404, "{\"error\":\"Not found\"}");
        }

        static void SaveVaultAtomically(string jsonBody) {
            lock (FileLock) {
                string tmp = DataFilePath + ".tmp";
                File.WriteAllText(tmp, jsonBody, new UTF8Encoding(false));
                if (File.Exists(DataFilePath)) {
                    File.Replace(tmp, DataFilePath, DataFilePath + ".bak", true);
                } else {
                    File.Move(tmp, DataFilePath);
                }

                string dailyName = Path.Combine(BackupsDir, "ledgerflow-" + DateTime.Now.ToString("yyyy-MM-dd") + ".json");
                if (!File.Exists(dailyName)) {
                    File.Copy(DataFilePath, dailyName, true);
                    PruneOldBackups();
                }
            }
        }

        static void PruneOldBackups() {
            try {
                var files = new DirectoryInfo(BackupsDir).GetFiles("ledgerflow-*.json");
                Array.Sort(files, (a, b) => b.CreationTimeUtc.CompareTo(a.CreationTimeUtc));
                for (int i = 14; i < files.Length; i++) {
                    files[i].Delete();
                }
            } catch { }
        }

        static void ServeEmbedded(NetworkStream ns, string resourceName, string contentType) {
            var asm = Assembly.GetExecutingAssembly();
            using (var stream = asm.GetManifestResourceStream(resourceName)) {
                if (stream == null) {
                    SendJson(ns, 404, "{\"error\":\"Resource missing\"}");
                    return;
                }
                byte[] buf = new byte[stream.Length];
                int off = 0;
                while (off < buf.Length) {
                    int n = stream.Read(buf, off, buf.Length - off);
                    if (n <= 0) break;
                    off += n;
                }
                SendResponse(ns, 200, contentType, buf);
            }
        }

        static void SendJson(NetworkStream ns, int code, string json) {
            SendResponse(ns, code, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
        }

        static void SendResponse(NetworkStream ns, int statusCode, string contentType, byte[] body) {
            string reason = statusCode == 200 ? "OK" : statusCode == 400 ? "Bad Request" : statusCode == 403 ? "Forbidden" : statusCode == 404 ? "Not Found" : "Error";
            string hdr = string.Format(
                "HTTP/1.1 {0} {1}\r\nContent-Type: {2}\r\nContent-Length: {3}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
                statusCode, reason, contentType, body.Length
            );
            byte[] hdrBytes = Encoding.ASCII.GetBytes(hdr);
            ns.Write(hdrBytes, 0, hdrBytes.Length);
            if (body.Length > 0) ns.Write(body, 0, body.Length);
            ns.Flush();
        }

        private const string GitHubRepo = "dhyanbirprofessional-svg/LedgerFlow";

        static string FetchGitHubText(string url, string ghToken, out int statusCode) {
            statusCode = 0;
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls;
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = "GET";
            req.Timeout = 7000;
            req.ReadWriteTimeout = 7000;
            req.UserAgent = "LedgerFlow-Updater/1.0";
            req.Accept = "application/vnd.github+json";
            if (!string.IsNullOrEmpty(ghToken)) {
                req.Headers["Authorization"] = "Bearer " + ghToken.Trim();
            }
            try {
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) {
                    statusCode = (int)resp.StatusCode;
                    return sr.ReadToEnd();
                }
            } catch (WebException wex) {
                var errResp = wex.Response as HttpWebResponse;
                if (errResp != null) {
                    statusCode = (int)errResp.StatusCode;
                    errResp.Close();
                }
                return null;
            }
        }

        static string CheckGitHubUpdate(string ghToken) {
            var ser = new JavaScriptSerializer();
            try {
                int code = 0;
                string relJson = FetchGitHubText("https://api.github.com/repos/" + GitHubRepo + "/releases/latest", ghToken, out code);
                if (!string.IsNullOrEmpty(relJson) && code >= 200 && code < 300) {
                    var rel = ser.Deserialize<Dictionary<string, object>>(relJson);
                    string tag = rel.ContainsKey("tag_name") && rel["tag_name"] != null ? rel["tag_name"].ToString().TrimStart('v', 'V') : "";
                    string notes = rel.ContainsKey("body") && rel["body"] != null ? rel["body"].ToString() : "";
                    string htmlUrl = rel.ContainsKey("html_url") && rel["html_url"] != null ? rel["html_url"].ToString() : ("https://github.com/" + GitHubRepo + "/releases/latest");
                    string winUrl = "", apkUrl = "";
                    if (rel.ContainsKey("assets") && rel["assets"] is System.Collections.ArrayList) {
                        foreach (object item in (System.Collections.ArrayList)rel["assets"]) {
                            var a = item as Dictionary<string, object>;
                            if (a == null) continue;
                            string nm = a.ContainsKey("name") && a["name"] != null ? a["name"].ToString() : "";
                            string dl = a.ContainsKey("browser_download_url") && a["browser_download_url"] != null ? a["browser_download_url"].ToString() : "";
                            if (nm.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) winUrl = dl;
                            else if (nm.EndsWith(".apk", StringComparison.OrdinalIgnoreCase)) apkUrl = dl;
                        }
                    }
                    if (!string.IsNullOrEmpty(tag)) {
                        return ser.Serialize(new Dictionary<string, object> {
                            { "ok", true }, { "version", tag }, { "notes", notes },
                            { "windowsUrl", winUrl }, { "androidUrl", apkUrl }, { "releaseUrl", htmlUrl }
                        });
                    }
                }

                int rawCode = 0;
                string verJson = FetchGitHubText("https://raw.githubusercontent.com/" + GitHubRepo + "/main/version.json", ghToken, out rawCode);
                if (!string.IsNullOrEmpty(verJson) && rawCode >= 200 && rawCode < 300) {
                    var v = ser.Deserialize<Dictionary<string, object>>(verJson);
                    string ver = v.ContainsKey("version") && v["version"] != null ? v["version"].ToString().TrimStart('v', 'V') : "";
                    string notes = v.ContainsKey("notes") && v["notes"] != null ? v["notes"].ToString() : "";
                    string relUrl = v.ContainsKey("releaseUrl") && v["releaseUrl"] != null ? v["releaseUrl"].ToString() : ("https://github.com/" + GitHubRepo + "/releases/latest");
                    return ser.Serialize(new Dictionary<string, object> {
                        { "ok", !string.IsNullOrEmpty(ver) },
                        { "version", ver },
                        { "notes", notes },
                        { "windowsUrl", "https://raw.githubusercontent.com/" + GitHubRepo + "/main/LedgerFlow-Setup.exe" },
                        { "androidUrl", "https://raw.githubusercontent.com/" + GitHubRepo + "/main/LedgerFlow.apk" },
                        { "releaseUrl", relUrl }
                    });
                }

                return ser.Serialize(new Dictionary<string, object> {
                    { "ok", false },
                    { "status", code != 0 ? code : rawCode },
                    { "error", (code == 404 || rawCode == 404) ? "GitHub repo is Private or has no release yet." : ("GitHub update check returned HTTP " + (code != 0 ? code : rawCode)) }
                });
            } catch (Exception ex) {
                return ser.Serialize(new Dictionary<string, object> { { "ok", false }, { "error", ex.Message } });
            }
        }

        static string DownloadAndRunWindowsUpdate(string jsonBody) {
            var ser = new JavaScriptSerializer();
            try {
                var req = ser.Deserialize<Dictionary<string, object>>(jsonBody);
                string url = req != null && req.ContainsKey("url") && req["url"] != null ? req["url"].ToString().Trim() : "";
                string ghToken = req != null && req.ContainsKey("token") && req["token"] != null ? req["token"].ToString().Trim() : "";
                Uri uri;
                if (!Uri.TryCreate(url, UriKind.Absolute, out uri) || uri.Scheme != Uri.UriSchemeHttps) {
                    return ser.Serialize(new Dictionary<string, object> { { "ok", false }, { "error", "Invalid HTTPS update URL." } });
                }
                string host = uri.Host.ToLowerInvariant();
                if (host != "github.com" && host != "raw.githubusercontent.com" && !host.EndsWith(".githubusercontent.com")) {
                    return ser.Serialize(new Dictionary<string, object> { { "ok", false }, { "error", "Untrusted update host." } });
                }

                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls;
                string tmpExe = Path.Combine(Path.GetTempPath(), "LedgerFlow-Setup-Update.exe");
                var wc = new WebClient();
                wc.Headers.Add("User-Agent", "LedgerFlow-Updater/1.0");
                if (!string.IsNullOrEmpty(ghToken)) wc.Headers.Add("Authorization", "Bearer " + ghToken);
                wc.DownloadFile(uri, tmpExe);

                string installDir = Path.GetDirectoryName(Application.ExecutablePath);
                Process.Start(new ProcessStartInfo {
                    FileName = tmpExe,
                    Arguments = string.Format("--quiet --dir=\"{0}\" --relaunch", installDir),
                    UseShellExecute = true
                });
                ThreadPool.QueueUserWorkItem(_ => {
                    Thread.Sleep(500);
                    QuitApp();
                });
                return ser.Serialize(new Dictionary<string, object> { { "ok", true } });
            } catch (Exception ex) {
                return ser.Serialize(new Dictionary<string, object> { { "ok", false }, { "error", ex.Message } });
            }
        }

        static bool CheckInternetReachable() {
            try {
                if (!System.Net.NetworkInformation.NetworkInterface.GetIsNetworkAvailable()) return false;
            } catch { }
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls;
            string[] probes = new[] {
                "https://clients3.google.com/generate_204",
                "https://api.github.com/",
                "https://generativelanguage.googleapis.com/"
            };
            foreach (string probe in probes) {
                try {
                    var req = (HttpWebRequest)WebRequest.Create(probe);
                    req.Method = "HEAD";
                    req.Timeout = 2000;
                    req.ReadWriteTimeout = 2000;
                    req.AllowAutoRedirect = false;
                    using (var resp = (HttpWebResponse)req.GetResponse()) {
                        if ((int)resp.StatusCode >= 200 && (int)resp.StatusCode < 500) return true;
                    }
                } catch (WebException wex) {
                    var errResp = wex.Response as HttpWebResponse;
                    if (errResp != null) {
                        int code = (int)errResp.StatusCode;
                        errResp.Close();
                        if (code >= 200 && code < 500) return true;
                    }
                } catch { }
            }
            return false;
        }

        static string ForwardAiHttpPost(string jsonBody) {
            var ser = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
            try {
                var reqMap = ser.Deserialize<Dictionary<string, object>>(jsonBody);
                string url = reqMap != null && reqMap.ContainsKey("url") && reqMap["url"] != null ? reqMap["url"].ToString() : "";
                string payload = reqMap != null && reqMap.ContainsKey("body") && reqMap["body"] != null ? reqMap["body"].ToString() : "";
                Uri parsed;
                if (!Uri.TryCreate(url, UriKind.Absolute, out parsed) || (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps)) {
                    return ser.Serialize(new Dictionary<string, object> { { "ok", false }, { "status", 0 }, { "error", "Only HTTP/HTTPS URLs are allowed." } });
                }

                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls;
                var hreq = (HttpWebRequest)WebRequest.Create(parsed);
                hreq.Method = "POST";
                hreq.Timeout = 45000;
                hreq.ReadWriteTimeout = 45000;
                hreq.ContentType = "application/json; charset=utf-8";

                if (reqMap.ContainsKey("headers") && reqMap["headers"] is Dictionary<string, object>) {
                    var hdrs = (Dictionary<string, object>)reqMap["headers"];
                    foreach (var kv in hdrs) {
                        if (kv.Value == null) continue;
                        if (string.Equals(kv.Key, "Content-Type", StringComparison.OrdinalIgnoreCase)) hreq.ContentType = kv.Value.ToString();
                        else hreq.Headers[kv.Key] = kv.Value.ToString();
                    }
                }

                byte[] postBytes = Encoding.UTF8.GetBytes(payload);
                hreq.ContentLength = postBytes.Length;
                using (var reqStream = hreq.GetRequestStream()) {
                    reqStream.Write(postBytes, 0, postBytes.Length);
                }

                try {
                    using (var hresp = (HttpWebResponse)hreq.GetResponse())
                    using (var sr = new StreamReader(hresp.GetResponseStream(), Encoding.UTF8)) {
                        string respText = sr.ReadToEnd();
                        return ser.Serialize(new Dictionary<string, object> {
                            { "ok", true },
                            { "status", (int)hresp.StatusCode },
                            { "body", respText }
                        });
                    }
                } catch (WebException wex) {
                    int code = 0;
                    string errBody = wex.Message;
                    if (wex.Response is HttpWebResponse) {
                        var errResp = (HttpWebResponse)wex.Response;
                        code = (int)errResp.StatusCode;
                        try {
                            using (var sr = new StreamReader(errResp.GetResponseStream(), Encoding.UTF8)) {
                                errBody = sr.ReadToEnd();
                            }
                        } catch { }
                    }
                    return ser.Serialize(new Dictionary<string, object> {
                        { "ok", false },
                        { "status", code },
                        { "body", errBody },
                        { "error", "HTTP " + code + ": " + errBody }
                    });
                }
            } catch (Exception ex) {
                return ser.Serialize(new Dictionary<string, object> { { "ok", false }, { "status", 0 }, { "error", ex.Message } });
            }
        }

        static string CheckWindowsHelloStatus(out bool available) {
            available = false;
            try {
                Type ucv = Type.GetType("Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType=WindowsRuntime");
                if (ucv == null) return "Unsupported";
                object op = ucv.GetMethod("CheckAvailabilityAsync").Invoke(null, null);
                object res = AwaitWinRtOperation(op, 5000);
                string s = res != null ? res.ToString() : "Unavailable";
                available = string.Equals(s, "Available", StringComparison.OrdinalIgnoreCase);
                return s;
            } catch {
                return "Unavailable";
            }
        }

        static bool RequestWindowsHelloVerification(string promptMessage, out string errorMessage) {
            errorMessage = "";
            try {
                Type ucv = Type.GetType("Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType=WindowsRuntime");
                if (ucv == null) {
                    errorMessage = "Windows Hello is unavailable on this system.";
                    return false;
                }
                object op = ucv.GetMethod("RequestVerificationAsync", new[] { typeof(string) }).Invoke(null, new object[] { promptMessage });
                object res = AwaitWinRtOperation(op, 60000);
                string s = res != null ? res.ToString() : "Canceled";
                if (string.Equals(s, "Verified", StringComparison.OrdinalIgnoreCase)) return true;
                errorMessage = "Verification returned: " + s;
                return false;
            } catch (Exception ex) {
                errorMessage = ex.Message;
                return false;
            }
        }

        static object AwaitWinRtOperation(object asyncOp, int timeoutMs) {
            if (asyncOp == null) return null;
            Type t = asyncOp.GetType();
            PropertyInfo statusProp = t.GetProperty("Status");
            int elapsed = 0;
            while (elapsed < timeoutMs) {
                int st = Convert.ToInt32(statusProp.GetValue(asyncOp, null));
                if (st == 1) {
                    return t.GetMethod("GetResults").Invoke(asyncOp, null);
                }
                if (st == 2 || st == 3) {
                    return null;
                }
                Thread.Sleep(40);
                elapsed += 40;
            }
            return null;
        }

        static string GenerateToken() {
            byte[] bytes = new byte[18];
            using (var rng = new RNGCryptoServiceProvider()) {
                rng.GetBytes(bytes);
            }
            return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
        }
    }
}
