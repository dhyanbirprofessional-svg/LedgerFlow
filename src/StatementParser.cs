using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Xml;

namespace LedgerFlowHost {
    public static class StatementParser {
        public class ParseResult {
            public bool ok;
            public bool needsPassword;
            public string format;
            public string error;
            public List<List<string>> rows;
        }

        public class ParseJobState {
            public string jobId;
            public volatile bool done;
            public string phase = "queued";
            public string stage = "Starting parser...";
            public int currentPage;
            public int totalPages;
            public int percent;
            public int txCount;
            public readonly object Sync = new object();
            public List<string> recentTx = new List<string>();
            public ParseResult result;
        }

        private static readonly object JobLock = new object();
        private static readonly Dictionary<string, ParseJobState> ParseJobs = new Dictionary<string, ParseJobState>();
        private static long JobSeq = 0;

        public static bool HasActiveJobs() {
            lock (JobLock) {
                foreach (var kv in ParseJobs) {
                    if (!kv.Value.done) return true;
                }
                return false;
            }
        }

        private static void UpdateJobProgress(ParseJobState job, string phase, string stage, int currentPage, int totalPages, int percent, int? txCount = null, IEnumerable<string> newSnippets = null) {
            if (job == null) return;
            lock (job.Sync) {
                if (phase != null) job.phase = phase;
                if (stage != null) job.stage = stage;
                if (currentPage >= 0) job.currentPage = currentPage;
                if (totalPages >= 0) job.totalPages = totalPages;
                job.percent = Math.Max(0, Math.Min(100, percent));
                if (txCount.HasValue) job.txCount = txCount.Value;
                if (newSnippets != null) {
                    foreach (string s in newSnippets) {
                        if (string.IsNullOrEmpty(s)) continue;
                        job.recentTx.Add(s);
                        if (job.recentTx.Count > 6) job.recentTx.RemoveAt(0);
                    }
                }
            }
        }

        public static string StartParseJob(string jsonBody) {
            var serializer = new JavaScriptSerializer { MaxJsonLength = 128 * 1024 * 1024 };
            string jobId = "job_" + System.Threading.Interlocked.Increment(ref JobSeq) + "_" + DateTime.UtcNow.Ticks;
            var job = new ParseJobState { jobId = jobId, phase = "starting", stage = "Decoding uploaded file...", percent = 3 };
            lock (JobLock) {
                ParseJobs[jobId] = job;
            }
            var th = new System.Threading.Thread(() => {
                try {
                    Dictionary<string, object> req = serializer.Deserialize<Dictionary<string, object>>(jsonBody);
                    string fileName = req.ContainsKey("fileName") && req["fileName"] != null ? req["fileName"].ToString() : "statement.xlsx";
                    string base64 = req.ContainsKey("base64") && req["base64"] != null ? req["base64"].ToString() : "";
                    string password = req.ContainsKey("password") && req["password"] != null ? req["password"].ToString() : "";
                    if (string.IsNullOrEmpty(base64)) {
                        job.result = new ParseResult { ok = false, error = "Empty file payload." };
                    } else {
                        int commaIdx = base64.IndexOf(',');
                        if (commaIdx >= 0 && base64.Substring(0, commaIdx).Contains("base64")) {
                            base64 = base64.Substring(commaIdx + 1);
                        }
                        byte[] bytes = Convert.FromBase64String(base64);
                        base64 = null;
                        job.result = ParseBytes(bytes, fileName, password, job);
                    }
                } catch (Exception ex) {
                    job.result = new ParseResult { ok = false, error = "Parser error: " + ex.Message };
                } finally {
                    lock (job.Sync) {
                        job.percent = 100;
                        job.phase = (job.result != null && job.result.ok) ? "done" : "error";
                        job.stage = (job.result != null && job.result.ok)
                            ? string.Format("Completed! {0} row(s) ready.", job.result.rows != null ? job.result.rows.Count : 0)
                            : (job.result != null ? job.result.error : "Failed");
                        if (job.result != null && job.result.rows != null) {
                            job.txCount = Math.Max(job.txCount, Math.Max(0, job.result.rows.Count - 1));
                        }
                        job.done = true;
                    }
                }
            }) { IsBackground = true };
            th.Start();
            return serializer.Serialize(new Dictionary<string, object> { { "ok", true }, { "jobId", jobId } });
        }

        public static string GetParseJobStatusJson(string jobId) {
            var serializer = new JavaScriptSerializer { MaxJsonLength = 128 * 1024 * 1024 };
            ParseJobState job = null;
            lock (JobLock) {
                ParseJobs.TryGetValue(jobId ?? "", out job);
            }
            if (job == null) {
                return serializer.Serialize(new Dictionary<string, object> { { "ok", false }, { "done", true }, { "error", "Parse job not found." } });
            }
            Dictionary<string, object> snap;
            bool isDone;
            lock (job.Sync) {
                isDone = job.done;
                snap = new Dictionary<string, object> {
                    { "ok", true },
                    { "done", job.done },
                    { "phase", job.phase },
                    { "stage", job.stage },
                    { "currentPage", job.currentPage },
                    { "totalPages", job.totalPages },
                    { "percent", job.percent },
                    { "txCount", job.txCount },
                    { "recentTx", new List<string>(job.recentTx) }
                };
                if (job.done) {
                    snap["result"] = job.result;
                }
            }
            if (isDone) {
                lock (JobLock) {
                    ParseJobs.Remove(jobId);
                }
            }
            return serializer.Serialize(snap);
        }

        public static string HandleParseRequest(string jsonBody) {
            var serializer = new JavaScriptSerializer { MaxJsonLength = 128 * 1024 * 1024 };
            Dictionary<string, object> req;
            try {
                req = serializer.Deserialize<Dictionary<string, object>>(jsonBody);
            } catch (Exception ex) {
                return serializer.Serialize(new ParseResult { ok = false, error = "Invalid request JSON: " + ex.Message });
            }

            string fileName = req.ContainsKey("fileName") && req["fileName"] != null ? req["fileName"].ToString() : "statement.xlsx";
            string base64 = req.ContainsKey("base64") && req["base64"] != null ? req["base64"].ToString() : "";
            string password = req.ContainsKey("password") && req["password"] != null ? req["password"].ToString() : "";

            if (string.IsNullOrEmpty(base64)) {
                return serializer.Serialize(new ParseResult { ok = false, error = "Empty file payload." });
            }

            byte[] bytes;
            try {
                int commaIdx = base64.IndexOf(',');
                if (commaIdx >= 0 && base64.Substring(0, commaIdx).Contains("base64")) {
                    base64 = base64.Substring(commaIdx + 1);
                }
                bytes = Convert.FromBase64String(base64);
            } catch (Exception ex) {
                return serializer.Serialize(new ParseResult { ok = false, error = "Failed to decode file: " + ex.Message });
            }

            ParseResult result = ParseBytes(bytes, fileName, password, null);
            return serializer.Serialize(result);
        }

        public static ParseResult ParseBytes(byte[] bytes, string fileName, string password, ParseJobState job = null) {
            if (bytes == null || bytes.Length == 0) {
                return new ParseResult { ok = false, error = "File is empty." };
            }

            // 0. Check PDF signature (%PDF-) -> Native local PDF text & table extractor
            if (IsPdfSignature(bytes)) {
                return ParsePdfBytes(bytes, password, job);
            }

            // 1. Check ZIP signature (PK\x03\x04) -> .xlsx
            if (bytes.Length >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4B && bytes[2] == 0x03 && bytes[3] == 0x04) {
                try {
                    using (var ms = new MemoryStream(bytes)) {
                        var rows = ParseXlsxStream(ms);
                        return new ParseResult { ok = true, format = "xlsx", rows = rows };
                    }
                } catch (Exception ex) {
                    return new ParseResult { ok = false, format = "xlsx", error = "Failed to read .xlsx workbook: " + ex.Message };
                }
            }

            // 2. Check OLE2 Compound Document (D0 CF 11 E0 A1 B1 1A E1) -> .xls or encrypted .xlsx
            if (bytes.Length >= 8 && bytes[0] == 0xD0 && bytes[1] == 0xCF && bytes[2] == 0x11 && bytes[3] == 0xE0) {
                try {
                    var ole = new Ole2Reader(bytes);
                    byte[] encInfo = ole.GetStream("EncryptionInfo");
                    byte[] encPkg = ole.GetStream("EncryptedPackage");
                    if (encInfo != null && encPkg != null) {
                        if (string.IsNullOrEmpty(password)) {
                            return new ParseResult {
                                ok = false,
                                needsPassword = true,
                                format = "xlsx-encrypted",
                                error = "This Excel file is password-protected. Enter the file password to unlock it."
                            };
                        }
                        byte[] decryptedXlsx;
                        try {
                            decryptedXlsx = DecryptOoxmlPackage(encInfo, encPkg, password);
                        } catch (Exception ex) {
                            return new ParseResult {
                                ok = false,
                                needsPassword = true,
                                format = "xlsx-encrypted",
                                error = "Could not decrypt Excel file (" + ex.Message + "). Check the password and try again."
                            };
                        }
                        using (var ms = new MemoryStream(decryptedXlsx)) {
                            var rows = ParseXlsxStream(ms);
                            return new ParseResult { ok = true, format = "xlsx-encrypted", rows = rows };
                        }
                    }

                    byte[] bookStream = ole.GetStream("Workbook") ?? ole.GetStream("Book");
                    if (bookStream != null) {
                        var rows = ParseBiff8Workbook(bookStream);
                        return new ParseResult { ok = true, format = "xls-biff8", rows = rows };
                    }
                    if (ole.GetStream("EncryptedSummary") != null) {
                        return new ParseResult {
                            ok = false,
                            needsPassword = true,
                            format = "xls-encrypted",
                            error = "Legacy encrypted .xls files cannot be decrypted offline. Please save as .xlsx or .csv in Excel and upload."
                        };
                    }
                } catch (Exception ex) {
                    return new ParseResult { ok = false, format = "xls", error = "Failed to read .xls compound file: " + ex.Message };
                }
            }

            // 3. Text-based formats: HTML (.xls from SBI/Indian banks), XML Spreadsheet 2003, or CSV/TSV
            string text = DecodeTextWithBom(bytes);
            string head = text.Length > 2048 ? text.Substring(0, 2048).ToLowerInvariant() : text.ToLowerInvariant();

            if (head.Contains("<table") || head.Contains("<html") || head.Contains("<tr")) {
                var rows = ParseHtmlTable(text);
                if (rows.Count > 0) return new ParseResult { ok = true, format = "xls-html", rows = rows };
            }

            if (head.Contains("schemas-microsoft-com:office:spreadsheet") || (head.Contains("<workbook") && head.Contains("<row"))) {
                try {
                    var rows = ParseSpreadsheetMl(text);
                    if (rows.Count > 0) return new ParseResult { ok = true, format = "xls-xml", rows = rows };
                } catch { }
            }

            string ext = Path.GetExtension(fileName ?? "").ToLowerInvariant();
            char delim = ext == ".tsv" ? '\t' : DetectDelimiter(text, ext);
            var csvRows = ParseDelimitedText(text, delim);
            return new ParseResult { ok = true, format = "csv", rows = csvRows };
        }

        private static string DecodeTextWithBom(byte[] bytes) {
            if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF) {
                return Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3);
            }
            if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE) {
                return Encoding.Unicode.GetString(bytes, 2, bytes.Length - 2);
            }
            if (bytes.Length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF) {
                return Encoding.BigEndianUnicode.GetString(bytes, 2, bytes.Length - 2);
            }
            return Encoding.UTF8.GetString(bytes);
        }

        private static char DetectDelimiter(string text, string ext) {
            char[] candidates = new[] { '\t', ',', ';' };
            var scores = new Dictionary<char, int>();
            foreach (char c in candidates) scores[c] = 0;

            var lines = new List<string>();
            using (var sr = new StringReader(text)) {
                string line;
                while ((line = sr.ReadLine()) != null && lines.Count < 80) {
                    if (!string.IsNullOrWhiteSpace(line)) lines.Add(line);
                }
            }

            foreach (char d in candidates) {
                var counts = new Dictionary<int, int>();
                foreach (string ln in lines) {
                    int cnt = 0;
                    bool inQ = false;
                    for (int i = 0; i < ln.Length; i++) {
                        char ch = ln[i];
                        if (ch == '"') inQ = !inQ;
                        else if (!inQ && ch == d) cnt++;
                    }
                    if (cnt >= 2) {
                        counts[cnt] = (counts.ContainsKey(cnt) ? counts[cnt] : 0) + 1;
                    }
                }
                int bestFreq = 0;
                foreach (var kv in counts) {
                    if (kv.Value * kv.Key > bestFreq) bestFreq = kv.Value * kv.Key;
                }
                scores[d] = bestFreq;
            }

            if (ext == ".xls" && scores['\t'] > 0 && scores['\t'] >= scores[','] / 2) return '\t';
            if (scores['\t'] > scores[','] && scores['\t'] >= scores[';']) return '\t';
            if (scores[';'] > scores[','] && scores[';'] > scores['\t']) return ';';
            return ',';
        }

        public static List<List<string>> ParseDelimitedText(string text, char delimiter) {
            var rows = new List<List<string>>();
            var row = new List<string>();
            var cur = new StringBuilder();
            bool inQuotes = false;

            for (int i = 0; i < text.Length; i++) {
                char ch = text[i];
                if (inQuotes) {
                    if (ch == '"' && i + 1 < text.Length && text[i + 1] == '"') {
                        cur.Append('"');
                        i++;
                    } else if (ch == '"') {
                        inQuotes = false;
                    } else {
                        cur.Append(ch);
                    }
                } else {
                    if (ch == '"') {
                        inQuotes = true;
                    } else if (ch == delimiter) {
                        row.Add(cur.ToString().Trim());
                        cur.Length = 0;
                    } else if (ch == '\n' || ch == '\r') {
                        if (ch == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
                        row.Add(cur.ToString().Trim());
                        cur.Length = 0;
                        if (RowHasContent(row)) rows.Add(row);
                        row = new List<string>();
                    } else {
                        cur.Append(ch);
                    }
                }
            }
            if (cur.Length > 0 || row.Count > 0) {
                row.Add(cur.ToString().Trim());
                if (RowHasContent(row)) rows.Add(row);
            }
            return rows;
        }

        private static bool RowHasContent(List<string> row) {
            for (int i = 0; i < row.Count; i++) {
                if (!string.IsNullOrEmpty(row[i])) return true;
            }
            return false;
        }

        private static List<List<string>> ParseHtmlTable(string html) {
            var rows = new List<List<string>>();
            var trMatches = Regex.Matches(html, @"<tr\b[^>]*>(.*?)</tr>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
            foreach (Match tr in trMatches) {
                var row = new List<string>();
                var tdMatches = Regex.Matches(tr.Groups[1].Value, @"<t[dh]\b[^>]*>(.*?)</t[dh]>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
                foreach (Match td in tdMatches) {
                    string cell = td.Groups[1].Value;
                    cell = Regex.Replace(cell, @"<br\s*/?>", "\n", RegexOptions.IgnoreCase);
                    cell = Regex.Replace(cell, @"<[^>]+>", " ");
                    cell = WebUtility.HtmlDecode(cell);
                    cell = Regex.Replace(cell, @"\r?\n ", "");
                    cell = Regex.Replace(cell, @"\s+", " ").Trim();
                    row.Add(cell);
                }
                if (row.Count > 0 && RowHasContent(row)) rows.Add(row);
            }
            return rows;
        }

        private static List<List<string>> ParseSpreadsheetMl(string xml) {
            var rows = new List<List<string>>();
            var doc = new XmlDocument();
            doc.XmlResolver = null;
            doc.LoadXml(xml);
            var nsm = new XmlNamespaceManager(doc.NameTable);
            nsm.AddNamespace("ss", "urn:schemas-microsoft-com:office:spreadsheet");
            var rowNodes = doc.SelectNodes("//ss:Worksheet[1]//ss:Table/ss:Row", nsm);
            if (rowNodes == null || rowNodes.Count == 0) {
                rowNodes = doc.SelectNodes("//*[local-name()='Row']");
            }
            if (rowNodes == null) return rows;

            foreach (XmlNode rNode in rowNodes) {
                var row = new List<string>();
                int colIdx = 0;
                foreach (XmlNode cNode in rNode.ChildNodes) {
                    if (cNode.LocalName != "Cell") continue;
                    XmlAttribute idxAttr = cNode.Attributes != null ? (cNode.Attributes["ss:Index"] ?? cNode.Attributes["Index"]) : null;
                    if (idxAttr != null) {
                        int target;
                        if (int.TryParse(idxAttr.Value, out target) && target - 1 > colIdx) {
                            while (colIdx < target - 1) { row.Add(""); colIdx++; }
                        }
                    }
                    string val = "";
                    foreach (XmlNode child in cNode.ChildNodes) {
                        if (child.LocalName == "Data") {
                            val = (child.InnerText ?? "").Trim();
                            XmlAttribute typeAttr = child.Attributes != null ? (child.Attributes["ss:Type"] ?? child.Attributes["Type"]) : null;
                            if (typeAttr != null && typeAttr.Value == "DateTime" && val.Length >= 10) {
                                val = val.Substring(0, 10);
                            }
                            break;
                        }
                    }
                    row.Add(val);
                    colIdx++;
                }
                if (RowHasContent(row)) rows.Add(row);
            }
            return rows;
        }

        /* ---------- XLSX Parser (Zip + XML) ---------- */
        private static List<List<string>> ParseXlsxStream(Stream stream) {
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Read, true)) {
                var sharedStrings = ReadSharedStrings(zip);
                var dateStyleIndices = ReadDateStyleIndices(zip);
                var sheetPaths = FindWorksheetPaths(zip);
                if (sheetPaths.Count == 0) throw new Exception("No worksheet found in workbook.");

                var rows = new List<List<string>>();
                foreach (string sheetPath in sheetPaths) {
                    var entry = GetZipEntryIgnoreCase(zip, sheetPath);
                    if (entry == null) continue;
                    using (var s = entry.Open()) {
                        var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, IgnoreWhitespace = true };
                        using (var xr = XmlReader.Create(s, settings)) {
                            List<string> curRow = null;
                            int nextCol = 0;
                            bool inCell = false;
                            int cellCol = 0;
                            string cellType = "";
                            string styleAttr = "";
                            bool inV = false;
                            bool inT = false;
                            var valBuf = new StringBuilder();

                            while (xr.Read()) {
                                if (xr.NodeType == XmlNodeType.Element) {
                                    if (xr.LocalName == "row") {
                                        curRow = new List<string>();
                                        nextCol = 0;
                                        if (xr.IsEmptyElement) curRow = null;
                                    } else if (xr.LocalName == "c" && curRow != null) {
                                        string cellRef = xr.GetAttribute("r");
                                        cellType = xr.GetAttribute("t") ?? "";
                                        styleAttr = xr.GetAttribute("s") ?? "";
                                        cellCol = !string.IsNullOrEmpty(cellRef) ? ParseColumnIndexFromRef(cellRef) : nextCol;
                                        while (curRow.Count < cellCol) curRow.Add("");
                                        valBuf.Length = 0;
                                        inV = false;
                                        inT = false;
                                        if (xr.IsEmptyElement) {
                                            if (cellCol < curRow.Count) curRow[cellCol] = "";
                                            else curRow.Add("");
                                            nextCol = cellCol + 1;
                                            inCell = false;
                                        } else {
                                            inCell = true;
                                        }
                                    } else if (inCell && xr.LocalName == "v") {
                                        if (!xr.IsEmptyElement) inV = true;
                                    } else if (inCell && xr.LocalName == "t") {
                                        if (!xr.IsEmptyElement) inT = true;
                                    }
                                } else if (xr.NodeType == XmlNodeType.Text || xr.NodeType == XmlNodeType.CDATA || xr.NodeType == XmlNodeType.SignificantWhitespace) {
                                    if (inCell && (inV || inT)) valBuf.Append(xr.Value);
                                } else if (xr.NodeType == XmlNodeType.EndElement) {
                                    if (xr.LocalName == "v") inV = false;
                                    else if (xr.LocalName == "t") inT = false;
                                    else if (xr.LocalName == "c" && inCell && curRow != null) {
                                        string finalVal = FormatXlsxCell(valBuf.ToString(), cellType, styleAttr, sharedStrings, dateStyleIndices);
                                        if (cellCol < curRow.Count) curRow[cellCol] = finalVal;
                                        else curRow.Add(finalVal);
                                        nextCol = cellCol + 1;
                                        inCell = false;
                                    } else if (xr.LocalName == "row" && curRow != null) {
                                        if (RowHasContent(curRow)) rows.Add(curRow);
                                        curRow = null;
                                    }
                                }
                            }
                        }
                    }
                }
                return rows;
            }
        }

        private static ZipArchiveEntry GetZipEntryIgnoreCase(ZipArchive zip, string path) {
            string norm = path.TrimStart('/').Replace('\\', '/');
            foreach (var e in zip.Entries) {
                if (string.Equals(e.FullName.TrimStart('/').Replace('\\', '/'), norm, StringComparison.OrdinalIgnoreCase)) {
                    return e;
                }
            }
            return null;
        }

        private static List<string> ReadSharedStrings(ZipArchive zip) {
            var list = new List<string>();
            var entry = GetZipEntryIgnoreCase(zip, "xl/sharedStrings.xml");
            if (entry == null) return list;

            using (var s = entry.Open()) {
                var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit };
                using (var xr = XmlReader.Create(s, settings)) {
                    var sb = new StringBuilder();
                    bool inSi = false;
                    bool inT = false;
                    bool inRPh = false;
                    while (xr.Read()) {
                        if (xr.NodeType == XmlNodeType.Element && xr.LocalName == "si") {
                            inSi = true;
                            inRPh = false;
                            sb.Length = 0;
                            if (xr.IsEmptyElement) { list.Add(""); inSi = false; }
                        } else if (inSi && xr.NodeType == XmlNodeType.Element && xr.LocalName == "rPh") {
                            if (!xr.IsEmptyElement) inRPh = true;
                        } else if (inSi && !inRPh && xr.NodeType == XmlNodeType.Element && xr.LocalName == "t") {
                            if (!xr.IsEmptyElement) inT = true;
                        } else if (inSi && inT && !inRPh && (xr.NodeType == XmlNodeType.Text || xr.NodeType == XmlNodeType.CDATA || xr.NodeType == XmlNodeType.SignificantWhitespace || xr.NodeType == XmlNodeType.Whitespace)) {
                            sb.Append(xr.Value);
                        } else if (xr.NodeType == XmlNodeType.EndElement && xr.LocalName == "rPh") {
                            inRPh = false;
                        } else if (xr.NodeType == XmlNodeType.EndElement && xr.LocalName == "t") {
                            inT = false;
                        } else if (xr.NodeType == XmlNodeType.EndElement && xr.LocalName == "si") {
                            list.Add(sb.ToString().Trim());
                            inSi = false;
                            inT = false;
                            inRPh = false;
                        }
                    }
                }
            }
            return list;
        }

        private static HashSet<int> ReadDateStyleIndices(ZipArchive zip) {
            var dateStyles = new HashSet<int>();
            var entry = GetZipEntryIgnoreCase(zip, "xl/styles.xml");
            if (entry == null) return dateStyles;

            try {
                var customDateFmtIds = new HashSet<int>();
                var doc = new XmlDocument();
                doc.XmlResolver = null;
                using (var s = entry.Open()) doc.Load(s);

                var numFmts = doc.SelectNodes("//*[local-name()='numFmts']/*[local-name()='numFmt']");
                if (numFmts != null) {
                    foreach (XmlNode n in numFmts) {
                        string idStr = n.Attributes["numFmtId"] != null ? n.Attributes["numFmtId"].Value : "";
                        string code = n.Attributes["formatCode"] != null ? n.Attributes["formatCode"].Value : "";
                        int fmtId;
                        if (int.TryParse(idStr, out fmtId) && IsExcelDateFormatCode(code)) {
                            customDateFmtIds.Add(fmtId);
                        }
                    }
                }

                var xfs = doc.SelectNodes("//*[local-name()='cellXfs']/*[local-name()='xf']");
                if (xfs != null) {
                    for (int i = 0; i < xfs.Count; i++) {
                        XmlNode xf = xfs[i];
                        string idStr = xf.Attributes["numFmtId"] != null ? xf.Attributes["numFmtId"].Value : "";
                        int fmtId;
                        if (int.TryParse(idStr, out fmtId)) {
                            if (IsBuiltInDateFormat(fmtId) || customDateFmtIds.Contains(fmtId)) {
                                dateStyles.Add(i);
                            }
                        }
                    }
                }
            } catch { }
            return dateStyles;
        }

        private static bool IsBuiltInDateFormat(int fmtId) {
            return (fmtId >= 14 && fmtId <= 22) || (fmtId >= 45 && fmtId <= 47);
        }

        private static bool IsExcelDateFormatCode(string code) {
            if (string.IsNullOrEmpty(code)) return false;
            string cleaned = Regex.Replace(code, "\"[^\"]*\"|\\[[^\\]]*\\]|\\\\.", "").ToLowerInvariant();
            if (cleaned.Contains("@")) return false;
            return Regex.IsMatch(cleaned, @"(^|[^a-z])(yy+|yyyy|d{1,2}[^a-z]*m{1,4}|m{1,4}[^a-z]*d{1,2})([^a-z]|$)");
        }

        private static List<string> FindWorksheetPaths(ZipArchive zip) {
            var sheetCandidates = new List<ZipArchiveEntry>();
            foreach (var e in zip.Entries) {
                string n = e.FullName.Replace('\\', '/');
                if (n.StartsWith("xl/worksheets/sheet", StringComparison.OrdinalIgnoreCase) && n.EndsWith(".xml", StringComparison.OrdinalIgnoreCase)) {
                    sheetCandidates.Add(e);
                }
            }
            sheetCandidates.Sort((a, b) => {
                int na = 0, nb = 0;
                int.TryParse(Regex.Match(a.FullName, @"sheet(\d+)\.xml$", RegexOptions.IgnoreCase).Groups[1].Value, out na);
                int.TryParse(Regex.Match(b.FullName, @"sheet(\d+)\.xml$", RegexOptions.IgnoreCase).Groups[1].Value, out nb);
                return na != nb ? na.CompareTo(nb) : string.Compare(a.FullName, b.FullName, StringComparison.OrdinalIgnoreCase);
            });
            var paths = new List<string>();
            foreach (var e in sheetCandidates) paths.Add(e.FullName);
            return paths;
        }

        private static int ParseColumnIndexFromRef(string cellRef) {
            int col = 0;
            for (int i = 0; i < cellRef.Length; i++) {
                char c = cellRef[i];
                if (c >= 'A' && c <= 'Z') col = col * 26 + (c - 'A' + 1);
                else if (c >= 'a' && c <= 'z') col = col * 26 + (c - 'a' + 1);
                else break;
            }
            return Math.Max(0, col - 1);
        }

        private static string FormatXlsxCell(string rawVal, string cellType, string styleAttr, List<string> sharedStrings, HashSet<int> dateStyles) {
            if (string.IsNullOrEmpty(rawVal)) return "";
            if (cellType == "s") {
                int idx;
                if (int.TryParse(rawVal, out idx) && idx >= 0 && idx < sharedStrings.Count) return sharedStrings[idx];
                return "";
            }
            if (cellType == "b") return rawVal == "1" ? "TRUE" : "FALSE";
            if (cellType == "str" || cellType == "inlineStr" || cellType == "e") return rawVal.Trim();

            int styleIdx;
            if (!string.IsNullOrEmpty(styleAttr) && int.TryParse(styleAttr, out styleIdx) && dateStyles.Contains(styleIdx)) {
                double serial;
                if (double.TryParse(rawVal, NumberStyles.Any, CultureInfo.InvariantCulture, out serial) && serial > 1 && serial < 2958465) {
                    try {
                        return DateTime.FromOADate(serial).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                    } catch { }
                }
            }
            return rawVal.Trim();
        }

        /* ---------- OOXML Encrypted Package Decryption (Standard + Agile) ---------- */
        private static byte[] DecryptOoxmlPackage(byte[] encInfo, byte[] encPkg, string password) {
            if (encInfo.Length < 8) throw new Exception("Invalid EncryptionInfo stream.");
            ushort vMajor = BitConverter.ToUInt16(encInfo, 0);
            ushort vMinor = BitConverter.ToUInt16(encInfo, 2);

            if (vMajor == 4 && vMinor == 4) {
                return DecryptAgile(encInfo, encPkg, password);
            }
            if ((vMajor == 3 || vMajor == 4) && vMinor == 2) {
                return DecryptStandard(encInfo, encPkg, password);
            }
            throw new Exception(string.Format("Unsupported Excel encryption version {0}.{1}", vMajor, vMinor));
        }

        private static byte[] DecryptStandard(byte[] encInfo, byte[] encPkg, string password) {
            int headerSize = BitConverter.ToInt32(encInfo, 8);
            int offset = 12 + headerSize;
            int saltSize = BitConverter.ToInt32(encInfo, offset); offset += 4;
            byte[] salt = new byte[saltSize]; Array.Copy(encInfo, offset, salt, 0, saltSize); offset += saltSize;
            byte[] encryptedVerifier = new byte[16]; Array.Copy(encInfo, offset, encryptedVerifier, 0, 16); offset += 16;
            int verifierHashSize = BitConverter.ToInt32(encInfo, offset); offset += 4;
            byte[] encryptedVerifierHash = new byte[32]; Array.Copy(encInfo, offset, encryptedVerifierHash, 0, 32);

            byte[] pwBytes = Encoding.Unicode.GetBytes(password);
            byte[] h;
            using (var sha = SHA1.Create()) {
                byte[] combined = new byte[salt.Length + pwBytes.Length];
                Array.Copy(salt, 0, combined, 0, salt.Length);
                Array.Copy(pwBytes, 0, combined, salt.Length, pwBytes.Length);
                h = sha.ComputeHash(combined);
                for (int i = 0; i < 50000; i++) {
                    byte[] iter = new byte[4 + h.Length];
                    BitConverter.GetBytes(i).CopyTo(iter, 0);
                    Array.Copy(h, 0, iter, 4, h.Length);
                    h = sha.ComputeHash(iter);
                }
                byte[] block0 = new byte[h.Length + 4];
                Array.Copy(h, 0, block0, 0, h.Length);
                h = sha.ComputeHash(block0);
            }

            byte[] cbKey = new byte[16];
            byte[] x1 = new byte[64];
            byte[] x2 = new byte[64];
            for (int i = 0; i < 64; i++) { x1[i] = 0x36; x2[i] = 0x5C; }
            for (int i = 0; i < h.Length; i++) { x1[i] ^= h[i]; x2[i] ^= h[i]; }
            using (var sha = SHA1.Create()) {
                byte[] d1 = sha.ComputeHash(x1);
                Array.Copy(d1, 0, cbKey, 0, 16);
            }

            using (var aes = new AesManaged { Mode = CipherMode.ECB, Padding = PaddingMode.None, Key = cbKey })
            using (var dec = aes.CreateDecryptor()) {
                byte[] verifier = dec.TransformFinalBlock(encryptedVerifier, 0, 16);
                byte[] vHash = dec.TransformFinalBlock(encryptedVerifierHash, 0, 32);
                using (var sha = SHA1.Create()) {
                    byte[] calcHash = sha.ComputeHash(verifier);
                    for (int i = 0; i < Math.Min(20, verifierHashSize); i++) {
                        if (calcHash[i] != vHash[i]) throw new Exception("Incorrect password");
                    }
                }

                long decryptedSize = BitConverter.ToInt64(encPkg, 0);
                int payloadLen = encPkg.Length - 8;
                byte[] decrypted = dec.TransformFinalBlock(encPkg, 8, payloadLen - (payloadLen % 16));
                byte[] trimmed = new byte[Math.Min(decryptedSize, decrypted.Length)];
                Array.Copy(decrypted, 0, trimmed, 0, trimmed.Length);
                return trimmed;
            }
        }

        private static byte[] DecryptAgile(byte[] encInfo, byte[] encPkg, string password) {
            string xmlStr = Encoding.UTF8.GetString(encInfo, 8, encInfo.Length - 8).TrimEnd('\0');
            var doc = new XmlDocument();
            doc.XmlResolver = null;
            doc.LoadXml(xmlStr);

            XmlNode keyDataNode = doc.SelectSingleNode("//*[local-name()='keyData']");
            XmlNode pKeyNode = doc.SelectSingleNode("//*[local-name()='encryptedKey']");
            if (keyDataNode == null || pKeyNode == null) throw new Exception("Missing Agile encryption metadata.");

            int kdKeyBits = int.Parse(keyDataNode.Attributes["keyBits"].Value);
            int kdBlockSize = int.Parse(keyDataNode.Attributes["blockSize"].Value);
            string kdHashAlg = keyDataNode.Attributes["hashAlgorithm"].Value;
            byte[] kdSalt = Convert.FromBase64String(keyDataNode.Attributes["saltValue"].Value);

            int spinCount = int.Parse(pKeyNode.Attributes["spinCount"].Value);
            int pkKeyBits = int.Parse(pKeyNode.Attributes["keyBits"].Value);
            int pkBlockSize = int.Parse(pKeyNode.Attributes["blockSize"].Value);
            string pkHashAlg = pKeyNode.Attributes["hashAlgorithm"].Value;
            byte[] pkSalt = Convert.FromBase64String(pKeyNode.Attributes["saltValue"].Value);
            byte[] encVerifierHashInput = Convert.FromBase64String(pKeyNode.Attributes["encryptedVerifierHashInput"].Value);
            byte[] encVerifierHashValue = Convert.FromBase64String(pKeyNode.Attributes["encryptedVerifierHashValue"].Value);
            byte[] encKeyValue = Convert.FromBase64String(pKeyNode.Attributes["encryptedKeyValue"].Value);

            byte[] verifierInputKey = DeriveAgileKey(password, pkHashAlg, pkSalt, spinCount, pkKeyBits / 8, new byte[] { 0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79 });
            byte[] verifierHashKey = DeriveAgileKey(password, pkHashAlg, pkSalt, spinCount, pkKeyBits / 8, new byte[] { 0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e });
            byte[] keyValueKey = DeriveAgileKey(password, pkHashAlg, pkSalt, spinCount, pkKeyBits / 8, new byte[] { 0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6 });

            byte[] verifierInput = AesCbcDecrypt(encVerifierHashInput, verifierInputKey, PadOrTrim(pkSalt, pkBlockSize));
            byte[] verifierHash = AesCbcDecrypt(encVerifierHashValue, verifierHashKey, PadOrTrim(pkSalt, pkBlockSize));

            using (var alg = CreateHashAlgorithm(pkHashAlg)) {
                byte[] computed = alg.ComputeHash(verifierInput);
                for (int i = 0; i < computed.Length; i++) {
                    if (computed[i] != verifierHash[i]) throw new Exception("Incorrect password");
                }
            }

            byte[] packageKey = AesCbcDecrypt(encKeyValue, keyValueKey, PadOrTrim(pkSalt, pkBlockSize));
            packageKey = PadOrTrim(packageKey, kdKeyBits / 8);

            long totalSize = BitConverter.ToInt64(encPkg, 0);
            var outMs = new MemoryStream();
            int segSize = 4096;
            int pos = 8;
            uint segIdx = 0;
            while (pos < encPkg.Length && outMs.Length < totalSize) {
                int chunkLen = Math.Min(segSize, encPkg.Length - pos);
                int paddedLen = (chunkLen % kdBlockSize == 0) ? chunkLen : chunkLen + (kdBlockSize - (chunkLen % kdBlockSize));
                byte[] chunk = new byte[paddedLen];
                Array.Copy(encPkg, pos, chunk, 0, chunkLen);

                byte[] iv;
                using (var alg = CreateHashAlgorithm(kdHashAlg)) {
                    byte[] ivInput = new byte[kdSalt.Length + 4];
                    Array.Copy(kdSalt, 0, ivInput, 0, kdSalt.Length);
                    BitConverter.GetBytes(segIdx).CopyTo(ivInput, kdSalt.Length);
                    iv = PadOrTrim(alg.ComputeHash(ivInput), kdBlockSize);
                }
                byte[] decChunk = AesCbcDecrypt(chunk, packageKey, iv);
                int writeLen = (int)Math.Min(decChunk.Length, totalSize - outMs.Length);
                outMs.Write(decChunk, 0, writeLen);
                pos += chunkLen;
                segIdx++;
            }
            return outMs.ToArray();
        }

        private static HashAlgorithm CreateHashAlgorithm(string name) {
            string n = (name ?? "SHA512").ToUpperInvariant();
            if (n.Contains("512")) return SHA512.Create();
            if (n.Contains("384")) return SHA384.Create();
            if (n.Contains("256")) return SHA256.Create();
            return SHA1.Create();
        }

        private static byte[] DeriveAgileKey(string password, string hashAlg, byte[] salt, int spinCount, int keyLen, byte[] blockKey) {
            byte[] pwBytes = Encoding.Unicode.GetBytes(password);
            using (var alg = CreateHashAlgorithm(hashAlg)) {
                byte[] init = new byte[salt.Length + pwBytes.Length];
                Array.Copy(salt, 0, init, 0, salt.Length);
                Array.Copy(pwBytes, 0, init, salt.Length, pwBytes.Length);
                byte[] h = alg.ComputeHash(init);
                byte[] iterBuf = new byte[4 + h.Length];
                for (int i = 0; i < spinCount; i++) {
                    BitConverter.GetBytes(i).CopyTo(iterBuf, 0);
                    Array.Copy(h, 0, iterBuf, 4, h.Length);
                    h = alg.ComputeHash(iterBuf);
                }
                byte[] finalBuf = new byte[h.Length + blockKey.Length];
                Array.Copy(h, 0, finalBuf, 0, h.Length);
                Array.Copy(blockKey, 0, finalBuf, h.Length, blockKey.Length);
                return PadOrTrim(alg.ComputeHash(finalBuf), keyLen);
            }
        }

        private static byte[] PadOrTrim(byte[] src, int len) {
            byte[] dst = new byte[len];
            for (int i = 0; i < len; i++) dst[i] = i < src.Length ? src[i] : (byte)0x36;
            return dst;
        }

        private static byte[] AesCbcDecrypt(byte[] data, byte[] key, byte[] iv) {
            using (var aes = new AesManaged { Mode = CipherMode.CBC, Padding = PaddingMode.None, Key = key, IV = iv })
            using (var dec = aes.CreateDecryptor()) {
                return dec.TransformFinalBlock(data, 0, data.Length);
            }
        }

        /* ---------- Minimal OLE2 + BIFF8 (.xls) Reader ---------- */
        private class Ole2Reader {
            private readonly byte[] _data;
            private readonly int _sectorSize;
            private readonly int _miniSectorSize;
            private readonly List<int> _fat = new List<int>();
            private readonly List<int> _miniFat = new List<int>();
            private byte[] _miniStream = new byte[0];
            private readonly Dictionary<string, Entry> _entries = new Dictionary<string, Entry>(StringComparer.OrdinalIgnoreCase);

            private class Entry {
                public string Name;
                public byte Type;
                public int StartSector;
                public long Size;
            }

            public Ole2Reader(byte[] data) {
                _data = data;
                int sectorShift = BitConverter.ToUInt16(data, 30);
                int miniShift = BitConverter.ToUInt16(data, 32);
                _sectorSize = 1 << sectorShift;
                _miniSectorSize = 1 << miniShift;

                int dirStart = BitConverter.ToInt32(data, 48);
                int miniCutoff = BitConverter.ToInt32(data, 56);
                int miniFatStart = BitConverter.ToInt32(data, 60);
                int numMiniFat = BitConverter.ToInt32(data, 64);
                int difatStart = BitConverter.ToInt32(data, 68);
                int numDifat = BitConverter.ToInt32(data, 72);

                var fatSectors = new List<int>();
                for (int i = 0; i < 109; i++) {
                    int s = BitConverter.ToInt32(data, 76 + i * 4);
                    if (s >= 0) fatSectors.Add(s);
                }
                int curDifat = difatStart;
                for (int d = 0; d < numDifat && curDifat >= 0; d++) {
                    int off = SectorOffset(curDifat);
                    int perSec = _sectorSize / 4 - 1;
                    for (int i = 0; i < perSec; i++) {
                        int s = BitConverter.ToInt32(data, off + i * 4);
                        if (s >= 0) fatSectors.Add(s);
                    }
                    curDifat = BitConverter.ToInt32(data, off + perSec * 4);
                }

                foreach (int fs in fatSectors) {
                    int off = SectorOffset(fs);
                    for (int i = 0; i < _sectorSize / 4 && off + i * 4 + 4 <= data.Length; i++) {
                        _fat.Add(BitConverter.ToInt32(data, off + i * 4));
                    }
                }

                if (miniFatStart >= 0 && numMiniFat > 0) {
                    byte[] mfBytes = ReadFatChain(miniFatStart, numMiniFat * _sectorSize);
                    for (int i = 0; i + 4 <= mfBytes.Length; i += 4) {
                        _miniFat.Add(BitConverter.ToInt32(mfBytes, i));
                    }
                }

                byte[] dirBytes = ReadFatChain(dirStart, 1024 * 1024);
                Entry rootEntry = null;
                for (int off = 0; off + 128 <= dirBytes.Length; off += 128) {
                    int nameLen = BitConverter.ToUInt16(dirBytes, off + 64);
                    if (nameLen < 2 || nameLen > 64) continue;
                    string name = Encoding.Unicode.GetString(dirBytes, off, nameLen - 2);
                    byte type = dirBytes[off + 66];
                    int startSec = BitConverter.ToInt32(dirBytes, off + 116);
                    long size = BitConverter.ToUInt32(dirBytes, off + 120);
                    var e = new Entry { Name = name, Type = type, StartSector = startSec, Size = size };
                    if (type == 5) rootEntry = e;
                    else if (type == 2 && !_entries.ContainsKey(name)) _entries[name] = e;
                }

                if (rootEntry != null && rootEntry.StartSector >= 0 && rootEntry.Size > 0) {
                    _miniStream = ReadFatChain(rootEntry.StartSector, rootEntry.Size);
                }
                _miniCutoff = miniCutoff;
            }

            private readonly int _miniCutoff;

            private int SectorOffset(int sec) { return (sec + 1) * _sectorSize; }

            private byte[] ReadFatChain(int startSec, long maxLen) {
                var ms = new MemoryStream();
                int cur = startSec;
                int guard = 0;
                while (cur >= 0 && cur < _fat.Count && guard++ < 50000) {
                    int off = SectorOffset(cur);
                    if (off + _sectorSize <= _data.Length) ms.Write(_data, off, _sectorSize);
                    cur = _fat[cur];
                    if (ms.Length >= maxLen) break;
                }
                byte[] res = ms.ToArray();
                if (res.Length > maxLen) {
                    byte[] trimmed = new byte[maxLen];
                    Array.Copy(res, 0, trimmed, 0, maxLen);
                    return trimmed;
                }
                return res;
            }

            public byte[] GetStream(string name) {
                Entry e;
                if (!_entries.TryGetValue(name, out e)) return null;
                if (e.Size < _miniCutoff && _miniStream.Length > 0) {
                    var ms = new MemoryStream();
                    int cur = e.StartSector;
                    int guard = 0;
                    while (cur >= 0 && cur < _miniFat.Count && guard++ < 50000) {
                        int off = cur * _miniSectorSize;
                        if (off + _miniSectorSize <= _miniStream.Length) ms.Write(_miniStream, off, _miniSectorSize);
                        cur = _miniFat[cur];
                        if (ms.Length >= e.Size) break;
                    }
                    byte[] buf = ms.ToArray();
                    byte[] res = new byte[Math.Min(e.Size, buf.Length)];
                    Array.Copy(buf, 0, res, 0, res.Length);
                    return res;
                }
                return ReadFatChain(e.StartSector, e.Size);
            }
        }

        private static List<List<string>> ParseBiff8Workbook(byte[] stream) {
            var records = new List<KeyValuePair<ushort, byte[]>>();
            int pos = 0;
            while (pos + 4 <= stream.Length) {
                ushort recType = BitConverter.ToUInt16(stream, pos);
                ushort recLen = BitConverter.ToUInt16(stream, pos + 2);
                pos += 4;
                if (pos + recLen > stream.Length) break;
                byte[] payload = new byte[recLen];
                Array.Copy(stream, pos, payload, 0, recLen);
                records.Add(new KeyValuePair<ushort, byte[]>(recType, payload));
                pos += recLen;
            }

            var sst = new List<string>();
            var customDateFmts = new HashSet<int>();
            var xfDateSet = new HashSet<int>();
            int xfIndex = 0;

            // First pass: FORMAT & SST
            for (int i = 0; i < records.Count; i++) {
                ushort t = records[i].Key;
                byte[] d = records[i].Value;
                if (t == 0x041E && d.Length >= 5) { // FORMAT
                    int fmtId = BitConverter.ToUInt16(d, 0);
                    string code = ReadBiff8String(d, 2);
                    if (IsExcelDateFormatCode(code)) customDateFmts.Add(fmtId);
                } else if (t == 0x00FC && d.Length >= 8) { // SST
                    int totalUnique = BitConverter.ToInt32(d, 4);
                    var chunks = new List<byte[]> { d };
                    while (i + 1 < records.Count && records[i + 1].Key == 0x003C) {
                        i++;
                        chunks.Add(records[i].Value);
                    }
                    ParseBiff8Sst(chunks, totalUnique, sst);
                }
            }
            // Pass 1b: XF (after FORMAT so customDateFmts is complete)
            for (int i = 0; i < records.Count; i++) {
                if (records[i].Key == 0x00E0 && records[i].Value.Length >= 4) {
                    int fmtId = BitConverter.ToUInt16(records[i].Value, 2);
                    if (IsBuiltInDateFormat(fmtId) || customDateFmts.Contains(fmtId)) xfDateSet.Add(xfIndex);
                    xfIndex++;
                }
            }

            // Second pass: find first Worksheet BOF (0x0809 with substream type 0x0010)
            var grid = new SortedDictionary<int, SortedDictionary<int, string>>();
            bool inSheet = false;
            int depth = 0;
            for (int i = 0; i < records.Count; i++) {
                ushort t = records[i].Key;
                byte[] d = records[i].Value;
                if (t == 0x0809 && d.Length >= 4) {
                    ushort subType = BitConverter.ToUInt16(d, 2);
                    if (subType == 0x0010 && !inSheet) { inSheet = true; depth = 1; continue; }
                    if (inSheet) depth++;
                } else if (t == 0x000A && inSheet) { // EOF
                    depth--;
                    if (depth <= 0) break;
                }
                if (!inSheet || depth != 1) continue;

                if (t == 0x00FD && d.Length >= 10) { // LABELSST
                    int r = BitConverter.ToUInt16(d, 0);
                    int c = BitConverter.ToUInt16(d, 2);
                    int sIdx = BitConverter.ToInt32(d, 6);
                    string val = (sIdx >= 0 && sIdx < sst.Count) ? sst[sIdx] : "";
                    SetGridCell(grid, r, c, val);
                } else if (t == 0x0204 && d.Length >= 8) { // LABEL
                    int r = BitConverter.ToUInt16(d, 0);
                    int c = BitConverter.ToUInt16(d, 2);
                    string val = ReadBiff8String(d, 6);
                    SetGridCell(grid, r, c, val);
                } else if (t == 0x0203 && d.Length >= 14) { // NUMBER
                    int r = BitConverter.ToUInt16(d, 0);
                    int c = BitConverter.ToUInt16(d, 2);
                    int xf = BitConverter.ToUInt16(d, 4);
                    double num = BitConverter.ToDouble(d, 6);
                    SetGridCell(grid, r, c, FormatBiffNumber(num, xf, xfDateSet));
                } else if (t == 0x027E && d.Length >= 10) { // RK
                    int r = BitConverter.ToUInt16(d, 0);
                    int c = BitConverter.ToUInt16(d, 2);
                    int xf = BitConverter.ToUInt16(d, 4);
                    double num = DecodeRk(BitConverter.ToInt32(d, 6));
                    SetGridCell(grid, r, c, FormatBiffNumber(num, xf, xfDateSet));
                } else if (t == 0x00BD && d.Length >= 6) { // MULRK
                    int r = BitConverter.ToUInt16(d, 0);
                    int cFirst = BitConverter.ToUInt16(d, 2);
                    int count = (d.Length - 6) / 6;
                    for (int k = 0; k < count; k++) {
                        int xf = BitConverter.ToUInt16(d, 4 + k * 6);
                        double num = DecodeRk(BitConverter.ToInt32(d, 6 + k * 6));
                        SetGridCell(grid, r, cFirst + k, FormatBiffNumber(num, xf, xfDateSet));
                    }
                } else if (t == 0x0006 && d.Length >= 20) { // FORMULA
                    int r = BitConverter.ToUInt16(d, 0);
                    int c = BitConverter.ToUInt16(d, 2);
                    int xf = BitConverter.ToUInt16(d, 4);
                    if (d[12] == 0xFF && d[13] == 0xFF) {
                        if (d[6] == 0 && i + 1 < records.Count && records[i + 1].Key == 0x0207) {
                            string val = ReadBiff8String(records[i + 1].Value, 0);
                            SetGridCell(grid, r, c, val);
                        }
                    } else {
                        double num = BitConverter.ToDouble(d, 6);
                        SetGridCell(grid, r, c, FormatBiffNumber(num, xf, xfDateSet));
                    }
                }
            }

            var rows = new List<List<string>>();
            foreach (var rEntry in grid) {
                int maxCol = 0;
                foreach (int cKey in rEntry.Value.Keys) if (cKey > maxCol) maxCol = cKey;
                var row = new List<string>(maxCol + 1);
                for (int c = 0; c <= maxCol; c++) {
                    string val;
                    row.Add(rEntry.Value.TryGetValue(c, out val) ? val : "");
                }
                if (RowHasContent(row)) rows.Add(row);
            }
            return rows;
        }

        private static void SetGridCell(SortedDictionary<int, SortedDictionary<int, string>> grid, int r, int c, string val) {
            SortedDictionary<int, string> row;
            if (!grid.TryGetValue(r, out row)) { row = new SortedDictionary<int, string>(); grid[r] = row; }
            row[c] = (val ?? "").Trim();
        }

        private static string FormatBiffNumber(double num, int xf, HashSet<int> xfDateSet) {
            if (xfDateSet.Contains(xf) && num > 1 && num < 2958465) {
                try { return DateTime.FromOADate(num).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); } catch { }
            }
            return num.ToString("G15", CultureInfo.InvariantCulture);
        }

        private static double DecodeRk(int rk) {
            bool div100 = (rk & 1) != 0;
            bool isInt = (rk & 2) != 0;
            double val;
            if (isInt) {
                val = rk >> 2;
            } else {
                long bits = ((long)(rk & ~3)) << 32;
                val = BitConverter.Int64BitsToDouble(bits);
            }
            return div100 ? val / 100.0 : val;
        }

        private static string ReadBiff8String(byte[] data, int offset) {
            if (offset + 3 > data.Length) { return ""; }
            int cch = BitConverter.ToUInt16(data, offset);
            byte flags = data[offset + 2];
            int p = offset + 3;
            bool isUtf16 = (flags & 0x01) != 0;
            bool hasExt = (flags & 0x04) != 0;
            bool hasRich = (flags & 0x08) != 0;
            if (hasRich) p += 2;
            if (hasExt) p += 4;
            int byteLen = isUtf16 ? cch * 2 : cch;
            byteLen = Math.Min(byteLen, Math.Max(0, data.Length - p));
            return isUtf16
                ? Encoding.Unicode.GetString(data, p, byteLen)
                : Encoding.GetEncoding(1252).GetString(data, p, byteLen);
        }

        private static void ParseBiff8Sst(List<byte[]> chunks, int totalUnique, List<string> sst) {
            int chunkIdx = 0;
            int offset = 8;
            for (int s = 0; s < totalUnique && chunkIdx < chunks.Count; s++) {
                if (offset + 3 > chunks[chunkIdx].Length) {
                    chunkIdx++;
                    offset = 0;
                    if (chunkIdx >= chunks.Count) break;
                }
                byte[] cur = chunks[chunkIdx];
                if (offset + 3 > cur.Length) break;
                int cch = BitConverter.ToUInt16(cur, offset);
                byte flags = cur[offset + 2];
                offset += 3;
                bool isUtf16 = (flags & 0x01) != 0;
                bool hasExt = (flags & 0x04) != 0;
                bool hasRich = (flags & 0x08) != 0;
                int rtRuns = 0;
                if (hasRich && offset + 2 <= cur.Length) { rtRuns = BitConverter.ToUInt16(cur, offset); offset += 2; }
                int extSz = 0;
                if (hasExt && offset + 4 <= cur.Length) { extSz = BitConverter.ToInt32(cur, offset); offset += 4; }

                var sb = new StringBuilder();
                int rem = cch;
                while (rem > 0 && chunkIdx < chunks.Count) {
                    cur = chunks[chunkIdx];
                    int availBytes = cur.Length - offset;
                    if (availBytes <= 0) {
                        chunkIdx++;
                        if (chunkIdx >= chunks.Count) break;
                        byte contFlag = chunks[chunkIdx][0];
                        isUtf16 = (contFlag & 0x01) != 0;
                        offset = 1;
                        continue;
                    }
                    int takeChars = Math.Min(rem, isUtf16 ? availBytes / 2 : availBytes);
                    if (takeChars == 0) {
                        chunkIdx++;
                        if (chunkIdx >= chunks.Count) break;
                        byte contFlag = chunks[chunkIdx][0];
                        isUtf16 = (contFlag & 0x01) != 0;
                        offset = 1;
                        continue;
                    }
                    int takeBytes = isUtf16 ? takeChars * 2 : takeChars;
                    sb.Append(isUtf16 ? Encoding.Unicode.GetString(cur, offset, takeBytes) : Encoding.GetEncoding(1252).GetString(cur, offset, takeBytes));
                    offset += takeBytes;
                    rem -= takeChars;
                }
                sst.Add(sb.ToString());
                int skip = rtRuns * 4 + extSz;
                while (skip > 0 && chunkIdx < chunks.Count) {
                    int avail = chunks[chunkIdx].Length - offset;
                    if (avail >= skip) { offset += skip; skip = 0; }
                    else { skip -= avail; chunkIdx++; offset = 0; }
                }
            }
        }

        /* ---------- Native Local PDF Text & Table Extractor (Zero Dependencies) ---------- */
        private class PdfIndirectObj {
            public int Id;
            public int Gen;
            public string Dict;
            public string RawBody;
            public byte[] RawStream;
            public byte[] DecodedStream;
        }

        private class PdfSecurityCtx {
            public int V;
            public int R;
            public int KeyLenBytes;
            public bool IsAes;
            public bool EncryptMetadata;
            public byte[] FileKey;
        }

        private class PdfCMap {
            public Dictionary<string, string> Map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            public int KeyHexLen = 0; // 2 or 4
        }

        private class PdfTextFrag {
            public int Page;
            public double X;
            public double Y;
            public double FontSize;
            public string Text;
        }

        private class PdfToken {
            public string Kind; // "str", "hex", "name", "num", "op", "arr_start", "arr_end"
            public string Text;
            public byte[] RawBytes;
        }

        private static bool IsPdfSignature(byte[] bytes) {
            if (bytes == null || bytes.Length < 5) return false;
            int lim = Math.Min(1024, bytes.Length - 4);
            for (int i = 0; i <= lim; i++) {
                if (bytes[i] == 0x25 && bytes[i + 1] == 0x50 && bytes[i + 2] == 0x44 && bytes[i + 3] == 0x46 && bytes[i + 4] == 0x2D) {
                    return true;
                }
            }
            return false;
        }

        private static readonly Regex SkipBinaryStreamRe = new Regex(@"(/Subtype\s*/(?:Image|CIDFontType0C|Type1C|OpenType)\b|/Length1\s+\d+\b)", RegexOptions.Compiled);
        private static readonly Regex ObjStmTypeRe = new Regex(@"/Type\s*/ObjStm\b", RegexOptions.Compiled);
        private static readonly Regex PageTypeRe = new Regex(@"/Type\s*/Page\b(?!s)", RegexOptions.Compiled);
        private static readonly Regex PageResKeyRe = new Regex(@"(/Resources\s+\d+\s+\d+\s+R|/Resources\s*<<[^>]*>>|/Parent\s+\d+\s+\d+\s+R)", RegexOptions.Compiled);
        private static readonly Regex LiveTxAmtOrDateRe = new Regex(@"(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{1,3}(?:,\d{2,3})*\.\d{2})", RegexOptions.Compiled);

        private static List<string> ExtractPageLiveSnippets(List<PdfTextFrag> pageFrags, out int txHits) {
            txHits = 0;
            var snippets = new List<string>();
            if (pageFrags == null || pageFrags.Count == 0) return snippets;
            var lines = new List<List<PdfTextFrag>>();
            var sorted = new List<PdfTextFrag>(pageFrags);
            sorted.Sort((a, b) => {
                int yc = b.Y.CompareTo(a.Y);
                return yc != 0 ? yc : a.X.CompareTo(b.X);
            });
            foreach (var f in sorted) {
                if (lines.Count > 0 && Math.Abs(lines[lines.Count - 1][0].Y - f.Y) <= 2.8) {
                    lines[lines.Count - 1].Add(f);
                } else {
                    lines.Add(new List<PdfTextFrag> { f });
                }
            }
            for (int li = 0; li < lines.Count; li++) {
                var ln = lines[li];
                ln.Sort((a, b) => a.X.CompareTo(b.X));
                var sb = new StringBuilder();
                for (int k = 0; k < ln.Count; k++) {
                    string t = (ln[k].Text ?? "").Trim();
                    if (t.Length == 0) continue;
                    if (sb.Length > 0) sb.Append("  ");
                    sb.Append(t);
                    if (sb.Length > 92) break;
                }
                string text = Regex.Replace(sb.ToString(), @"\s+", " ").Trim();
                if (text.Length < 10) continue;
                string lower = text.ToLowerInvariant();
                if (lower.Contains("page no") || lower.Contains("statement summary") || lower.Contains("please do not share")) continue;
                if (LiveTxAmtOrDateRe.IsMatch(text)) {
                    txHits++;
                    if (text.Length > 88) text = text.Substring(0, 85) + "...";
                    snippets.Add(text);
                }
            }
            if (snippets.Count > 5) {
                snippets = snippets.GetRange(snippets.Count - 5, 5);
            }
            return snippets;
        }

        private static ParseResult ParsePdfBytes(byte[] bytes, string password, ParseJobState job = null) {
            try {
                UpdateJobProgress(job, "indexing", "Scanning PDF byte structure (0%)...", 0, 0, 2);
                Encoding latin1 = Encoding.GetEncoding("ISO-8859-1");

                var objs = ParsePdfObjectsFast(bytes, latin1, job);
                PdfSecurityCtx secCtx = null;
                ParseResult encErr = TryUnlockPdfSecurityFast(bytes, latin1, objs, password, out secCtx);
                if (encErr != null) return encErr;

                var globalCMap = new PdfCMap();
                var objCMaps = new Dictionary<int, PdfCMap>();

                // Decrypt (if encrypted) & decompress text/font/objstm streams (skip images & binary font programs to save RAM)
                var objIds = new List<int>(objs.Keys);
                int totalObjs = objIds.Count;
                for (int oi = 0; oi < totalObjs; oi++) {
                    int id = objIds[oi];
                    PdfIndirectObj o = objs[id];
                    if (o.RawStream != null) {
                        string oDict = o.Dict ?? "";
                        if (SkipBinaryStreamRe.IsMatch(oDict)) {
                            o.RawStream = null;
                            continue;
                        }
                        byte[] streamSrc = secCtx != null ? DecryptPdfObjectStream(o.RawStream, o.Id, o.Gen, oDict, secCtx) : o.RawStream;
                        o.DecodedStream = DecodePdfStream(streamSrc, oDict);
                        o.RawStream = null;
                        if (o.DecodedStream != null && o.DecodedStream.Length > 0) {
                            bool isObjStm = ObjStmTypeRe.IsMatch(oDict);
                            if (o.DecodedStream.Length <= 512 * 1024) {
                                string sText = latin1.GetString(o.DecodedStream);
                                if (sText.Contains("beginbfchar") || sText.Contains("beginbfrange")) {
                                    PdfCMap cm = ParsePdfCMap(sText);
                                    objCMaps[id] = cm;
                                    MergeCMap(globalCMap, cm);
                                }
                            }
                            if (isObjStm) {
                                ExtractPdfObjStm(o.DecodedStream, oDict, objs);
                                o.DecodedStream = null;
                            }
                        }
                    }
                    if (job != null && totalObjs > 0 && (oi % 150 == 0 || oi == totalObjs - 1)) {
                        int decPct = 14 + (int)(12.0 * (oi + 1) / totalObjs);
                        UpdateJobProgress(job, "decoding", string.Format("Decoding PDF streams & fonts ({0}/{1} objects)...", oi + 1, totalObjs), 0, 0, decPct);
                    }
                }

                // Collect Page objects and map their content streams & fonts
                var pageObjs = new List<PdfIndirectObj>();
                var pageOrderIds = ResolvePdfPageOrder(objs);
                if (pageOrderIds.Count > 0) {
                    foreach (int pid in pageOrderIds) {
                        PdfIndirectObj po;
                        if (objs.TryGetValue(pid, out po)) pageObjs.Add(po);
                    }
                } else {
                    var sortedIds = new List<int>(objs.Keys);
                    sortedIds.Sort();
                    foreach (int id in sortedIds) {
                        PdfIndirectObj o = objs[id];
                        if (PageTypeRe.IsMatch(o.Dict ?? "")) {
                            pageObjs.Add(o);
                        }
                    }
                }

                var allFrags = new List<PdfTextFrag>();
                var fontCache = new Dictionary<string, Dictionary<string, PdfCMap>>(StringComparer.Ordinal);
                var xobjCache = new Dictionary<string, Dictionary<string, PdfIndirectObj>>(StringComparer.Ordinal);
                int pageNum = 0;
                int totalPages = pageObjs.Count;
                int runningTxHits = 0;

                if (pageObjs.Count > 0) {
                    UpdateJobProgress(job, "reading", string.Format("Reading page 1 of {0}...", totalPages), 0, totalPages, 26, 0);
                    var pageFrags = new List<PdfTextFrag>(256);
                    var batchSnippets = new List<string>();
                    foreach (PdfIndirectObj page in pageObjs) {
                        pageNum++;
                        string cacheKey = null;
                        string pDict = page.Dict ?? "";
                        Match rkm = PageResKeyRe.Match(pDict);
                        if (rkm.Success && !pDict.Contains("/Font <<") && !pDict.Contains("/XObject <<")) {
                            cacheKey = rkm.Groups[1].Value;
                        }
                        Dictionary<string, PdfCMap> fontCMaps;
                        if (cacheKey == null || !fontCache.TryGetValue(cacheKey, out fontCMaps)) {
                            fontCMaps = ResolvePageFontCMaps(page, objs, objCMaps);
                            if (cacheKey != null) fontCache[cacheKey] = fontCMaps;
                        }
                        Dictionary<string, PdfIndirectObj> formXObjs;
                        if (cacheKey == null || !xobjCache.TryGetValue(cacheKey, out formXObjs)) {
                            formXObjs = ResolvePageFormXObjects(page, objs);
                            if (cacheKey != null) xobjCache[cacheKey] = formXObjs;
                        }
                        var contentIds = ExtractPdfContentRefs(page.Dict, objs);
                        var combined = new MemoryStream();
                        foreach (int cid in contentIds) {
                            PdfIndirectObj co;
                            if (objs.TryGetValue(cid, out co) && co.DecodedStream != null) {
                                combined.Write(co.DecodedStream, 0, co.DecodedStream.Length);
                                combined.WriteByte((byte)'\n');
                            }
                        }
                        byte[] pageBytes = combined.ToArray();
                        pageFrags.Clear();
                        if (pageBytes.Length > 0) {
                            ExtractPdfContentText(pageBytes, pageNum, objs, objCMaps, fontCMaps, globalCMap, formXObjs, null, pageFrags, 0);
                            if (pageFrags.Count > 0) {
                                allFrags.AddRange(pageFrags);
                                if (job != null) {
                                    int hits;
                                    var snips = ExtractPageLiveSnippets(pageFrags, out hits);
                                    runningTxHits += hits;
                                    if (snips.Count > 0) {
                                        batchSnippets.AddRange(snips);
                                        if (batchSnippets.Count > 6) {
                                            batchSnippets = batchSnippets.GetRange(batchSnippets.Count - 6, 6);
                                        }
                                    }
                                }
                            }
                        }
                        if (job != null && (pageNum == 1 || pageNum == totalPages || pageNum % 3 == 0)) {
                            int pct = 26 + (int)(62.0 * pageNum / Math.Max(1, totalPages));
                            UpdateJobProgress(
                                job,
                                "reading",
                                string.Format("Reading page {0} of {1}...", pageNum, totalPages),
                                pageNum,
                                totalPages,
                                pct,
                                runningTxHits,
                                batchSnippets
                            );
                            batchSnippets.Clear();
                        }
                    }
                } else {
                    // Fallback: scan decoded streams that look like PDF content operators
                    var sortedIds = new List<int>(objs.Keys);
                    sortedIds.Sort();
                    foreach (int id in sortedIds) {
                        PdfIndirectObj o = objs[id];
                        if (o.DecodedStream == null || o.DecodedStream.Length == 0) continue;
                        if (objCMaps.ContainsKey(id)) continue;
                        string head = latin1.GetString(o.DecodedStream, 0, Math.Min(512, o.DecodedStream.Length));
                        if (head.Contains("BT") || head.Contains("Tj") || head.Contains("TJ")) {
                            pageNum++;
                            var pageFrags = new List<PdfTextFrag>();
                            ExtractPdfContentText(o.DecodedStream, pageNum, objs, objCMaps, new Dictionary<string, PdfCMap>(), globalCMap, null, null, pageFrags, 0);
                            if (pageFrags.Count > 0) allFrags.AddRange(pageFrags);
                        }
                    }
                }

                objs.Clear();
                objCMaps.Clear();
                fontCache.Clear();
                xobjCache.Clear();
                if (allFrags.Count == 0) {
                    return new ParseResult {
                        ok = false,
                        format = "pdf-scanned",
                        error = "No selectable text found in this PDF (it looks like a scanned image PDF). Use 'Paste / OCR Text' or configure Vision AI in Settings."
                    };
                }

                UpdateJobProgress(job, "building", string.Format("Aligning columns across {0} page(s)...", Math.Max(1, totalPages)), totalPages, totalPages, 90, runningTxHits);
                var rows = BuildPdfTableRows(allFrags);
                allFrags.Clear();
                if (rows.Count == 0) {
                    return new ParseResult {
                        ok = false,
                        format = "pdf-empty",
                        error = "Could not extract readable transaction rows from this PDF."
                    };
                }
                UpdateJobProgress(job, "done", string.Format("Extracted {0} row(s) from {1} page(s).", rows.Count, Math.Max(1, totalPages)), totalPages, totalPages, 98, Math.Max(0, rows.Count - 1));
                return new ParseResult { ok = true, format = "pdf", rows = rows };
            } catch (Exception ex) {
                return new ParseResult { ok = false, format = "pdf", error = "Failed to parse PDF locally: " + ex.Message };
            }
        }

        private static bool IsPdfWs(byte b) {
            return b == (byte)' ' || b == (byte)'\t' || b == (byte)'\r' || b == (byte)'\n' || b == (byte)'\f' || b == 0;
        }

        private static bool IsPdfBoundaryOrDelim(byte b) {
            return b <= 32 || b == (byte)'<' || b == (byte)'>' || b == (byte)'/' || b == (byte)'[' || b == (byte)']' || b == (byte)'(' || b == (byte)')' || b == (byte)'%';
        }

        private static int FindBytesAscii(byte[] hay, int start, int limit, string needle) {
            int nLen = needle.Length;
            int end = Math.Min(limit, hay.Length) - nLen;
            if (start < 0 || end < start || nLen == 0) return -1;
            byte first = (byte)needle[0];
            for (int i = start; i <= end; i++) {
                if (hay[i] != first) continue;
                bool ok = true;
                for (int j = 1; j < nLen; j++) {
                    if (hay[i + j] != (byte)needle[j]) { ok = false; break; }
                }
                if (ok) return i;
            }
            return -1;
        }

        private static int ExtractDirectLengthFromDict(string dict) {
            if (string.IsNullOrEmpty(dict)) return -1;
            int idx = 0;
            while ((idx = dict.IndexOf("/Length", idx, StringComparison.Ordinal)) >= 0) {
                int p = idx + 7;
                if (p < dict.Length && dict[p] >= 'A' && dict[p] <= 'z') { idx = p; continue; }
                while (p < dict.Length && dict[p] <= ' ') p++;
                int numStart = p;
                while (p < dict.Length && dict[p] >= '0' && dict[p] <= '9') p++;
                if (p > numStart) {
                    int afterNum = p;
                    while (afterNum < dict.Length && dict[afterNum] <= ' ') afterNum++;
                    int gStart = afterNum;
                    while (afterNum < dict.Length && dict[afterNum] >= '0' && dict[afterNum] <= '9') afterNum++;
                    if (afterNum > gStart) {
                        while (afterNum < dict.Length && dict[afterNum] <= ' ') afterNum++;
                        if (afterNum < dict.Length && dict[afterNum] == 'R') {
                            idx = p;
                            continue; // indirect reference e.g. /Length 55 0 R
                        }
                    }
                    int val;
                    if (int.TryParse(dict.Substring(numStart, p - numStart), out val)) return val;
                }
                idx = p;
            }
            return -1;
        }

        private static Dictionary<int, PdfIndirectObj> ParsePdfObjectsFast(byte[] rawBytes, Encoding latin1, ParseJobState job) {
            var map = new Dictionary<int, PdfIndirectObj>();
            int n = rawBytes.Length;
            int pos = 0;
            int nextReportPos = 512 * 1024;

            while (pos < n) {
                if (job != null && pos >= nextReportPos) {
                    int pct = 2 + (int)(11.0 * pos / Math.Max(1, n));
                    UpdateJobProgress(job, "indexing", string.Format("Indexing PDF ({0:F1} / {1:F1} MB, {2} objects)...", pos / 1048576.0, n / 1048576.0, map.Count), 0, 0, pct);
                    nextReportPos += 512 * 1024;
                }

                byte b = rawBytes[pos];
                if (b < (byte)'0' || b > (byte)'9' || (pos > 0 && !IsPdfWs(rawBytes[pos - 1]))) {
                    pos++;
                    continue;
                }

                int p = pos;
                long idVal = 0;
                int idDigits = 0;
                while (p < n && rawBytes[p] >= (byte)'0' && rawBytes[p] <= (byte)'9') {
                    if (idDigits < 9) idVal = idVal * 10 + (rawBytes[p] - (byte)'0');
                    idDigits++;
                    p++;
                }
                if (idDigits == 0 || idDigits > 9 || p >= n || !IsPdfWs(rawBytes[p])) {
                    pos++;
                    continue;
                }
                while (p < n && IsPdfWs(rawBytes[p])) p++;

                long genVal = 0;
                int genDigits = 0;
                while (p < n && rawBytes[p] >= (byte)'0' && rawBytes[p] <= (byte)'9') {
                    if (genDigits < 5) genVal = genVal * 10 + (rawBytes[p] - (byte)'0');
                    genDigits++;
                    p++;
                }
                if (genDigits == 0 || genDigits > 5 || p >= n || !IsPdfWs(rawBytes[p])) {
                    pos++;
                    continue;
                }
                while (p < n && IsPdfWs(rawBytes[p])) p++;

                if (p + 3 > n || rawBytes[p] != (byte)'o' || rawBytes[p + 1] != (byte)'b' || rawBytes[p + 2] != (byte)'j'
                    || (p + 3 < n && !IsPdfBoundaryOrDelim(rawBytes[p + 3]))) {
                    pos++;
                    continue;
                }

                int id = (int)idVal;
                int gen = (int)genVal;
                int bodyStart = p + 3;

                // Scan for optional << ... >> dictionary
                string dict = "";
                int dictStart = -1;
                int dictEnd = -1;
                int scanLim = Math.Min(n, bodyStart + 4096);
                for (int i = bodyStart; i < scanLim - 1; i++) {
                    byte c = rawBytes[i];
                    if (c <= 32) continue;
                    if (c == (byte)'<') {
                        if (rawBytes[i + 1] == (byte)'<') { dictStart = i; break; }
                        break;
                    }
                    if (c == (byte)'s' && i + 6 <= scanLim && rawBytes[i + 1] == (byte)'t' && rawBytes[i + 2] == (byte)'r'
                        && rawBytes[i + 3] == (byte)'e' && rawBytes[i + 4] == (byte)'a' && rawBytes[i + 5] == (byte)'m') {
                        break;
                    }
                    if (c == (byte)'e' && i + 6 <= scanLim && rawBytes[i + 1] == (byte)'n' && rawBytes[i + 2] == (byte)'d'
                        && rawBytes[i + 3] == (byte)'o' && rawBytes[i + 4] == (byte)'b' && rawBytes[i + 5] == (byte)'j') {
                        break;
                    }
                    if (c == (byte)'%') {
                        while (i < scanLim && rawBytes[i] != (byte)'\n' && rawBytes[i] != (byte)'\r') i++;
                        continue;
                    }
                    break;
                }

                if (dictStart >= 0) {
                    int depth = 0;
                    int dictMax = Math.Min(n - 1, dictStart + 65536);
                    bool inLit = false;
                    int litParen = 0;
                    for (int i = dictStart; i < dictMax; i++) {
                        byte c = rawBytes[i];
                        if (inLit) {
                            if (c == (byte)'\\') { i++; continue; }
                            if (c == (byte)'(') litParen++;
                            else if (c == (byte)')') { litParen--; if (litParen <= 0) inLit = false; }
                            continue;
                        }
                        if (c == (byte)'(') { inLit = true; litParen = 1; continue; }
                        if (c == (byte)'<' && rawBytes[i + 1] == (byte)'<') { depth++; i++; }
                        else if (c == (byte)'>' && rawBytes[i + 1] == (byte)'>') {
                            depth--; i++;
                            if (depth == 0) { dictEnd = i + 1; break; }
                        }
                    }
                    if (dictEnd > dictStart) {
                        dict = latin1.GetString(rawBytes, dictStart, dictEnd - dictStart);
                    }
                }

                int afterDict = dictEnd > 0 ? dictEnd : bodyStart;
                int probe = afterDict;
                while (probe < n && IsPdfWs(rawBytes[probe])) probe++;

                byte[] streamBytes = null;
                string rawBody = "";
                bool isStream = probe + 6 <= n
                    && rawBytes[probe] == (byte)'s' && rawBytes[probe + 1] == (byte)'t' && rawBytes[probe + 2] == (byte)'r'
                    && rawBytes[probe + 3] == (byte)'e' && rawBytes[probe + 4] == (byte)'a' && rawBytes[probe + 5] == (byte)'m'
                    && (probe + 6 == n || IsPdfWs(rawBytes[probe + 6]));

                if (isStream) {
                    int sDataStart = probe + 6;
                    if (sDataStart < n && rawBytes[sDataStart] == (byte)'\r') sDataStart++;
                    if (sDataStart < n && rawBytes[sDataStart] == (byte)'\n') sDataStart++;

                    int declLen = ExtractDirectLengthFromDict(dict);
                    if (declLen >= 0 && sDataStart + declLen <= n) {
                        int tailPos = sDataStart + declLen;
                        int chk = tailPos;
                        while (chk < n && IsPdfWs(rawBytes[chk])) chk++;
                        if (chk + 9 <= n && FindBytesAscii(rawBytes, chk, chk + 9, "endstream") == chk) {
                            if (declLen > 0) {
                                streamBytes = new byte[declLen];
                                Array.Copy(rawBytes, sDataStart, streamBytes, 0, declLen);
                            }
                            pos = chk + 9;
                        }
                    }
                    if (pos <= probe) {
                        int endStreamKw = FindBytesAscii(rawBytes, sDataStart, n, "endstream");
                        if (endStreamKw >= sDataStart) {
                            int sLen = endStreamKw - sDataStart;
                            if (sLen > 0 && rawBytes[sDataStart + sLen - 1] == (byte)'\n') sLen--;
                            if (sLen > 0 && rawBytes[sDataStart + sLen - 1] == (byte)'\r') sLen--;
                            if (sLen > 0) {
                                streamBytes = new byte[sLen];
                                Array.Copy(rawBytes, sDataStart, streamBytes, 0, sLen);
                            }
                            pos = endStreamKw + 9;
                        } else {
                            pos = sDataStart;
                        }
                    }
                    int eoAfter = FindBytesAscii(rawBytes, pos, Math.Min(n, pos + 128), "endobj");
                    if (eoAfter >= pos) pos = eoAfter + 6;
                } else {
                    int endObjPos = FindBytesAscii(rawBytes, afterDict, Math.Min(n, afterDict + 65536), "endobj");
                    if (endObjPos < 0) endObjPos = Math.Min(n, afterDict + 4096);
                    if (string.IsNullOrEmpty(dict) && endObjPos > bodyStart) {
                        rawBody = latin1.GetString(rawBytes, bodyStart, endObjPos - bodyStart).Trim();
                    }
                    pos = Math.Max(bodyStart, endObjPos + 6);
                }

                map[id] = new PdfIndirectObj { Id = id, Gen = gen, Dict = dict, RawBody = rawBody, RawStream = streamBytes };
            }
            if (job != null) {
                UpdateJobProgress(job, "indexing", string.Format("Indexed {0} PDF object(s).", map.Count), 0, 0, 14);
            }
            return map;
        }

        private static ParseResult TryUnlockPdfSecurityFast(byte[] rawBytes, Encoding latin1, Dictionary<int, PdfIndirectObj> objs, string password, out PdfSecurityCtx secCtx) {
            int tailLen = Math.Min(rawBytes.Length, 196 * 1024);
            string tailStr = latin1.GetString(rawBytes, rawBytes.Length - tailLen, tailLen);
            string probeStr = tailStr;
            if (!probeStr.Contains("/Encrypt")) {
                int headLen = Math.Min(rawBytes.Length, 64 * 1024);
                string headStr = latin1.GetString(rawBytes, 0, headLen);
                if (headStr.Contains("/Encrypt")) probeStr = headStr + "\n" + tailStr;
                else {
                    foreach (var kv in objs) {
                        if (!string.IsNullOrEmpty(kv.Value.Dict) && kv.Value.Dict.Contains("/Encrypt")) {
                            probeStr = kv.Value.Dict + "\n" + tailStr;
                            break;
                        }
                    }
                }
            }
            return TryUnlockPdfSecurity(probeStr, objs, password, out secCtx);
        }

        private static byte[] DecodePdfStream(byte[] raw, string dict) {
            if (raw == null || raw.Length == 0) return raw;
            string d = dict ?? "";
            byte[] data = raw;

            bool hasHex = d.Contains("/ASCIIHexDecode");
            bool hasA85 = d.Contains("/ASCII85Decode");
            bool hasLzw = d.Contains("/LZWDecode");
            bool hasFlate = d.Contains("/FlateDecode");

            if (hasHex) data = DecodeAsciiHex(data);
            if (hasA85) data = DecodeAscii85(data);
            if (hasLzw) {
                byte[] lzw = DecodePdfLzw(data);
                if (lzw != null) data = lzw;
            }
            if (hasFlate) {
                byte[] inf = InflateZlibOrRaw(data);
                if (inf != null) data = inf;
                Match predM = Regex.Match(d, @"/Predictor\s+(\d+)");
                if (predM.Success) {
                    int pred = int.Parse(predM.Groups[1].Value);
                    if (pred >= 10) {
                        Match colM = Regex.Match(d, @"/Columns\s+(\d+)");
                        int cols = colM.Success ? int.Parse(colM.Groups[1].Value) : 1;
                        data = UnfilterPngPredictor(data, cols);
                    }
                }
            }
            return data;
        }

        private static byte[] DecodePdfLzw(byte[] data) {
            if (data == null || data.Length == 0) return null;
            try {
                var outMs = new MemoryStream();
                var dict = new List<byte[]>(4096);
                Action resetDict = () => {
                    dict.Clear();
                    for (int i = 0; i < 258; i++) dict.Add(i < 256 ? new byte[] { (byte)i } : new byte[0]);
                };
                resetDict();
                int codeLen = 9, bitBuf = 0, bitCnt = 0, pos = 0, prevCode = -1;
                while (true) {
                    while (bitCnt < codeLen && pos < data.Length) {
                        bitBuf = (bitBuf << 8) | data[pos++];
                        bitCnt += 8;
                    }
                    if (bitCnt < codeLen) break;
                    bitCnt -= codeLen;
                    int code = (bitBuf >> bitCnt) & ((1 << codeLen) - 1);
                    if (code == 256) {
                        resetDict();
                        codeLen = 9;
                        prevCode = -1;
                        continue;
                    }
                    if (code == 257) break;
                    byte[] entry;
                    if (code < dict.Count) {
                        entry = dict[code];
                    } else if (code == dict.Count && prevCode >= 0 && prevCode < dict.Count) {
                        byte[] prev = dict[prevCode];
                        entry = new byte[prev.Length + 1];
                        Array.Copy(prev, entry, prev.Length);
                        entry[prev.Length] = prev[0];
                    } else {
                        break;
                    }
                    outMs.Write(entry, 0, entry.Length);
                    if (prevCode >= 0 && dict.Count < 4096) {
                        byte[] prev = dict[prevCode];
                        byte[] next = new byte[prev.Length + 1];
                        Array.Copy(prev, next, prev.Length);
                        next[prev.Length] = entry[0];
                        dict.Add(next);
                        if (dict.Count == 511) codeLen = 10;
                        else if (dict.Count == 1023) codeLen = 11;
                        else if (dict.Count == 2047) codeLen = 12;
                    }
                    prevCode = code;
                }
                return outMs.Length > 0 ? outMs.ToArray() : null;
            } catch {
                return null;
            }
        }

        private static byte[] InflateZlibOrRaw(byte[] data) {
            if (data == null || data.Length == 0) return null;
            // Try zlib (skip 2-byte header when CMF=8) then raw deflate
            int[] offsets = (data.Length > 2 && (data[0] & 0x0F) == 8) ? new[] { 2, 6, 0 } : new[] { 0, 2, 6 };
            foreach (int off in offsets) {
                if (off >= data.Length) continue;
                try {
                    using (var msIn = new MemoryStream(data, off, data.Length - off))
                    using (var ds = new DeflateStream(msIn, CompressionMode.Decompress))
                    using (var msOut = new MemoryStream()) {
                        byte[] buf = new byte[8192];
                        int n;
                        while ((n = ds.Read(buf, 0, buf.Length)) > 0) msOut.Write(buf, 0, n);
                        if (msOut.Length > 0) return msOut.ToArray();
                    }
                } catch { }
            }
            return null;
        }

        private static byte[] DecodeAsciiHex(byte[] data) {
            var ms = new MemoryStream();
            int hi = -1;
            for (int i = 0; i < data.Length; i++) {
                char c = (char)data[i];
                if (c == '>') break;
                int v = HexVal(c);
                if (v < 0) continue;
                if (hi < 0) hi = v;
                else { ms.WriteByte((byte)((hi << 4) | v)); hi = -1; }
            }
            if (hi >= 0) ms.WriteByte((byte)(hi << 4));
            return ms.ToArray();
        }

        private static byte[] DecodeAscii85(byte[] data) {
            var ms = new MemoryStream();
            uint tuple = 0;
            int count = 0;
            for (int i = 0; i < data.Length; i++) {
                char c = (char)data[i];
                if (c == '~' && i + 1 < data.Length && (char)data[i + 1] == '>') break;
                if (c == 'z' && count == 0) {
                    ms.WriteByte(0); ms.WriteByte(0); ms.WriteByte(0); ms.WriteByte(0);
                    continue;
                }
                if (c < '!' || c > 'u') continue;
                tuple = tuple * 85u + (uint)(c - '!');
                count++;
                if (count == 5) {
                    ms.WriteByte((byte)(tuple >> 24));
                    ms.WriteByte((byte)(tuple >> 16));
                    ms.WriteByte((byte)(tuple >> 8));
                    ms.WriteByte((byte)tuple);
                    tuple = 0;
                    count = 0;
                }
            }
            if (count > 1) {
                for (int k = count; k < 5; k++) tuple = tuple * 85u + 84u;
                for (int k = 0; k < count - 1; k++) {
                    ms.WriteByte((byte)(tuple >> (24 - k * 8)));
                }
            }
            return ms.ToArray();
        }

        private static byte[] UnfilterPngPredictor(byte[] data, int columns) {
            int rowStride = columns + 1;
            if (rowStride <= 1 || data.Length < rowStride) return data;
            var outMs = new MemoryStream();
            byte[] prev = new byte[columns];
            for (int pos = 0; pos + rowStride <= data.Length; pos += rowStride) {
                int f = data[pos];
                byte[] cur = new byte[columns];
                for (int i = 0; i < columns; i++) {
                    int raw = data[pos + 1 + i];
                    int left = i > 0 ? cur[i - 1] : 0;
                    int up = prev[i];
                    int upLeft = i > 0 ? prev[i - 1] : 0;
                    int val = raw;
                    if (f == 1) val = raw + left;
                    else if (f == 2) val = raw + up;
                    else if (f == 3) val = raw + ((left + up) >> 1);
                    else if (f == 4) val = raw + Paeth(left, up, upLeft);
                    cur[i] = (byte)(val & 0xFF);
                }
                outMs.Write(cur, 0, columns);
                prev = cur;
            }
            return outMs.ToArray();
        }

        private static int Paeth(int a, int b, int c) {
            int p = a + b - c;
            int pa = Math.Abs(p - a), pb = Math.Abs(p - b), pc = Math.Abs(p - c);
            if (pa <= pb && pa <= pc) return a;
            return pb <= pc ? b : c;
        }

        private static void ExtractPdfObjStm(byte[] stmBytes, string dict, Dictionary<int, PdfIndirectObj> objs) {
            try {
                Match nM = Regex.Match(dict ?? "", @"/N\s+(\d+)");
                Match fM = Regex.Match(dict ?? "", @"/First\s+(\d+)");
                if (!nM.Success || !fM.Success) return;
                int n = int.Parse(nM.Groups[1].Value);
                int first = int.Parse(fM.Groups[1].Value);
                if (first <= 0 || first > stmBytes.Length) return;

                string hdr = Encoding.ASCII.GetString(stmBytes, 0, first).Trim();
                string[] parts = Regex.Split(hdr, @"\s+");
                if (parts.Length < n * 2) return;

                Encoding latin1 = Encoding.GetEncoding("ISO-8859-1");
                var entries = new List<KeyValuePair<int, int>>();
                for (int i = 0; i < n; i++) {
                    int oid, off;
                    if (int.TryParse(parts[i * 2], out oid) && int.TryParse(parts[i * 2 + 1], out off)) {
                        entries.Add(new KeyValuePair<int, int>(oid, first + off));
                    }
                }
                for (int i = 0; i < entries.Count; i++) {
                    int oid = entries[i].Key;
                    int start = entries[i].Value;
                    int end = (i + 1 < entries.Count) ? entries[i + 1].Value : stmBytes.Length;
                    if (start >= 0 && end > start && end <= stmBytes.Length && !objs.ContainsKey(oid)) {
                        string body = latin1.GetString(stmBytes, start, end - start).Trim();
                        objs[oid] = new PdfIndirectObj { Id = oid, Dict = body, RawStream = null };
                    }
                }
            } catch { }
        }

        private static List<int> ResolvePdfPageOrder(Dictionary<int, PdfIndirectObj> objs) {
            var order = new List<int>();
            try {
                int rootId = -1;
                foreach (var kv in objs) {
                    if (Regex.IsMatch(kv.Value.Dict ?? "", @"/Type\s*/Catalog\b")) {
                        Match pm = Regex.Match(kv.Value.Dict, @"/Pages\s+(\d+)\s+\d+\s+R");
                        if (pm.Success) { rootId = int.Parse(pm.Groups[1].Value); break; }
                    }
                }
                if (rootId < 0) return order;
                var visited = new HashSet<int>();
                WalkPagesTree(rootId, objs, order, visited);
            } catch { }
            return order;
        }

        private static void WalkPagesTree(int nodeId, Dictionary<int, PdfIndirectObj> objs, List<int> order, HashSet<int> visited) {
            if (!visited.Add(nodeId)) return;
            PdfIndirectObj node;
            if (!objs.TryGetValue(nodeId, out node) || string.IsNullOrEmpty(node.Dict)) return;
            if (Regex.IsMatch(node.Dict, @"/Type\s*/Page\b(?!s)")) {
                order.Add(nodeId);
                return;
            }
            Match kidsM = Regex.Match(node.Dict, @"/Kids\s*\[(.*?)\]", RegexOptions.Singleline);
            if (!kidsM.Success) return;
            var refs = Regex.Matches(kidsM.Groups[1].Value, @"(\d+)\s+\d+\s+R");
            foreach (Match r in refs) {
                int kidId;
                if (int.TryParse(r.Groups[1].Value, out kidId)) {
                    WalkPagesTree(kidId, objs, order, visited);
                }
            }
        }

        private static List<int> ExtractPdfContentRefs(string pageDict, Dictionary<int, PdfIndirectObj> objs) {
            var list = new List<int>();
            if (string.IsNullOrEmpty(pageDict)) return list;
            Match arrM = Regex.Match(pageDict, @"/Contents\s*\[(.*?)\]", RegexOptions.Singleline);
            if (arrM.Success) {
                foreach (Match r in Regex.Matches(arrM.Groups[1].Value, @"(\d+)\s+\d+\s+R")) {
                    int id;
                    if (int.TryParse(r.Groups[1].Value, out id)) list.Add(id);
                }
                return list;
            }
            Match singleM = Regex.Match(pageDict, @"/Contents\s+(\d+)\s+\d+\s+R");
            if (singleM.Success) {
                int id;
                if (int.TryParse(singleM.Groups[1].Value, out id)) {
                    PdfIndirectObj co;
                    if (objs != null && objs.TryGetValue(id, out co) && co.RawStream == null && !string.IsNullOrEmpty(co.RawBody) && co.RawBody.StartsWith("[")) {
                        foreach (Match r in Regex.Matches(co.RawBody, @"(\d+)\s+\d+\s+R")) {
                            int subId;
                            if (int.TryParse(r.Groups[1].Value, out subId)) list.Add(subId);
                        }
                    } else {
                        list.Add(id);
                    }
                }
            }
            return list;
        }

        private static string CollectPageResourcesText(PdfIndirectObj page, Dictionary<int, PdfIndirectObj> objs) {
            var sb = new StringBuilder();
            var visited = new HashSet<int>();
            PdfIndirectObj cur = page;
            int guard = 0;
            while (cur != null && !string.IsNullOrEmpty(cur.Dict) && guard++ < 8) {
                sb.Append(' ').Append(cur.Dict);
                Match resRef = Regex.Match(cur.Dict, @"/Resources\s+(\d+)\s+\d+\s+R");
                if (resRef.Success) {
                    int rid = int.Parse(resRef.Groups[1].Value);
                    PdfIndirectObj ro;
                    if (objs.TryGetValue(rid, out ro) && ro.Dict != null) sb.Append(' ').Append(ro.Dict);
                }
                Match parentRef = Regex.Match(cur.Dict, @"/Parent\s+(\d+)\s+\d+\s+R");
                if (!parentRef.Success) break;
                int pid = int.Parse(parentRef.Groups[1].Value);
                if (!visited.Add(pid) || !objs.TryGetValue(pid, out cur)) break;
            }
            return sb.ToString();
        }

        private static Dictionary<string, PdfCMap> ResolvePageFontCMaps(PdfIndirectObj page, Dictionary<int, PdfIndirectObj> objs, Dictionary<int, PdfCMap> objCMaps) {
            var map = new Dictionary<string, PdfCMap>(StringComparer.Ordinal);
            if (page == null || string.IsNullOrEmpty(page.Dict)) return map;
            string resText = CollectPageResourcesText(page, objs);
            foreach (Match fontRef in Regex.Matches(resText, @"/Font\s+(\d+)\s+\d+\s+R")) {
                int fid = int.Parse(fontRef.Groups[1].Value);
                PdfIndirectObj fo;
                if (objs.TryGetValue(fid, out fo) && fo.Dict != null) resText += " " + fo.Dict;
            }
            foreach (Match fm in Regex.Matches(resText, @"/([A-Za-z0-9_+.#-]+)\s+(\d+)\s+\d+\s+R")) {
                string fName = fm.Groups[1].Value;
                int fontObjId = int.Parse(fm.Groups[2].Value);
                PdfIndirectObj fontObj;
                if (!objs.TryGetValue(fontObjId, out fontObj) || string.IsNullOrEmpty(fontObj.Dict)) continue;
                if (!Regex.IsMatch(fontObj.Dict, @"(/Type\s*/Font\b|/Subtype\s*/(?:Type0|Type1|TrueType|CIDFontType0|CIDFontType2|Type3)\b|/ToUnicode\b|/BaseFont\b)")) continue;
                Match tuM = Regex.Match(fontObj.Dict, @"/ToUnicode\s+(\d+)\s+\d+\s+R");
                if (tuM.Success) {
                    int cmId = int.Parse(tuM.Groups[1].Value);
                    PdfCMap cm;
                    if (objCMaps.TryGetValue(cmId, out cm)) map[fName] = cm;
                    else if (!map.ContainsKey(fName)) map[fName] = null;
                } else if (!map.ContainsKey(fName)) {
                    // Explicit sentinel: font is declared without ToUnicode (WinAnsi/Standard), do not corrupt with unrelated globalCMap
                    map[fName] = null;
                }
            }
            return map;
        }

        private static Dictionary<string, PdfIndirectObj> ResolvePageFormXObjects(PdfIndirectObj page, Dictionary<int, PdfIndirectObj> objs) {
            var map = new Dictionary<string, PdfIndirectObj>(StringComparer.Ordinal);
            if (page == null || string.IsNullOrEmpty(page.Dict)) return map;
            string resText = CollectPageResourcesText(page, objs);
            foreach (Match xRef in Regex.Matches(resText, @"/XObject\s+(\d+)\s+\d+\s+R")) {
                int xid = int.Parse(xRef.Groups[1].Value);
                PdfIndirectObj xo;
                if (objs.TryGetValue(xid, out xo) && xo.Dict != null) resText += " " + xo.Dict;
            }
            foreach (Match xm in Regex.Matches(resText, @"/([A-Za-z0-9_+.#-]+)\s+(\d+)\s+\d+\s+R")) {
                string xName = xm.Groups[1].Value;
                int objId = int.Parse(xm.Groups[2].Value);
                PdfIndirectObj xObj;
                if (objs.TryGetValue(objId, out xObj) && xObj.DecodedStream != null
                    && Regex.IsMatch(xObj.Dict ?? "", @"/Subtype\s*/Form\b")) {
                    map[xName] = xObj;
                }
            }
            return map;
        }

        private static PdfCMap ParsePdfCMap(string text) {
            var cm = new PdfCMap();
            foreach (Match blk in Regex.Matches(text, @"beginbfchar\s+(.*?)\s+endbfchar", RegexOptions.Singleline)) {
                var pairs = Regex.Matches(blk.Groups[1].Value, @"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>");
                foreach (Match p in pairs) {
                    string src = p.Groups[1].Value.ToUpperInvariant();
                    string dst = DecodeHexUtf16Be(p.Groups[2].Value);
                    if (src.Length > cm.KeyHexLen) cm.KeyHexLen = src.Length;
                    cm.Map[src] = dst;
                }
            }
            foreach (Match blk in Regex.Matches(text, @"beginbfrange\s+(.*?)\s+endbfrange", RegexOptions.Singleline)) {
                string body = blk.Groups[1].Value;
                // Form 1: <start> <end> <dstStart>
                foreach (Match r1 in Regex.Matches(body, @"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>")) {
                    string sHex = r1.Groups[1].Value;
                    string eHex = r1.Groups[2].Value;
                    string dHex = r1.Groups[3].Value;
                    int w = sHex.Length;
                    if (w > cm.KeyHexLen) cm.KeyHexLen = w;
                    uint startCode, endCode, dstCode;
                    if (uint.TryParse(sHex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out startCode)
                        && uint.TryParse(eHex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out endCode)
                        && dHex.Length <= 8
                        && uint.TryParse(dHex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out dstCode)
                        && endCode >= startCode && (endCode - startCode) <= 4096) {
                        for (uint c = startCode; c <= endCode; c++) {
                            string key = c.ToString("X" + w, CultureInfo.InvariantCulture);
                            uint uc = dstCode + (c - startCode);
                            cm.Map[key] = char.ConvertFromUtf32((int)uc);
                        }
                    }
                }
                // Form 2: <start> <end> [<d1> <d2> ...]
                foreach (Match r2 in Regex.Matches(body, @"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*?)\]", RegexOptions.Singleline)) {
                    string sHex = r2.Groups[1].Value;
                    string eHex = r2.Groups[2].Value;
                    int w = sHex.Length;
                    if (w > cm.KeyHexLen) cm.KeyHexLen = w;
                    uint startCode, endCode;
                    if (uint.TryParse(sHex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out startCode)
                        && uint.TryParse(eHex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out endCode)
                        && endCode >= startCode && (endCode - startCode) <= 4096) {
                        var dstMatches = Regex.Matches(r2.Groups[3].Value, @"<([0-9A-Fa-f]+)>");
                        int idx = 0;
                        for (uint c = startCode; c <= endCode && idx < dstMatches.Count; c++, idx++) {
                            string key = c.ToString("X" + w, CultureInfo.InvariantCulture);
                            cm.Map[key] = DecodeHexUtf16Be(dstMatches[idx].Groups[1].Value);
                        }
                    }
                }
            }
            return cm;
        }

        private static void MergeCMap(PdfCMap target, PdfCMap src) {
            if (src.KeyHexLen > target.KeyHexLen) target.KeyHexLen = src.KeyHexLen;
            foreach (var kv in src.Map) {
                if (!target.Map.ContainsKey(kv.Key)) target.Map[kv.Key] = kv.Value;
            }
        }

        private static string DecodeHexUtf16Be(string hex) {
            if (string.IsNullOrEmpty(hex)) return "";
            if (hex.Length % 2 == 1) hex = "0" + hex;
            byte[] b = new byte[hex.Length / 2];
            for (int i = 0; i < b.Length; i++) {
                b[i] = (byte)((HexVal(hex[i * 2]) << 4) | HexVal(hex[i * 2 + 1]));
            }
            if (b.Length >= 2 && b.Length % 2 == 0) {
                return Encoding.BigEndianUnicode.GetString(b);
            }
            return Encoding.GetEncoding(1252).GetString(b);
        }

        private static int HexVal(char c) {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            return -1;
        }

        private static List<PdfToken> TokenizePdfContent(byte[] bytes) {
            var tokens = new List<PdfToken>();
            int n = bytes.Length;
            int i = 0;
            while (i < n) {
                byte b = bytes[i];
                if (b <= 32) { i++; continue; }
                if (b == (byte)'%') {
                    while (i < n && bytes[i] != (byte)'\n' && bytes[i] != (byte)'\r') i++;
                    continue;
                }
                if (b == (byte)'(') {
                    i++;
                    var ms = new MemoryStream();
                    int depth = 1;
                    while (i < n && depth > 0) {
                        byte ch = bytes[i++];
                        if (ch == (byte)'\\') {
                            if (i >= n) break;
                            byte esc = bytes[i++];
                            if (esc == (byte)'n') ms.WriteByte((byte)'\n');
                            else if (esc == (byte)'r') ms.WriteByte((byte)'\r');
                            else if (esc == (byte)'t') ms.WriteByte((byte)'\t');
                            else if (esc == (byte)'b') ms.WriteByte((byte)'\b');
                            else if (esc == (byte)'f') ms.WriteByte((byte)'\f');
                            else if (esc == (byte)'\r') { if (i < n && bytes[i] == (byte)'\n') i++; }
                            else if (esc == (byte)'\n') { }
                            else if (esc >= (byte)'0' && esc <= (byte)'7') {
                                int oct = esc - (byte)'0';
                                for (int k = 0; k < 2 && i < n && bytes[i] >= (byte)'0' && bytes[i] <= (byte)'7'; k++) {
                                    oct = oct * 8 + (bytes[i++] - (byte)'0');
                                }
                                ms.WriteByte((byte)(oct & 0xFF));
                            } else {
                                ms.WriteByte(esc);
                            }
                        } else if (ch == (byte)'(') {
                            depth++;
                            ms.WriteByte(ch);
                        } else if (ch == (byte)')') {
                            depth--;
                            if (depth > 0) ms.WriteByte(ch);
                        } else {
                            ms.WriteByte(ch);
                        }
                    }
                    tokens.Add(new PdfToken { Kind = "str", RawBytes = ms.ToArray() });
                    continue;
                }
                if (b == (byte)'<') {
                    if (i + 1 < n && bytes[i + 1] == (byte)'<') { i += 2; continue; }
                    i++;
                    var sb = new StringBuilder();
                    while (i < n && bytes[i] != (byte)'>') {
                        char c = (char)bytes[i++];
                        if (HexVal(c) >= 0) sb.Append(c);
                    }
                    if (i < n && bytes[i] == (byte)'>') i++;
                    tokens.Add(new PdfToken { Kind = "hex", Text = sb.ToString() });
                    continue;
                }
                if (b == (byte)'>') {
                    if (i + 1 < n && bytes[i + 1] == (byte)'>') i += 2;
                    else i++;
                    continue;
                }
                if (b == (byte)'[') { tokens.Add(new PdfToken { Kind = "arr_start", Text = "[" }); i++; continue; }
                if (b == (byte)']') { tokens.Add(new PdfToken { Kind = "arr_end", Text = "]" }); i++; continue; }
                if (b == (byte)'/') {
                    i++;
                    var sb = new StringBuilder();
                    while (i < n && bytes[i] > 32 && "()<>[]{}/%".IndexOf((char)bytes[i]) < 0) {
                        sb.Append((char)bytes[i++]);
                    }
                    tokens.Add(new PdfToken { Kind = "name", Text = sb.ToString() });
                    continue;
                }
                var word = new StringBuilder();
                while (i < n && bytes[i] > 32 && "()<>[]{}/%".IndexOf((char)bytes[i]) < 0) {
                    word.Append((char)bytes[i++]);
                }
                string w = word.ToString();
                if (w == "BI" && (tokens.Count == 0 || tokens[tokens.Count - 1].Kind == "op" || tokens[tokens.Count - 1].Kind == "arr_end")) {
                    // Skip inline image BI ... ID <binary> EI so raw pixel bytes never break string tokenization
                    int scan = i;
                    int lim = Math.Min(n, i + 4096);
                    int idPos = -1;
                    while (scan + 2 < lim) {
                        if (bytes[scan] <= 32 && bytes[scan + 1] == (byte)'I' && bytes[scan + 2] == (byte)'D'
                            && (scan + 3 >= n || bytes[scan + 3] <= 32)) {
                            idPos = scan + 4;
                            break;
                        }
                        scan++;
                    }
                    if (idPos > 0) {
                        int eiScan = idPos;
                        while (eiScan + 2 < n) {
                            if (bytes[eiScan] <= 32 && bytes[eiScan + 1] == (byte)'E' && bytes[eiScan + 2] == (byte)'I'
                                && (eiScan + 3 >= n || bytes[eiScan + 3] <= 32)) {
                                i = eiScan + 3;
                                break;
                            }
                            eiScan++;
                        }
                        if (i >= idPos) continue;
                    }
                }
                double dVal;
                if (double.TryParse(w, NumberStyles.Float, CultureInfo.InvariantCulture, out dVal)) {
                    tokens.Add(new PdfToken { Kind = "num", Text = w });
                } else {
                    tokens.Add(new PdfToken { Kind = "op", Text = w });
                }
            }
            return tokens;
        }

        private static string DecodePdfStringToken(PdfToken tok, PdfCMap activeMap, PdfCMap globalMap, bool suppressGlobal) {
            string res = DecodePdfStringTokenRaw(tok, activeMap, suppressGlobal ? null : globalMap);
            return string.IsNullOrEmpty(res) ? "" : res.Replace("\0", "");
        }

        private static string DecodePdfStringTokenRaw(PdfToken tok, PdfCMap activeMap, PdfCMap globalMap) {
            if (tok == null) return "";
            if (tok.Kind == "hex") {
                PdfCMap cm = activeMap ?? globalMap;
                string hex = (tok.Text ?? "").ToUpperInvariant();
                if (hex.Length == 0) return "";
                if (cm != null && cm.Map.Count > 0) {
                    int step = cm.KeyHexLen >= 4 && hex.Length % 4 == 0 ? 4 : (cm.KeyHexLen == 2 ? 2 : (hex.Length % 4 == 0 ? 4 : 2));
                    var sb = new StringBuilder();
                    int hits = 0;
                    for (int i = 0; i + step <= hex.Length; i += step) {
                        string code = hex.Substring(i, step);
                        string val;
                        if (cm.Map.TryGetValue(code, out val)) { sb.Append(val); hits++; }
                        else if (step == 4) {
                            int cp = int.Parse(code, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
                            if (cp >= 32 && cp < 0xD800) sb.Append((char)cp);
                        } else {
                            int cp = int.Parse(code, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
                            if (cp >= 32) sb.Append((char)cp);
                        }
                    }
                    if (hits > 0) return sb.ToString();
                }
                if (hex.StartsWith("FEFF") && hex.Length >= 4 && hex.Length % 4 == 0) {
                    return DecodeHexUtf16Be(hex.Substring(4));
                }
                if (hex.Length % 2 == 0) {
                    byte[] raw = new byte[hex.Length / 2];
                    for (int i = 0; i < raw.Length; i++) raw[i] = (byte)((HexVal(hex[i * 2]) << 4) | HexVal(hex[i * 2 + 1]));
                    return Encoding.GetEncoding(1252).GetString(raw);
                }
                return "";
            }
            if (tok.Kind == "str" && tok.RawBytes != null) {
                byte[] b = tok.RawBytes;
                if (b.Length >= 2 && b[0] == 0xFE && b[1] == 0xFF) {
                    return Encoding.BigEndianUnicode.GetString(b, 2, b.Length - 2);
                }
                PdfCMap cm = activeMap;
                if (cm == null && globalMap != null && globalMap.Map.Count > 0) {
                    int nonPrintable = 0;
                    for (int i = 0; i < b.Length; i++) if (b[i] < 32 && b[i] != 9 && b[i] != 10 && b[i] != 13) nonPrintable++;
                    if (nonPrintable > 0) cm = globalMap;
                }
                if (cm != null && cm.Map.Count > 0) {
                    int byteStep = (cm.KeyHexLen >= 4 && b.Length % 2 == 0) ? 2 : 1;
                    var sb = new StringBuilder();
                    int hits = 0;
                    for (int i = 0; i + byteStep <= b.Length; i += byteStep) {
                        string code = byteStep == 2
                            ? ((b[i] << 8) | b[i + 1]).ToString("X4", CultureInfo.InvariantCulture)
                            : b[i].ToString("X2", CultureInfo.InvariantCulture);
                        string val;
                        if (cm.Map.TryGetValue(code, out val)) { sb.Append(val); hits++; }
                        else if (byteStep == 1 && b[i] >= 32) sb.Append((char)b[i]);
                    }
                    if (hits > 0) return sb.ToString();
                }
                return Encoding.GetEncoding(1252).GetString(b);
            }
            return "";
        }

        private static void ExtractPdfContentText(byte[] contentBytes, int pageNum, Dictionary<int, PdfIndirectObj> objs, Dictionary<int, PdfCMap> objCMaps, Dictionary<string, PdfCMap> fontCMaps, PdfCMap globalCMap, Dictionary<string, PdfIndirectObj> formXObjs, double[] initCtm, List<PdfTextFrag> outFrags, int depth) {
            if (depth > 4) return;
            var tokens = TokenizePdfContent(contentBytes);
            var ops = new List<PdfToken>();
            var ctmStack = new Stack<double[]>();
            double[] ctm = initCtm != null ? (double[])initCtm.Clone() : new double[] { 1, 0, 0, 1, 0, 0 };
            double[] tm = new double[] { 1, 0, 0, 1, 0, 0 };
            double[] tlm = new double[] { 1, 0, 0, 1, 0, 0 };
            double tl = 0;
            double tfSize = 9.0;
            bool inText = false;
            PdfCMap curFontMap = null;
            bool suppressGlobalCMap = (fontCMaps != null && fontCMaps.Count > 0);

            for (int i = 0; i < tokens.Count; i++) {
                PdfToken tok = tokens[i];
                if (tok.Kind != "op") {
                    ops.Add(tok);
                    continue;
                }
                string op = tok.Text;
                if (op == "q") {
                    ctmStack.Push((double[])ctm.Clone());
                } else if (op == "Q") {
                    if (ctmStack.Count > 0) ctm = ctmStack.Pop();
                } else if (op == "cm" && ops.Count >= 6) {
                    double[] m = ReadLast6Nums(ops);
                    ctm = MultiplyPdfMatrix(m, ctm);
                } else if (op == "Do" && ops.Count >= 1 && formXObjs != null) {
                    string xName = ops[ops.Count - 1].Text ?? "";
                    PdfIndirectObj xo;
                    if (formXObjs.TryGetValue(xName, out xo) && xo.DecodedStream != null) {
                        double[] formMat = ParsePdfFormMatrix(xo.Dict);
                        double[] subCtm = formMat != null ? MultiplyPdfMatrix(formMat, ctm) : ctm;
                        var subFonts = fontCMaps;
                        var subXObjs = formXObjs;
                        if (!string.IsNullOrEmpty(xo.Dict) && xo.Dict.Contains("/Resources")) {
                            var ownFonts = ResolvePageFontCMaps(xo, objs, objCMaps);
                            if (ownFonts.Count > 0) {
                                subFonts = new Dictionary<string, PdfCMap>(fontCMaps ?? new Dictionary<string, PdfCMap>(), StringComparer.Ordinal);
                                foreach (var fkv in ownFonts) subFonts[fkv.Key] = fkv.Value;
                            }
                            var ownX = ResolvePageFormXObjects(xo, objs);
                            if (ownX.Count > 0) {
                                subXObjs = new Dictionary<string, PdfIndirectObj>(formXObjs, StringComparer.Ordinal);
                                foreach (var xkv in ownX) subXObjs[xkv.Key] = xkv.Value;
                            }
                        }
                        ExtractPdfContentText(xo.DecodedStream, pageNum, objs, objCMaps, subFonts, globalCMap, subXObjs, subCtm, outFrags, depth + 1);
                    }
                } else if (op == "BT") {
                    inText = true;
                    tm = new double[] { 1, 0, 0, 1, 0, 0 };
                    tlm = new double[] { 1, 0, 0, 1, 0, 0 };
                } else if (op == "ET") {
                    inText = false;
                } else if (op == "Tf" && ops.Count >= 2) {
                    string fName = ops[ops.Count - 2].Text ?? "";
                    PdfCMap fm;
                    if (fontCMaps != null && fontCMaps.TryGetValue(fName, out fm)) {
                        curFontMap = fm;
                        suppressGlobalCMap = true;
                    } else {
                        curFontMap = null;
                        suppressGlobalCMap = (fontCMaps != null && fontCMaps.Count > 0);
                    }
                    double fs;
                    if (double.TryParse(ops[ops.Count - 1].Text, NumberStyles.Float, CultureInfo.InvariantCulture, out fs) && fs > 0.5 && fs < 100) {
                        tfSize = fs;
                    }
                } else if (op == "TL" && ops.Count >= 1) {
                    double.TryParse(ops[ops.Count - 1].Text, NumberStyles.Float, CultureInfo.InvariantCulture, out tl);
                } else if ((op == "Td" || op == "TD") && ops.Count >= 2) {
                    double tx = 0, ty = 0;
                    double.TryParse(ops[ops.Count - 2].Text, NumberStyles.Float, CultureInfo.InvariantCulture, out tx);
                    double.TryParse(ops[ops.Count - 1].Text, NumberStyles.Float, CultureInfo.InvariantCulture, out ty);
                    if (op == "TD") tl = -ty;
                    tlm = MultiplyPdfMatrix(new double[] { 1, 0, 0, 1, tx, ty }, tlm);
                    tm = (double[])tlm.Clone();
                } else if (op == "Tm" && ops.Count >= 6) {
                    double[] m = ReadLast6Nums(ops);
                    tm = m;
                    tlm = (double[])m.Clone();
                } else if (op == "T*") {
                    tlm = MultiplyPdfMatrix(new double[] { 1, 0, 0, 1, 0, -tl }, tlm);
                    tm = (double[])tlm.Clone();
                } else if (inText && (op == "Tj" || op == "'" || op == "\"") && ops.Count >= 1) {
                    if (op == "'" || op == "\"") {
                        tlm = MultiplyPdfMatrix(new double[] { 1, 0, 0, 1, 0, -tl }, tlm);
                        tm = (double[])tlm.Clone();
                    }
                    string txt = DecodePdfStringToken(ops[ops.Count - 1], curFontMap, globalCMap, suppressGlobalCMap);
                    double effSize = ComputeEffectiveFontSize(tfSize, tm, ctm);
                    if (!string.IsNullOrWhiteSpace(txt)) {
                        double[] pt = TransformPdfPoint(tm[4], tm[5], ctm);
                        outFrags.Add(new PdfTextFrag { Page = pageNum, X = pt[0], Y = pt[1], FontSize = effSize, Text = txt });
                        double unscaledW = EstimateTextWidth(txt, tfSize);
                        tm[4] += unscaledW * tm[0];
                        tm[5] += unscaledW * tm[1];
                    }
                } else if (inText && op == "TJ") {
                    int arrStart = -1;
                    for (int k = ops.Count - 1; k >= 0; k--) {
                        if (ops[k].Kind == "arr_start") { arrStart = k; break; }
                    }
                    if (arrStart >= 0) {
                        var sb = new StringBuilder();
                        double[] basePt = TransformPdfPoint(tm[4], tm[5], ctm);
                        double effSize = ComputeEffectiveFontSize(tfSize, tm, ctm);
                        double curX = basePt[0];
                        double totalAdv = 0;
                        for (int k = arrStart + 1; k < ops.Count; k++) {
                            PdfToken el = ops[k];
                            if (el.Kind == "str" || el.Kind == "hex") {
                                sb.Append(DecodePdfStringToken(el, curFontMap, globalCMap, suppressGlobalCMap));
                            } else if (el.Kind == "num") {
                                double kern;
                                if (double.TryParse(el.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out kern)) {
                                    if (kern < -1200) {
                                        string part = sb.ToString();
                                        double adv = Math.Abs(kern) * 0.001 * effSize;
                                        double stepW = !string.IsNullOrWhiteSpace(part) ? EstimateTextWidth(part, effSize) + Math.Max(8.0, adv) : Math.Max(8.0, adv);
                                        if (!string.IsNullOrWhiteSpace(part)) {
                                            outFrags.Add(new PdfTextFrag { Page = pageNum, X = curX, Y = basePt[1], FontSize = effSize, Text = part });
                                        }
                                        curX += stepW;
                                        totalAdv += stepW;
                                        sb.Length = 0;
                                    } else if (kern < -140) {
                                        if (sb.Length > 0 && sb[sb.Length - 1] != ' ') sb.Append(' ');
                                    }
                                }
                            }
                        }
                        string txt = sb.ToString();
                        if (!string.IsNullOrWhiteSpace(txt)) {
                            outFrags.Add(new PdfTextFrag { Page = pageNum, X = curX, Y = basePt[1], FontSize = effSize, Text = txt });
                            totalAdv += EstimateTextWidth(txt, effSize);
                        }
                        if (totalAdv > 0) {
                            double tmScale = Math.Sqrt(tm[0] * tm[0] + tm[1] * tm[1]);
                            double ctmScale = Math.Sqrt(ctm[0] * ctm[0] + ctm[1] * ctm[1]);
                            double scaleDiv = (tmScale > 0.05 ? tmScale : 1.0) * (ctmScale > 0.05 ? ctmScale : 1.0);
                            tm[4] += totalAdv / scaleDiv;
                        }
                    }
                }
                ops.Clear();
            }
        }

        private static double[] ParsePdfFormMatrix(string dict) {
            if (string.IsNullOrEmpty(dict)) return null;
            Match m = Regex.Match(dict, @"/Matrix\s*\[\s*([^\]]+)\]");
            if (!m.Success) return null;
            string[] parts = Regex.Split(m.Groups[1].Value.Trim(), @"\s+");
            if (parts.Length < 6) return null;
            double[] mat = new double[6];
            for (int i = 0; i < 6; i++) {
                if (!double.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out mat[i])) return null;
            }
            return mat;
        }

        private static double EstimateTextWidth(string text, double fsz) {
            if (string.IsNullOrEmpty(text)) return 0;
            double units = 0;
            for (int i = 0; i < text.Length; i++) {
                char c = text[i];
                if (c == ' ' || c == 'i' || c == 'l' || c == 'I' || c == 'j' || c == 't' || c == 'f' || c == 'r'
                    || c == '.' || c == ',' || c == ':' || c == ';' || c == '\'' || c == '|' || c == '/' || c == '(' || c == ')' || c == '1') {
                    units += 0.30;
                } else if (c == 'M' || c == 'W' || c == 'G' || c == 'O' || c == 'Q' || c == 'D' || c == 'H' || c == 'N' || c == 'U' || c == 'B' || c == 'R' || c == 'C' || c == 'K' || c == 'A' || c == 'V' || c == 'X' || c == 'Y' || c == 'Z' || c == '@' || c == '%' || c == '&') {
                    units += 0.60;
                } else {
                    units += 0.47;
                }
            }
            return Math.Max(2.5, units * fsz);
        }

        private static double ComputeEffectiveFontSize(double tfSize, double[] tm, double[] ctm) {
            double tmScale = Math.Sqrt(tm[0] * tm[0] + tm[1] * tm[1]);
            double ctmScale = Math.Sqrt(ctm[0] * ctm[0] + ctm[1] * ctm[1]);
            double sz = tfSize * (tmScale > 0.05 ? tmScale : 1.0) * (ctmScale > 0.05 ? ctmScale : 1.0);
            if (sz < 4.5) sz = 7.0;
            if (sz > 36.0) sz = 12.0;
            return sz;
        }

        private static double[] ReadLast6Nums(List<PdfToken> ops) {
            double[] m = new double[] { 1, 0, 0, 1, 0, 0 };
            int start = ops.Count - 6;
            for (int i = 0; i < 6; i++) {
                double.TryParse(ops[start + i].Text, NumberStyles.Float, CultureInfo.InvariantCulture, out m[i]);
            }
            return m;
        }

        private static double[] MultiplyPdfMatrix(double[] a, double[] b) {
            return new double[] {
                a[0] * b[0] + a[1] * b[2],
                a[0] * b[1] + a[1] * b[3],
                a[2] * b[0] + a[3] * b[2],
                a[2] * b[1] + a[3] * b[3],
                a[4] * b[0] + a[5] * b[2] + b[4],
                a[4] * b[1] + a[5] * b[3] + b[5]
            };
        }

        private static double[] TransformPdfPoint(double x, double y, double[] m) {
            return new double[] { x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5] };
        }

        private class PdfCellSpan {
            public double X;
            public double EndX;
            public string Text;
            public bool RightAlignHint;
        }

        private static bool IsPdfNumericColHeader(string text) {
            return Regex.IsMatch((text ?? "").ToLowerInvariant(), @"(debit|withdrawal|credit|deposit|amount|amt|balance|\bdr\b|\bcr\b)");
        }

        private static bool IsPdfAmountText(string text) {
            return Regex.IsMatch((text ?? "").Trim(), @"^-?[\d,]+\.\d{1,2}(\s*\(?(CR|DR)\.?\)?)?$", RegexOptions.IgnoreCase);
        }

        private static bool IsPdfPlaceholderDash(string text) {
            string t = (text ?? "").Trim();
            return t == "-" || t == "--" || t == "\u2013" || t == "\u2014" || t.Equals("NIL", StringComparison.OrdinalIgnoreCase) || t.Equals("N/A", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsPdfDateLikeText(string text) {
            return Regex.IsMatch((text ?? "").Trim(), @"^(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}[\s\-][A-Za-z]{3,9}[\s\-]\d{2,4})$");
        }

        private static bool IsPdfSummaryOrFooterLine(List<PdfCellSpan> spans) {
            if (spans == null || spans.Count == 0) return false;
            var sb = new StringBuilder();
            for (int i = 0; i < spans.Count; i++) {
                if (i > 0) sb.Append(' ');
                sb.Append(spans[i].Text);
            }
            string joined = Regex.Replace(sb.ToString(), @"\s+", " ").Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(joined)) return false;
            return Regex.IsMatch(joined, @"(\bstatement\s+summary\b|\bbrought\s+forward\b|\bcarried\s+forward\b|\bopening\s+balance\b|\bclosing\s+balance\b|\bdr\.?\s*count\b|\bcr\.?\s*count\b|please do not share|power of attorney holder|letter of authority|computer generated statement|does not require a signature|abbreviations are as under|end of statement|\*\*\*\s*end\s+of|about:blank|^page\s*(no\.?)?\s*\d+(\s*of\s*\d+)?$)");
        }

        private static bool IsPdfHeaderFragmentLine(List<PdfCellSpan> spans) {
            if (spans == null || spans.Count == 0 || spans.Count > 5) return false;
            foreach (var s in spans) {
                string t = (s.Text ?? "").Trim();
                if (string.IsNullOrEmpty(t)) continue;
                if (IsPdfDateLikeText(t) || IsPdfAmountText(t) || IsPdfPlaceholderDash(t)) return false;
                if (Regex.IsMatch(t, @"\d{6,}")) return false;
            }
            var sb = new StringBuilder();
            for (int i = 0; i < spans.Count; i++) {
                if (i > 0) sb.Append(' ');
                sb.Append(spans[i].Text);
            }
            string joined = sb.ToString().ToLowerInvariant();
            return Regex.IsMatch(joined, @"(?:\b(?:date|dt|value|post|txn|tran|details|particulars|particular|description|narration|remarks|remark|ref|cheque|chq|no\.?|debit|withdrawal|credit|deposit|amount|amt|balance|bal|dr|cr)\b|₹|\brs\.?)");
        }

        private static bool IsPdfHeaderCellRow(List<PdfCellSpan> cells) {
            if (cells == null || cells.Count < 3) return false;
            int score = 0;
            bool hasDate = false, hasDesc = false, hasAmt = false;
            foreach (var c in cells) {
                string t = (c.Text ?? "").ToLowerInvariant();
                if (Regex.IsMatch(t, @"\b(date|dt|txndt|trandt|valdt)\b")) { hasDate = true; score++; }
                if (Regex.IsMatch(t, @"(details|particulars|particular|description|narration|remarks|remark|payee)")) { hasDesc = true; score++; }
                if (IsPdfNumericColHeader(t)) { hasAmt = true; score++; }
            }
            return hasDate && (hasDesc || hasAmt) && score >= 3;
        }

        private class PdfSpanLine {
            public double Y;
            public List<PdfCellSpan> Spans;
        }

        private static List<List<string>> BuildPdfTableRows(List<PdfTextFrag> frags) {
            var rows = new List<List<string>>();
            var byPage = new SortedDictionary<int, List<PdfTextFrag>>();
            foreach (var f in frags) {
                List<PdfTextFrag> list;
                if (!byPage.TryGetValue(f.Page, out list)) { list = new List<PdfTextFrag>(); byPage[f.Page] = list; }
                list.Add(f);
            }

            List<PdfCellSpan> activeHeaderCols = null;
            bool inSummarySection = false;
            bool nextRowIsSummaryValues = false;

            foreach (var kv in byPage) {
                var pFrags = kv.Value;
                pFrags.Sort((a, b) => {
                    int yc = b.Y.CompareTo(a.Y); // PDF Y increases upwards -> descending = top-to-bottom
                    return yc != 0 ? yc : a.X.CompareTo(b.X);
                });

                var lines = new List<List<PdfTextFrag>>();
                foreach (var f in pFrags) {
                    if (lines.Count > 0 && Math.Abs(lines[lines.Count - 1][0].Y - f.Y) <= 2.8) {
                        lines[lines.Count - 1].Add(f);
                    } else {
                        lines.Add(new List<PdfTextFrag> { f });
                    }
                }

                var pageSpans = new List<PdfSpanLine>();
                foreach (var line in lines) {
                    line.Sort((a, b) => a.X.CompareTo(b.X));
                    var spans = new List<PdfCellSpan>();
                    var curCell = new StringBuilder();
                    double cellStartX = 0;
                    double prevEndX = double.NaN;
                    double prevFontSz = 9.0;

                    for (int i = 0; i < line.Count; i++) {
                        string t = Regex.Replace(line[i].Text ?? "", @"\s+", " ").Trim();
                        if (string.IsNullOrEmpty(t)) continue;
                        double x = line[i].X;
                        double fsz = line[i].FontSize > 0 ? line[i].FontSize : prevFontSz;
                        bool curIsNum = curCell.Length > 0 && IsPdfAmountText(curCell.ToString().Trim());
                        bool nextIsNum = IsPdfAmountText(t);
                        double splitGap = (!curIsNum && nextIsNum) ? Math.Max(2.0, fsz * 0.28) : Math.Max(6.5, fsz * 0.85);
                        double spaceGap = Math.Max(1.4, fsz * 0.22);

                        if (double.IsNaN(prevEndX)) {
                            cellStartX = x;
                        } else {
                            double gap = x - prevEndX;
                            if (gap > splitGap || (!curIsNum && nextIsNum && x - cellStartX > 30.0 && gap > 0.5)) {
                                string built = curCell.ToString().Trim();
                                if (!string.IsNullOrEmpty(built)) {
                                    spans.Add(new PdfCellSpan { X = cellStartX, EndX = prevEndX, Text = built });
                                }
                                curCell.Length = 0;
                                cellStartX = x;
                            } else if (gap > spaceGap && curCell.Length > 0 && curCell[curCell.Length - 1] != ' ') {
                                curCell.Append(' ');
                            }
                        }
                        curCell.Append(t);
                        prevFontSz = fsz;
                        prevEndX = x + EstimateTextWidth(t, fsz);
                    }
                    string last = curCell.ToString().Trim();
                    if (!string.IsNullOrEmpty(last)) {
                        spans.Add(new PdfCellSpan { X = cellStartX, EndX = prevEndX, Text = last });
                    }
                    if (spans.Count > 0) pageSpans.Add(new PdfSpanLine { Y = line[0].Y, Spans = spans });
                }

                for (int rIdx = 0; rIdx < pageSpans.Count; rIdx++) {
                    var spans = pageSpans[rIdx].Spans;

                    // Try single-line or multi-line wrapped headers (up to 4 lines within 26pt, e.g. Ref No/ + Balance + Value Date... + No)
                    List<PdfCellSpan> matchedHdr = null;
                    int hdrEndIdx = rIdx;

                    if (IsPdfHeaderCellRow(spans)) {
                        matchedHdr = CloneCellSpans(spans);
                    } else if (IsPdfHeaderFragmentLine(spans)) {
                        List<PdfCellSpan> acc = CloneCellSpans(spans);
                        int maxLook = Math.Min(pageSpans.Count - 1, rIdx + 3);
                        for (int k = rIdx + 1; k <= maxLook; k++) {
                            if (Math.Abs(pageSpans[rIdx].Y - pageSpans[k].Y) > 26.0) break;
                            if (!IsPdfHeaderFragmentLine(pageSpans[k].Spans) && !IsPdfHeaderCellRow(pageSpans[k].Spans)) break;
                            acc = MergeTwoHeaderLines(acc, pageSpans[k].Spans);
                            if (IsPdfHeaderCellRow(acc)) {
                                matchedHdr = acc;
                                hdrEndIdx = k;
                                break;
                            }
                        }
                    }

                    if (matchedHdr != null) {
                        // Absorb any immediate trailing wrapped header line (e.g. "No" or "(₹)" or "Balance" within 28pt)
                        while (hdrEndIdx + 1 < pageSpans.Count
                            && Math.Abs(pageSpans[hdrEndIdx].Y - pageSpans[hdrEndIdx + 1].Y) <= 28.0
                            && pageSpans[hdrEndIdx + 1].Spans.Count <= 5
                            && IsPdfHeaderFragmentLine(pageSpans[hdrEndIdx + 1].Spans)
                            && !IsPdfHeaderCellRow(pageSpans[hdrEndIdx + 1].Spans)) {
                            matchedHdr = MergeTwoHeaderLines(matchedHdr, pageSpans[hdrEndIdx + 1].Spans);
                            hdrEndIdx++;
                        }
                        foreach (var s in matchedHdr) s.RightAlignHint = IsPdfNumericColHeader(s.Text);
                        activeHeaderCols = CalibratePdfHeaderColumns(pageSpans, hdrEndIdx + 1, matchedHdr);
                        inSummarySection = false;
                        nextRowIsSummaryValues = false;
                        var hdrRow = new List<string>(matchedHdr.Count);
                        foreach (var s in matchedHdr) hdrRow.Add(s.Text);
                        if (RowHasContent(hdrRow)) rows.Add(hdrRow);
                        rIdx = hdrEndIdx;
                        continue;
                    }

                    if (IsPdfSummaryOrFooterLine(spans)) {
                        var rawRow = new List<string>(spans.Count);
                        bool hasBf = false;
                        bool hasBfHeaderCols = false;
                        foreach (var s in spans) {
                            rawRow.Add(s.Text);
                            if (s.Text != null) {
                                if (s.Text.IndexOf("Brought Forward", StringComparison.OrdinalIgnoreCase) >= 0) hasBf = true;
                                if (s.Text.IndexOf("Dr Count", StringComparison.OrdinalIgnoreCase) >= 0 || s.Text.IndexOf("Total Debits", StringComparison.OrdinalIgnoreCase) >= 0) hasBfHeaderCols = true;
                            }
                        }
                        if (hasBf && !hasBfHeaderCols) {
                            // Single-line "Brought Forward | 241845.44Dr" at top of page table: do NOT disable column alignment for rows below!
                            nextRowIsSummaryValues = false;
                        } else {
                            inSummarySection = true;
                            nextRowIsSummaryValues = hasBf;
                        }
                        if (RowHasContent(rawRow)) rows.Add(rawRow);
                        continue;
                    }

                    if (inSummarySection || nextRowIsSummaryValues) {
                        nextRowIsSummaryValues = false;
                        var rawRow = new List<string>(spans.Count);
                        foreach (var s in spans) rawRow.Add(s.Text);
                        if (RowHasContent(rawRow)) rows.Add(rawRow);
                        continue;
                    }

                    if (activeHeaderCols != null && spans.Count >= 1 && spans.Count <= activeHeaderCols.Count * 3) {
                        int nCols = activeHeaderCols.Count;
                        string[] aligned = new string[nCols];
                        for (int c = 0; c < nCols; c++) aligned[c] = "";

                        foreach (var sp in spans) {
                            int bestCol = MatchPdfHeaderColumn(sp, activeHeaderCols);
                            if (IsPdfPlaceholderDash(sp.Text) && !string.IsNullOrEmpty(aligned[bestCol])) continue;
                            if (string.IsNullOrEmpty(aligned[bestCol])) {
                                aligned[bestCol] = sp.Text;
                            } else {
                                aligned[bestCol] = aligned[bestCol] + " " + sp.Text;
                            }
                        }
                        var rowList = new List<string>(aligned);
                        if (RowHasContent(rowList)) rows.Add(rowList);
                    } else {
                        var rawRow = new List<string>(spans.Count);
                        foreach (var s in spans) rawRow.Add(s.Text);
                        if (RowHasContent(rawRow)) rows.Add(rawRow);
                    }
                }
            }
            return rows;
        }

        private static List<PdfCellSpan> CloneCellSpans(List<PdfCellSpan> src) {
            var list = new List<PdfCellSpan>(src.Count);
            foreach (var t in src) {
                list.Add(new PdfCellSpan { X = t.X, EndX = t.EndX, Text = t.Text, RightAlignHint = t.RightAlignHint });
            }
            return list;
        }

        private static List<PdfCellSpan> MergeTwoHeaderLines(List<PdfCellSpan> top, List<PdfCellSpan> bot) {
            if (top == null || bot == null) return null;
            var merged = CloneCellSpans(top);
            foreach (var b in bot) {
                int best = -1;
                double bestDist = double.MaxValue;
                double bMid = (b.X + b.EndX) * 0.5;
                for (int c = 0; c < merged.Count; c++) {
                    bool overlaps = b.X <= merged[c].EndX + 12.0 && b.EndX >= merged[c].X - 12.0;
                    double d = Math.Min(Math.Abs(b.X - merged[c].X), Math.Abs(bMid - (merged[c].X + merged[c].EndX) * 0.5));
                    if (overlaps && d < bestDist) {
                        bestDist = d;
                        best = c;
                    }
                }
                if (best >= 0) {
                    merged[best].Text = (merged[best].Text + " " + b.Text).Trim();
                    if (b.X < merged[best].X) merged[best].X = b.X;
                    if (b.EndX > merged[best].EndX) merged[best].EndX = b.EndX;
                } else {
                    merged.Add(new PdfCellSpan { X = b.X, EndX = b.EndX, Text = b.Text, RightAlignHint = b.RightAlignHint });
                }
            }
            merged.Sort((a, b) => a.X.CompareTo(b.X));
            return merged;
        }

        private static List<PdfCellSpan> CalibratePdfHeaderColumns(List<PdfSpanLine> pageSpans, int startRow, List<PdfCellSpan> hdrCols) {
            var cal = CloneCellSpans(hdrCols);
            int limit = Math.Min(pageSpans.Count, startRow + 35);

            // Pass 1: Calibrate exact 1-to-1 full rows (spans.Count == cal.Count) so centered headers like "Details" learn true left/right bounds
            for (int r = startRow; r < limit; r++) {
                var spans = pageSpans[r].Spans;
                if (IsPdfHeaderCellRow(spans) || IsPdfSummaryOrFooterLine(spans)) break;
                if (spans.Count != cal.Count) continue;
                if (!IsPdfDateLikeText(spans[0].Text)) continue;
                bool okOrder = true;
                for (int c = 1; c < cal.Count; c++) {
                    if (spans[c].X <= spans[c - 1].EndX) { okOrder = false; break; }
                }
                if (!okOrder) continue;
                for (int c = 0; c < cal.Count; c++) {
                    var sp = spans[c];
                    double minLeft = c == 0 ? 0.0 : cal[c - 1].EndX + 2.0;
                    double maxRight = c == cal.Count - 1 ? 2000.0 : cal[c + 1].X - 2.0;
                    if (sp.X >= minLeft && sp.EndX <= maxRight) {
                        if (sp.X < cal[c].X && Math.Abs(cal[c].X - sp.X) <= 180.0) cal[c].X = sp.X;
                        if (sp.EndX > cal[c].EndX && Math.Abs(sp.EndX - cal[c].EndX) <= 180.0) cal[c].EndX = sp.EndX;
                    }
                }
            }

            // Pass 2: Refine bounds from remaining transaction rows
            for (int r = startRow; r < limit; r++) {
                var spans = pageSpans[r].Spans;
                if (IsPdfHeaderCellRow(spans) || IsPdfSummaryOrFooterLine(spans)) break;
                if (spans.Count < Math.Max(3, cal.Count - 4)) continue;
                foreach (var sp in spans) {
                    bool isNum = IsPdfAmountText(sp.Text);
                    int best = MatchPdfHeaderColumn(sp, cal);
                    double minLeft = best == 0 ? 0.0 : cal[best - 1].EndX + 3.0;
                    double maxRight = best == cal.Count - 1 ? 2000.0 : cal[best + 1].X - 3.0;
                    if (isNum && cal[best].RightAlignHint) {
                        if (sp.X < cal[best].X && sp.X >= minLeft && Math.Abs(cal[best].X - sp.X) <= 32.0) cal[best].X = sp.X;
                        if (sp.EndX > cal[best].EndX && sp.EndX <= maxRight && Math.Abs(sp.EndX - cal[best].EndX) <= 32.0) cal[best].EndX = sp.EndX;
                    } else if (!isNum && !IsPdfPlaceholderDash(sp.Text) && !cal[best].RightAlignHint) {
                        if (sp.X < cal[best].X && sp.X >= minLeft && Math.Abs(cal[best].X - sp.X) <= 140.0) cal[best].X = sp.X;
                        if (sp.EndX > cal[best].EndX && sp.EndX <= maxRight && Math.Abs(sp.EndX - cal[best].EndX) <= 140.0) cal[best].EndX = sp.EndX;
                    }
                }
            }
            return cal;
        }

        private static int MatchPdfHeaderColumn(PdfCellSpan sp, List<PdfCellSpan> cols) {
            int nCols = cols.Count;
            double spCenter = (sp.X + sp.EndX) * 0.5;
            bool spIsNum = IsPdfAmountText(sp.Text);
            bool spIsDash = IsPdfPlaceholderDash(sp.Text);

            int bestCol = 0;
            double bestScore = double.MaxValue;
            for (int c = 0; c < nCols; c++) {
                double leftBound = c == 0 ? double.NegativeInfinity : (cols[c - 1].RightAlignHint ? Math.Max(cols[c - 1].EndX + 2.0, (cols[c - 1].EndX + cols[c].X) * 0.5) : Math.Min(cols[c].X - 4.0, (cols[c - 1].EndX + cols[c].X) * 0.5));
                double rightBound = c == nCols - 1 ? double.PositiveInfinity : (cols[c].RightAlignHint ? Math.Max(cols[c].EndX + 12.0, (cols[c].EndX + cols[c + 1].X) * 0.5) : Math.Max(cols[c].EndX, (cols[c].EndX + cols[c + 1].X) * 0.5));
                double colCenter = (cols[c].X + cols[c].EndX) * 0.5;

                double dist;
                if (sp.X >= cols[c].X - 2.0 && sp.EndX <= cols[c].EndX + 4.0) {
                    dist = 0.5;
                } else if (cols[c].RightAlignHint) {
                    dist = Math.Min(Math.Abs(sp.EndX - cols[c].EndX), Math.Abs(spCenter - colCenter));
                } else {
                    dist = Math.Min(Math.Abs(sp.X - cols[c].X), Math.Abs(spCenter - colCenter));
                }

                // Prefer interval containment strongly, and slightly penalize real text landing in numeric columns
                if ((spCenter >= leftBound && spCenter <= rightBound) || (sp.X >= leftBound && sp.X <= rightBound) || (spIsNum && cols[c].RightAlignHint && sp.EndX >= leftBound && sp.EndX <= rightBound + 8.0)) dist *= 0.28;
                if ((spIsNum || spIsDash) && cols[c].RightAlignHint) dist *= 0.7;
                else if (!spIsNum && !spIsDash && cols[c].RightAlignHint && sp.X < cols[c].X - 18.0) dist += 40.0;

                if (dist < bestScore) {
                    bestScore = dist;
                    bestCol = c;
                }
            }
            return bestCol;
        }

        /* ---------- PDF Standard Security Handler Decryption (R=2,3,4 RC4/AES-128 & R=5,6 AES-256) ---------- */
        private static readonly byte[] PdfPwPadding = new byte[] {
            0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
            0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A
        };

        private static ParseResult TryUnlockPdfSecurity(string pdfStr, Dictionary<int, PdfIndirectObj> objs, string password, out PdfSecurityCtx secCtx) {
            secCtx = null;
            string encDict = null;
            Match encRefM = Regex.Match(pdfStr, @"/Encrypt\s+(\d+)\s+\d+\s+R");
            if (encRefM.Success) {
                int eid;
                PdfIndirectObj eo;
                if (int.TryParse(encRefM.Groups[1].Value, out eid) && objs.TryGetValue(eid, out eo)) {
                    encDict = eo.Dict;
                }
            } else {
                Match encInlineM = Regex.Match(pdfStr, @"/Encrypt\s*<<");
                if (encInlineM.Success) {
                    int start = encInlineM.Index + encInlineM.Length - 2;
                    int depth = 0;
                    for (int i = start; i < pdfStr.Length - 1; i++) {
                        if (pdfStr[i] == '<' && pdfStr[i + 1] == '<') { depth++; i++; }
                        else if (pdfStr[i] == '>' && pdfStr[i + 1] == '>') {
                            depth--; i++;
                            if (depth == 0) { encDict = pdfStr.Substring(start, i + 1 - start); break; }
                        }
                    }
                }
            }
            if (string.IsNullOrEmpty(encDict)) return null;

            int v = ParsePdfDictInt(encDict, "V", 0);
            int r = ParsePdfDictInt(encDict, "R", 2);
            int lenBits = ParsePdfDictInt(encDict, "Length", v == 1 ? 40 : (v >= 5 ? 256 : 128));
            int pPerm = ParsePdfDictInt(encDict, "P", 0);
            bool encMeta = !Regex.IsMatch(encDict, @"/EncryptMetadata\s+false\b");
            bool isAes = Regex.IsMatch(encDict, @"/CFM\s*/(AESV2|AESV3)\b") || v >= 5;

            byte[] oVal = ParsePdfDictStringValue(encDict, "O");
            byte[] uVal = ParsePdfDictStringValue(encDict, "U");
            byte[] oeVal = ParsePdfDictStringValue(encDict, "OE");
            byte[] ueVal = ParsePdfDictStringValue(encDict, "UE");
            byte[] id0 = ParsePdfTrailerId0(pdfStr);

            if (oVal == null || uVal == null) {
                return new ParseResult {
                    ok = false, needsPassword = true, format = "pdf-encrypted",
                    error = "This PDF uses an unsupported encryption header."
                };
            }

            string tryPw = password ?? "";
            byte[] fileKey = VerifyAndDerivePdfFileKey(tryPw, v, r, lenBits, pPerm, encMeta, oVal, uVal, oeVal, ueVal, id0);
            if (fileKey == null) {
                return new ParseResult {
                    ok = false,
                    needsPassword = true,
                    format = "pdf-encrypted",
                    error = string.IsNullOrEmpty(password)
                        ? "This PDF is password-protected. Enter the PDF password to unlock it."
                        : "Incorrect PDF password. Check the password and try again."
                };
            }

            secCtx = new PdfSecurityCtx {
                V = v,
                R = r,
                KeyLenBytes = fileKey.Length,
                IsAes = isAes,
                EncryptMetadata = encMeta,
                FileKey = fileKey
            };
            return null;
        }

        private static int ParsePdfDictInt(string dict, string key, int defVal) {
            Match m = Regex.Match(dict, @"/" + Regex.Escape(key) + @"(?![A-Za-z0-9])\s*(-?\d+)");
            int val;
            return (m.Success && int.TryParse(m.Groups[1].Value, out val)) ? val : defVal;
        }

        private static byte[] ParsePdfTrailerId0(string pdfStr) {
            MatchCollection ms = Regex.Matches(pdfStr, @"/ID\s*\[\s*(<[^>]+>|\((?:[^()\\]|\\.)*\))");
            if (ms.Count == 0) return new byte[0];
            string raw = ms[ms.Count - 1].Groups[1].Value;
            return ParsePdfRawStringToken(raw);
        }

        private static byte[] ParsePdfDictStringValue(string dict, string key) {
            Match m = Regex.Match(dict, @"/" + Regex.Escape(key) + @"(?![A-Za-z0-9])\s*(\(|<)");
            if (!m.Success) return null;
            int idx = m.Groups[1].Index;
            if (dict[idx] == '<') {
                int end = dict.IndexOf('>', idx + 1);
                if (end < 0) return null;
                return ParsePdfRawStringToken(dict.Substring(idx, end - idx + 1));
            }
            int depth = 0;
            int i = idx;
            while (i < dict.Length) {
                char c = dict[i];
                if (c == '\\') { i += 2; continue; }
                if (c == '(') depth++;
                else if (c == ')') {
                    depth--;
                    if (depth == 0) return ParsePdfRawStringToken(dict.Substring(idx, i - idx + 1));
                }
                i++;
            }
            return null;
        }

        private static byte[] ParsePdfRawStringToken(string tok) {
            if (string.IsNullOrEmpty(tok)) return new byte[0];
            if (tok[0] == '<' && tok[tok.Length - 1] == '>') {
                var sb = new StringBuilder();
                for (int i = 1; i < tok.Length - 1; i++) {
                    if (HexVal(tok[i]) >= 0) sb.Append(tok[i]);
                }
                if (sb.Length % 2 == 1) sb.Append('0');
                byte[] res = new byte[sb.Length / 2];
                for (int i = 0; i < res.Length; i++) {
                    res[i] = (byte)((HexVal(sb[i * 2]) << 4) | HexVal(sb[i * 2 + 1]));
                }
                return res;
            }
            if (tok[0] == '(' && tok[tok.Length - 1] == ')') {
                var ms = new MemoryStream();
                for (int i = 1; i < tok.Length - 1; i++) {
                    char c = tok[i];
                    if (c == '\\' && i + 1 < tok.Length - 1) {
                        char e = tok[++i];
                        if (e == 'n') ms.WriteByte((byte)'\n');
                        else if (e == 'r') ms.WriteByte((byte)'\r');
                        else if (e == 't') ms.WriteByte((byte)'\t');
                        else if (e == 'b') ms.WriteByte((byte)'\b');
                        else if (e == 'f') ms.WriteByte((byte)'\f');
                        else if (e == '\r') { if (i + 1 < tok.Length - 1 && tok[i + 1] == '\n') i++; }
                        else if (e == '\n') { }
                        else if (e >= '0' && e <= '7') {
                            int oct = e - '0';
                            for (int k = 0; k < 2 && i + 1 < tok.Length - 1 && tok[i + 1] >= '0' && tok[i + 1] <= '7'; k++) {
                                oct = oct * 8 + (tok[++i] - '0');
                            }
                            ms.WriteByte((byte)(oct & 0xFF));
                        } else {
                            ms.WriteByte((byte)e);
                        }
                    } else {
                        ms.WriteByte((byte)c);
                    }
                }
                return ms.ToArray();
            }
            return new byte[0];
        }

        private static byte[] PadPdfPassword32(string pw) {
            byte[] src = Encoding.GetEncoding("ISO-8859-1").GetBytes(pw ?? "");
            byte[] outB = new byte[32];
            int copy = Math.Min(32, src.Length);
            if (copy > 0) Array.Copy(src, 0, outB, 0, copy);
            if (copy < 32) Array.Copy(PdfPwPadding, 0, outB, copy, 32 - copy);
            return outB;
        }

        private static byte[] VerifyAndDerivePdfFileKey(string pw, int v, int r, int lenBits, int pPerm, bool encMeta, byte[] oVal, byte[] uVal, byte[] oeVal, byte[] ueVal, byte[] id0) {
            if (v >= 5 || r >= 5) {
                return VerifyPdfR5R6(pw, r, oVal, uVal, oeVal, ueVal);
            }
            int keyLenBytes = Math.Max(5, Math.Min(16, lenBits / 8));
            byte[] padded = PadPdfPassword32(pw);

            // Try as User Password first
            byte[] fk = DerivePdfKeyR2to4(padded, oVal, pPerm, id0, r, keyLenBytes, encMeta);
            if (CheckPdfUserKeyR2to4(fk, uVal, id0, r)) return fk;

            // Try as Owner Password (Alg 3 + Alg 2)
            byte[] ownerKey = DerivePdfOwnerRc4Key(padded, r, keyLenBytes);
            byte[] userPaddedFromOwner = DecryptPdfOwnerO(ownerKey, oVal, r);
            byte[] fkOwner = DerivePdfKeyR2to4(userPaddedFromOwner, oVal, pPerm, id0, r, keyLenBytes, encMeta);
            if (CheckPdfUserKeyR2to4(fkOwner, uVal, id0, r)) return fkOwner;

            return null;
        }

        private static byte[] DerivePdfKeyR2to4(byte[] paddedPw32, byte[] oVal, int pPerm, byte[] id0, int r, int keyLenBytes, bool encMeta) {
            using (var md5 = MD5.Create()) {
                var ms = new MemoryStream();
                ms.Write(paddedPw32, 0, 32);
                ms.Write(oVal, 0, Math.Min(32, oVal.Length));
                ms.Write(BitConverter.GetBytes(pPerm), 0, 4);
                if (id0 != null && id0.Length > 0) ms.Write(id0, 0, id0.Length);
                if (r >= 4 && !encMeta) ms.Write(new byte[] { 0xFF, 0xFF, 0xFF, 0xFF }, 0, 4);

                byte[] digest = md5.ComputeHash(ms.ToArray());
                if (r >= 3) {
                    for (int i = 0; i < 50; i++) {
                        byte[] sub = new byte[keyLenBytes];
                        Array.Copy(digest, 0, sub, 0, keyLenBytes);
                        digest = md5.ComputeHash(sub);
                    }
                }
                byte[] fk = new byte[keyLenBytes];
                Array.Copy(digest, 0, fk, 0, keyLenBytes);
                return fk;
            }
        }

        private static bool CheckPdfUserKeyR2to4(byte[] fileKey, byte[] uVal, byte[] id0, int r) {
            if (uVal == null || uVal.Length < 16) return false;
            if (r == 2) {
                byte[] calc = Rc4Transform(fileKey, PdfPwPadding);
                if (uVal.Length < 32) return false;
                for (int i = 0; i < 32; i++) if (calc[i] != uVal[i]) return false;
                return true;
            }
            using (var md5 = MD5.Create()) {
                var ms = new MemoryStream();
                ms.Write(PdfPwPadding, 0, 32);
                if (id0 != null && id0.Length > 0) ms.Write(id0, 0, id0.Length);
                byte[] d = md5.ComputeHash(ms.ToArray());
                byte[] x = Rc4Transform(fileKey, d);
                for (int i = 1; i <= 19; i++) {
                    byte[] k2 = new byte[fileKey.Length];
                    for (int j = 0; j < fileKey.Length; j++) k2[j] = (byte)(fileKey[j] ^ i);
                    x = Rc4Transform(k2, x);
                }
                for (int i = 0; i < 16; i++) if (x[i] != uVal[i]) return false;
                return true;
            }
        }

        private static byte[] DerivePdfOwnerRc4Key(byte[] paddedOwner, int r, int keyLenBytes) {
            using (var md5 = MD5.Create()) {
                byte[] digest = md5.ComputeHash(paddedOwner);
                if (r >= 3) {
                    for (int i = 0; i < 50; i++) digest = md5.ComputeHash(digest);
                }
                byte[] key = new byte[keyLenBytes];
                Array.Copy(digest, 0, key, 0, keyLenBytes);
                return key;
            }
        }

        private static byte[] DecryptPdfOwnerO(byte[] ownerKey, byte[] oVal, int r) {
            byte[] data = new byte[Math.Min(32, oVal.Length)];
            Array.Copy(oVal, 0, data, 0, data.Length);
            if (r == 2) return Rc4Transform(ownerKey, data);
            for (int i = 19; i >= 0; i--) {
                byte[] k2 = new byte[ownerKey.Length];
                for (int j = 0; j < ownerKey.Length; j++) k2[j] = (byte)(ownerKey[j] ^ i);
                data = Rc4Transform(k2, data);
            }
            return data;
        }

        private static byte[] VerifyPdfR5R6(string pw, int r, byte[] oVal, byte[] uVal, byte[] oeVal, byte[] ueVal) {
            if (uVal == null || uVal.Length < 48 || ueVal == null || ueVal.Length < 32) return null;
            byte[] pwBytes = Encoding.UTF8.GetBytes(pw ?? "");
            if (pwBytes.Length > 127) {
                byte[] tr = new byte[127];
                Array.Copy(pwBytes, 0, tr, 0, 127);
                pwBytes = tr;
            }

            byte[] uHash = SliceBytes(uVal, 0, 32);
            byte[] uValSalt = SliceBytes(uVal, 32, 8);
            byte[] uKeySalt = SliceBytes(uVal, 40, 8);

            byte[] calcU = (r == 5)
                ? ComputeSha256Concat(pwBytes, uValSalt, null)
                : ComputePdfR6Hash(pwBytes, uValSalt, null);

            if (BytesEqual(calcU, uHash)) {
                byte[] kKey = (r == 5)
                    ? ComputeSha256Concat(pwBytes, uKeySalt, null)
                    : ComputePdfR6Hash(pwBytes, uKeySalt, null);
                return AesCbcDecrypt(SliceBytes(ueVal, 0, 32), kKey, new byte[16]);
            }

            if (oVal != null && oVal.Length >= 48 && oeVal != null && oeVal.Length >= 32) {
                byte[] u48 = SliceBytes(uVal, 0, 48);
                byte[] oHash = SliceBytes(oVal, 0, 32);
                byte[] oValSalt = SliceBytes(oVal, 32, 8);
                byte[] oKeySalt = SliceBytes(oVal, 40, 8);
                byte[] calcO = (r == 5)
                    ? ComputeSha256Concat(pwBytes, oValSalt, u48)
                    : ComputePdfR6Hash(pwBytes, oValSalt, u48);
                if (BytesEqual(calcO, oHash)) {
                    byte[] kKey = (r == 5)
                        ? ComputeSha256Concat(pwBytes, oKeySalt, u48)
                        : ComputePdfR6Hash(pwBytes, oKeySalt, u48);
                    return AesCbcDecrypt(SliceBytes(oeVal, 0, 32), kKey, new byte[16]);
                }
            }
            return null;
        }

        private static byte[] ComputeSha256Concat(byte[] a, byte[] b, byte[] c) {
            using (var sha = SHA256.Create()) {
                var ms = new MemoryStream();
                if (a != null) ms.Write(a, 0, a.Length);
                if (b != null) ms.Write(b, 0, b.Length);
                if (c != null) ms.Write(c, 0, c.Length);
                return sha.ComputeHash(ms.ToArray());
            }
        }

        private static byte[] ComputePdfR6Hash(byte[] pwBytes, byte[] salt8, byte[] u48) {
            byte[] K = ComputeSha256Concat(pwBytes, salt8, u48);
            int round = 0;
            while (true) {
                int unitLen = pwBytes.Length + K.Length + (u48 != null ? u48.Length : 0);
                byte[] k1 = new byte[unitLen * 64];
                for (int i = 0; i < 64; i++) {
                    int off = i * unitLen;
                    Array.Copy(pwBytes, 0, k1, off, pwBytes.Length);
                    Array.Copy(K, 0, k1, off + pwBytes.Length, K.Length);
                    if (u48 != null) Array.Copy(u48, 0, k1, off + pwBytes.Length + K.Length, u48.Length);
                }
                byte[] e = AesCbcDecryptOrEncrypt128(k1, SliceBytes(K, 0, 16), SliceBytes(K, 16, 16));
                int sum16 = 0;
                for (int i = 0; i < 16; i++) sum16 += e[i];
                int mod = sum16 % 3;
                if (mod == 0) { using (var sha = SHA256.Create()) K = sha.ComputeHash(e); }
                else if (mod == 1) { using (var sha = SHA384.Create()) K = sha.ComputeHash(e); }
                else { using (var sha = SHA512.Create()) K = sha.ComputeHash(e); }

                round++;
                int lastByte = e[e.Length - 1];
                if (round >= 64 && lastByte <= round - 32) break;
                if (round > 1000) break;
            }
            return SliceBytes(K, 0, 32);
        }

        private static byte[] AesCbcDecryptOrEncrypt128(byte[] data, byte[] key, byte[] iv) {
            using (var aes = new AesManaged { Mode = CipherMode.CBC, Padding = PaddingMode.None, Key = key, IV = iv })
            using (var enc = aes.CreateEncryptor()) {
                return enc.TransformFinalBlock(data, 0, data.Length);
            }
        }

        private static byte[] DecryptPdfObjectStream(byte[] rawStream, int objId, int gen, string dict, PdfSecurityCtx ctx) {
            if (rawStream == null || rawStream.Length == 0 || ctx == null || ctx.FileKey == null) return rawStream;
            string d = dict ?? "";
            if (Regex.IsMatch(d, @"/Type\s*/XRef\b")) return rawStream;
            if (!ctx.EncryptMetadata && Regex.IsMatch(d, @"/Type\s*/Metadata\b")) return rawStream;

            try {
                if (ctx.R >= 5) {
                    if (rawStream.Length < 16) return rawStream;
                    byte[] iv = SliceBytes(rawStream, 0, 16);
                    int ctLen = rawStream.Length - 16;
                    ctLen -= (ctLen % 16);
                    if (ctLen <= 0) return new byte[0];
                    byte[] pt = AesCbcDecrypt(SliceBytes(rawStream, 16, ctLen), ctx.FileKey, iv);
                    return StripPkcs7Padding(pt);
                }

                byte[] keyIn = new byte[ctx.FileKey.Length + 5 + (ctx.IsAes ? 4 : 0)];
                Array.Copy(ctx.FileKey, 0, keyIn, 0, ctx.FileKey.Length);
                int p = ctx.FileKey.Length;
                keyIn[p++] = (byte)(objId & 0xFF);
                keyIn[p++] = (byte)((objId >> 8) & 0xFF);
                keyIn[p++] = (byte)((objId >> 16) & 0xFF);
                keyIn[p++] = (byte)(gen & 0xFF);
                keyIn[p++] = (byte)((gen >> 8) & 0xFF);
                if (ctx.IsAes) {
                    keyIn[p++] = 0x73; keyIn[p++] = 0x41; keyIn[p++] = 0x6C; keyIn[p++] = 0x54;
                }
                byte[] objKey;
                using (var md5 = MD5.Create()) {
                    byte[] dg = md5.ComputeHash(keyIn);
                    objKey = SliceBytes(dg, 0, Math.Min(ctx.FileKey.Length + 5, 16));
                }

                if (ctx.IsAes) {
                    if (rawStream.Length < 16) return rawStream;
                    byte[] iv = SliceBytes(rawStream, 0, 16);
                    int ctLen = rawStream.Length - 16;
                    ctLen -= (ctLen % 16);
                    if (ctLen <= 0) return new byte[0];
                    byte[] pt = AesCbcDecrypt(SliceBytes(rawStream, 16, ctLen), objKey, iv);
                    return StripPkcs7Padding(pt);
                }
                return Rc4Transform(objKey, rawStream);
            } catch {
                return rawStream;
            }
        }

        private static byte[] StripPkcs7Padding(byte[] data) {
            if (data == null || data.Length == 0) return data;
            int pad = data[data.Length - 1];
            if (pad >= 1 && pad <= 16 && pad <= data.Length) {
                for (int i = data.Length - pad; i < data.Length; i++) {
                    if (data[i] != pad) return data;
                }
                return SliceBytes(data, 0, data.Length - pad);
            }
            return data;
        }

        private static byte[] Rc4Transform(byte[] key, byte[] data) {
            byte[] s = new byte[256];
            for (int i = 0; i < 256; i++) s[i] = (byte)i;
            int j = 0;
            for (int i = 0; i < 256; i++) {
                j = (j + s[i] + key[i % key.Length]) & 255;
                byte tmp = s[i]; s[i] = s[j]; s[j] = tmp;
            }
            byte[] outB = new byte[data.Length];
            int a = 0, b = 0;
            for (int k = 0; k < data.Length; k++) {
                a = (a + 1) & 255;
                b = (b + s[a]) & 255;
                byte tmp = s[a]; s[a] = s[b]; s[b] = tmp;
                outB[k] = (byte)(data[k] ^ s[(s[a] + s[b]) & 255]);
            }
            return outB;
        }

        private static byte[] SliceBytes(byte[] src, int offset, int count) {
            byte[] dst = new byte[count];
            Array.Copy(src, offset, dst, 0, count);
            return dst;
        }

        private static bool BytesEqual(byte[] a, byte[] b) {
            if (a == null || b == null || a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }
    }
}
