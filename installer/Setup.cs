using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace LedgerFlowSetup {
    static class Program {
        private const string AppName = "LedgerFlow";
        private const string AppVersion = "1.0.9";
        private const string Publisher = "LedgerFlow Software";
        private const string UninstallRegPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\LedgerFlow";

        [STAThread]
        static int Main(string[] args) {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool isUninstall = false;
            bool quiet = false;
            bool relaunch = false;
            bool skipSystemIntegration = false;
            string silentDir = null;

            for (int i = 0; i < args.Length; i++) {
                string a = args[i].ToLowerInvariant();
                if (a == "--uninstall" || a == "/uninstall") isUninstall = true;
                else if (a == "--quiet" || a == "--silent" || a == "/s") quiet = true;
                else if (a == "--relaunch") relaunch = true;
                else if (a == "--no-sys") skipSystemIntegration = true;
                else if (a.StartsWith("--dir=")) silentDir = args[i].Substring(6).Trim('"');
            }

            if (isUninstall) {
                return RunUninstall(quiet, skipSystemIntegration);
            }

            if (quiet) {
                string target = string.IsNullOrEmpty(silentDir) ? GetDefaultInstallDir() : silentDir;
                try {
                    PerformInstall(target, !skipSystemIntegration, !skipSystemIntegration, !skipSystemIntegration, null);
                    if (relaunch) {
                        foreach (var mp in Process.GetProcessesByName("msedge")) {
                            try {
                                if (!string.IsNullOrEmpty(mp.MainWindowTitle) && mp.MainWindowTitle.StartsWith("LedgerFlow", StringComparison.OrdinalIgnoreCase)) {
                                    mp.CloseMainWindow();
                                }
                            } catch { }
                        }
                        Thread.Sleep(500);
                        string exe = Path.Combine(target, "LedgerFlow.exe");
                        if (File.Exists(exe)) {
                            Process.Start(new ProcessStartInfo { FileName = exe, WorkingDirectory = target, UseShellExecute = true });
                        }
                    }
                    return 0;
                } catch (Exception ex) {
                    Console.Error.WriteLine("Install error: " + ex);
                    return 1;
                }
            }

            Application.Run(new SetupForm());
            return 0;
        }

        public static string GetDefaultInstallDir() {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs",
                AppName
            );
        }

        public static void PerformInstall(string installDir, bool createDesktopShortcut, bool createStartMenu, bool registerUninstall, Action<int, string> onProgress) {
            if (onProgress != null) onProgress(10, "Preparing installation directory...");
            Directory.CreateDirectory(installDir);

            // Stop any running LedgerFlow instance cleanly before overwriting files
            foreach (var p in Process.GetProcessesByName("LedgerFlow")) {
                try { p.Kill(); p.WaitForExit(3000); } catch { }
            }

            if (onProgress != null) onProgress(35, "Extracting application files...");
            string tempZip = Path.Combine(Path.GetTempPath(), "ledgerflow_payload_" + Guid.NewGuid().ToString("N") + ".zip");
            try {
                var asm = Assembly.GetExecutingAssembly();
                using (var resStream = asm.GetManifestResourceStream("payload.zip")) {
                    if (resStream == null) throw new Exception("Embedded application payload is missing.");
                    using (var fs = new FileStream(tempZip, FileMode.Create, FileAccess.Write)) {
                        resStream.CopyTo(fs);
                    }
                }

                using (var archive = ZipFile.OpenRead(tempZip)) {
                    foreach (var entry in archive.Entries) {
                        if (string.IsNullOrEmpty(entry.Name)) continue;
                        string destPath = Path.GetFullPath(Path.Combine(installDir, entry.FullName));
                        if (!destPath.StartsWith(Path.GetFullPath(installDir), StringComparison.OrdinalIgnoreCase)) continue;
                        Directory.CreateDirectory(Path.GetDirectoryName(destPath));
                        entry.ExtractToFile(destPath, true);
                    }
                }
            } finally {
                try { if (File.Exists(tempZip)) File.Delete(tempZip); } catch { }
            }

            if (onProgress != null) onProgress(65, "Installing uninstaller...");
            string mainExe = Path.Combine(installDir, "LedgerFlow.exe");
            string uninstallExe = Path.Combine(installDir, "Uninstall.exe");
            string selfExe = Assembly.GetExecutingAssembly().Location;
            if (!string.Equals(Path.GetFullPath(selfExe), Path.GetFullPath(uninstallExe), StringComparison.OrdinalIgnoreCase)) {
                File.Copy(selfExe, uninstallExe, true);
            }

            if (createStartMenu) {
                if (onProgress != null) onProgress(80, "Creating Start Menu shortcuts...");
                string startDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName);
                Directory.CreateDirectory(startDir);
                CreateShortcut(Path.Combine(startDir, AppName + ".lnk"), mainExe, installDir, "LedgerFlow — Smart Personal Finance & Expense Tracker", mainExe + ",0", "");
                CreateShortcut(Path.Combine(startDir, "Uninstall " + AppName + ".lnk"), uninstallExe, installDir, "Uninstall LedgerFlow", uninstallExe + ",0", "--uninstall");
            }

            if (createDesktopShortcut) {
                if (onProgress != null) onProgress(88, "Creating Desktop shortcut...");
                string desktopLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk");
                CreateShortcut(desktopLnk, mainExe, installDir, "LedgerFlow — Expense Tracker", mainExe + ",0", "");
            }

            if (registerUninstall) {
                if (onProgress != null) onProgress(95, "Registering software in Windows Apps...");
                long totalBytes = 0;
                foreach (var fi in new DirectoryInfo(installDir).GetFiles("*", SearchOption.AllDirectories)) {
                    totalBytes += fi.Length;
                }
                int sizeKb = (int)Math.Max(1, totalBytes / 1024);

                using (var key = Registry.CurrentUser.CreateSubKey(UninstallRegPath)) {
                    if (key != null) {
                        key.SetValue("DisplayName", AppName);
                        key.SetValue("DisplayVersion", AppVersion);
                        key.SetValue("Publisher", Publisher);
                        key.SetValue("DisplayIcon", mainExe + ",0");
                        key.SetValue("InstallLocation", installDir);
                        key.SetValue("UninstallString", "\"" + uninstallExe + "\" --uninstall");
                        key.SetValue("QuietUninstallString", "\"" + uninstallExe + "\" --uninstall --quiet");
                        key.SetValue("EstimatedSize", sizeKb, RegistryValueKind.DWord);
                        key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                        key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                        key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
                    }
                }
            }

            if (onProgress != null) onProgress(100, "Installation complete!");
        }

        static int RunUninstall(bool quiet, bool skipSystemIntegration) {
            bool removeUserData = false;
            if (!quiet) {
                var confirm = MessageBox.Show(
                    "Are you sure you want to uninstall LedgerFlow?\n\nYour financial data vault in AppData\\Roaming\\LedgerFlow will be preserved unless you choose to remove it in the next prompt.",
                    "Uninstall LedgerFlow",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question
                );
                if (confirm != DialogResult.Yes) return 0;

                string appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), AppName);
                if (Directory.Exists(appData)) {
                    var delData = MessageBox.Show(
                        "Do you also want to delete your saved transactions, budgets, and backups?\n\nClick YES to permanently delete your local vault, or NO to keep your data safe.",
                        "Remove Financial Data?",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Warning,
                        MessageBoxDefaultButton.Button2
                    );
                    removeUserData = (delData == DialogResult.Yes);
                }
            }

            foreach (var p in Process.GetProcessesByName("LedgerFlow")) {
                try { p.Kill(); p.WaitForExit(3000); } catch { }
            }

            string installDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            if (!skipSystemIntegration) {
                try { Registry.CurrentUser.DeleteSubKeyTree(UninstallRegPath, false); } catch { }
                try {
                    string desktopLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk");
                    if (File.Exists(desktopLnk)) File.Delete(desktopLnk);
                } catch { }
                try {
                    string startDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName);
                    if (Directory.Exists(startDir)) Directory.Delete(startDir, true);
                } catch { }
            }

            if (removeUserData) {
                try {
                    string appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), AppName);
                    if (Directory.Exists(appData)) Directory.Delete(appData, true);
                } catch { }
            }

            try {
                string mainExe = Path.Combine(installDir, "LedgerFlow.exe");
                if (File.Exists(mainExe)) File.Delete(mainExe);
                string readme = Path.Combine(installDir, "README.txt");
                if (File.Exists(readme)) File.Delete(readme);
            } catch { }

            if (!quiet) {
                MessageBox.Show("LedgerFlow has been uninstalled.", "LedgerFlow", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }

            // Self-delete Uninstall.exe & installDir cleanly via cmd after exit
            try {
                var psi = new ProcessStartInfo {
                    FileName = "cmd.exe",
                    Arguments = string.Format("/c ping 127.0.0.1 -n 3 > nul & rmdir /s /q \"{0}\"", installDir),
                    WindowStyle = ProcessWindowStyle.Hidden,
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                Process.Start(psi);
            } catch { }
            return 0;
        }

        static void CreateShortcut(string shortcutPath, string targetPath, string workingDir, string description, string iconLocation, string arguments) {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            object shell = Activator.CreateInstance(shellType);
            try {
                object lnk = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
                Type lnkType = lnk.GetType();
                lnkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { targetPath });
                lnkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { workingDir });
                lnkType.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { description });
                lnkType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { iconLocation });
                if (!string.IsNullOrEmpty(arguments)) {
                    lnkType.InvokeMember("Arguments", BindingFlags.SetProperty, null, lnk, new object[] { arguments });
                }
                lnkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
                Marshal.FinalReleaseComObject(lnk);
            } finally {
                Marshal.FinalReleaseComObject(shell);
            }
        }
    }

    class SetupForm : Form {
        private TextBox txtPath;
        private CheckBox chkDesktop;
        private CheckBox chkStartMenu;
        private CheckBox chkLaunch;
        private ProgressBar progressBar;
        private Label lblStatus;
        private Button btnInstall;
        private Button btnBrowse;
        private Button btnCancel;
        private string installedExePath;
        private bool installDone = false;

        public SetupForm() {
            Text = "LedgerFlow Setup — v1.0.0";
            ClientSize = new Size(560, 420);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(246, 248, 251);
            Font = new Font("Segoe UI", 9.5f);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            // Header Banner
            var banner = new Panel { Dock = DockStyle.Top, Height = 96 };
            banner.Paint += (s, e) => {
                using (var br = new LinearGradientBrush(banner.ClientRectangle, Color.FromArgb(16, 185, 129), Color.FromArgb(79, 70, 229), 15f)) {
                    e.Graphics.FillRectangle(br, banner.ClientRectangle);
                }
                if (Icon != null) {
                    using (var bmp = Icon.ToBitmap()) {
                        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                        e.Graphics.DrawImage(bmp, 24, 22, 52, 52);
                    }
                }
                using (var titleFont = new Font("Segoe UI", 17f, FontStyle.Bold))
                using (var subFont = new Font("Segoe UI", 9.5f, FontStyle.Regular))
                using (var white = new SolidBrush(Color.White))
                using (var soft = new SolidBrush(Color.FromArgb(230, 240, 255))) {
                    e.Graphics.DrawString("Install LedgerFlow", titleFont, white, 90, 22);
                    e.Graphics.DrawString("Stylish, Modern & Offline Personal Finance Software", subFont, soft, 92, 54);
                }
            };
            Controls.Add(banner);

            var lblIntro = new Label {
                Text = "Welcome! LedgerFlow keeps all your expenses, budgets, receipts, and backups privately in your local Windows vault with zero cloud lock-in.",
                Location = new Point(26, 114),
                Size = new Size(508, 40),
                ForeColor = Color.FromArgb(51, 65, 85)
            };
            Controls.Add(lblIntro);

            var lblFolder = new Label {
                Text = "Installation Folder:",
                Location = new Point(26, 166),
                AutoSize = true,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                ForeColor = Color.FromArgb(15, 23, 42)
            };
            Controls.Add(lblFolder);

            txtPath = new TextBox {
                Text = Program.GetDefaultInstallDir(),
                Location = new Point(26, 190),
                Size = new Size(418, 28)
            };
            Controls.Add(txtPath);

            btnBrowse = new Button {
                Text = "Browse...",
                Location = new Point(452, 188),
                Size = new Size(82, 28),
                BackColor = Color.White,
                FlatStyle = FlatStyle.System
            };
            btnBrowse.Click += (s, e) => {
                using (var dlg = new FolderBrowserDialog { SelectedPath = txtPath.Text, Description = "Select where to install LedgerFlow" }) {
                    if (dlg.ShowDialog() == DialogResult.OK) {
                        txtPath.Text = Path.Combine(dlg.SelectedPath, "LedgerFlow");
                    }
                }
            };
            Controls.Add(btnBrowse);

            chkDesktop = new CheckBox { Text = "Create a Desktop shortcut", Checked = true, Location = new Point(28, 232), AutoSize = true };
            chkStartMenu = new CheckBox { Text = "Add Start Menu shortcut & register in Windows Apps", Checked = true, Location = new Point(28, 258), AutoSize = true };
            chkLaunch = new CheckBox { Text = "Launch LedgerFlow immediately after installation", Checked = true, Location = new Point(28, 284), AutoSize = true };
            Controls.AddRange(new Control[] { chkDesktop, chkStartMenu, chkLaunch });

            progressBar = new ProgressBar { Location = new Point(26, 322), Size = new Size(508, 18), Minimum = 0, Maximum = 100 };
            lblStatus = new Label { Text = "Ready to install.", Location = new Point(26, 345), Size = new Size(508, 20), ForeColor = Color.FromArgb(100, 116, 139) };
            Controls.Add(progressBar);
            Controls.Add(lblStatus);

            btnCancel = new Button {
                Text = "Cancel",
                Location = new Point(342, 376),
                Size = new Size(90, 30),
                FlatStyle = FlatStyle.System
            };
            btnCancel.Click += (s, e) => Close();

            btnInstall = new Button {
                Text = "Install Now",
                Location = new Point(440, 376),
                Size = new Size(94, 30),
                BackColor = Color.FromArgb(79, 70, 229),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold)
            };
            btnInstall.FlatAppearance.BorderSize = 0;
            btnInstall.Click += OnInstallClick;

            Controls.Add(btnCancel);
            Controls.Add(btnInstall);
        }

        private void OnInstallClick(object sender, EventArgs e) {
            if (installDone) {
                if (chkLaunch.Checked && File.Exists(installedExePath)) {
                    Process.Start(new ProcessStartInfo { FileName = installedExePath, UseShellExecute = true });
                }
                Close();
                return;
            }

            string targetDir = txtPath.Text.Trim();
            if (string.IsNullOrEmpty(targetDir)) {
                MessageBox.Show("Please specify a valid installation folder.", "LedgerFlow Setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            btnInstall.Enabled = false;
            btnBrowse.Enabled = false;
            txtPath.Enabled = false;
            btnCancel.Enabled = false;

            bool desktop = chkDesktop.Checked;
            bool startMenu = chkStartMenu.Checked;

            ThreadPool.QueueUserWorkItem(_ => {
                try {
                    Program.PerformInstall(targetDir, desktop, startMenu, startMenu, (pct, msg) => {
                        BeginInvoke((Action)(() => {
                            progressBar.Value = pct;
                            lblStatus.Text = msg;
                        }));
                    });
                    installedExePath = Path.Combine(targetDir, "LedgerFlow.exe");
                    BeginInvoke((Action)(() => {
                        installDone = true;
                        lblStatus.Text = "LedgerFlow was installed successfully!";
                        btnInstall.Text = "Finish";
                        btnInstall.Enabled = true;
                        btnCancel.Visible = false;
                    }));
                } catch (Exception ex) {
                    BeginInvoke((Action)(() => {
                        MessageBox.Show("Installation failed: " + ex.Message, "LedgerFlow Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        btnInstall.Enabled = true;
                        btnBrowse.Enabled = true;
                        txtPath.Enabled = true;
                        btnCancel.Enabled = true;
                    }));
                }
            });
        }
    }
}
