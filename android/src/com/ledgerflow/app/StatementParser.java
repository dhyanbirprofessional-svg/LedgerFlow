package com.ledgerflow.app;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.Inflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.SAXParser;
import javax.xml.parsers.SAXParserFactory;

import org.xml.sax.Attributes;
import org.xml.sax.helpers.DefaultHandler;

public final class StatementParser {
    public static final class ParseResult {
        public boolean ok;
        public boolean needsPassword;
        public String format = "";
        public String error = "";
        public List<List<String>> rows = new ArrayList<List<String>>();

        public String toJson() {
            StringBuilder sb = new StringBuilder(4096);
            sb.append("{\"ok\":").append(ok);
            sb.append(",\"needsPassword\":").append(needsPassword);
            sb.append(",\"format\":");
            appendJsonString(sb, format);
            sb.append(",\"error\":");
            appendJsonString(sb, error);
            sb.append(",\"rows\":[");
            for (int r = 0; r < rows.size(); r++) {
                if (r > 0) sb.append(',');
                sb.append('[');
                List<String> row = rows.get(r);
                for (int c = 0; c < row.size(); c++) {
                    if (c > 0) sb.append(',');
                    appendJsonString(sb, row.get(c));
                }
                sb.append(']');
            }
            sb.append("]}");
            return sb.toString();
        }
    }

    private StatementParser() {}

    public static String handleParseRequest(String fileName, String base64Payload, String password) {
        if (base64Payload == null || base64Payload.isEmpty()) {
            ParseResult res = new ParseResult();
            res.ok = false;
            res.error = "Empty file payload.";
            return res.toJson();
        }
        String b64 = base64Payload;
        int comma = b64.indexOf(',');
        if (comma >= 0 && b64.substring(0, comma).contains("base64")) {
            b64 = b64.substring(comma + 1);
        }
        byte[] bytes;
        try {
            bytes = decodeBase64(b64);
        } catch (Exception ex) {
            ParseResult res = new ParseResult();
            res.ok = false;
            res.error = "Failed to decode file: " + ex.getMessage();
            return res.toJson();
        }
        return parseBytes(bytes, fileName, password).toJson();
    }

    public static ParseResult parseBytes(byte[] bytes, String fileName, String password) {
        ParseResult res = new ParseResult();
        if (bytes == null || bytes.length == 0) {
            res.error = "File is empty.";
            return res;
        }
        String pw = password == null ? "" : password;

        // 0. PDF signature (%PDF-) -> Native local PDF text & table extractor
        if (isPdfSignature(bytes)) {
            return parsePdfBytes(bytes, pw);
        }

        // 1. ZIP signature (PK\x03\x04) -> .xlsx
        if (bytes.length >= 4 && (bytes[0] & 0xFF) == 0x50 && (bytes[1] & 0xFF) == 0x4B
                && (bytes[2] & 0xFF) == 0x03 && (bytes[3] & 0xFF) == 0x04) {
            try {
                res.rows = parseXlsxBytes(bytes);
                res.ok = true;
                res.format = "xlsx";
                return res;
            } catch (Exception ex) {
                res.format = "xlsx";
                res.error = "Failed to read .xlsx workbook: " + ex.getMessage();
                return res;
            }
        }

        // 2. OLE2 Compound Document -> encrypted .xlsx or BIFF8 .xls
        if (bytes.length >= 8 && (bytes[0] & 0xFF) == 0xD0 && (bytes[1] & 0xFF) == 0xCF
                && (bytes[2] & 0xFF) == 0x11 && (bytes[3] & 0xFF) == 0xE0) {
            try {
                Ole2Reader ole = new Ole2Reader(bytes);
                byte[] encInfo = ole.getStream("EncryptionInfo");
                byte[] encPkg = ole.getStream("EncryptedPackage");
                if (encInfo != null && encPkg != null) {
                    if (pw.isEmpty()) {
                        res.needsPassword = true;
                        res.format = "xlsx-encrypted";
                        res.error = "This Excel file is password-protected. Enter the file password to unlock it.";
                        return res;
                    }
                    byte[] decryptedXlsx;
                    try {
                        decryptedXlsx = decryptOoxmlPackage(encInfo, encPkg, pw);
                    } catch (Exception ex) {
                        res.needsPassword = true;
                        res.format = "xlsx-encrypted";
                        res.error = "Could not decrypt Excel file (" + ex.getMessage() + "). Check the password and try again.";
                        return res;
                    }
                    res.rows = parseXlsxBytes(decryptedXlsx);
                    res.ok = true;
                    res.format = "xlsx-encrypted";
                    return res;
                }

                byte[] book = ole.getStream("Workbook");
                if (book == null) book = ole.getStream("Book");
                if (book != null) {
                    res.rows = parseBiff8Workbook(book);
                    res.ok = true;
                    res.format = "xls-biff8";
                    return res;
                }
                if (ole.getStream("EncryptedSummary") != null) {
                    res.needsPassword = true;
                    res.format = "xls-encrypted";
                    res.error = "Legacy encrypted .xls files cannot be decrypted offline. Save as .xlsx or .csv and upload.";
                    return res;
                }
            } catch (Exception ex) {
                res.format = "xls";
                res.error = "Failed to read .xls compound file: " + ex.getMessage();
                return res;
            }
        }

        // 3. Text formats: HTML (.xls), SpreadsheetML 2003 XML, or CSV/TSV
        String text = decodeTextWithBom(bytes);
        String head = (text.length() > 2048 ? text.substring(0, 2048) : text).toLowerCase(Locale.US);

        if (head.contains("<table") || head.contains("<html") || head.contains("<tr")) {
            List<List<String>> rows = parseHtmlTable(text);
            if (!rows.isEmpty()) {
                res.rows = rows;
                res.ok = true;
                res.format = "xls-html";
                return res;
            }
        }

        if (head.contains("schemas-microsoft-com:office:spreadsheet")
                || (head.contains("<workbook") && head.contains("<row"))) {
            try {
                List<List<String>> rows = parseSpreadsheetMl(text);
                if (!rows.isEmpty()) {
                    res.rows = rows;
                    res.ok = true;
                    res.format = "xls-xml";
                    return res;
                }
            } catch (Exception ignored) {}
        }

        String ext = "";
        if (fileName != null) {
            int dot = fileName.lastIndexOf('.');
            if (dot >= 0) ext = fileName.substring(dot).toLowerCase(Locale.US);
        }
        char delim = ".tsv".equals(ext) ? '\t' : detectDelimiter(text, ext);
        res.rows = parseDelimitedText(text, delim);
        res.ok = true;
        res.format = "csv";
        return res;
    }

    private static String decodeTextWithBom(byte[] bytes) {
        if (bytes.length >= 3 && (bytes[0] & 0xFF) == 0xEF && (bytes[1] & 0xFF) == 0xBB && (bytes[2] & 0xFF) == 0xBF) {
            return new String(bytes, 3, bytes.length - 3, StandardCharsets.UTF_8);
        }
        if (bytes.length >= 2 && (bytes[0] & 0xFF) == 0xFF && (bytes[1] & 0xFF) == 0xFE) {
            return new String(bytes, 2, bytes.length - 2, StandardCharsets.UTF_16LE);
        }
        if (bytes.length >= 2 && (bytes[0] & 0xFF) == 0xFE && (bytes[1] & 0xFF) == 0xFF) {
            return new String(bytes, 2, bytes.length - 2, StandardCharsets.UTF_16BE);
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private static char detectDelimiter(String text, String ext) {
        char[] candidates = new char[]{'\t', ',', ';'};
        Map<Character, Integer> scores = new HashMap<Character, Integer>();
        for (char c : candidates) scores.put(c, 0);

        List<String> lines = new ArrayList<String>();
        try (BufferedReader br = new BufferedReader(new StringReader(text))) {
            String ln;
            while ((ln = br.readLine()) != null && lines.size() < 80) {
                if (!ln.trim().isEmpty()) lines.add(ln);
            }
        } catch (IOException ignored) {}

        for (char d : candidates) {
            Map<Integer, Integer> counts = new HashMap<Integer, Integer>();
            for (String ln : lines) {
                int cnt = 0;
                boolean inQ = false;
                for (int i = 0; i < ln.length(); i++) {
                    char ch = ln.charAt(i);
                    if (ch == '"') inQ = !inQ;
                    else if (!inQ && ch == d) cnt++;
                }
                if (cnt >= 2) {
                    Integer prev = counts.get(cnt);
                    counts.put(cnt, (prev == null ? 0 : prev) + 1);
                }
            }
            int bestFreq = 0;
            for (Map.Entry<Integer, Integer> e : counts.entrySet()) {
                int sc = e.getValue() * e.getKey();
                if (sc > bestFreq) bestFreq = sc;
            }
            scores.put(d, bestFreq);
        }

        int tabScore = scores.get('\t');
        int commaScore = scores.get(',');
        int semiScore = scores.get(';');
        if (".xls".equals(ext) && tabScore > 0 && tabScore >= commaScore / 2) return '\t';
        if (tabScore > commaScore && tabScore >= semiScore) return '\t';
        if (semiScore > commaScore && semiScore > tabScore) return ';';
        return ',';
    }

    public static List<List<String>> parseDelimitedText(String text, char delimiter) {
        List<List<String>> rows = new ArrayList<List<String>>();
        List<String> row = new ArrayList<String>();
        StringBuilder cur = new StringBuilder();
        boolean inQuotes = false;

        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (inQuotes) {
                if (ch == '"' && i + 1 < text.length() && text.charAt(i + 1) == '"') {
                    cur.append('"');
                    i++;
                } else if (ch == '"') {
                    inQuotes = false;
                } else {
                    cur.append(ch);
                }
            } else {
                if (ch == '"') {
                    inQuotes = true;
                } else if (ch == delimiter) {
                    row.add(cur.toString().trim());
                    cur.setLength(0);
                } else if (ch == '\n' || ch == '\r') {
                    if (ch == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') i++;
                    row.add(cur.toString().trim());
                    cur.setLength(0);
                    if (rowHasContent(row)) rows.add(row);
                    row = new ArrayList<String>();
                } else {
                    cur.append(ch);
                }
            }
        }
        if (cur.length() > 0 || !row.isEmpty()) {
            row.add(cur.toString().trim());
            if (rowHasContent(row)) rows.add(row);
        }
        return rows;
    }

    private static boolean rowHasContent(List<String> row) {
        for (int i = 0; i < row.size(); i++) {
            if (row.get(i) != null && !row.get(i).isEmpty()) return true;
        }
        return false;
    }

    private static List<List<String>> parseHtmlTable(String html) {
        List<List<String>> rows = new ArrayList<List<String>>();
        Pattern trPat = Pattern.compile("<tr\\b[^>]*>(.*?)</tr>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
        Pattern tdPat = Pattern.compile("<t[dh]\\b[^>]*>(.*?)</t[dh]>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
        Matcher trM = trPat.matcher(html);
        while (trM.find()) {
            List<String> row = new ArrayList<String>();
            Matcher tdM = tdPat.matcher(trM.group(1));
            while (tdM.find()) {
                String cell = tdM.group(1);
                cell = cell.replaceAll("(?i)<br\\s*/?>", "\n");
                cell = cell.replaceAll("<[^>]+>", " ");
                cell = decodeHtmlEntities(cell);
                cell = cell.replaceAll("\r?\n ", "");
                cell = cell.replaceAll("\\s+", " ").trim();
                row.add(cell);
            }
            if (!row.isEmpty() && rowHasContent(row)) rows.add(row);
        }
        return rows;
    }

    private static String decodeHtmlEntities(String s) {
        if (s == null || !s.contains("&")) return s == null ? "" : s;
        String out = s.replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&apos;", "'");
        Pattern numEnt = Pattern.compile("&#(x?[0-9a-fA-F]+);");
        Matcher m = numEnt.matcher(out);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String code = m.group(1);
            try {
                int cp = code.startsWith("x") || code.startsWith("X")
                        ? Integer.parseInt(code.substring(1), 16)
                        : Integer.parseInt(code, 10);
                m.appendReplacement(sb, Matcher.quoteReplacement(new String(Character.toChars(cp))));
            } catch (Exception ex) {
                m.appendReplacement(sb, Matcher.quoteReplacement(m.group(0)));
            }
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static List<List<String>> parseSpreadsheetMl(String xml) throws Exception {
        List<List<String>> rows = new ArrayList<List<String>>();
        DocumentBuilderFactory dbf = createSecureDbf();
        DocumentBuilder db = dbf.newDocumentBuilder();
        Document doc = db.parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));

        NodeList wsList = doc.getElementsByTagNameNS("*", "Worksheet");
        Node rootSearch = wsList.getLength() > 0 ? wsList.item(0) : doc.getDocumentElement();
        NodeList rowNodes = ((Element) rootSearch).getElementsByTagNameNS("*", "Row");
        if (rowNodes.getLength() == 0) {
            rowNodes = doc.getElementsByTagName("Row");
        }
        for (int i = 0; i < rowNodes.getLength(); i++) {
            Node rNode = rowNodes.item(i);
            List<String> row = new ArrayList<String>();
            int colIdx = 0;
            NodeList children = rNode.getChildNodes();
            for (int j = 0; j < children.getLength(); j++) {
                Node cNode = children.item(j);
                if (cNode.getNodeType() != Node.ELEMENT_NODE || !"Cell".equals(localName(cNode))) continue;
                Element cEl = (Element) cNode;
                String idxVal = getAttrAnyNs(cEl, "Index");
                if (idxVal != null && !idxVal.isEmpty()) {
                    try {
                        int target = Integer.parseInt(idxVal);
                        while (colIdx < target - 1) {
                            row.add("");
                            colIdx++;
                        }
                    } catch (NumberFormatException ignored) {}
                }
                String val = "";
                NodeList cellKids = cEl.getChildNodes();
                for (int k = 0; k < cellKids.getLength(); k++) {
                    Node dNode = cellKids.item(k);
                    if (dNode.getNodeType() == Node.ELEMENT_NODE && "Data".equals(localName(dNode))) {
                        val = (dNode.getTextContent() == null ? "" : dNode.getTextContent()).trim();
                        String typeVal = getAttrAnyNs((Element) dNode, "Type");
                        if ("DateTime".equals(typeVal) && val.length() >= 10) {
                            val = val.substring(0, 10);
                        }
                        break;
                    }
                }
                row.add(val);
                colIdx++;
            }
            if (rowHasContent(row)) rows.add(row);
        }
        return rows;
    }

    /* ---------- XLSX Parser (Zip + SAX) ---------- */
    private static List<List<String>> parseXlsxBytes(byte[] zipBytes) throws Exception {
        Map<String, byte[]> entries = readZipEntries(zipBytes);
        final List<String> sharedStrings = readSharedStrings(entries.get("xl/sharedstrings.xml"));
        final Set<Integer> dateStyles = readDateStyleIndices(entries.get("xl/styles.xml"));
        List<String> sheetKeys = findWorksheetKeys(entries);
        if (sheetKeys.isEmpty()) throw new IOException("No worksheet found in workbook.");

        final List<List<String>> rows = new ArrayList<List<String>>();
        SAXParserFactory spf = SAXParserFactory.newInstance();
        spf.setNamespaceAware(true);
        try {
            spf.setFeature("http://xml.org/sax/features/external-general-entities", false);
            spf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        } catch (Exception ignored) {}

        for (String key : sheetKeys) {
            byte[] sheetBytes = entries.get(key);
            if (sheetBytes == null) continue;
            SAXParser parser = spf.newSAXParser();
            parser.parse(new ByteArrayInputStream(sheetBytes), new DefaultHandler() {
                List<String> curRow = null;
                int nextCol = 0;
                boolean inCell = false;
                int cellCol = 0;
                String cellType = "";
                String styleAttr = "";
                boolean inV = false;
                boolean inT = false;
                final StringBuilder valBuf = new StringBuilder();

                @Override
                public void startElement(String uri, String lName, String qName, Attributes attrs) {
                    String name = (lName != null && !lName.isEmpty()) ? lName : stripPrefix(qName);
                    if ("row".equals(name)) {
                        curRow = new ArrayList<String>();
                        nextCol = 0;
                    } else if ("c".equals(name) && curRow != null) {
                        String ref = attrs.getValue("r");
                        cellType = attrs.getValue("t");
                        if (cellType == null) cellType = "";
                        styleAttr = attrs.getValue("s");
                        if (styleAttr == null) styleAttr = "";
                        cellCol = (ref != null && !ref.isEmpty()) ? parseColumnIndexFromRef(ref) : nextCol;
                        while (curRow.size() < cellCol) curRow.add("");
                        valBuf.setLength(0);
                        inV = false;
                        inT = false;
                        inCell = true;
                    } else if (inCell && "v".equals(name)) {
                        inV = true;
                    } else if (inCell && "t".equals(name)) {
                        inT = true;
                    }
                }

                @Override
                public void characters(char[] ch, int start, int length) {
                    if (inCell && (inV || inT)) {
                        valBuf.append(ch, start, length);
                    }
                }

                @Override
                public void endElement(String uri, String lName, String qName) {
                    String name = (lName != null && !lName.isEmpty()) ? lName : stripPrefix(qName);
                    if ("v".equals(name)) {
                        inV = false;
                    } else if ("t".equals(name)) {
                        inT = false;
                    } else if ("c".equals(name) && inCell && curRow != null) {
                        String finalVal = formatXlsxCell(valBuf.toString(), cellType, styleAttr, sharedStrings, dateStyles);
                        if (cellCol < curRow.size()) curRow.set(cellCol, finalVal);
                        else curRow.add(finalVal);
                        nextCol = cellCol + 1;
                        inCell = false;
                    } else if ("row".equals(name) && curRow != null) {
                        if (rowHasContent(curRow)) rows.add(curRow);
                        curRow = null;
                    }
                }
            });
        }
        return rows;
    }

    private static Map<String, byte[]> readZipEntries(byte[] zipBytes) throws IOException {
        Map<String, byte[]> map = new HashMap<String, byte[]>();
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
            ZipEntry entry;
            byte[] buf = new byte[8192];
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String norm = entry.getName().replace('\\', '/');
                while (norm.startsWith("/")) norm = norm.substring(1);
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                int n;
                while ((n = zis.read(buf)) > 0) baos.write(buf, 0, n);
                map.put(norm.toLowerCase(Locale.US), baos.toByteArray());
            }
        }
        return map;
    }

    private static List<String> readSharedStrings(byte[] ssBytes) {
        final List<String> list = new ArrayList<String>();
        if (ssBytes == null) return list;
        try {
            SAXParserFactory spf = SAXParserFactory.newInstance();
            spf.setNamespaceAware(true);
            try {
                spf.setFeature("http://xml.org/sax/features/external-general-entities", false);
                spf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            } catch (Exception ignored) {}
            SAXParser parser = spf.newSAXParser();
            parser.parse(new ByteArrayInputStream(ssBytes), new DefaultHandler() {
                final StringBuilder sb = new StringBuilder();
                boolean inSi = false;
                boolean inT = false;
                boolean inRPh = false;

                @Override
                public void startElement(String uri, String lName, String qName, Attributes attrs) {
                    String name = (lName != null && !lName.isEmpty()) ? lName : stripPrefix(qName);
                    if ("si".equals(name)) {
                        inSi = true;
                        inRPh = false;
                        inT = false;
                        sb.setLength(0);
                    } else if (inSi && "rPh".equals(name)) {
                        inRPh = true;
                    } else if (inSi && !inRPh && "t".equals(name)) {
                        inT = true;
                    }
                }

                @Override
                public void characters(char[] ch, int start, int length) {
                    if (inSi && inT && !inRPh) {
                        sb.append(ch, start, length);
                    }
                }

                @Override
                public void endElement(String uri, String lName, String qName) {
                    String name = (lName != null && !lName.isEmpty()) ? lName : stripPrefix(qName);
                    if ("rPh".equals(name)) inRPh = false;
                    else if ("t".equals(name)) inT = false;
                    else if ("si".equals(name)) {
                        list.add(sb.toString().trim());
                        inSi = false;
                        inT = false;
                        inRPh = false;
                    }
                }
            });
        } catch (Exception ignored) {}
        return list;
    }

    private static Set<Integer> readDateStyleIndices(byte[] stylesBytes) {
        Set<Integer> dateStyles = new HashSet<Integer>();
        if (stylesBytes == null) return dateStyles;
        try {
            DocumentBuilder db = createSecureDbf().newDocumentBuilder();
            Document doc = db.parse(new ByteArrayInputStream(stylesBytes));

            Set<Integer> customDateFmtIds = new HashSet<Integer>();
            NodeList numFmts = doc.getElementsByTagNameNS("*", "numFmt");
            if (numFmts.getLength() == 0) numFmts = doc.getElementsByTagName("numFmt");
            for (int i = 0; i < numFmts.getLength(); i++) {
                Element el = (Element) numFmts.item(i);
                String idStr = el.getAttribute("numFmtId");
                String code = el.getAttribute("formatCode");
                try {
                    int fmtId = Integer.parseInt(idStr);
                    if (isExcelDateFormatCode(code)) customDateFmtIds.add(fmtId);
                } catch (NumberFormatException ignored) {}
            }

            NodeList cellXfsList = doc.getElementsByTagNameNS("*", "cellXfs");
            if (cellXfsList.getLength() == 0) cellXfsList = doc.getElementsByTagName("cellXfs");
            if (cellXfsList.getLength() > 0) {
                NodeList xfs = ((Element) cellXfsList.item(0)).getElementsByTagNameNS("*", "xf");
                if (xfs.getLength() == 0) xfs = ((Element) cellXfsList.item(0)).getElementsByTagName("xf");
                for (int i = 0; i < xfs.getLength(); i++) {
                    Element xf = (Element) xfs.item(i);
                    String idStr = xf.getAttribute("numFmtId");
                    try {
                        int fmtId = Integer.parseInt(idStr);
                        if (isBuiltInDateFormat(fmtId) || customDateFmtIds.contains(fmtId)) {
                            dateStyles.add(i);
                        }
                    } catch (NumberFormatException ignored) {}
                }
            }
        } catch (Exception ignored) {}
        return dateStyles;
    }

    private static boolean isBuiltInDateFormat(int fmtId) {
        return (fmtId >= 14 && fmtId <= 22) || (fmtId >= 45 && fmtId <= 47);
    }

    private static boolean isExcelDateFormatCode(String code) {
        if (code == null || code.isEmpty()) return false;
        String cleaned = code.replaceAll("\"[^\"]*\"|\\[[^\\]]*\\]|\\\\.", "").toLowerCase(Locale.US);
        if (cleaned.contains("@")) return false;
        return cleaned.matches(".*(^|[^a-z])(yy+|yyyy|d{1,2}[^a-z]*m{1,4}|m{1,4}[^a-z]*d{1,2})([^a-z]|$).*");
    }

    private static List<String> findWorksheetKeys(Map<String, byte[]> entries) {
        List<String> keys = new ArrayList<String>();
        for (String k : entries.keySet()) {
            if (k.startsWith("xl/worksheets/sheet") && k.endsWith(".xml")) {
                keys.add(k);
            }
        }
        final Pattern p = Pattern.compile("sheet(\\d+)\\.xml$");
        Collections.sort(keys, new Comparator<String>() {
            @Override
            public int compare(String a, String b) {
                int na = extractSheetNum(a), nb = extractSheetNum(b);
                return na != nb ? Integer.compare(na, nb) : a.compareTo(b);
            }
            private int extractSheetNum(String s) {
                Matcher m = p.matcher(s);
                if (m.find()) {
                    try { return Integer.parseInt(m.group(1)); } catch (NumberFormatException ignored) {}
                }
                return 0;
            }
        });
        return keys;
    }

    private static int parseColumnIndexFromRef(String ref) {
        int col = 0;
        for (int i = 0; i < ref.length(); i++) {
            char c = ref.charAt(i);
            if (c >= 'A' && c <= 'Z') col = col * 26 + (c - 'A' + 1);
            else if (c >= 'a' && c <= 'z') col = col * 26 + (c - 'a' + 1);
            else break;
        }
        return Math.max(0, col - 1);
    }

    private static String formatXlsxCell(String rawVal, String cellType, String styleAttr,
                                         List<String> sharedStrings, Set<Integer> dateStyles) {
        if (rawVal == null || rawVal.isEmpty()) return "";
        if ("s".equals(cellType)) {
            try {
                int idx = Integer.parseInt(rawVal.trim());
                if (idx >= 0 && idx < sharedStrings.size()) return sharedStrings.get(idx);
            } catch (NumberFormatException ignored) {}
            return "";
        }
        if ("b".equals(cellType)) return "1".equals(rawVal) ? "TRUE" : "FALSE";
        if ("str".equals(cellType) || "inlineStr".equals(cellType) || "e".equals(cellType)) {
            return rawVal.trim();
        }
        if (styleAttr != null && !styleAttr.isEmpty()) {
            try {
                int styleIdx = Integer.parseInt(styleAttr);
                if (dateStyles.contains(styleIdx)) {
                    double serial = Double.parseDouble(rawVal.trim());
                    if (serial > 1 && serial < 2958465) {
                        return formatExcelSerialDate(serial);
                    }
                }
            } catch (NumberFormatException ignored) {}
        }
        return rawVal.trim();
    }

    private static String formatExcelSerialDate(double serial) {
        int days = (int) Math.floor(serial);
        // Excel epoch: 1899-12-30 (accounts for 1900 leap year bug for dates >= 60)
        Calendar cal = Calendar.getInstance(Locale.US);
        cal.clear();
        cal.set(1899, Calendar.DECEMBER, 30, 0, 0, 0);
        cal.add(Calendar.DAY_OF_MONTH, days);
        return String.format(Locale.US, "%04d-%02d-%02d",
                cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH));
    }

    /* ---------- OOXML Encrypted Package Decryption (Standard + Agile) ---------- */
    private static byte[] decryptOoxmlPackage(byte[] encInfo, byte[] encPkg, String password) throws Exception {
        if (encInfo.length < 8) throw new Exception("Invalid EncryptionInfo stream.");
        int vMajor = readU16(encInfo, 0);
        int vMinor = readU16(encInfo, 2);
        if (vMajor == 4 && vMinor == 4) {
            return decryptAgile(encInfo, encPkg, password);
        }
        if ((vMajor == 3 || vMajor == 4) && vMinor == 2) {
            return decryptStandard(encInfo, encPkg, password);
        }
        throw new Exception("Unsupported Excel encryption version " + vMajor + "." + vMinor);
    }

    private static byte[] decryptStandard(byte[] encInfo, byte[] encPkg, String password) throws Exception {
        int headerSize = readI32(encInfo, 8);
        int offset = 12 + headerSize;
        int saltSize = readI32(encInfo, offset); offset += 4;
        byte[] salt = Arrays.copyOfRange(encInfo, offset, offset + saltSize); offset += saltSize;
        byte[] encryptedVerifier = Arrays.copyOfRange(encInfo, offset, offset + 16); offset += 16;
        int verifierHashSize = readI32(encInfo, offset); offset += 4;
        byte[] encryptedVerifierHash = Arrays.copyOfRange(encInfo, offset, offset + 32);

        byte[] pwBytes = password.getBytes(StandardCharsets.UTF_16LE);
        MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
        sha1.update(salt);
        sha1.update(pwBytes);
        byte[] h = sha1.digest();
        byte[] iterBuf = new byte[4 + h.length];
        for (int i = 0; i < 50000; i++) {
            writeI32Le(iterBuf, 0, i);
            System.arraycopy(h, 0, iterBuf, 4, h.length);
            sha1.reset();
            h = sha1.digest(iterBuf);
        }
        byte[] block0 = new byte[h.length + 4];
        System.arraycopy(h, 0, block0, 0, h.length);
        sha1.reset();
        h = sha1.digest(block0);

        byte[] x1 = new byte[64];
        Arrays.fill(x1, (byte) 0x36);
        for (int i = 0; i < h.length; i++) x1[i] ^= h[i];
        sha1.reset();
        byte[] cbKey = Arrays.copyOf(sha1.digest(x1), 16);

        Cipher aesEcb = Cipher.getInstance("AES/ECB/NoPadding");
        aesEcb.init(Cipher.DECRYPT_MODE, new SecretKeySpec(cbKey, "AES"));
        byte[] verifier = aesEcb.doFinal(encryptedVerifier);
        byte[] vHash = aesEcb.doFinal(encryptedVerifierHash);

        sha1.reset();
        byte[] calcHash = sha1.digest(verifier);
        int checkLen = Math.min(20, verifierHashSize);
        for (int i = 0; i < checkLen; i++) {
            if (calcHash[i] != vHash[i]) throw new Exception("Incorrect password");
        }

        long decryptedSize = readI64(encPkg, 0);
        int payloadLen = encPkg.length - 8;
        int aligned = payloadLen - (payloadLen % 16);
        byte[] decrypted = aesEcb.doFinal(encPkg, 8, aligned);
        int outLen = (int) Math.min(decryptedSize, decrypted.length);
        return Arrays.copyOf(decrypted, outLen);
    }

    private static byte[] decryptAgile(byte[] encInfo, byte[] encPkg, String password) throws Exception {
        int trimEnd = encInfo.length;
        while (trimEnd > 8 && encInfo[trimEnd - 1] == 0) trimEnd--;
        String xmlStr = new String(encInfo, 8, trimEnd - 8, StandardCharsets.UTF_8);
        Document doc = createSecureDbf().newDocumentBuilder()
                .parse(new ByteArrayInputStream(xmlStr.getBytes(StandardCharsets.UTF_8)));

        Element keyDataNode = firstElementByName(doc, "keyData");
        Element pKeyNode = firstElementByName(doc, "encryptedKey");
        if (keyDataNode == null || pKeyNode == null) throw new Exception("Missing Agile encryption metadata.");

        int kdKeyBits = Integer.parseInt(keyDataNode.getAttribute("keyBits"));
        int kdBlockSize = Integer.parseInt(keyDataNode.getAttribute("blockSize"));
        String kdHashAlg = keyDataNode.getAttribute("hashAlgorithm");
        byte[] kdSalt = decodeBase64(keyDataNode.getAttribute("saltValue"));

        int spinCount = Integer.parseInt(pKeyNode.getAttribute("spinCount"));
        int pkKeyBits = Integer.parseInt(pKeyNode.getAttribute("keyBits"));
        int pkBlockSize = Integer.parseInt(pKeyNode.getAttribute("blockSize"));
        String pkHashAlg = pKeyNode.getAttribute("hashAlgorithm");
        byte[] pkSalt = decodeBase64(pKeyNode.getAttribute("saltValue"));
        byte[] encVerifierHashInput = decodeBase64(pKeyNode.getAttribute("encryptedVerifierHashInput"));
        byte[] encVerifierHashValue = decodeBase64(pKeyNode.getAttribute("encryptedVerifierHashValue"));
        byte[] encKeyValue = decodeBase64(pKeyNode.getAttribute("encryptedKeyValue"));

        byte[] verifierInputKey = deriveAgileKey(password, pkHashAlg, pkSalt, spinCount, pkKeyBits / 8,
                new byte[]{(byte) 0xfe, (byte) 0xa7, (byte) 0xd2, 0x76, 0x3b, 0x4b, (byte) 0x9e, 0x79});
        byte[] verifierHashKey = deriveAgileKey(password, pkHashAlg, pkSalt, spinCount, pkKeyBits / 8,
                new byte[]{(byte) 0xd7, (byte) 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e});
        byte[] keyValueKey = deriveAgileKey(password, pkHashAlg, pkSalt, spinCount, pkKeyBits / 8,
                new byte[]{0x14, 0x6e, 0x0b, (byte) 0xe7, (byte) 0xab, (byte) 0xac, (byte) 0xd0, (byte) 0xd6});

        byte[] pkIv = padOrTrim(pkSalt, pkBlockSize);
        byte[] verifierInput = aesCbcDecrypt(encVerifierHashInput, verifierInputKey, pkIv);
        byte[] verifierHash = aesCbcDecrypt(encVerifierHashValue, verifierHashKey, pkIv);

        MessageDigest md = createHashAlgorithm(pkHashAlg);
        byte[] computed = md.digest(verifierInput);
        for (int i = 0; i < computed.length; i++) {
            if (computed[i] != verifierHash[i]) throw new Exception("Incorrect password");
        }

        byte[] packageKey = padOrTrim(aesCbcDecrypt(encKeyValue, keyValueKey, pkIv), kdKeyBits / 8);
        long totalSize = readI64(encPkg, 0);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int segSize = 4096;
        int pos = 8;
        int segIdx = 0;
        MessageDigest kdMd = createHashAlgorithm(kdHashAlg);

        while (pos < encPkg.length && out.size() < totalSize) {
            int chunkLen = Math.min(segSize, encPkg.length - pos);
            int paddedLen = (chunkLen % kdBlockSize == 0) ? chunkLen : chunkLen + (kdBlockSize - (chunkLen % kdBlockSize));
            byte[] chunk = new byte[paddedLen];
            System.arraycopy(encPkg, pos, chunk, 0, chunkLen);

            byte[] ivInput = new byte[kdSalt.length + 4];
            System.arraycopy(kdSalt, 0, ivInput, 0, kdSalt.length);
            writeI32Le(ivInput, kdSalt.length, segIdx);
            kdMd.reset();
            byte[] iv = padOrTrim(kdMd.digest(ivInput), kdBlockSize);

            byte[] decChunk = aesCbcDecrypt(chunk, packageKey, iv);
            int writeLen = (int) Math.min(decChunk.length, totalSize - out.size());
            out.write(decChunk, 0, writeLen);
            pos += chunkLen;
            segIdx++;
        }
        return out.toByteArray();
    }

    private static MessageDigest createHashAlgorithm(String name) throws Exception {
        String n = name == null ? "SHA512" : name.toUpperCase(Locale.US);
        if (n.contains("512")) return MessageDigest.getInstance("SHA-512");
        if (n.contains("384")) return MessageDigest.getInstance("SHA-384");
        if (n.contains("256")) return MessageDigest.getInstance("SHA-256");
        return MessageDigest.getInstance("SHA-1");
    }

    private static byte[] deriveAgileKey(String password, String hashAlg, byte[] salt,
                                         int spinCount, int keyLen, byte[] blockKey) throws Exception {
        byte[] pwBytes = password.getBytes(StandardCharsets.UTF_16LE);
        MessageDigest md = createHashAlgorithm(hashAlg);
        byte[] init = new byte[salt.length + pwBytes.length];
        System.arraycopy(salt, 0, init, 0, salt.length);
        System.arraycopy(pwBytes, 0, init, salt.length, pwBytes.length);
        byte[] h = md.digest(init);
        byte[] iterBuf = new byte[4 + h.length];
        for (int i = 0; i < spinCount; i++) {
            writeI32Le(iterBuf, 0, i);
            System.arraycopy(h, 0, iterBuf, 4, h.length);
            md.reset();
            h = md.digest(iterBuf);
        }
        byte[] finalBuf = new byte[h.length + blockKey.length];
        System.arraycopy(h, 0, finalBuf, 0, h.length);
        System.arraycopy(blockKey, 0, finalBuf, h.length, blockKey.length);
        md.reset();
        return padOrTrim(md.digest(finalBuf), keyLen);
    }

    private static byte[] padOrTrim(byte[] src, int len) {
        byte[] dst = new byte[len];
        for (int i = 0; i < len; i++) dst[i] = i < src.length ? src[i] : (byte) 0x36;
        return dst;
    }

    private static byte[] aesCbcDecrypt(byte[] data, byte[] key, byte[] iv) throws Exception {
        Cipher c = Cipher.getInstance("AES/CBC/NoPadding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        return c.doFinal(data);
    }

    /* ---------- Minimal OLE2 + BIFF8 (.xls) Reader ---------- */
    private static final class Ole2Reader {
        private final byte[] data;
        private final int sectorSize;
        private final int miniSectorSize;
        private final int miniCutoff;
        private final List<Integer> fat = new ArrayList<Integer>();
        private final List<Integer> miniFat = new ArrayList<Integer>();
        private byte[] miniStream = new byte[0];
        private final Map<String, Entry> entries = new HashMap<String, Entry>();

        private static final class Entry {
            String name;
            int startSector;
            long size;
        }

        Ole2Reader(byte[] data) {
            this.data = data;
            int sectorShift = readU16(data, 30);
            int miniShift = readU16(data, 32);
            this.sectorSize = 1 << sectorShift;
            this.miniSectorSize = 1 << miniShift;

            int dirStart = readI32(data, 48);
            this.miniCutoff = readI32(data, 56);
            int miniFatStart = readI32(data, 60);
            int numMiniFat = readI32(data, 64);
            int difatStart = readI32(data, 68);
            int numDifat = readI32(data, 72);

            List<Integer> fatSectors = new ArrayList<Integer>();
            for (int i = 0; i < 109; i++) {
                int s = readI32(data, 76 + i * 4);
                if (s >= 0) fatSectors.add(s);
            }
            int curDifat = difatStart;
            for (int d = 0; d < numDifat && curDifat >= 0; d++) {
                int off = sectorOffset(curDifat);
                int perSec = sectorSize / 4 - 1;
                for (int i = 0; i < perSec; i++) {
                    int s = readI32(data, off + i * 4);
                    if (s >= 0) fatSectors.add(s);
                }
                curDifat = readI32(data, off + perSec * 4);
            }

            for (int fs : fatSectors) {
                int off = sectorOffset(fs);
                for (int i = 0; i < sectorSize / 4 && off + i * 4 + 4 <= data.length; i++) {
                    fat.add(readI32(data, off + i * 4));
                }
            }

            if (miniFatStart >= 0 && numMiniFat > 0) {
                byte[] mfBytes = readFatChain(miniFatStart, (long) numMiniFat * sectorSize);
                for (int i = 0; i + 4 <= mfBytes.length; i += 4) {
                    miniFat.add(readI32(mfBytes, i));
                }
            }

            byte[] dirBytes = readFatChain(dirStart, 1024L * 1024L);
            Entry rootEntry = null;
            for (int off = 0; off + 128 <= dirBytes.length; off += 128) {
                int nameLen = readU16(dirBytes, off + 64);
                if (nameLen < 2 || nameLen > 64) continue;
                String name = new String(dirBytes, off, nameLen - 2, StandardCharsets.UTF_16LE);
                int type = dirBytes[off + 66] & 0xFF;
                int startSec = readI32(dirBytes, off + 116);
                long size = readU32(dirBytes, off + 120);
                Entry e = new Entry();
                e.name = name;
                e.startSector = startSec;
                e.size = size;
                if (type == 5) rootEntry = e;
                else if (type == 2) {
                    String key = name.toLowerCase(Locale.US);
                    if (!entries.containsKey(key)) entries.put(key, e);
                }
            }
            if (rootEntry != null && rootEntry.startSector >= 0 && rootEntry.size > 0) {
                this.miniStream = readFatChain(rootEntry.startSector, rootEntry.size);
            }
        }

        private int sectorOffset(int sec) {
            return (sec + 1) * sectorSize;
        }

        private byte[] readFatChain(int startSec, long maxLen) {
            ByteArrayOutputStream ms = new ByteArrayOutputStream();
            int cur = startSec;
            int guard = 0;
            while (cur >= 0 && cur < fat.size() && guard++ < 50000) {
                int off = sectorOffset(cur);
                if (off + sectorSize <= data.length) ms.write(data, off, sectorSize);
                cur = fat.get(cur);
                if (ms.size() >= maxLen) break;
            }
            byte[] res = ms.toByteArray();
            if (res.length > maxLen) return Arrays.copyOf(res, (int) maxLen);
            return res;
        }

        byte[] getStream(String name) {
            Entry e = entries.get(name.toLowerCase(Locale.US));
            if (e == null) return null;
            if (e.size < miniCutoff && miniStream.length > 0) {
                ByteArrayOutputStream ms = new ByteArrayOutputStream();
                int cur = e.startSector;
                int guard = 0;
                while (cur >= 0 && cur < miniFat.size() && guard++ < 50000) {
                    int off = cur * miniSectorSize;
                    if (off + miniSectorSize <= miniStream.length) ms.write(miniStream, off, miniSectorSize);
                    cur = miniFat.get(cur);
                    if (ms.size() >= e.size) break;
                }
                byte[] buf = ms.toByteArray();
                return Arrays.copyOf(buf, (int) Math.min(e.size, buf.length));
            }
            return readFatChain(e.startSector, e.size);
        }
    }

    private static List<List<String>> parseBiff8Workbook(byte[] stream) {
        List<Integer> recTypes = new ArrayList<Integer>();
        List<byte[]> recPayloads = new ArrayList<byte[]>();
        int pos = 0;
        while (pos + 4 <= stream.length) {
            int recType = readU16(stream, pos);
            int recLen = readU16(stream, pos + 2);
            pos += 4;
            if (pos + recLen > stream.length) break;
            recTypes.add(recType);
            recPayloads.add(Arrays.copyOfRange(stream, pos, pos + recLen));
            pos += recLen;
        }

        List<String> sst = new ArrayList<String>();
        Set<Integer> customDateFmts = new HashSet<Integer>();
        Set<Integer> xfDateSet = new HashSet<Integer>();
        int xfIndex = 0;

        for (int i = 0; i < recTypes.size(); i++) {
            int t = recTypes.get(i);
            byte[] d = recPayloads.get(i);
            if (t == 0x041E && d.length >= 5) {
                int fmtId = readU16(d, 0);
                String code = readBiff8String(d, 2);
                if (isExcelDateFormatCode(code)) customDateFmts.add(fmtId);
            } else if (t == 0x00FC && d.length >= 8) {
                int totalUnique = readI32(d, 4);
                List<byte[]> chunks = new ArrayList<byte[]>();
                chunks.add(d);
                while (i + 1 < recTypes.size() && recTypes.get(i + 1) == 0x003C) {
                    i++;
                    chunks.add(recPayloads.get(i));
                }
                parseBiff8Sst(chunks, totalUnique, sst);
            }
        }
        for (int i = 0; i < recTypes.size(); i++) {
            if (recTypes.get(i) == 0x00E0 && recPayloads.get(i).length >= 4) {
                int fmtId = readU16(recPayloads.get(i), 2);
                if (isBuiltInDateFormat(fmtId) || customDateFmts.contains(fmtId)) xfDateSet.add(xfIndex);
                xfIndex++;
            }
        }

        Map<Integer, Map<Integer, String>> grid = new TreeMap<Integer, Map<Integer, String>>();
        boolean inSheet = false;
        int depth = 0;
        for (int i = 0; i < recTypes.size(); i++) {
            int t = recTypes.get(i);
            byte[] d = recPayloads.get(i);
            if (t == 0x0809 && d.length >= 4) {
                int subType = readU16(d, 2);
                if (subType == 0x0010 && !inSheet) {
                    inSheet = true;
                    depth = 1;
                    continue;
                }
                if (inSheet) depth++;
            } else if (t == 0x000A && inSheet) {
                depth--;
                if (depth <= 0) break;
            }
            if (!inSheet || depth != 1) continue;

            if (t == 0x00FD && d.length >= 10) {
                int r = readU16(d, 0), c = readU16(d, 2), sIdx = readI32(d, 6);
                setGridCell(grid, r, c, (sIdx >= 0 && sIdx < sst.size()) ? sst.get(sIdx) : "");
            } else if (t == 0x0204 && d.length >= 8) {
                setGridCell(grid, readU16(d, 0), readU16(d, 2), readBiff8String(d, 6));
            } else if (t == 0x0203 && d.length >= 14) {
                setGridCell(grid, readU16(d, 0), readU16(d, 2), formatBiffNumber(readF64(d, 6), readU16(d, 4), xfDateSet));
            } else if (t == 0x027E && d.length >= 10) {
                setGridCell(grid, readU16(d, 0), readU16(d, 2), formatBiffNumber(decodeRk(readI32(d, 6)), readU16(d, 4), xfDateSet));
            } else if (t == 0x00BD && d.length >= 6) {
                int r = readU16(d, 0), cFirst = readU16(d, 2), count = (d.length - 6) / 6;
                for (int k = 0; k < count; k++) {
                    setGridCell(grid, r, cFirst + k, formatBiffNumber(decodeRk(readI32(d, 6 + k * 6)), readU16(d, 4 + k * 6), xfDateSet));
                }
            } else if (t == 0x0006 && d.length >= 20) {
                int r = readU16(d, 0), c = readU16(d, 2), xf = readU16(d, 4);
                if ((d[12] & 0xFF) == 0xFF && (d[13] & 0xFF) == 0xFF) {
                    if (d[6] == 0 && i + 1 < recTypes.size() && recTypes.get(i + 1) == 0x0207) {
                        setGridCell(grid, r, c, readBiff8String(recPayloads.get(i + 1), 0));
                    }
                } else {
                    setGridCell(grid, r, c, formatBiffNumber(readF64(d, 6), xf, xfDateSet));
                }
            }
        }

        List<List<String>> rows = new ArrayList<List<String>>();
        for (Map<Integer, String> rowMap : grid.values()) {
            int maxCol = 0;
            for (int cKey : rowMap.keySet()) if (cKey > maxCol) maxCol = cKey;
            List<String> row = new ArrayList<String>(maxCol + 1);
            for (int c = 0; c <= maxCol; c++) {
                String val = rowMap.get(c);
                row.add(val != null ? val : "");
            }
            if (rowHasContent(row)) rows.add(row);
        }
        return rows;
    }

    private static void setGridCell(Map<Integer, Map<Integer, String>> grid, int r, int c, String val) {
        Map<Integer, String> row = grid.get(r);
        if (row == null) {
            row = new TreeMap<Integer, String>();
            grid.put(r, row);
        }
        row.put(c, val == null ? "" : val.trim());
    }

    private static String formatBiffNumber(double num, int xf, Set<Integer> xfDateSet) {
        if (xfDateSet.contains(xf) && num > 1 && num < 2958465) {
            return formatExcelSerialDate(num);
        }
        if (num == Math.rint(num) && Math.abs(num) < 1e14) {
            return Long.toString((long) num);
        }
        return Double.toString(num);
    }

    private static double decodeRk(int rk) {
        boolean div100 = (rk & 1) != 0;
        boolean isInt = (rk & 2) != 0;
        double val = isInt ? (rk >> 2) : Double.longBitsToDouble(((long) (rk & ~3)) << 32);
        return div100 ? val / 100.0 : val;
    }

    private static String readBiff8String(byte[] data, int offset) {
        if (offset + 3 > data.length) return "";
        int cch = readU16(data, offset);
        int flags = data[offset + 2] & 0xFF;
        int p = offset + 3;
        boolean isUtf16 = (flags & 0x01) != 0;
        boolean hasExt = (flags & 0x04) != 0;
        boolean hasRich = (flags & 0x08) != 0;
        if (hasRich) p += 2;
        if (hasExt) p += 4;
        int byteLen = Math.min(isUtf16 ? cch * 2 : cch, Math.max(0, data.length - p));
        return new String(data, p, byteLen, isUtf16 ? StandardCharsets.UTF_16LE : Charset.forName("windows-1252"));
    }

    private static void parseBiff8Sst(List<byte[]> chunks, int totalUnique, List<String> sst) {
        Charset cp1252 = Charset.forName("windows-1252");
        int chunkIdx = 0;
        int offset = 8;
        for (int s = 0; s < totalUnique && chunkIdx < chunks.size(); s++) {
            if (offset + 3 > chunks.get(chunkIdx).length) {
                chunkIdx++;
                offset = 0;
                if (chunkIdx >= chunks.size()) break;
            }
            byte[] cur = chunks.get(chunkIdx);
            if (offset + 3 > cur.length) break;
            int cch = readU16(cur, offset);
            int flags = cur[offset + 2] & 0xFF;
            offset += 3;
            boolean isUtf16 = (flags & 0x01) != 0;
            boolean hasExt = (flags & 0x04) != 0;
            boolean hasRich = (flags & 0x08) != 0;
            int rtRuns = 0;
            if (hasRich && offset + 2 <= cur.length) { rtRuns = readU16(cur, offset); offset += 2; }
            int extSz = 0;
            if (hasExt && offset + 4 <= cur.length) { extSz = readI32(cur, offset); offset += 4; }

            StringBuilder sb = new StringBuilder();
            int rem = cch;
            while (rem > 0 && chunkIdx < chunks.size()) {
                cur = chunks.get(chunkIdx);
                int availBytes = cur.length - offset;
                if (availBytes <= 0) {
                    chunkIdx++;
                    if (chunkIdx >= chunks.size()) break;
                    isUtf16 = (chunks.get(chunkIdx)[0] & 0x01) != 0;
                    offset = 1;
                    continue;
                }
                int takeChars = Math.min(rem, isUtf16 ? availBytes / 2 : availBytes);
                if (takeChars == 0) {
                    chunkIdx++;
                    if (chunkIdx >= chunks.size()) break;
                    isUtf16 = (chunks.get(chunkIdx)[0] & 0x01) != 0;
                    offset = 1;
                    continue;
                }
                int takeBytes = isUtf16 ? takeChars * 2 : takeChars;
                sb.append(new String(cur, offset, takeBytes, isUtf16 ? StandardCharsets.UTF_16LE : cp1252));
                offset += takeBytes;
                rem -= takeChars;
            }
            sst.add(sb.toString());
            int skip = rtRuns * 4 + extSz;
            while (skip > 0 && chunkIdx < chunks.size()) {
                int avail = chunks.get(chunkIdx).length - offset;
                if (avail >= skip) { offset += skip; skip = 0; }
                else { skip -= avail; chunkIdx++; offset = 0; }
            }
        }
    }

    /* ---------- Helpers ---------- */
    private static DocumentBuilderFactory createSecureDbf() {
        DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
        dbf.setNamespaceAware(true);
        try {
            dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
            dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        } catch (Exception ignored) {}
        return dbf;
    }

    private static Element firstElementByName(Document doc, String local) {
        NodeList nl = doc.getElementsByTagNameNS("*", local);
        if (nl.getLength() == 0) nl = doc.getElementsByTagName(local);
        return nl.getLength() > 0 ? (Element) nl.item(0) : null;
    }

    private static String localName(Node n) {
        String ln = n.getLocalName();
        return ln != null ? ln : stripPrefix(n.getNodeName());
    }

    private static String stripPrefix(String qName) {
        if (qName == null) return "";
        int idx = qName.indexOf(':');
        return idx >= 0 ? qName.substring(idx + 1) : qName;
    }

    private static String getAttrAnyNs(Element el, String localAttr) {
        if (el.hasAttribute(localAttr)) return el.getAttribute(localAttr);
        if (el.hasAttribute("ss:" + localAttr)) return el.getAttribute("ss:" + localAttr);
        return null;
    }

    private static int readU16(byte[] b, int off) {
        return (b[off] & 0xFF) | ((b[off + 1] & 0xFF) << 8);
    }

    private static int readI32(byte[] b, int off) {
        return (b[off] & 0xFF)
                | ((b[off + 1] & 0xFF) << 8)
                | ((b[off + 2] & 0xFF) << 16)
                | ((b[off + 3] & 0xFF) << 24);
    }

    private static long readU32(byte[] b, int off) {
        return readI32(b, off) & 0xFFFFFFFFL;
    }

    private static long readI64(byte[] b, int off) {
        return ByteBuffer.wrap(b, off, 8).order(ByteOrder.LITTLE_ENDIAN).getLong();
    }

    private static double readF64(byte[] b, int off) {
        return ByteBuffer.wrap(b, off, 8).order(ByteOrder.LITTLE_ENDIAN).getDouble();
    }

    private static void writeI32Le(byte[] dst, int off, int val) {
        dst[off] = (byte) (val & 0xFF);
        dst[off + 1] = (byte) ((val >>> 8) & 0xFF);
        dst[off + 2] = (byte) ((val >>> 16) & 0xFF);
        dst[off + 3] = (byte) ((val >>> 24) & 0xFF);
    }

    private static void appendJsonString(StringBuilder sb, String s) {
        if (s == null) {
            sb.append("\"\"");
            return;
        }
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format(Locale.US, "\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        sb.append('"');
    }

    private static byte[] decodeBase64(String src) {
        int[] table = new int[256];
        Arrays.fill(table, -1);
        for (int i = 'A'; i <= 'Z'; i++) table[i] = i - 'A';
        for (int i = 'a'; i <= 'z'; i++) table[i] = i - 'a' + 26;
        for (int i = '0'; i <= '9'; i++) table[i] = i - '0' + 52;
        table['+'] = 62;
        table['/'] = 63;

        ByteArrayOutputStream out = new ByteArrayOutputStream((src.length() * 3) / 4);
        int buf = 0;
        int bits = 0;
        for (int i = 0; i < src.length(); i++) {
            char ch = src.charAt(i);
            if (ch == '=') break;
            if (ch >= 256) continue;
            int v = table[ch];
            if (v < 0) continue;
            buf = (buf << 6) | v;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                out.write((buf >>> bits) & 0xFF);
            }
        }
        return out.toByteArray();
    }

    /* ---------- Native Local PDF Text & Table Extractor (Zero Dependencies) ---------- */
    private static final class PdfIndirectObj {
        int id;
        int gen;
        String dict = "";
        String rawBody = "";
        byte[] rawStream;
        byte[] decodedStream;
    }

    private static final class PdfSecurityCtx {
        int v;
        int r;
        int keyLenBytes;
        boolean isAes;
        boolean encryptMetadata;
        byte[] fileKey;
    }

    private static final class PdfCMap {
        final Map<String, String> map = new HashMap<String, String>();
        int keyHexLen = 0;
    }

    private static final class PdfTextFrag {
        int page;
        double x;
        double y;
        double fontSize;
        String text;
    }

    private static final class PdfToken {
        String kind; // "str", "hex", "name", "num", "op", "arr_start", "arr_end"
        String text;
        byte[] rawBytes;
    }

    private static boolean isPdfSignature(byte[] bytes) {
        if (bytes == null || bytes.length < 5) return false;
        int lim = Math.min(1024, bytes.length - 5);
        for (int i = 0; i <= lim; i++) {
            if (bytes[i] == 0x25 && bytes[i + 1] == 0x50 && bytes[i + 2] == 0x44 && bytes[i + 3] == 0x46 && bytes[i + 4] == 0x2D) {
                return true;
            }
        }
        return false;
    }

    private static ParseResult parsePdfBytes(byte[] bytes, String password) {
        ParseResult res = new ParseResult();
        try {
            String pdfStr = new String(bytes, StandardCharsets.ISO_8859_1);
            Map<Integer, PdfIndirectObj> objs = parsePdfObjects(bytes, pdfStr);
            Object[] secAttempt = tryUnlockPdfSecurity(pdfStr, objs, password);
            if (secAttempt[0] != null) {
                return (ParseResult) secAttempt[0];
            }
            PdfSecurityCtx secCtx = (PdfSecurityCtx) secAttempt[1];

            PdfCMap globalCMap = new PdfCMap();
            Map<Integer, PdfCMap> objCMaps = new HashMap<Integer, PdfCMap>();

            List<Integer> objIds = new ArrayList<Integer>(objs.keySet());
            for (int id : objIds) {
                PdfIndirectObj o = objs.get(id);
                if (o.rawStream != null) {
                    byte[] streamSrc = secCtx != null
                            ? decryptPdfObjectStream(o.rawStream, o.id, o.gen, o.dict, secCtx)
                            : o.rawStream;
                    o.decodedStream = decodePdfStream(streamSrc, o.dict);
                    if (o.decodedStream != null && o.decodedStream.length > 0) {
                        String sText = new String(o.decodedStream, StandardCharsets.ISO_8859_1);
                        if (sText.contains("beginbfchar") || sText.contains("beginbfrange")) {
                            PdfCMap cm = parsePdfCMap(sText);
                            objCMaps.put(id, cm);
                            mergePdfCMap(globalCMap, cm);
                        }
                        if (o.dict != null && Pattern.compile("/Type\\s*/ObjStm\\b").matcher(o.dict).find()) {
                            extractPdfObjStm(o.decodedStream, o.dict, objs);
                        }
                    }
                }
            }

            List<PdfIndirectObj> pageObjs = new ArrayList<PdfIndirectObj>();
            List<Integer> pageOrderIds = resolvePdfPageOrder(objs);
            if (!pageOrderIds.isEmpty()) {
                for (int pid : pageOrderIds) {
                    PdfIndirectObj po = objs.get(pid);
                    if (po != null) pageObjs.add(po);
                }
            } else {
                List<Integer> sortedIds = new ArrayList<Integer>(objs.keySet());
                Collections.sort(sortedIds);
                Pattern pagePat = Pattern.compile("/Type\\s*/Page\\b(?!s)");
                for (int id : sortedIds) {
                    PdfIndirectObj o = objs.get(id);
                    if (o.dict != null && pagePat.matcher(o.dict).find()) {
                        pageObjs.add(o);
                    }
                }
            }

            List<PdfTextFrag> allFrags = new ArrayList<PdfTextFrag>();
            int pageNum = 0;

            if (!pageObjs.isEmpty()) {
                for (PdfIndirectObj page : pageObjs) {
                    pageNum++;
                    Map<String, PdfCMap> fontCMaps = resolvePageFontCMaps(page, objs, objCMaps);
                    Map<String, PdfIndirectObj> formXObjs = resolvePageFormXObjects(page, objs);
                    List<Integer> contentIds = extractPdfContentRefs(page.dict, objs);
                    ByteArrayOutputStream combined = new ByteArrayOutputStream();
                    for (int cid : contentIds) {
                        PdfIndirectObj co = objs.get(cid);
                        if (co != null && co.decodedStream != null) {
                            combined.write(co.decodedStream, 0, co.decodedStream.length);
                            combined.write('\n');
                        }
                    }
                    byte[] pageBytes = combined.toByteArray();
                    if (pageBytes.length > 0) {
                        extractPdfContentText(pageBytes, pageNum, objs, objCMaps, fontCMaps, globalCMap, formXObjs, null, allFrags, 0);
                    }
                }
            } else {
                List<Integer> sortedIds = new ArrayList<Integer>(objs.keySet());
                Collections.sort(sortedIds);
                Map<String, PdfCMap> emptyMap = new HashMap<String, PdfCMap>();
                for (int id : sortedIds) {
                    PdfIndirectObj o = objs.get(id);
                    if (o.decodedStream == null || o.decodedStream.length == 0 || objCMaps.containsKey(id)) continue;
                    String head = new String(o.decodedStream, 0, Math.min(512, o.decodedStream.length), StandardCharsets.ISO_8859_1);
                    if (head.contains("BT") || head.contains("Tj") || head.contains("TJ")) {
                        pageNum++;
                        extractPdfContentText(o.decodedStream, pageNum, objs, objCMaps, emptyMap, globalCMap, null, null, allFrags, 0);
                    }
                }
            }

            if (allFrags.isEmpty()) {
                res.format = "pdf-scanned";
                res.error = "No selectable text found in this PDF (it looks like a scanned image PDF). Use 'Paste / OCR Text' or configure Vision AI in Settings.";
                return res;
            }

            List<List<String>> rows = buildPdfTableRows(allFrags);
            if (rows.isEmpty()) {
                res.format = "pdf-empty";
                res.error = "Could not extract readable transaction rows from this PDF.";
                return res;
            }
            res.ok = true;
            res.format = "pdf";
            res.rows = rows;
            return res;
        } catch (Exception ex) {
            res.format = "pdf";
            res.error = "Failed to parse PDF locally: " + ex.getMessage();
            return res;
        }
    }

    private static Map<Integer, PdfIndirectObj> parsePdfObjects(byte[] rawBytes, String pdfStr) {
        Map<Integer, PdfIndirectObj> map = new HashMap<Integer, PdfIndirectObj>();
        Matcher m = Pattern.compile("(?:^|[\\r\\n\\s])(\\d+)\\s+(\\d+)\\s+obj\\b").matcher(pdfStr);
        List<Integer> ids = new ArrayList<Integer>();
        List<Integer> gens = new ArrayList<Integer>();
        List<Integer> starts = new ArrayList<Integer>();
        List<Integer> bodyStarts = new ArrayList<Integer>();
        while (m.find()) {
            try {
                ids.add(Integer.parseInt(m.group(1)));
                gens.add(Integer.parseInt(m.group(2)));
                starts.add(m.start());
                bodyStarts.add(m.end());
            } catch (NumberFormatException ignored) {}
        }

        for (int idx = 0; idx < ids.size(); idx++) {
            int id = ids.get(idx);
            int gen = gens.get(idx);
            int bodyStart = bodyStarts.get(idx);
            int searchEnd = (idx + 1 < starts.size()) ? starts.get(idx + 1) : pdfStr.length();
            if (bodyStart >= searchEnd) continue;

            String dict = "";
            int dictStart = -1;
            int dictEnd = -1;
            int scanLim = Math.min(searchEnd, bodyStart + 4096);
            for (int i = bodyStart; i < scanLim - 1; i++) {
                char c = pdfStr.charAt(i);
                if (c == '<' && pdfStr.charAt(i + 1) == '<') { dictStart = i; break; }
                if (c == 's' && i + 6 <= scanLim && "stream".equals(pdfStr.substring(i, i + 6))) break;
            }
            if (dictStart >= 0) {
                int depth = 0;
                for (int i = dictStart; i < searchEnd - 1; i++) {
                    if (pdfStr.charAt(i) == '<' && pdfStr.charAt(i + 1) == '<') { depth++; i++; }
                    else if (pdfStr.charAt(i) == '>' && pdfStr.charAt(i + 1) == '>') {
                        depth--; i++;
                        if (depth == 0) { dictEnd = i + 1; break; }
                    }
                }
                if (dictEnd > dictStart) {
                    dict = pdfStr.substring(dictStart, dictEnd);
                }
            }

            byte[] streamBytes = null;
            String rawBody = "";
            int afterDict = dictEnd > 0 ? dictEnd : bodyStart;
            int endObjPos = pdfStr.indexOf("endobj", afterDict);
            if (endObjPos < 0 || endObjPos > searchEnd) endObjPos = searchEnd;

            Matcher lenPatM = Pattern.compile("/Length\\s+(\\d+)\\b").matcher(dict == null ? "" : dict);
            int declLen = -1;
            if (lenPatM.find()) {
                try { declLen = Integer.parseInt(lenPatM.group(1)); } catch (Exception ignored) { declLen = -1; }
            }

            int streamKw = pdfStr.indexOf("stream", afterDict);
            if (streamKw >= 0 && streamKw < searchEnd && (streamKw < endObjPos || declLen > 0)) {
                int sDataStart = streamKw + 6;
                if (sDataStart < pdfStr.length() && pdfStr.charAt(sDataStart) == '\r') sDataStart++;
                if (sDataStart < pdfStr.length() && pdfStr.charAt(sDataStart) == '\n') sDataStart++;
                if (declLen > 0 && sDataStart + declLen <= rawBytes.length) {
                    int probeEnd = Math.min(pdfStr.length(), sDataStart + declLen + 16);
                    String tail = pdfStr.substring(sDataStart + declLen, probeEnd).trim();
                    if (tail.startsWith("endstream")) {
                        streamBytes = Arrays.copyOfRange(rawBytes, sDataStart, sDataStart + declLen);
                    }
                }
                if (streamBytes == null) {
                    int limEnd = Math.max(sDataStart, endObjPos);
                    int endStreamKw = pdfStr.lastIndexOf("endstream", limEnd);
                    if (endStreamKw >= sDataStart) {
                        int sLen = endStreamKw - sDataStart;
                        if (sLen > 0 && rawBytes[sDataStart + sLen - 1] == '\n') sLen--;
                        if (sLen > 0 && rawBytes[sDataStart + sLen - 1] == '\r') sLen--;
                        if (sLen > 0 && sDataStart + sLen <= rawBytes.length) {
                            streamBytes = Arrays.copyOfRange(rawBytes, sDataStart, sDataStart + sLen);
                        }
                    }
                }
            } else if ((dict == null || dict.isEmpty()) && endObjPos > bodyStart) {
                rawBody = pdfStr.substring(bodyStart, endObjPos).trim();
            }

            PdfIndirectObj obj = new PdfIndirectObj();
            obj.id = id;
            obj.gen = gen;
            obj.dict = dict;
            obj.rawBody = rawBody;
            obj.rawStream = streamBytes;
            map.put(id, obj);
        }
        return map;
    }

    private static byte[] decodePdfStream(byte[] raw, String dict) {
        if (raw == null || raw.length == 0) return raw;
        String d = dict == null ? "" : dict;
        byte[] data = raw;
        if (d.contains("/ASCIIHexDecode")) data = decodeAsciiHex(data);
        if (d.contains("/ASCII85Decode")) data = decodeAscii85(data);
        if (d.contains("/LZWDecode")) {
            byte[] lzw = decodePdfLzw(data);
            if (lzw != null) data = lzw;
        }
        if (d.contains("/FlateDecode")) {
            byte[] inf = inflateZlibOrRaw(data);
            if (inf != null) data = inf;
            Matcher predM = Pattern.compile("/Predictor\\s+(\\d+)").matcher(d);
            if (predM.find()) {
                int pred = Integer.parseInt(predM.group(1));
                if (pred >= 10) {
                    Matcher colM = Pattern.compile("/Columns\\s+(\\d+)").matcher(d);
                    int cols = colM.find() ? Integer.parseInt(colM.group(1)) : 1;
                    data = unfilterPngPredictor(data, cols);
                }
            }
        }
        return data;
    }

    private static byte[] decodePdfLzw(byte[] data) {
        if (data == null || data.length == 0) return null;
        try {
            ByteArrayOutputStream outMs = new ByteArrayOutputStream();
            List<byte[]> dict = new ArrayList<byte[]>(4096);
            for (int i = 0; i < 258; i++) dict.add(i < 256 ? new byte[]{(byte) i} : new byte[0]);
            int codeLen = 9, bitBuf = 0, bitCnt = 0, pos = 0, prevCode = -1;
            while (true) {
                while (bitCnt < codeLen && pos < data.length) {
                    bitBuf = (bitBuf << 8) | (data[pos++] & 0xFF);
                    bitCnt += 8;
                }
                if (bitCnt < codeLen) break;
                bitCnt -= codeLen;
                int code = (bitBuf >> bitCnt) & ((1 << codeLen) - 1);
                if (code == 256) {
                    dict.clear();
                    for (int i = 0; i < 258; i++) dict.add(i < 256 ? new byte[]{(byte) i} : new byte[0]);
                    codeLen = 9;
                    prevCode = -1;
                    continue;
                }
                if (code == 257) break;
                byte[] entry;
                if (code < dict.size()) {
                    entry = dict.get(code);
                } else if (code == dict.size() && prevCode >= 0 && prevCode < dict.size()) {
                    byte[] prev = dict.get(prevCode);
                    entry = new byte[prev.length + 1];
                    System.arraycopy(prev, 0, entry, 0, prev.length);
                    entry[prev.length] = prev[0];
                } else {
                    break;
                }
                outMs.write(entry, 0, entry.length);
                if (prevCode >= 0 && dict.size() < 4096) {
                    byte[] prev = dict.get(prevCode);
                    byte[] next = new byte[prev.length + 1];
                    System.arraycopy(prev, 0, next, 0, prev.length);
                    next[prev.length] = entry[0];
                    dict.add(next);
                    if (dict.size() == 511) codeLen = 10;
                    else if (dict.size() == 1023) codeLen = 11;
                    else if (dict.size() == 2047) codeLen = 12;
                }
                prevCode = code;
            }
            return outMs.size() > 0 ? outMs.toByteArray() : null;
        } catch (Exception ex) {
            return null;
        }
    }

    private static byte[] inflateZlibOrRaw(byte[] data) {
        if (data == null || data.length == 0) return null;
        boolean[] nowrapOpts = new boolean[]{false, true};
        for (boolean nowrap : nowrapOpts) {
            Inflater inf = new Inflater(nowrap);
            try {
                inf.setInput(data);
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                while (!inf.finished()) {
                    int n = inf.inflate(buf);
                    if (n > 0) {
                        out.write(buf, 0, n);
                    } else if (inf.needsInput() || inf.needsDictionary()) {
                        break;
                    }
                }
                if (out.size() > 0) return out.toByteArray();
            } catch (Exception ignored) {
            } finally {
                inf.end();
            }
        }
        return null;
    }

    private static byte[] decodeAsciiHex(byte[] data) {
        ByteArrayOutputStream ms = new ByteArrayOutputStream();
        int hi = -1;
        for (int i = 0; i < data.length; i++) {
            char c = (char) (data[i] & 0xFF);
            if (c == '>') break;
            int v = hexVal(c);
            if (v < 0) continue;
            if (hi < 0) hi = v;
            else { ms.write((hi << 4) | v); hi = -1; }
        }
        if (hi >= 0) ms.write(hi << 4);
        return ms.toByteArray();
    }

    private static byte[] decodeAscii85(byte[] data) {
        ByteArrayOutputStream ms = new ByteArrayOutputStream();
        long tuple = 0;
        int count = 0;
        for (int i = 0; i < data.length; i++) {
            char c = (char) (data[i] & 0xFF);
            if (c == '~' && i + 1 < data.length && (char) (data[i + 1] & 0xFF) == '>') break;
            if (c == 'z' && count == 0) {
                ms.write(0); ms.write(0); ms.write(0); ms.write(0);
                continue;
            }
            if (c < '!' || c > 'u') continue;
            tuple = tuple * 85L + (c - '!');
            count++;
            if (count == 5) {
                ms.write((int) ((tuple >>> 24) & 0xFF));
                ms.write((int) ((tuple >>> 16) & 0xFF));
                ms.write((int) ((tuple >>> 8) & 0xFF));
                ms.write((int) (tuple & 0xFF));
                tuple = 0;
                count = 0;
            }
        }
        if (count > 1) {
            for (int k = count; k < 5; k++) tuple = tuple * 85L + 84L;
            for (int k = 0; k < count - 1; k++) {
                ms.write((int) ((tuple >>> (24 - k * 8)) & 0xFF));
            }
        }
        return ms.toByteArray();
    }

    private static byte[] unfilterPngPredictor(byte[] data, int columns) {
        int rowStride = columns + 1;
        if (rowStride <= 1 || data.length < rowStride) return data;
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] prev = new byte[columns];
        for (int pos = 0; pos + rowStride <= data.length; pos += rowStride) {
            int f = data[pos] & 0xFF;
            byte[] cur = new byte[columns];
            for (int i = 0; i < columns; i++) {
                int raw = data[pos + 1 + i] & 0xFF;
                int left = i > 0 ? (cur[i - 1] & 0xFF) : 0;
                int up = prev[i] & 0xFF;
                int upLeft = i > 0 ? (prev[i - 1] & 0xFF) : 0;
                int val = raw;
                if (f == 1) val = raw + left;
                else if (f == 2) val = raw + up;
                else if (f == 3) val = raw + ((left + up) >> 1);
                else if (f == 4) val = raw + paeth(left, up, upLeft);
                cur[i] = (byte) (val & 0xFF);
            }
            out.write(cur, 0, columns);
            prev = cur;
        }
        return out.toByteArray();
    }

    private static int paeth(int a, int b, int c) {
        int p = a + b - c;
        int pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        if (pa <= pb && pa <= pc) return a;
        return pb <= pc ? b : c;
    }

    private static void extractPdfObjStm(byte[] stmBytes, String dict, Map<Integer, PdfIndirectObj> objs) {
        try {
            Matcher nM = Pattern.compile("/N\\s+(\\d+)").matcher(dict == null ? "" : dict);
            Matcher fM = Pattern.compile("/First\\s+(\\d+)").matcher(dict == null ? "" : dict);
            if (!nM.find() || !fM.find()) return;
            int n = Integer.parseInt(nM.group(1));
            int first = Integer.parseInt(fM.group(1));
            if (first <= 0 || first > stmBytes.length) return;
            String hdr = new String(stmBytes, 0, first, StandardCharsets.US_ASCII).trim();
            String[] parts = hdr.split("\\s+");
            if (parts.length < n * 2) return;
            List<Integer> oids = new ArrayList<Integer>();
            List<Integer> offs = new ArrayList<Integer>();
            for (int i = 0; i < n; i++) {
                oids.add(Integer.parseInt(parts[i * 2]));
                offs.add(first + Integer.parseInt(parts[i * 2 + 1]));
            }
            for (int i = 0; i < oids.size(); i++) {
                int oid = oids.get(i);
                int start = offs.get(i);
                int end = (i + 1 < offs.size()) ? offs.get(i + 1) : stmBytes.length;
                if (start >= 0 && end > start && end <= stmBytes.length && !objs.containsKey(oid)) {
                    PdfIndirectObj obj = new PdfIndirectObj();
                    obj.id = oid;
                    obj.dict = new String(stmBytes, start, end - start, StandardCharsets.ISO_8859_1).trim();
                    objs.put(oid, obj);
                }
            }
        } catch (Exception ignored) {}
    }

    private static List<Integer> resolvePdfPageOrder(Map<Integer, PdfIndirectObj> objs) {
        List<Integer> order = new ArrayList<Integer>();
        try {
            int rootId = -1;
            Pattern catPat = Pattern.compile("/Type\\s*/Catalog\\b");
            Pattern pagesPat = Pattern.compile("/Pages\\s+(\\d+)\\s+\\d+\\s+R");
            for (PdfIndirectObj o : objs.values()) {
                if (o.dict != null && catPat.matcher(o.dict).find()) {
                    Matcher pm = pagesPat.matcher(o.dict);
                    if (pm.find()) { rootId = Integer.parseInt(pm.group(1)); break; }
                }
            }
            if (rootId < 0) return order;
            walkPagesTree(rootId, objs, order, new HashSet<Integer>());
        } catch (Exception ignored) {}
        return order;
    }

    private static void walkPagesTree(int nodeId, Map<Integer, PdfIndirectObj> objs, List<Integer> order, Set<Integer> visited) {
        if (!visited.add(nodeId)) return;
        PdfIndirectObj node = objs.get(nodeId);
        if (node == null || node.dict == null || node.dict.isEmpty()) return;
        if (Pattern.compile("/Type\\s*/Page\\b(?!s)").matcher(node.dict).find()) {
            order.add(nodeId);
            return;
        }
        Matcher kidsM = Pattern.compile("/Kids\\s*\\[(.*?)\\]", Pattern.DOTALL).matcher(node.dict);
        if (!kidsM.find()) return;
        Matcher refs = Pattern.compile("(\\d+)\\s+\\d+\\s+R").matcher(kidsM.group(1));
        while (refs.find()) {
            walkPagesTree(Integer.parseInt(refs.group(1)), objs, order, visited);
        }
    }

    private static List<Integer> extractPdfContentRefs(String pageDict, Map<Integer, PdfIndirectObj> objs) {
        List<Integer> list = new ArrayList<Integer>();
        if (pageDict == null || pageDict.isEmpty()) return list;
        Matcher arrM = Pattern.compile("/Contents\\s*\\[(.*?)\\]", Pattern.DOTALL).matcher(pageDict);
        if (arrM.find()) {
            Matcher r = Pattern.compile("(\\d+)\\s+\\d+\\s+R").matcher(arrM.group(1));
            while (r.find()) list.add(Integer.parseInt(r.group(1)));
            return list;
        }
        Matcher singleM = Pattern.compile("/Contents\\s+(\\d+)\\s+\\d+\\s+R").matcher(pageDict);
        if (singleM.find()) {
            int id = Integer.parseInt(singleM.group(1));
            PdfIndirectObj co = objs == null ? null : objs.get(id);
            if (co != null && co.rawStream == null && co.rawBody != null && co.rawBody.startsWith("[")) {
                Matcher r = Pattern.compile("(\\d+)\\s+\\d+\\s+R").matcher(co.rawBody);
                while (r.find()) list.add(Integer.parseInt(r.group(1)));
            } else {
                list.add(id);
            }
        }
        return list;
    }

    private static String collectPageResourcesText(PdfIndirectObj page, Map<Integer, PdfIndirectObj> objs) {
        StringBuilder sb = new StringBuilder();
        Set<Integer> visited = new HashSet<Integer>();
        PdfIndirectObj cur = page;
        int guard = 0;
        Pattern resPat = Pattern.compile("/Resources\\s+(\\d+)\\s+\\d+\\s+R");
        Pattern parPat = Pattern.compile("/Parent\\s+(\\d+)\\s+\\d+\\s+R");
        while (cur != null && cur.dict != null && !cur.dict.isEmpty() && guard++ < 8) {
            sb.append(' ').append(cur.dict);
            Matcher resRef = resPat.matcher(cur.dict);
            if (resRef.find()) {
                PdfIndirectObj ro = objs.get(Integer.parseInt(resRef.group(1)));
                if (ro != null && ro.dict != null) sb.append(' ').append(ro.dict);
            }
            Matcher parentRef = parPat.matcher(cur.dict);
            if (!parentRef.find()) break;
            int pid = Integer.parseInt(parentRef.group(1));
            if (!visited.add(pid)) break;
            cur = objs.get(pid);
        }
        return sb.toString();
    }

    private static Map<String, PdfCMap> resolvePageFontCMaps(PdfIndirectObj page, Map<Integer, PdfIndirectObj> objs, Map<Integer, PdfCMap> objCMaps) {
        Map<String, PdfCMap> map = new HashMap<String, PdfCMap>();
        if (page == null || page.dict == null || page.dict.isEmpty()) return map;
        StringBuilder resText = new StringBuilder(collectPageResourcesText(page, objs));
        Matcher fontRef = Pattern.compile("/Font\\s+(\\d+)\\s+\\d+\\s+R").matcher(resText.toString());
        while (fontRef.find()) {
            PdfIndirectObj fo = objs.get(Integer.parseInt(fontRef.group(1)));
            if (fo != null && fo.dict != null) resText.append(' ').append(fo.dict);
        }
        Matcher fm = Pattern.compile("/([A-Za-z0-9_+.#-]+)\\s+(\\d+)\\s+\\d+\\s+R").matcher(resText.toString());
        Pattern fontObjPat = Pattern.compile("(/Type\\s*/Font\\b|/Subtype\\s*/(?:Type0|Type1|TrueType|CIDFontType0|CIDFontType2|Type3)\\b|/ToUnicode\\b|/BaseFont\\b)");
        Pattern tuPat = Pattern.compile("/ToUnicode\\s+(\\d+)\\s+\\d+\\s+R");
        while (fm.find()) {
            String fName = fm.group(1);
            int fontObjId = Integer.parseInt(fm.group(2));
            PdfIndirectObj fontObj = objs.get(fontObjId);
            if (fontObj == null || fontObj.dict == null || !fontObjPat.matcher(fontObj.dict).find()) continue;
            Matcher tuM = tuPat.matcher(fontObj.dict);
            if (tuM.find()) {
                PdfCMap cm = objCMaps.get(Integer.parseInt(tuM.group(1)));
                if (cm != null) map.put(fName, cm);
                else if (!map.containsKey(fName)) map.put(fName, null);
            } else if (!map.containsKey(fName)) {
                map.put(fName, null);
            }
        }
        return map;
    }

    private static Map<String, PdfIndirectObj> resolvePageFormXObjects(PdfIndirectObj page, Map<Integer, PdfIndirectObj> objs) {
        Map<String, PdfIndirectObj> map = new HashMap<String, PdfIndirectObj>();
        if (page == null || page.dict == null || page.dict.isEmpty()) return map;
        StringBuilder resText = new StringBuilder(collectPageResourcesText(page, objs));
        Matcher xRef = Pattern.compile("/XObject\\s+(\\d+)\\s+\\d+\\s+R").matcher(resText.toString());
        while (xRef.find()) {
            PdfIndirectObj xo = objs.get(Integer.parseInt(xRef.group(1)));
            if (xo != null && xo.dict != null) resText.append(' ').append(xo.dict);
        }
        Matcher xm = Pattern.compile("/([A-Za-z0-9_+.#-]+)\\s+(\\d+)\\s+\\d+\\s+R").matcher(resText.toString());
        Pattern formPat = Pattern.compile("/Subtype\\s*/Form\\b");
        while (xm.find()) {
            String xName = xm.group(1);
            int objId = Integer.parseInt(xm.group(2));
            PdfIndirectObj xObj = objs.get(objId);
            if (xObj != null && xObj.decodedStream != null && xObj.dict != null && formPat.matcher(xObj.dict).find()) {
                map.put(xName, xObj);
            }
        }
        return map;
    }

    private static PdfCMap parsePdfCMap(String text) {
        PdfCMap cm = new PdfCMap();
        Matcher blk1 = Pattern.compile("beginbfchar\\s+(.*?)\\s+endbfchar", Pattern.DOTALL).matcher(text);
        Pattern pairPat = Pattern.compile("<([0-9A-Fa-f]+)>\\s*<([0-9A-Fa-f]+)>");
        while (blk1.find()) {
            Matcher pm = pairPat.matcher(blk1.group(1));
            while (pm.find()) {
                String src = pm.group(1).toUpperCase(Locale.US);
                String dst = decodeHexUtf16Be(pm.group(2));
                if (src.length() > cm.keyHexLen) cm.keyHexLen = src.length();
                cm.map.put(src, dst);
            }
        }
        Matcher blk2 = Pattern.compile("beginbfrange\\s+(.*?)\\s+endbfrange", Pattern.DOTALL).matcher(text);
        Pattern r1Pat = Pattern.compile("<([0-9A-Fa-f]+)>\\s*<([0-9A-Fa-f]+)>\\s*<([0-9A-Fa-f]+)>");
        Pattern r2Pat = Pattern.compile("<([0-9A-Fa-f]+)>\\s*<([0-9A-Fa-f]+)>\\s*\\[(.*?)\\]", Pattern.DOTALL);
        Pattern hexPat = Pattern.compile("<([0-9A-Fa-f]+)>");
        while (blk2.find()) {
            String body = blk2.group(1);
            Matcher r1 = r1Pat.matcher(body);
            while (r1.find()) {
                String sHex = r1.group(1), eHex = r1.group(2), dHex = r1.group(3);
                int w = sHex.length();
                if (w > cm.keyHexLen) cm.keyHexLen = w;
                try {
                    long startCode = Long.parseLong(sHex, 16);
                    long endCode = Long.parseLong(eHex, 16);
                    if (dHex.length() <= 8 && endCode >= startCode && (endCode - startCode) <= 4096) {
                        long dstCode = Long.parseLong(dHex, 16);
                        String fmt = "%0" + w + "X";
                        for (long c = startCode; c <= endCode; c++) {
                            int cp = (int) (dstCode + (c - startCode));
                            cm.map.put(String.format(Locale.US, fmt, c), new String(Character.toChars(cp)));
                        }
                    }
                } catch (Exception ignored) {}
            }
            Matcher r2 = r2Pat.matcher(body);
            while (r2.find()) {
                String sHex = r2.group(1), eHex = r2.group(2);
                int w = sHex.length();
                if (w > cm.keyHexLen) cm.keyHexLen = w;
                try {
                    long startCode = Long.parseLong(sHex, 16);
                    long endCode = Long.parseLong(eHex, 16);
                    if (endCode >= startCode && (endCode - startCode) <= 4096) {
                        Matcher dm = hexPat.matcher(r2.group(3));
                        String fmt = "%0" + w + "X";
                        for (long c = startCode; c <= endCode && dm.find(); c++) {
                            cm.map.put(String.format(Locale.US, fmt, c), decodeHexUtf16Be(dm.group(1)));
                        }
                    }
                } catch (Exception ignored) {}
            }
        }
        return cm;
    }

    private static void mergePdfCMap(PdfCMap target, PdfCMap src) {
        if (src.keyHexLen > target.keyHexLen) target.keyHexLen = src.keyHexLen;
        for (Map.Entry<String, String> kv : src.map.entrySet()) {
            if (!target.map.containsKey(kv.getKey())) target.map.put(kv.getKey(), kv.getValue());
        }
    }

    private static String decodeHexUtf16Be(String hex) {
        if (hex == null || hex.isEmpty()) return "";
        if (hex.length() % 2 == 1) hex = "0" + hex;
        byte[] b = new byte[hex.length() / 2];
        for (int i = 0; i < b.length; i++) {
            b[i] = (byte) ((hexVal(hex.charAt(i * 2)) << 4) | hexVal(hex.charAt(i * 2 + 1)));
        }
        if (b.length >= 2 && b.length % 2 == 0) {
            return new String(b, StandardCharsets.UTF_16BE);
        }
        return new String(b, Charset.forName("windows-1252"));
    }

    private static int hexVal(char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    }

    private static List<PdfToken> tokenizePdfContent(byte[] bytes) {
        List<PdfToken> tokens = new ArrayList<PdfToken>();
        int n = bytes.length;
        int i = 0;
        while (i < n) {
            int b = bytes[i] & 0xFF;
            if (b <= 32) { i++; continue; }
            if (b == '%') {
                while (i < n && bytes[i] != '\n' && bytes[i] != '\r') i++;
                continue;
            }
            if (b == '(') {
                i++;
                ByteArrayOutputStream ms = new ByteArrayOutputStream();
                int depth = 1;
                while (i < n && depth > 0) {
                    int ch = bytes[i++] & 0xFF;
                    if (ch == '\\') {
                        if (i >= n) break;
                        int esc = bytes[i++] & 0xFF;
                        if (esc == 'n') ms.write('\n');
                        else if (esc == 'r') ms.write('\r');
                        else if (esc == 't') ms.write('\t');
                        else if (esc == 'b') ms.write('\b');
                        else if (esc == 'f') ms.write('\f');
                        else if (esc == '\r') { if (i < n && bytes[i] == '\n') i++; }
                        else if (esc == '\n') { }
                        else if (esc >= '0' && esc <= '7') {
                            int oct = esc - '0';
                            for (int k = 0; k < 2 && i < n && bytes[i] >= '0' && bytes[i] <= '7'; k++) {
                                oct = oct * 8 + (bytes[i++] - '0');
                            }
                            ms.write(oct & 0xFF);
                        } else {
                            ms.write(esc);
                        }
                    } else if (ch == '(') {
                        depth++;
                        ms.write(ch);
                    } else if (ch == ')') {
                        depth--;
                        if (depth > 0) ms.write(ch);
                    } else {
                        ms.write(ch);
                    }
                }
                PdfToken tok = new PdfToken();
                tok.kind = "str";
                tok.rawBytes = ms.toByteArray();
                tokens.add(tok);
                continue;
            }
            if (b == '<') {
                if (i + 1 < n && bytes[i + 1] == '<') { i += 2; continue; }
                i++;
                StringBuilder sb = new StringBuilder();
                while (i < n && bytes[i] != '>') {
                    char c = (char) (bytes[i++] & 0xFF);
                    if (hexVal(c) >= 0) sb.append(c);
                }
                if (i < n && bytes[i] == '>') i++;
                PdfToken tok = new PdfToken();
                tok.kind = "hex";
                tok.text = sb.toString();
                tokens.add(tok);
                continue;
            }
            if (b == '>') {
                if (i + 1 < n && bytes[i + 1] == '>') i += 2;
                else i++;
                continue;
            }
            if (b == '[') { PdfToken t = new PdfToken(); t.kind = "arr_start"; t.text = "["; tokens.add(t); i++; continue; }
            if (b == ']') { PdfToken t = new PdfToken(); t.kind = "arr_end"; t.text = "]"; tokens.add(t); i++; continue; }
            if (b == '/') {
                i++;
                StringBuilder sb = new StringBuilder();
                while (i < n && (bytes[i] & 0xFF) > 32 && "()<>[]{}/%".indexOf((char) (bytes[i] & 0xFF)) < 0) {
                    sb.append((char) (bytes[i++] & 0xFF));
                }
                PdfToken t = new PdfToken(); t.kind = "name"; t.text = sb.toString(); tokens.add(t);
                continue;
            }
            StringBuilder word = new StringBuilder();
            while (i < n && (bytes[i] & 0xFF) > 32 && "()<>[]{}/%".indexOf((char) (bytes[i] & 0xFF)) < 0) {
                word.append((char) (bytes[i++] & 0xFF));
            }
            String w = word.toString();
            if ("BI".equals(w) && (tokens.isEmpty() || "op".equals(tokens.get(tokens.size() - 1).kind) || "arr_end".equals(tokens.get(tokens.size() - 1).kind))) {
                int scan = i;
                int lim = Math.min(n, i + 4096);
                int idPos = -1;
                while (scan + 2 < lim) {
                    if ((bytes[scan] & 0xFF) <= 32 && bytes[scan + 1] == 'I' && bytes[scan + 2] == 'D'
                            && (scan + 3 >= n || (bytes[scan + 3] & 0xFF) <= 32)) {
                        idPos = scan + 4;
                        break;
                    }
                    scan++;
                }
                if (idPos > 0) {
                    int eiScan = idPos;
                    while (eiScan + 2 < n) {
                        if ((bytes[eiScan] & 0xFF) <= 32 && bytes[eiScan + 1] == 'E' && bytes[eiScan + 2] == 'I'
                                && (eiScan + 3 >= n || (bytes[eiScan + 3] & 0xFF) <= 32)) {
                            i = eiScan + 3;
                            break;
                        }
                        eiScan++;
                    }
                    if (i >= idPos) continue;
                }
            }
            PdfToken t = new PdfToken();
            t.text = w;
            try {
                Double.parseDouble(w);
                t.kind = "num";
            } catch (NumberFormatException ex) {
                t.kind = "op";
            }
            tokens.add(t);
        }
        return tokens;
    }

    private static String decodePdfStringToken(PdfToken tok, PdfCMap activeMap, PdfCMap globalMap, boolean suppressGlobal) {
        String res = decodePdfStringTokenRaw(tok, activeMap, suppressGlobal ? null : globalMap);
        return (res == null || res.isEmpty()) ? "" : res.replace("\0", "");
    }

    private static String decodePdfStringTokenRaw(PdfToken tok, PdfCMap activeMap, PdfCMap globalMap) {
        if (tok == null) return "";
        if ("hex".equals(tok.kind)) {
            PdfCMap cm = activeMap != null ? activeMap : globalMap;
            String hex = (tok.text == null ? "" : tok.text).toUpperCase(Locale.US);
            if (hex.isEmpty()) return "";
            if (cm != null && !cm.map.isEmpty()) {
                int step = cm.keyHexLen >= 4 && hex.length() % 4 == 0 ? 4 : (cm.keyHexLen == 2 ? 2 : (hex.length() % 4 == 0 ? 4 : 2));
                StringBuilder sb = new StringBuilder();
                int hits = 0;
                for (int i = 0; i + step <= hex.length(); i += step) {
                    String code = hex.substring(i, i + step);
                    String val = cm.map.get(code);
                    if (val != null) { sb.append(val); hits++; }
                    else {
                        int cp = Integer.parseInt(code, 16);
                        if (step == 4 && cp >= 32 && cp < 0xD800) sb.append((char) cp);
                        else if (step == 2 && cp >= 32) sb.append((char) cp);
                    }
                }
                if (hits > 0) return sb.toString();
            }
            if (hex.startsWith("FEFF") && hex.length() >= 4 && hex.length() % 4 == 0) {
                return decodeHexUtf16Be(hex.substring(4));
            }
            if (hex.length() % 2 == 0) {
                byte[] raw = new byte[hex.length() / 2];
                for (int i = 0; i < raw.length; i++) {
                    raw[i] = (byte) ((hexVal(hex.charAt(i * 2)) << 4) | hexVal(hex.charAt(i * 2 + 1)));
                }
                return new String(raw, Charset.forName("windows-1252"));
            }
            return "";
        }
        if ("str".equals(tok.kind) && tok.rawBytes != null) {
            byte[] b = tok.rawBytes;
            if (b.length >= 2 && (b[0] & 0xFF) == 0xFE && (b[1] & 0xFF) == 0xFF) {
                return new String(b, 2, b.length - 2, StandardCharsets.UTF_16BE);
            }
            PdfCMap cm = activeMap;
            if (cm == null && globalMap != null && !globalMap.map.isEmpty()) {
                int nonPrintable = 0;
                for (byte v : b) {
                    int iv = v & 0xFF;
                    if (iv < 32 && iv != 9 && iv != 10 && iv != 13) nonPrintable++;
                }
                if (nonPrintable > 0) cm = globalMap;
            }
            if (cm != null && !cm.map.isEmpty()) {
                int byteStep = (cm.keyHexLen >= 4 && b.length % 2 == 0) ? 2 : 1;
                StringBuilder sb = new StringBuilder();
                int hits = 0;
                for (int i = 0; i + byteStep <= b.length; i += byteStep) {
                    String code = byteStep == 2
                            ? String.format(Locale.US, "%04X", ((b[i] & 0xFF) << 8) | (b[i + 1] & 0xFF))
                            : String.format(Locale.US, "%02X", b[i] & 0xFF);
                    String val = cm.map.get(code);
                    if (val != null) { sb.append(val); hits++; }
                    else if (byteStep == 1 && (b[i] & 0xFF) >= 32) sb.append((char) (b[i] & 0xFF));
                }
                if (hits > 0) return sb.toString();
            }
            return new String(b, Charset.forName("windows-1252"));
        }
        return "";
    }

    private static void extractPdfContentText(byte[] contentBytes, int pageNum, Map<Integer, PdfIndirectObj> objs, Map<Integer, PdfCMap> objCMaps, Map<String, PdfCMap> fontCMaps, PdfCMap globalCMap, Map<String, PdfIndirectObj> formXObjs, double[] initCtm, List<PdfTextFrag> outFrags, int depth) {
        if (depth > 4) return;
        List<PdfToken> tokens = tokenizePdfContent(contentBytes);
        List<PdfToken> ops = new ArrayList<PdfToken>();
        List<double[]> ctmStack = new ArrayList<double[]>();
        double[] ctm = initCtm != null ? initCtm.clone() : new double[]{1, 0, 0, 1, 0, 0};
        double[] tm = new double[]{1, 0, 0, 1, 0, 0};
        double[] tlm = new double[]{1, 0, 0, 1, 0, 0};
        double tl = 0;
        double tfSize = 9.0;
        boolean inText = false;
        PdfCMap curFontMap = null;
        boolean suppressGlobalCMap = (fontCMaps != null && !fontCMaps.isEmpty());

        for (PdfToken tok : tokens) {
            if (!"op".equals(tok.kind)) {
                ops.add(tok);
                continue;
            }
            String op = tok.text;
            if ("q".equals(op)) {
                ctmStack.add(ctm.clone());
            } else if ("Q".equals(op)) {
                if (!ctmStack.isEmpty()) ctm = ctmStack.remove(ctmStack.size() - 1);
            } else if ("cm".equals(op) && ops.size() >= 6) {
                ctm = multiplyPdfMatrix(readLast6Nums(ops), ctm);
            } else if ("Do".equals(op) && !ops.isEmpty() && formXObjs != null) {
                String xName = ops.get(ops.size() - 1).text;
                PdfIndirectObj xo = xName == null ? null : formXObjs.get(xName);
                if (xo != null && xo.decodedStream != null) {
                    double[] formMat = parsePdfFormMatrix(xo.dict);
                    double[] subCtm = formMat != null ? multiplyPdfMatrix(formMat, ctm) : ctm;
                    Map<String, PdfCMap> subFonts = fontCMaps;
                    Map<String, PdfIndirectObj> subXObjs = formXObjs;
                    if (xo.dict != null && xo.dict.contains("/Resources")) {
                        Map<String, PdfCMap> ownFonts = resolvePageFontCMaps(xo, objs, objCMaps);
                        if (!ownFonts.isEmpty()) {
                            subFonts = new HashMap<String, PdfCMap>();
                            if (fontCMaps != null) subFonts.putAll(fontCMaps);
                            subFonts.putAll(ownFonts);
                        }
                        Map<String, PdfIndirectObj> ownX = resolvePageFormXObjects(xo, objs);
                        if (!ownX.isEmpty()) {
                            subXObjs = new HashMap<String, PdfIndirectObj>(formXObjs);
                            subXObjs.putAll(ownX);
                        }
                    }
                    extractPdfContentText(xo.decodedStream, pageNum, objs, objCMaps, subFonts, globalCMap, subXObjs, subCtm, outFrags, depth + 1);
                }
            } else if ("BT".equals(op)) {
                inText = true;
                tm = new double[]{1, 0, 0, 1, 0, 0};
                tlm = new double[]{1, 0, 0, 1, 0, 0};
            } else if ("ET".equals(op)) {
                inText = false;
            } else if ("Tf".equals(op) && ops.size() >= 2) {
                String fName = ops.get(ops.size() - 2).text;
                if (fontCMaps != null && fontCMaps.containsKey(fName)) {
                    curFontMap = fontCMaps.get(fName);
                    suppressGlobalCMap = true;
                } else {
                    curFontMap = null;
                    suppressGlobalCMap = (fontCMaps != null && !fontCMaps.isEmpty());
                }
                double fs = parseDblSafe(ops.get(ops.size() - 1).text);
                if (fs > 0.5 && fs < 100.0) tfSize = fs;
            } else if ("TL".equals(op) && !ops.isEmpty()) {
                try { tl = Double.parseDouble(ops.get(ops.size() - 1).text); } catch (Exception ignored) {}
            } else if (("Td".equals(op) || "TD".equals(op)) && ops.size() >= 2) {
                double tx = parseDblSafe(ops.get(ops.size() - 2).text);
                double ty = parseDblSafe(ops.get(ops.size() - 1).text);
                if ("TD".equals(op)) tl = -ty;
                tlm = multiplyPdfMatrix(new double[]{1, 0, 0, 1, tx, ty}, tlm);
                tm = tlm.clone();
            } else if ("Tm".equals(op) && ops.size() >= 6) {
                double[] m = readLast6Nums(ops);
                tm = m;
                tlm = m.clone();
            } else if ("T*".equals(op)) {
                tlm = multiplyPdfMatrix(new double[]{1, 0, 0, 1, 0, -tl}, tlm);
                tm = tlm.clone();
            } else if (inText && ("Tj".equals(op) || "'".equals(op) || "\"".equals(op)) && !ops.isEmpty()) {
                if ("'".equals(op) || "\"".equals(op)) {
                    tlm = multiplyPdfMatrix(new double[]{1, 0, 0, 1, 0, -tl}, tlm);
                    tm = tlm.clone();
                }
                String txt = decodePdfStringToken(ops.get(ops.size() - 1), curFontMap, globalCMap, suppressGlobalCMap);
                double effSize = computeEffectiveFontSize(tfSize, tm, ctm);
                if (!txt.trim().isEmpty()) {
                    double[] pt = transformPdfPoint(tm[4], tm[5], ctm);
                    PdfTextFrag frag = new PdfTextFrag();
                    frag.page = pageNum; frag.x = pt[0]; frag.y = pt[1]; frag.fontSize = effSize; frag.text = txt;
                    outFrags.add(frag);
                    double unscaledW = estimateTextWidth(txt, tfSize);
                    tm[4] += unscaledW * tm[0];
                    tm[5] += unscaledW * tm[1];
                }
            } else if (inText && "TJ".equals(op)) {
                int arrStart = -1;
                for (int k = ops.size() - 1; k >= 0; k--) {
                    if ("arr_start".equals(ops.get(k).kind)) { arrStart = k; break; }
                }
                if (arrStart >= 0) {
                    StringBuilder sb = new StringBuilder();
                    double[] basePt = transformPdfPoint(tm[4], tm[5], ctm);
                    double effSize = computeEffectiveFontSize(tfSize, tm, ctm);
                    double curX = basePt[0];
                    double totalAdv = 0;
                    for (int k = arrStart + 1; k < ops.size(); k++) {
                        PdfToken el = ops.get(k);
                        if ("str".equals(el.kind) || "hex".equals(el.kind)) {
                            sb.append(decodePdfStringToken(el, curFontMap, globalCMap, suppressGlobalCMap));
                        } else if ("num".equals(el.kind)) {
                            double kern = parseDblSafe(el.text);
                            if (kern < -1200) {
                                String part = sb.toString();
                                double adv = Math.abs(kern) * 0.001 * effSize;
                                double stepW = !part.trim().isEmpty() ? estimateTextWidth(part, effSize) + Math.max(8.0, adv) : Math.max(8.0, adv);
                                if (!part.trim().isEmpty()) {
                                    PdfTextFrag frag = new PdfTextFrag();
                                    frag.page = pageNum; frag.x = curX; frag.y = basePt[1]; frag.fontSize = effSize; frag.text = part;
                                    outFrags.add(frag);
                                }
                                curX += stepW;
                                totalAdv += stepW;
                                sb.setLength(0);
                            } else if (kern < -140) {
                                if (sb.length() > 0 && sb.charAt(sb.length() - 1) != ' ') sb.append(' ');
                            }
                        }
                    }
                    String txt = sb.toString();
                    if (!txt.trim().isEmpty()) {
                        PdfTextFrag frag = new PdfTextFrag();
                        frag.page = pageNum; frag.x = curX; frag.y = basePt[1]; frag.fontSize = effSize; frag.text = txt;
                        outFrags.add(frag);
                        totalAdv += estimateTextWidth(txt, effSize);
                    }
                    if (totalAdv > 0) {
                        double tmScale = Math.sqrt(tm[0] * tm[0] + tm[1] * tm[1]);
                        double ctmScale = Math.sqrt(ctm[0] * ctm[0] + ctm[1] * ctm[1]);
                        double scaleDiv = (tmScale > 0.05 ? tmScale : 1.0) * (ctmScale > 0.05 ? ctmScale : 1.0);
                        tm[4] += totalAdv / scaleDiv;
                    }
                }
            }
            ops.clear();
        }
    }

    private static double[] parsePdfFormMatrix(String dict) {
        if (dict == null || dict.isEmpty()) return null;
        Matcher m = Pattern.compile("/Matrix\\s*\\[\\s*([^\\]]+)\\]").matcher(dict);
        if (!m.find()) return null;
        String[] parts = m.group(1).trim().split("\\s+");
        if (parts.length < 6) return null;
        double[] mat = new double[6];
        for (int i = 0; i < 6; i++) mat[i] = parseDblSafe(parts[i]);
        return mat;
    }

    private static double estimateTextWidth(String text, double fsz) {
        if (text == null || text.isEmpty()) return 0;
        double units = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == ' ' || c == 'i' || c == 'l' || c == 'I' || c == 'j' || c == 't' || c == 'f' || c == 'r'
                    || c == '.' || c == ',' || c == ':' || c == ';' || c == '\'' || c == '|' || c == '/' || c == '(' || c == ')' || c == '1') {
                units += 0.30;
            } else if (c == 'M' || c == 'W' || c == 'G' || c == 'O' || c == 'Q' || c == 'D' || c == 'H' || c == 'N' || c == 'U' || c == 'B' || c == 'R' || c == 'C' || c == 'K' || c == 'A' || c == 'V' || c == 'X' || c == 'Y' || c == 'Z' || c == '@' || c == '%' || c == '&') {
                units += 0.60;
            } else {
                units += 0.47;
            }
        }
        return Math.max(2.5, units * fsz);
    }

    private static double computeEffectiveFontSize(double tfSize, double[] tm, double[] ctm) {
        double tmScale = Math.sqrt(tm[0] * tm[0] + tm[1] * tm[1]);
        double ctmScale = Math.sqrt(ctm[0] * ctm[0] + ctm[1] * ctm[1]);
        double sz = tfSize * (tmScale > 0.05 ? tmScale : 1.0) * (ctmScale > 0.05 ? ctmScale : 1.0);
        if (sz < 4.5) sz = 7.0;
        if (sz > 36.0) sz = 12.0;
        return sz;
    }

    private static double parseDblSafe(String s) {
        try { return Double.parseDouble(s); } catch (Exception ex) { return 0; }
    }

    private static double[] readLast6Nums(List<PdfToken> ops) {
        double[] m = new double[]{1, 0, 0, 1, 0, 0};
        int start = ops.size() - 6;
        for (int i = 0; i < 6; i++) m[i] = parseDblSafe(ops.get(start + i).text);
        return m;
    }

    private static double[] multiplyPdfMatrix(double[] a, double[] b) {
        return new double[]{
            a[0] * b[0] + a[1] * b[2],
            a[0] * b[1] + a[1] * b[3],
            a[2] * b[0] + a[3] * b[2],
            a[2] * b[1] + a[3] * b[3],
            a[4] * b[0] + a[5] * b[2] + b[4],
            a[4] * b[1] + a[5] * b[3] + b[5]
        };
    }

    private static double[] transformPdfPoint(double x, double y, double[] m) {
        return new double[]{x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]};
    }

    private static final class PdfCellSpan {
        double x;
        double endX;
        String text;
        boolean rightAlignHint;
    }

    private static boolean isPdfNumericColHeader(String text) {
        return Pattern.compile("(debit|withdrawal|credit|deposit|amount|amt|balance|\\bdr\\b|\\bcr\\b)").matcher((text == null ? "" : text).toLowerCase(Locale.US)).find();
    }

    private static boolean isPdfAmountText(String text) {
        return Pattern.compile("^-?[\\d,]+\\.\\d{1,2}(\\s*\\(?(CR|DR)\\.?\\)?)?$", Pattern.CASE_INSENSITIVE)
                .matcher((text == null ? "" : text).trim()).matches();
    }

    private static boolean isPdfPlaceholderDash(String text) {
        String t = text == null ? "" : text.trim();
        return t.equals("-") || t.equals("--") || t.equals("\u2013") || t.equals("\u2014")
                || t.equalsIgnoreCase("NIL") || t.equalsIgnoreCase("N/A");
    }

    private static boolean isPdfDateLikeText(String text) {
        return Pattern.compile("^(\\d{1,2}[/\\-.]\\d{1,2}[/\\-.]\\d{2,4}|\\d{4}[/\\-.]\\d{1,2}[/\\-.]\\d{1,2}|\\d{1,2}[\\s\\-][A-Za-z]{3,9}[\\s\\-]\\d{2,4})$")
                .matcher((text == null ? "" : text).trim()).matches();
    }

    private static boolean isPdfSummaryOrFooterLine(List<PdfCellSpan> spans) {
        if (spans == null || spans.isEmpty()) return false;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < spans.size(); i++) {
            if (i > 0) sb.append(' ');
            sb.append(spans.get(i).text == null ? "" : spans.get(i).text);
        }
        String joined = sb.toString().replaceAll("\\s+", " ").trim().toLowerCase(Locale.US);
        if (joined.isEmpty()) return false;
        return Pattern.compile("(\\bstatement\\s+summary\\b|\\bbrought\\s+forward\\b|\\bopening\\s+balance\\b|\\bclosing\\s+balance\\b|please do not share your atm|power of attorney holder|computer generated statement|does not require a signature|abbreviations are as under|end of statement|^page\\s*(no\\.?)?\\s*\\d+(\\s*of\\s*\\d+)?$)")
                .matcher(joined).find();
    }

    private static boolean isPdfHeaderFragmentLine(List<PdfCellSpan> spans) {
        if (spans == null || spans.isEmpty() || spans.size() > 5) return false;
        Pattern longNum = Pattern.compile("\\d{6,}");
        for (PdfCellSpan s : spans) {
            String t = s.text == null ? "" : s.text.trim();
            if (t.isEmpty()) continue;
            if (isPdfDateLikeText(t) || isPdfAmountText(t) || isPdfPlaceholderDash(t)) return false;
            if (longNum.matcher(t).find()) return false;
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < spans.size(); i++) {
            if (i > 0) sb.append(' ');
            sb.append(spans.get(i).text == null ? "" : spans.get(i).text);
        }
        String joined = sb.toString().toLowerCase(Locale.US);
        return Pattern.compile("\\b(date|dt|value|post|txn|tran|details|particulars|particular|description|narration|remarks|remark|ref|cheque|chq|no\\.?|debit|withdrawal|credit|deposit|amount|amt|balance|bal|dr|cr)\\b")
                .matcher(joined).find();
    }

    private static final class PdfSpanLine {
        double y;
        List<PdfCellSpan> spans;
    }

    private static boolean isPdfHeaderCellRow(List<PdfCellSpan> cells) {
        if (cells == null || cells.size() < 3) return false;
        int score = 0;
        boolean hasDate = false, hasDesc = false, hasAmt = false;
        Pattern pDate = Pattern.compile("\\b(date|dt|txndt|trandt|valdt)\\b");
        Pattern pDesc = Pattern.compile("(details|particulars|particular|description|narration|remarks|remark|payee)");
        for (PdfCellSpan c : cells) {
            String t = (c.text == null ? "" : c.text).toLowerCase(Locale.US);
            if (pDate.matcher(t).find()) { hasDate = true; score++; }
            if (pDesc.matcher(t).find()) { hasDesc = true; score++; }
            if (isPdfNumericColHeader(t)) { hasAmt = true; score++; }
        }
        return hasDate && (hasDesc || hasAmt) && score >= 3;
    }

    private static List<List<String>> buildPdfTableRows(List<PdfTextFrag> frags) {
        List<List<String>> rows = new ArrayList<List<String>>();
        Map<Integer, List<PdfTextFrag>> byPage = new TreeMap<Integer, List<PdfTextFrag>>();
        for (PdfTextFrag f : frags) {
            List<PdfTextFrag> list = byPage.get(f.page);
            if (list == null) { list = new ArrayList<PdfTextFrag>(); byPage.put(f.page, list); }
            list.add(f);
        }

        List<PdfCellSpan> activeHeaderCols = null;
        boolean inSummarySection = false;
        boolean nextRowIsSummaryValues = false;

        for (List<PdfTextFrag> pFrags : byPage.values()) {
            Collections.sort(pFrags, new Comparator<PdfTextFrag>() {
                @Override
                public int compare(PdfTextFrag a, PdfTextFrag b) {
                    int yc = Double.compare(b.y, a.y);
                    return yc != 0 ? yc : Double.compare(a.x, b.x);
                }
            });

            List<List<PdfTextFrag>> lines = new ArrayList<List<PdfTextFrag>>();
            for (PdfTextFrag f : pFrags) {
                if (!lines.isEmpty() && Math.abs(lines.get(lines.size() - 1).get(0).y - f.y) <= 2.8) {
                    lines.get(lines.size() - 1).add(f);
                } else {
                    List<PdfTextFrag> nl = new ArrayList<PdfTextFrag>();
                    nl.add(f);
                    lines.add(nl);
                }
            }

            List<PdfSpanLine> pageSpans = new ArrayList<PdfSpanLine>();
            for (List<PdfTextFrag> line : lines) {
                Collections.sort(line, new Comparator<PdfTextFrag>() {
                    @Override
                    public int compare(PdfTextFrag a, PdfTextFrag b) { return Double.compare(a.x, b.x); }
                });
                List<PdfCellSpan> spans = new ArrayList<PdfCellSpan>();
                StringBuilder curCell = new StringBuilder();
                double cellStartX = 0;
                double prevEndX = Double.NaN;
                double prevFontSz = 9.0;

                for (PdfTextFrag frag : line) {
                    String t = (frag.text == null ? "" : frag.text).replaceAll("\\s+", " ").trim();
                    if (t.isEmpty()) continue;
                    double x = frag.x;
                    double fsz = frag.fontSize > 0 ? frag.fontSize : prevFontSz;
                    boolean curIsNum = curCell.length() > 0 && isPdfAmountText(curCell.toString().trim());
                    boolean nextIsNum = isPdfAmountText(t);
                    double splitGap = (!curIsNum && nextIsNum) ? Math.max(2.0, fsz * 0.28) : Math.max(6.5, fsz * 0.85);
                    double spaceGap = Math.max(1.4, fsz * 0.22);

                    if (Double.isNaN(prevEndX)) {
                        cellStartX = x;
                    } else {
                        double gap = x - prevEndX;
                        if (gap > splitGap || (!curIsNum && nextIsNum && x - cellStartX > 30.0 && gap > 0.5)) {
                            String built = curCell.toString().trim();
                            if (!built.isEmpty()) {
                                PdfCellSpan sp = new PdfCellSpan();
                                sp.x = cellStartX; sp.endX = prevEndX; sp.text = built;
                                spans.add(sp);
                            }
                            curCell.setLength(0);
                            cellStartX = x;
                        } else if (gap > spaceGap && curCell.length() > 0 && curCell.charAt(curCell.length() - 1) != ' ') {
                            curCell.append(' ');
                        }
                    }
                    curCell.append(t);
                    prevFontSz = fsz;
                    prevEndX = x + estimateTextWidth(t, fsz);
                }
                String last = curCell.toString().trim();
                if (!last.isEmpty()) {
                    PdfCellSpan sp = new PdfCellSpan();
                    sp.x = cellStartX; sp.endX = prevEndX; sp.text = last;
                    spans.add(sp);
                }
                if (!spans.isEmpty()) {
                    PdfSpanLine sl = new PdfSpanLine();
                    sl.y = line.get(0).y;
                    sl.spans = spans;
                    pageSpans.add(sl);
                }
            }

            for (int rIdx = 0; rIdx < pageSpans.size(); rIdx++) {
                List<PdfCellSpan> spans = pageSpans.get(rIdx).spans;
                List<PdfCellSpan> matchedHdr = null;
                int hdrEndIdx = rIdx;

                if (isPdfHeaderCellRow(spans)) {
                    matchedHdr = cloneCellSpans(spans);
                } else if (isPdfHeaderFragmentLine(spans)) {
                    List<PdfCellSpan> acc = cloneCellSpans(spans);
                    int maxLook = Math.min(pageSpans.size() - 1, rIdx + 3);
                    for (int k = rIdx + 1; k <= maxLook; k++) {
                        if (Math.abs(pageSpans.get(rIdx).y - pageSpans.get(k).y) > 26.0) break;
                        if (!isPdfHeaderFragmentLine(pageSpans.get(k).spans) && !isPdfHeaderCellRow(pageSpans.get(k).spans)) break;
                        acc = mergeTwoHeaderLines(acc, pageSpans.get(k).spans);
                        if (isPdfHeaderCellRow(acc)) {
                            matchedHdr = acc;
                            hdrEndIdx = k;
                            break;
                        }
                    }
                }

                if (matchedHdr != null) {
                    while (hdrEndIdx + 1 < pageSpans.size()
                            && Math.abs(pageSpans.get(hdrEndIdx).y - pageSpans.get(hdrEndIdx + 1).y) <= 15.0
                            && pageSpans.get(hdrEndIdx + 1).spans.size() <= 3
                            && isPdfHeaderFragmentLine(pageSpans.get(hdrEndIdx + 1).spans)
                            && !isPdfHeaderCellRow(pageSpans.get(hdrEndIdx + 1).spans)) {
                        matchedHdr = mergeTwoHeaderLines(matchedHdr, pageSpans.get(hdrEndIdx + 1).spans);
                        hdrEndIdx++;
                    }
                    for (PdfCellSpan s : matchedHdr) s.rightAlignHint = isPdfNumericColHeader(s.text);
                    activeHeaderCols = calibratePdfHeaderColumns(pageSpans, hdrEndIdx + 1, matchedHdr);
                    inSummarySection = false;
                    nextRowIsSummaryValues = false;
                    List<String> hdrRow = new ArrayList<String>(matchedHdr.size());
                    for (PdfCellSpan s : matchedHdr) hdrRow.add(s.text);
                    if (rowHasContent(hdrRow)) rows.add(hdrRow);
                    rIdx = hdrEndIdx;
                    continue;
                }

                if (isPdfSummaryOrFooterLine(spans)) {
                    inSummarySection = true;
                    List<String> rawRow = new ArrayList<String>(spans.size());
                    boolean hasBf = false;
                    for (PdfCellSpan s : spans) {
                        rawRow.add(s.text);
                        if (s.text != null && s.text.toLowerCase(Locale.US).contains("brought forward")) hasBf = true;
                    }
                    nextRowIsSummaryValues = hasBf;
                    if (rowHasContent(rawRow)) rows.add(rawRow);
                    continue;
                }

                if (inSummarySection || nextRowIsSummaryValues) {
                    nextRowIsSummaryValues = false;
                    List<String> rawRow = new ArrayList<String>(spans.size());
                    for (PdfCellSpan s : spans) rawRow.add(s.text);
                    if (rowHasContent(rawRow)) rows.add(rawRow);
                    continue;
                }

                if (activeHeaderCols != null && !spans.isEmpty() && spans.size() <= activeHeaderCols.size() * 3) {
                    int nCols = activeHeaderCols.size();
                    String[] aligned = new String[nCols];
                    Arrays.fill(aligned, "");

                    for (PdfCellSpan sp : spans) {
                        int bestCol = matchPdfHeaderColumn(sp, activeHeaderCols);
                        if (aligned[bestCol].isEmpty()) aligned[bestCol] = sp.text;
                        else aligned[bestCol] = aligned[bestCol] + " " + sp.text;
                    }
                    List<String> rowList = Arrays.asList(aligned);
                    if (rowHasContent(rowList)) rows.add(rowList);
                } else {
                    List<String> rawRow = new ArrayList<String>(spans.size());
                    for (PdfCellSpan s : spans) rawRow.add(s.text);
                    if (rowHasContent(rawRow)) rows.add(rawRow);
                }
            }
        }
        return rows;
    }

    private static List<PdfCellSpan> cloneCellSpans(List<PdfCellSpan> src) {
        List<PdfCellSpan> list = new ArrayList<PdfCellSpan>(src.size());
        for (PdfCellSpan t : src) {
            PdfCellSpan cp = new PdfCellSpan();
            cp.x = t.x; cp.endX = t.endX; cp.text = t.text; cp.rightAlignHint = t.rightAlignHint;
            list.add(cp);
        }
        return list;
    }

    private static List<PdfCellSpan> mergeTwoHeaderLines(List<PdfCellSpan> top, List<PdfCellSpan> bot) {
        if (top == null || bot == null) return null;
        List<PdfCellSpan> merged = cloneCellSpans(top);
        for (PdfCellSpan b : bot) {
            int best = -1;
            double bestDist = Double.MAX_VALUE;
            double bMid = (b.x + b.endX) * 0.5;
            for (int c = 0; c < merged.size(); c++) {
                PdfCellSpan mc = merged.get(c);
                boolean overlaps = b.x <= mc.endX + 12.0 && b.endX >= mc.x - 12.0;
                double d = Math.min(Math.abs(b.x - mc.x), Math.abs(bMid - (mc.x + mc.endX) * 0.5));
                if (overlaps && d < bestDist) {
                    bestDist = d;
                    best = c;
                }
            }
            if (best >= 0) {
                PdfCellSpan m = merged.get(best);
                m.text = (m.text + " " + b.text).trim();
                if (b.x < m.x) m.x = b.x;
                if (b.endX > m.endX) m.endX = b.endX;
            } else {
                PdfCellSpan cp = new PdfCellSpan();
                cp.x = b.x; cp.endX = b.endX; cp.text = b.text; cp.rightAlignHint = b.rightAlignHint;
                merged.add(cp);
            }
        }
        Collections.sort(merged, new Comparator<PdfCellSpan>() {
            @Override
            public int compare(PdfCellSpan a, PdfCellSpan b) { return Double.compare(a.x, b.x); }
        });
        return merged;
    }

    private static List<PdfCellSpan> calibratePdfHeaderColumns(List<PdfSpanLine> pageSpans, int startRow, List<PdfCellSpan> hdrCols) {
        List<PdfCellSpan> cal = cloneCellSpans(hdrCols);
        int limit = Math.min(pageSpans.size(), startRow + 35);

        for (int r = startRow; r < limit; r++) {
            List<PdfCellSpan> spans = pageSpans.get(r).spans;
            if (isPdfHeaderCellRow(spans) || isPdfSummaryOrFooterLine(spans)) break;
            if (spans.size() != cal.size()) continue;
            if (!isPdfDateLikeText(spans.get(0).text)) continue;
            boolean okOrder = true;
            for (int c = 1; c < cal.size(); c++) {
                if (spans.get(c).x <= spans.get(c - 1).endX) { okOrder = false; break; }
            }
            if (!okOrder) continue;
            for (int c = 0; c < cal.size(); c++) {
                PdfCellSpan sp = spans.get(c);
                PdfCellSpan hc = cal.get(c);
                double minLeft = c == 0 ? 0.0 : cal.get(c - 1).endX + 2.0;
                double maxRight = c == cal.size() - 1 ? 2000.0 : cal.get(c + 1).x - 2.0;
                if (sp.x >= minLeft && sp.endX <= maxRight) {
                    if (sp.x < hc.x && Math.abs(hc.x - sp.x) <= 75.0) hc.x = sp.x;
                    if (sp.endX > hc.endX && Math.abs(sp.endX - hc.endX) <= 75.0) hc.endX = sp.endX;
                }
            }
        }

        for (int r = startRow; r < limit; r++) {
            List<PdfCellSpan> spans = pageSpans.get(r).spans;
            if (isPdfHeaderCellRow(spans) || isPdfSummaryOrFooterLine(spans)) break;
            if (spans.size() < cal.size() - 2) continue;
            for (PdfCellSpan sp : spans) {
                boolean isNum = isPdfAmountText(sp.text);
                int best = matchPdfHeaderColumn(sp, cal);
                PdfCellSpan bc = cal.get(best);
                double minLeft = best == 0 ? 0.0 : cal.get(best - 1).endX + 3.0;
                double maxRight = best == cal.size() - 1 ? 2000.0 : cal.get(best + 1).x - 3.0;
                if (isNum && bc.rightAlignHint) {
                    if (sp.x < bc.x && sp.x >= minLeft && Math.abs(bc.x - sp.x) <= 32.0) bc.x = sp.x;
                    if (sp.endX > bc.endX && sp.endX <= maxRight && Math.abs(sp.endX - bc.endX) <= 32.0) bc.endX = sp.endX;
                } else if (!isNum && !isPdfPlaceholderDash(sp.text) && !bc.rightAlignHint) {
                    if (sp.x < bc.x && sp.x >= minLeft && Math.abs(bc.x - sp.x) <= 65.0) bc.x = sp.x;
                    if (sp.endX > bc.endX && sp.endX <= maxRight && Math.abs(sp.endX - bc.endX) <= 65.0) bc.endX = sp.endX;
                }
            }
        }
        return cal;
    }

    private static int matchPdfHeaderColumn(PdfCellSpan sp, List<PdfCellSpan> cols) {
        int nCols = cols.size();
        double spCenter = (sp.x + sp.endX) * 0.5;
        boolean spIsNum = isPdfAmountText(sp.text);
        boolean spIsDash = isPdfPlaceholderDash(sp.text);

        int bestCol = 0;
        double bestScore = Double.MAX_VALUE;
        for (int c = 0; c < nCols; c++) {
            PdfCellSpan col = cols.get(c);
            double leftBound = c == 0 ? Double.NEGATIVE_INFINITY
                    : (cols.get(c - 1).rightAlignHint ? Math.max(cols.get(c - 1).endX + 2.0, (cols.get(c - 1).endX + col.x) * 0.5) : Math.min(col.x - 4.0, (cols.get(c - 1).endX + col.x) * 0.5));
            double rightBound = c == nCols - 1 ? Double.POSITIVE_INFINITY
                    : (col.rightAlignHint ? Math.max(col.endX + 12.0, (col.endX + cols.get(c + 1).x) * 0.5) : Math.max(col.endX, (col.endX + cols.get(c + 1).x) * 0.5));
            double colCenter = (col.x + col.endX) * 0.5;

            double dist;
            if (sp.x >= col.x - 2.0 && sp.endX <= col.endX + 4.0) {
                dist = 0.5;
            } else if (col.rightAlignHint) {
                dist = Math.min(Math.abs(sp.endX - col.endX), Math.abs(spCenter - colCenter));
            } else {
                dist = Math.min(Math.abs(sp.x - col.x), Math.abs(spCenter - colCenter));
            }

            if ((spCenter >= leftBound && spCenter <= rightBound) || (sp.x >= leftBound && sp.x <= rightBound) || (spIsNum && col.rightAlignHint && sp.endX >= leftBound && sp.endX <= rightBound + 8.0)) dist *= 0.28;
            if ((spIsNum || spIsDash) && col.rightAlignHint) dist *= 0.7;
            else if (!spIsNum && !spIsDash && col.rightAlignHint && sp.x < col.x - 18.0) dist += 40.0;

            if (dist < bestScore) {
                bestScore = dist;
                bestCol = c;
            }
        }
        return bestCol;
    }

    /* ---------- PDF Standard Security Handler Decryption (R=2,3,4 RC4/AES-128 & R=5,6 AES-256) ---------- */
    private static final byte[] PDF_PW_PADDING = new byte[]{
        (byte) 0x28, (byte) 0xBF, (byte) 0x4E, (byte) 0x5E, (byte) 0x4E, (byte) 0x75, (byte) 0x8A, (byte) 0x41,
        (byte) 0x64, (byte) 0x00, (byte) 0x4E, (byte) 0x56, (byte) 0xFF, (byte) 0xFA, (byte) 0x01, (byte) 0x08,
        (byte) 0x2E, (byte) 0x2E, (byte) 0x00, (byte) 0xB6, (byte) 0xD0, (byte) 0x68, (byte) 0x3E, (byte) 0x80,
        (byte) 0x2F, (byte) 0x0C, (byte) 0xA9, (byte) 0xFE, (byte) 0x64, (byte) 0x53, (byte) 0x69, (byte) 0x7A
    };

    private static Object[] tryUnlockPdfSecurity(String pdfStr, Map<Integer, PdfIndirectObj> objs, String password) {
        String encDict = null;
        Matcher encRefM = Pattern.compile("/Encrypt\\s+(\\d+)\\s+\\d+\\s+R").matcher(pdfStr);
        if (encRefM.find()) {
            try {
                PdfIndirectObj eo = objs.get(Integer.parseInt(encRefM.group(1)));
                if (eo != null) encDict = eo.dict;
            } catch (NumberFormatException ignored) {}
        } else {
            Matcher encInlineM = Pattern.compile("/Encrypt\\s*<<").matcher(pdfStr);
            if (encInlineM.find()) {
                int start = encInlineM.end() - 2;
                int depth = 0;
                for (int i = start; i < pdfStr.length() - 1; i++) {
                    if (pdfStr.charAt(i) == '<' && pdfStr.charAt(i + 1) == '<') { depth++; i++; }
                    else if (pdfStr.charAt(i) == '>' && pdfStr.charAt(i + 1) == '>') {
                        depth--; i++;
                        if (depth == 0) { encDict = pdfStr.substring(start, i + 1); break; }
                    }
                }
            }
        }
        if (encDict == null || encDict.isEmpty()) return new Object[]{null, null};

        int v = parsePdfDictInt(encDict, "V", 0);
        int r = parsePdfDictInt(encDict, "R", 2);
        int lenBits = parsePdfDictInt(encDict, "Length", v == 1 ? 40 : (v >= 5 ? 256 : 128));
        int pPerm = parsePdfDictInt(encDict, "P", 0);
        boolean encMeta = !Pattern.compile("/EncryptMetadata\\s+false\\b").matcher(encDict).find();
        boolean isAes = Pattern.compile("/CFM\\s*/(AESV2|AESV3)\\b").matcher(encDict).find() || v >= 5;

        byte[] oVal = parsePdfDictStringValue(encDict, "O");
        byte[] uVal = parsePdfDictStringValue(encDict, "U");
        byte[] oeVal = parsePdfDictStringValue(encDict, "OE");
        byte[] ueVal = parsePdfDictStringValue(encDict, "UE");
        byte[] id0 = parsePdfTrailerId0(pdfStr);

        if (oVal == null || uVal == null) {
            ParseResult err = new ParseResult();
            err.needsPassword = true;
            err.format = "pdf-encrypted";
            err.error = "This PDF uses an unsupported encryption header.";
            return new Object[]{err, null};
        }

        String tryPw = password == null ? "" : password;
        byte[] fileKey = verifyAndDerivePdfFileKey(tryPw, v, r, lenBits, pPerm, encMeta, oVal, uVal, oeVal, ueVal, id0);
        if (fileKey == null) {
            ParseResult err = new ParseResult();
            err.needsPassword = true;
            err.format = "pdf-encrypted";
            err.error = (password == null || password.isEmpty())
                    ? "This PDF is password-protected. Enter the PDF password to unlock it."
                    : "Incorrect PDF password. Check the password and try again.";
            return new Object[]{err, null};
        }

        PdfSecurityCtx ctx = new PdfSecurityCtx();
        ctx.v = v;
        ctx.r = r;
        ctx.keyLenBytes = fileKey.length;
        ctx.isAes = isAes;
        ctx.encryptMetadata = encMeta;
        ctx.fileKey = fileKey;
        return new Object[]{null, ctx};
    }

    private static int parsePdfDictInt(String dict, String key, int defVal) {
        Matcher m = Pattern.compile("/" + Pattern.quote(key) + "(?![A-Za-z0-9])\\s*(-?\\d+)").matcher(dict);
        if (m.find()) {
            try { return Integer.parseInt(m.group(1)); } catch (NumberFormatException ignored) {}
        }
        return defVal;
    }

    private static byte[] parsePdfTrailerId0(String pdfStr) {
        Matcher m = Pattern.compile("/ID\\s*\\[\\s*(<[^>]+>|\\((?:[^()\\\\]|\\\\.)*\\))").matcher(pdfStr);
        String raw = null;
        while (m.find()) raw = m.group(1);
        return raw == null ? new byte[0] : parsePdfRawStringToken(raw);
    }

    private static byte[] parsePdfDictStringValue(String dict, String key) {
        Matcher m = Pattern.compile("/" + Pattern.quote(key) + "(?![A-Za-z0-9])\\s*(\\(|<)").matcher(dict);
        if (!m.find()) return null;
        int idx = m.start(1);
        if (dict.charAt(idx) == '<') {
            int end = dict.indexOf('>', idx + 1);
            if (end < 0) return null;
            return parsePdfRawStringToken(dict.substring(idx, end + 1));
        }
        int depth = 0;
        int i = idx;
        while (i < dict.length()) {
            char c = dict.charAt(i);
            if (c == '\\') { i += 2; continue; }
            if (c == '(') depth++;
            else if (c == ')') {
                depth--;
                if (depth == 0) return parsePdfRawStringToken(dict.substring(idx, i + 1));
            }
            i++;
        }
        return null;
    }

    private static byte[] parsePdfRawStringToken(String tok) {
        if (tok == null || tok.isEmpty()) return new byte[0];
        if (tok.charAt(0) == '<' && tok.charAt(tok.length() - 1) == '>') {
            StringBuilder sb = new StringBuilder();
            for (int i = 1; i < tok.length() - 1; i++) {
                if (hexVal(tok.charAt(i)) >= 0) sb.append(tok.charAt(i));
            }
            if (sb.length() % 2 == 1) sb.append('0');
            byte[] res = new byte[sb.length() / 2];
            for (int i = 0; i < res.length; i++) {
                res[i] = (byte) ((hexVal(sb.charAt(i * 2)) << 4) | hexVal(sb.charAt(i * 2 + 1)));
            }
            return res;
        }
        if (tok.charAt(0) == '(' && tok.charAt(tok.length() - 1) == ')') {
            ByteArrayOutputStream ms = new ByteArrayOutputStream();
            for (int i = 1; i < tok.length() - 1; i++) {
                char c = tok.charAt(i);
                if (c == '\\' && i + 1 < tok.length() - 1) {
                    char e = tok.charAt(++i);
                    if (e == 'n') ms.write('\n');
                    else if (e == 'r') ms.write('\r');
                    else if (e == 't') ms.write('\t');
                    else if (e == 'b') ms.write('\b');
                    else if (e == 'f') ms.write('\f');
                    else if (e == '\r') { if (i + 1 < tok.length() - 1 && tok.charAt(i + 1) == '\n') i++; }
                    else if (e == '\n') { }
                    else if (e >= '0' && e <= '7') {
                        int oct = e - '0';
                        for (int k = 0; k < 2 && i + 1 < tok.length() - 1 && tok.charAt(i + 1) >= '0' && tok.charAt(i + 1) <= '7'; k++) {
                            oct = oct * 8 + (tok.charAt(++i) - '0');
                        }
                        ms.write(oct & 0xFF);
                    } else {
                        ms.write(e & 0xFF);
                    }
                } else {
                    ms.write(c & 0xFF);
                }
            }
            return ms.toByteArray();
        }
        return new byte[0];
    }

    private static byte[] padPdfPassword32(String pw) {
        byte[] src = (pw == null ? "" : pw).getBytes(StandardCharsets.ISO_8859_1);
        byte[] outB = new byte[32];
        int copy = Math.min(32, src.length);
        if (copy > 0) System.arraycopy(src, 0, outB, 0, copy);
        if (copy < 32) System.arraycopy(PDF_PW_PADDING, 0, outB, copy, 32 - copy);
        return outB;
    }

    private static byte[] verifyAndDerivePdfFileKey(String pw, int v, int r, int lenBits, int pPerm, boolean encMeta,
                                                    byte[] oVal, byte[] uVal, byte[] oeVal, byte[] ueVal, byte[] id0) {
        try {
            if (v >= 5 || r >= 5) {
                return verifyPdfR5R6(pw, r, oVal, uVal, oeVal, ueVal);
            }
            int keyLenBytes = Math.max(5, Math.min(16, lenBits / 8));
            byte[] padded = padPdfPassword32(pw);

            byte[] fk = derivePdfKeyR2to4(padded, oVal, pPerm, id0, r, keyLenBytes, encMeta);
            if (checkPdfUserKeyR2to4(fk, uVal, id0, r)) return fk;

            byte[] ownerKey = derivePdfOwnerRc4Key(padded, r, keyLenBytes);
            byte[] userPaddedFromOwner = decryptPdfOwnerO(ownerKey, oVal, r);
            byte[] fkOwner = derivePdfKeyR2to4(userPaddedFromOwner, oVal, pPerm, id0, r, keyLenBytes, encMeta);
            if (checkPdfUserKeyR2to4(fkOwner, uVal, id0, r)) return fkOwner;
        } catch (Exception ignored) {}
        return null;
    }

    private static byte[] derivePdfKeyR2to4(byte[] paddedPw32, byte[] oVal, int pPerm, byte[] id0,
                                            int r, int keyLenBytes, boolean encMeta) throws Exception {
        MessageDigest md5 = MessageDigest.getInstance("MD5");
        md5.update(paddedPw32, 0, 32);
        md5.update(oVal, 0, Math.min(32, oVal.length));
        byte[] pLe = new byte[4];
        writeI32Le(pLe, 0, pPerm);
        md5.update(pLe);
        if (id0 != null && id0.length > 0) md5.update(id0);
        if (r >= 4 && !encMeta) md5.update(new byte[]{(byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF});
        byte[] digest = md5.digest();
        if (r >= 3) {
            for (int i = 0; i < 50; i++) {
                md5.reset();
                md5.update(digest, 0, keyLenBytes);
                digest = md5.digest();
            }
        }
        return Arrays.copyOf(digest, keyLenBytes);
    }

    private static boolean checkPdfUserKeyR2to4(byte[] fileKey, byte[] uVal, byte[] id0, int r) throws Exception {
        if (uVal == null || uVal.length < 16) return false;
        if (r == 2) {
            byte[] calc = rc4Transform(fileKey, PDF_PW_PADDING);
            if (uVal.length < 32) return false;
            for (int i = 0; i < 32; i++) if (calc[i] != uVal[i]) return false;
            return true;
        }
        MessageDigest md5 = MessageDigest.getInstance("MD5");
        md5.update(PDF_PW_PADDING, 0, 32);
        if (id0 != null && id0.length > 0) md5.update(id0);
        byte[] d = md5.digest();
        byte[] x = rc4Transform(fileKey, d);
        for (int i = 1; i <= 19; i++) {
            byte[] k2 = new byte[fileKey.length];
            for (int j = 0; j < fileKey.length; j++) k2[j] = (byte) (fileKey[j] ^ i);
            x = rc4Transform(k2, x);
        }
        for (int i = 0; i < 16; i++) if (x[i] != uVal[i]) return false;
        return true;
    }

    private static byte[] derivePdfOwnerRc4Key(byte[] paddedOwner, int r, int keyLenBytes) throws Exception {
        MessageDigest md5 = MessageDigest.getInstance("MD5");
        byte[] digest = md5.digest(paddedOwner);
        if (r >= 3) {
            for (int i = 0; i < 50; i++) {
                md5.reset();
                digest = md5.digest(digest);
            }
        }
        return Arrays.copyOf(digest, keyLenBytes);
    }

    private static byte[] decryptPdfOwnerO(byte[] ownerKey, byte[] oVal, int r) {
        byte[] data = Arrays.copyOf(oVal, Math.min(32, oVal.length));
        if (r == 2) return rc4Transform(ownerKey, data);
        for (int i = 19; i >= 0; i--) {
            byte[] k2 = new byte[ownerKey.length];
            for (int j = 0; j < ownerKey.length; j++) k2[j] = (byte) (ownerKey[j] ^ i);
            data = rc4Transform(k2, data);
        }
        return data;
    }

    private static byte[] verifyPdfR5R6(String pw, int r, byte[] oVal, byte[] uVal, byte[] oeVal, byte[] ueVal) throws Exception {
        if (uVal == null || uVal.length < 48 || ueVal == null || ueVal.length < 32) return null;
        byte[] pwBytes = (pw == null ? "" : pw).getBytes(StandardCharsets.UTF_8);
        if (pwBytes.length > 127) pwBytes = Arrays.copyOf(pwBytes, 127);

        byte[] uHash = Arrays.copyOfRange(uVal, 0, 32);
        byte[] uValSalt = Arrays.copyOfRange(uVal, 32, 40);
        byte[] uKeySalt = Arrays.copyOfRange(uVal, 40, 48);

        byte[] calcU = (r == 5)
                ? computeSha256Concat(pwBytes, uValSalt, null)
                : computePdfR6Hash(pwBytes, uValSalt, null);
        if (Arrays.equals(calcU, uHash)) {
            byte[] kKey = (r == 5)
                    ? computeSha256Concat(pwBytes, uKeySalt, null)
                    : computePdfR6Hash(pwBytes, uKeySalt, null);
            return aesCbcDecrypt(Arrays.copyOfRange(ueVal, 0, 32), kKey, new byte[16]);
        }

        if (oVal != null && oVal.length >= 48 && oeVal != null && oeVal.length >= 32) {
            byte[] u48 = Arrays.copyOfRange(uVal, 0, 48);
            byte[] oHash = Arrays.copyOfRange(oVal, 0, 32);
            byte[] oValSalt = Arrays.copyOfRange(oVal, 32, 40);
            byte[] oKeySalt = Arrays.copyOfRange(oVal, 40, 48);
            byte[] calcO = (r == 5)
                    ? computeSha256Concat(pwBytes, oValSalt, u48)
                    : computePdfR6Hash(pwBytes, oValSalt, u48);
            if (Arrays.equals(calcO, oHash)) {
                byte[] kKey = (r == 5)
                        ? computeSha256Concat(pwBytes, oKeySalt, u48)
                        : computePdfR6Hash(pwBytes, oKeySalt, u48);
                return aesCbcDecrypt(Arrays.copyOfRange(oeVal, 0, 32), kKey, new byte[16]);
            }
        }
        return null;
    }

    private static byte[] computeSha256Concat(byte[] a, byte[] b, byte[] c) throws Exception {
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        if (a != null) sha.update(a);
        if (b != null) sha.update(b);
        if (c != null) sha.update(c);
        return sha.digest();
    }

    private static byte[] computePdfR6Hash(byte[] pwBytes, byte[] salt8, byte[] u48) throws Exception {
        byte[] K = computeSha256Concat(pwBytes, salt8, u48);
        int round = 0;
        while (true) {
            int unitLen = pwBytes.length + K.length + (u48 != null ? u48.length : 0);
            byte[] k1 = new byte[unitLen * 64];
            for (int i = 0; i < 64; i++) {
                int off = i * unitLen;
                System.arraycopy(pwBytes, 0, k1, off, pwBytes.length);
                System.arraycopy(K, 0, k1, off + pwBytes.length, K.length);
                if (u48 != null) System.arraycopy(u48, 0, k1, off + pwBytes.length + K.length, u48.length);
            }
            Cipher c = Cipher.getInstance("AES/CBC/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(Arrays.copyOfRange(K, 0, 16), "AES"),
                    new IvParameterSpec(Arrays.copyOfRange(K, 16, 32)));
            byte[] e = c.doFinal(k1);
            int sum16 = 0;
            for (int i = 0; i < 16; i++) sum16 += (e[i] & 0xFF);
            int mod = sum16 % 3;
            String alg = mod == 0 ? "SHA-256" : (mod == 1 ? "SHA-384" : "SHA-512");
            K = MessageDigest.getInstance(alg).digest(e);

            round++;
            int lastByte = e[e.length - 1] & 0xFF;
            if (round >= 64 && lastByte <= round - 32) break;
            if (round > 1000) break;
        }
        return Arrays.copyOfRange(K, 0, 32);
    }

    private static byte[] decryptPdfObjectStream(byte[] rawStream, int objId, int gen, String dict, PdfSecurityCtx ctx) {
        if (rawStream == null || rawStream.length == 0 || ctx == null || ctx.fileKey == null) return rawStream;
        String d = dict == null ? "" : dict;
        if (Pattern.compile("/Type\\s*/XRef\\b").matcher(d).find()) return rawStream;
        if (!ctx.encryptMetadata && Pattern.compile("/Type\\s*/Metadata\\b").matcher(d).find()) return rawStream;

        try {
            if (ctx.r >= 5) {
                if (rawStream.length < 16) return rawStream;
                byte[] iv = Arrays.copyOfRange(rawStream, 0, 16);
                int ctLen = rawStream.length - 16;
                ctLen -= (ctLen % 16);
                if (ctLen <= 0) return new byte[0];
                byte[] pt = aesCbcDecrypt(Arrays.copyOfRange(rawStream, 16, 16 + ctLen), ctx.fileKey, iv);
                return stripPkcs7Padding(pt);
            }

            byte[] keyIn = new byte[ctx.fileKey.length + 5 + (ctx.isAes ? 4 : 0)];
            System.arraycopy(ctx.fileKey, 0, keyIn, 0, ctx.fileKey.length);
            int p = ctx.fileKey.length;
            keyIn[p++] = (byte) (objId & 0xFF);
            keyIn[p++] = (byte) ((objId >>> 8) & 0xFF);
            keyIn[p++] = (byte) ((objId >>> 16) & 0xFF);
            keyIn[p++] = (byte) (gen & 0xFF);
            keyIn[p++] = (byte) ((gen >>> 8) & 0xFF);
            if (ctx.isAes) {
                keyIn[p++] = 0x73; keyIn[p++] = 0x41; keyIn[p++] = 0x6C; keyIn[p++] = 0x54;
            }
            byte[] dg = MessageDigest.getInstance("MD5").digest(keyIn);
            byte[] objKey = Arrays.copyOf(dg, Math.min(ctx.fileKey.length + 5, 16));

            if (ctx.isAes) {
                if (rawStream.length < 16) return rawStream;
                byte[] iv = Arrays.copyOfRange(rawStream, 0, 16);
                int ctLen = rawStream.length - 16;
                ctLen -= (ctLen % 16);
                if (ctLen <= 0) return new byte[0];
                byte[] pt = aesCbcDecrypt(Arrays.copyOfRange(rawStream, 16, 16 + ctLen), objKey, iv);
                return stripPkcs7Padding(pt);
            }
            return rc4Transform(objKey, rawStream);
        } catch (Exception ex) {
            return rawStream;
        }
    }

    private static byte[] stripPkcs7Padding(byte[] data) {
        if (data == null || data.length == 0) return data;
        int pad = data[data.length - 1] & 0xFF;
        if (pad >= 1 && pad <= 16 && pad <= data.length) {
            for (int i = data.length - pad; i < data.length; i++) {
                if ((data[i] & 0xFF) != pad) return data;
            }
            return Arrays.copyOf(data, data.length - pad);
        }
        return data;
    }

    private static byte[] rc4Transform(byte[] key, byte[] data) {
        byte[] s = new byte[256];
        for (int i = 0; i < 256; i++) s[i] = (byte) i;
        int j = 0;
        for (int i = 0; i < 256; i++) {
            j = (j + (s[i] & 0xFF) + (key[i % key.length] & 0xFF)) & 255;
            byte tmp = s[i]; s[i] = s[j]; s[j] = tmp;
        }
        byte[] outB = new byte[data.length];
        int a = 0, b = 0;
        for (int k = 0; k < data.length; k++) {
            a = (a + 1) & 255;
            b = (b + (s[a] & 0xFF)) & 255;
            byte tmp = s[a]; s[a] = s[b]; s[b] = tmp;
            outB[k] = (byte) (data[k] ^ s[((s[a] & 0xFF) + (s[b] & 0xFF)) & 255]);
        }
        return outB;
    }
}
