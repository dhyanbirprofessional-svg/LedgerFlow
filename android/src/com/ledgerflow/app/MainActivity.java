package com.ledgerflow.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.Iterator;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQ = 4101;
    private static final int DEVICE_CREDENTIAL_REQ = 4102;
    private static final String APP_ORIGIN = "https://ledgerflow.local";

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private final Object fileLock = new Object();
    private final ExecutorService bgExecutor = Executors.newCachedThreadPool();
    private File dataFile;
    private File backupsDir;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        dataFile = new File(getFilesDir(), "ledgerflow-data.json");
        backupsDir = new File(getFilesDir(), "backups");
        if (!backupsDir.exists()) backupsDir.mkdirs();

        webView = new WebView(this);
        setContentView(webView);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(true);
        ws.setLoadWithOverviewMode(true);
        ws.setUseWideViewPort(true);
        ws.setSupportZoom(false);
        ws.setBuiltInZoomControls(false);
        ws.setDisplayZoomControls(false);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setDefaultTextEncodingName("UTF-8");

        webView.addJavascriptInterface(new AndroidBridge(), "LedgerFlowAndroid");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url != null && "ledgerflow.local".equalsIgnoreCase(url.getHost())) {
                    String path = url.getPath();
                    if (path == null || "/".equals(path) || "/index.html".equals(path)) {
                        return assetResponse("ui/index.html", "text/html");
                    }
                    if ("/styles.css".equals(path)) {
                        return assetResponse("ui/styles.css", "text/css");
                    }
                    if ("/mobile.css".equals(path)) {
                        return assetResponse("ui/mobile.css", "text/css");
                    }
                    if ("/app.js".equals(path)) {
                        return assetResponse("ui/app.js", "application/javascript");
                    }
                    if ("/favicon.ico".equals(path)) {
                        return new WebResourceResponse("image/x-icon", null, new ByteArrayInputStream(new byte[0]));
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && "ledgerflow.local".equalsIgnoreCase(uri.getHost())) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {}
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;

                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                String[] acceptTypes = params != null ? params.getAcceptTypes() : new String[0];
                String joinedAccept = acceptTypes != null ? String.join(",", acceptTypes).toLowerCase() : "";
                if (joinedAccept.contains("pdf") && !joinedAccept.contains("xls") && !joinedAccept.contains("csv")) {
                    intent.setType("application/pdf");
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/pdf", "image/*"});
                } else {
                    intent.setType("*/*");
                    String[] mimeTypes = new String[]{
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            "application/vnd.ms-excel",
                            "text/csv",
                            "text/tab-separated-values",
                            "text/plain",
                            "application/json",
                            "image/*",
                            "application/pdf"
                    };
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
                }
                try {
                    startActivityForResult(Intent.createChooser(intent, "Select File"), FILE_CHOOSER_REQ);
                } catch (Exception ex) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "No file picker available.", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        setSystemBarTheme("light");
        webView.loadUrl(APP_ORIGIN + "/index.html");
    }

    private WebResourceResponse assetResponse(String assetPath, String mimeType) {
        try {
            InputStream is = getAssets().open(assetPath);
            return new WebResourceResponse(mimeType, "UTF-8", is);
        } catch (Exception ex) {
            byte[] err = ("Missing asset: " + assetPath).getBytes(StandardCharsets.UTF_8);
            return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(err));
        }
    }

    @Override
    protected void onDestroy() {
        try { bgExecutor.shutdownNow(); } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQ) {
            ValueCallback<Uri[]> cb = filePathCallback;
            filePathCallback = null;
            if (cb == null) return;
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null && data.getClipData().getItemCount() > 0) {
                    int n = data.getClipData().getItemCount();
                    result = new Uri[n];
                    for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            cb.onReceiveValue(result);
            return;
        }
        if (requestCode == DEVICE_CREDENTIAL_REQ) {
            if (resultCode == RESULT_OK) notifyBiometricResult(true, "");
            else notifyBiometricResult(false, "Biometric verification cancelled.");
        }
    }

    private void notifyBiometricResult(final boolean ok, final String message) {
        runOnUiThread(() -> {
            if (webView == null) return;
            String js = "if(window.ledgerFlowBiometricResult){window.ledgerFlowBiometricResult("
                    + (ok ? "true" : "false") + "," + JSONObject.quote(message == null ? "" : message) + ");}";
            webView.evaluateJavascript(js, null);
        });
    }

    private boolean canAuthenticateBiometric() {
        KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        if (Build.VERSION.SDK_INT >= 30) {
            BiometricManager bm = getSystemService(BiometricManager.class);
            if (bm != null) {
                int r = bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG
                        | BiometricManager.Authenticators.BIOMETRIC_WEAK
                        | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
                return r == BiometricManager.BIOMETRIC_SUCCESS;
            }
        } else if (Build.VERSION.SDK_INT >= 29) {
            BiometricManager bm = getSystemService(BiometricManager.class);
            if (bm != null && bm.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS) return true;
            return km != null && km.isDeviceSecure();
        } else {
            boolean hasFp = getPackageManager().hasSystemFeature(PackageManager.FEATURE_FINGERPRINT);
            return (km != null && km.isDeviceSecure()) || hasFp;
        }
        return false;
    }

    @SuppressWarnings("deprecation")
    private void startBiometricPrompt() {
        runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= 28) {
                    BiometricPrompt.Builder builder = new BiometricPrompt.Builder(MainActivity.this)
                            .setTitle("Unlock LedgerFlow")
                            .setSubtitle("Verify with fingerprint, face, or screen lock");
                    if (Build.VERSION.SDK_INT >= 30) {
                        builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG
                                | BiometricManager.Authenticators.BIOMETRIC_WEAK
                                | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
                    } else if (Build.VERSION.SDK_INT == 29) {
                        builder.setDeviceCredentialAllowed(true);
                    } else {
                        builder.setNegativeButton("Cancel", getMainExecutor(),
                                (dialog, which) -> notifyBiometricResult(false, "Cancelled"));
                    }
                    BiometricPrompt prompt = builder.build();
                    prompt.authenticate(new CancellationSignal(), getMainExecutor(),
                            new BiometricPrompt.AuthenticationCallback() {
                                @Override
                                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                                    notifyBiometricResult(true, "");
                                }

                                @Override
                                public void onAuthenticationError(int errorCode, CharSequence errString) {
                                    notifyBiometricResult(false, errString != null ? errString.toString() : "Authentication failed");
                                }
                            });
                } else {
                    KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
                    if (km != null && km.isDeviceSecure()) {
                        Intent intent = km.createConfirmDeviceCredentialIntent("Unlock LedgerFlow",
                                "Verify your identity to access your finances");
                        if (intent != null) {
                            startActivityForResult(intent, DEVICE_CREDENTIAL_REQ);
                            return;
                        }
                    }
                    notifyBiometricResult(false, "Set up screen lock or biometrics in Android Settings first.");
                }
            } catch (Exception ex) {
                notifyBiometricResult(false, ex.getMessage());
            }
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript("(function(){return window.ledgerFlowHandleBack ? window.ledgerFlowHandleBack() : 'exit';})()",
                value -> {
                    if (value != null && value.contains("handled")) {
                        return;
                    }
                    MainActivity.super.onBackPressed();
                });
    }

    @SuppressWarnings("deprecation")
    private void setSystemBarTheme(final String theme) {
        runOnUiThread(() -> {
            Window window = getWindow();
            boolean dark = "dark".equalsIgnoreCase(theme);
            int bg = Color.parseColor(dark ? "#121824" : "#FFFFFF");
            window.setStatusBarColor(bg);
            window.setNavigationBarColor(bg);
            if (Build.VERSION.SDK_INT >= 30) {
                WindowInsetsController ctrl = window.getInsetsController();
                if (ctrl != null) {
                    int flags = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                            | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                    ctrl.setSystemBarsAppearance(dark ? 0 : flags, flags);
                }
            } else if (Build.VERSION.SDK_INT >= 26) {
                View decor = window.getDecorView();
                int vis = decor.getSystemUiVisibility();
                int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                decor.setSystemUiVisibility(dark ? (vis & ~flags) : (vis | flags));
            } else {
                View decor = window.getDecorView();
                int vis = decor.getSystemUiVisibility();
                int flag = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                decor.setSystemUiVisibility(dark ? (vis & ~flag) : (vis | flag));
            }
        });
    }

    public final class AndroidBridge {
        @JavascriptInterface
        public String getStateJson() {
            String dataJson = "null";
            synchronized (fileLock) {
                if (dataFile.exists()) {
                    try (FileInputStream fis = new FileInputStream(dataFile)) {
                        byte[] buf = new byte[(int) dataFile.length()];
                        int off = 0;
                        while (off < buf.length) {
                            int n = fis.read(buf, off, buf.length - off);
                            if (n <= 0) break;
                            off += n;
                        }
                        String raw = new String(buf, 0, off, StandardCharsets.UTF_8).trim();
                        if (raw.startsWith("{") && raw.endsWith("}")) {
                            dataJson = raw;
                        }
                    } catch (Exception ignored) {}
                }
            }
            return "{\"host\":true,\"platform\":\"android\",\"data\":" + dataJson + "}";
        }

        @JavascriptInterface
        public String saveStateJson(String jsonBody) {
            if (jsonBody == null) return "{\"ok\":false,\"error\":\"Empty body\"}";
            String trimmed = jsonBody.trim();
            if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
                return "{\"ok\":false,\"error\":\"Invalid JSON\"}";
            }
            synchronized (fileLock) {
                try {
                    File tmp = new File(getFilesDir(), "ledgerflow-data.json.tmp");
                    try (FileOutputStream fos = new FileOutputStream(tmp)) {
                        fos.write(trimmed.getBytes(StandardCharsets.UTF_8));
                        fos.getFD().sync();
                    }
                    if (!tmp.renameTo(dataFile)) {
                        try (FileOutputStream fos = new FileOutputStream(dataFile)) {
                            fos.write(trimmed.getBytes(StandardCharsets.UTF_8));
                        }
                        tmp.delete();
                    }

                    String day = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
                    File daily = new File(backupsDir, "ledgerflow-" + day + ".json");
                    if (!daily.exists()) {
                        try (FileOutputStream fos = new FileOutputStream(daily)) {
                            fos.write(trimmed.getBytes(StandardCharsets.UTF_8));
                        }
                        pruneOldBackups();
                    }
                    return "{\"ok\":true}";
                } catch (Exception ex) {
                    return "{\"ok\":false,\"error\":" + JSONObject.quote(ex.getMessage()) + "}";
                }
            }
        }

        @JavascriptInterface
        public String parseStatementJson(String requestJson) {
            try {
                JSONObject req = new JSONObject(requestJson);
                String fileName = req.optString("fileName", "statement.xlsx");
                String base64 = req.optString("base64", "");
                String password = req.optString("password", "");
                return StatementParser.handleParseRequest(fileName, base64, password);
            } catch (Exception ex) {
                return "{\"ok\":false,\"needsPassword\":false,\"error\":" + JSONObject.quote(ex.getMessage()) + "}";
            }
        }

        @JavascriptInterface
        public void saveExportFile(final String fileName, final String mimeType, final String content) {
            try {
                byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                    cv.put(MediaStore.Downloads.MIME_TYPE, mimeType != null ? mimeType : "application/octet-stream");
                    cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/LedgerFlow");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (uri != null) {
                        try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                            if (os != null) os.write(bytes);
                        }
                        showAndroidToast("Saved to Downloads/LedgerFlow/" + fileName);
                        return;
                    }
                }
                File outDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!outDir.exists()) outDir.mkdirs();
                File outFile = new File(outDir, fileName);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(bytes);
                }
                showAndroidToast("Saved to Downloads/" + fileName);
            } catch (Exception ex) {
                try {
                    File internalOut = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), fileName);
                    try (FileOutputStream fos = new FileOutputStream(internalOut)) {
                        fos.write(content.getBytes(StandardCharsets.UTF_8));
                    }
                    showAndroidToast("Saved to Android/data/.../Downloads/" + fileName);
                } catch (Exception inner) {
                    showAndroidToast("Export failed: " + ex.getMessage());
                }
            }
        }

        @JavascriptInterface
        public void setStatusBarTheme(String theme) {
            setSystemBarTheme(theme);
        }

        @JavascriptInterface
        public boolean isBiometricAvailable() {
            return canAuthenticateBiometric();
        }

        @JavascriptInterface
        public void authenticateBiometric() {
            startBiometricPrompt();
        }

        private void dispatchAsyncResult(final String cbId, final String payloadJson) {
            runOnUiThread(() -> {
                if (webView == null) return;
                String js = "if(window.__lfAndroidAsyncResolve){window.__lfAndroidAsyncResolve("
                        + JSONObject.quote(cbId == null ? "" : cbId) + ","
                        + JSONObject.quote(payloadJson == null ? "{}" : payloadJson) + ");}";
                webView.evaluateJavascript(js, null);
            });
        }

        @JavascriptInterface
        public String checkOnlineJson() {
            try {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm == null) return "{\"online\":false}";
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    Network net = cm.getActiveNetwork();
                    if (net == null) return "{\"online\":false}";
                    NetworkCapabilities caps = cm.getNetworkCapabilities(net);
                    boolean ok = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
                    return "{\"online\":" + (ok ? "true" : "false") + "}";
                } else {
                    @SuppressWarnings("deprecation")
                    NetworkInfo ni = cm.getActiveNetworkInfo();
                    boolean ok = ni != null && ni.isConnected();
                    return "{\"online\":" + (ok ? "true" : "false") + "}";
                }
            } catch (Exception ignored) {
                return "{\"online\":true}";
            }
        }

        @JavascriptInterface
        public String startParseStatementJob(final String requestJson) {
            try {
                final JSONObject req = new JSONObject(requestJson);
                final String fileName = req.optString("fileName", "statement.xlsx");
                final String base64 = req.optString("base64", "");
                final String password = req.optString("password", "");
                final StatementParser.ParseJobState job = StatementParser.createParseJob();
                bgExecutor.execute(() -> StatementParser.runParseJob(job, fileName, base64, password));
                return "{\"ok\":true,\"jobId\":" + JSONObject.quote(job.jobId) + "}";
            } catch (Exception ex) {
                return "{\"ok\":false,\"error\":" + JSONObject.quote(ex.getMessage()) + "}";
            }
        }

        @JavascriptInterface
        public String getParseStatementJobStatus(final String jobId) {
            try {
                return StatementParser.getParseJobStatusJson(jobId);
            } catch (Exception ex) {
                return "{\"ok\":false,\"done\":true,\"error\":" + JSONObject.quote(ex.getMessage()) + "}";
            }
        }

        @JavascriptInterface
        public void parseStatementJsonAsync(final String cbId, final String requestJson) {
            bgExecutor.execute(() -> dispatchAsyncResult(cbId, parseStatementJson(requestJson)));
        }

        @JavascriptInterface
        public void checkUpdateJsonAsync(final String cbId, final String ghToken) {
            bgExecutor.execute(() -> dispatchAsyncResult(cbId, checkUpdateJson(ghToken)));
        }

        @JavascriptInterface
        public void aiHttpPostAsync(final String cbId, final String urlStr, final String headersJson, final String bodyJson) {
            bgExecutor.execute(() -> dispatchAsyncResult(cbId, aiHttpPost(urlStr, headersJson, bodyJson)));
        }

        @JavascriptInterface
        public void downloadAndInstallApkAsync(final String cbId, final String urlStr, final String ghToken) {
            bgExecutor.execute(() -> dispatchAsyncResult(cbId, downloadAndInstallApkSync(urlStr, ghToken)));
        }

        private String downloadAndInstallApkSync(String urlStr, String ghToken) {
            HttpURLConnection conn = null;
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (!getPackageManager().canRequestPackageInstalls()) {
                        Intent permIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getPackageName()));
                        permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(permIntent);
                        return "{\"ok\":false,\"needsPermission\":true,\"error\":\"Allow 'Install unknown apps' for LedgerFlow in Settings, then tap Update again.\"}";
                    }
                }
                if (urlStr == null || !urlStr.startsWith("https://")) {
                    return "{\"ok\":false,\"error\":\"Invalid HTTPS APK URL.\"}";
                }
                URL currentUrl = new URL(urlStr);
                String initialHost = currentUrl.getHost() == null ? "" : currentUrl.getHost().toLowerCase(Locale.US);
                if (!initialHost.equals("github.com") && !initialHost.equals("raw.githubusercontent.com") && !initialHost.endsWith(".githubusercontent.com")) {
                    return "{\"ok\":false,\"error\":\"Untrusted update host.\"}";
                }

                for (int hops = 0; hops < 6; hops++) {
                    conn = (HttpURLConnection) currentUrl.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    conn.setRequestProperty("User-Agent", "LedgerFlow-Android/1.0");
                    String h = currentUrl.getHost() == null ? "" : currentUrl.getHost().toLowerCase(Locale.US);
                    if (ghToken != null && !ghToken.trim().isEmpty() && (h.equals("github.com") || h.equals("api.github.com") || h.equals("raw.githubusercontent.com"))) {
                        conn.setRequestProperty("Authorization", "Bearer " + ghToken.trim());
                    }
                    int code = conn.getResponseCode();
                    if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                        String loc = conn.getHeaderField("Location");
                        conn.disconnect();
                        conn = null;
                        if (loc == null || loc.isEmpty()) break;
                        currentUrl = new URL(currentUrl, loc);
                        continue;
                    }
                    if (code < 200 || code >= 300) {
                        return "{\"ok\":false,\"error\":\"APK download failed (HTTP " + code + ")\"}";
                    }
                    File updDir = new File(getCacheDir(), "updates");
                    if (!updDir.exists()) updDir.mkdirs();
                    File apkFile = new File(updDir, "LedgerFlow-update.apk");
                    try (InputStream is = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(apkFile)) {
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = is.read(buf)) > 0) fos.write(buf, 0, n);
                    }
                    Uri apkUri = Uri.parse("content://com.ledgerflow.app.apkprovider/LedgerFlow-update.apk");
                    Intent installIntent = new Intent(Intent.ACTION_VIEW);
                    installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                    installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(installIntent);
                    return "{\"ok\":true}";
                }
                return "{\"ok\":false,\"error\":\"Too many redirects downloading APK.\"}";
            } catch (Exception ex) {
                return "{\"ok\":false,\"error\":" + JSONObject.quote(ex.getMessage()) + "}";
            } finally {
                if (conn != null) conn.disconnect();
            }
        }

        @JavascriptInterface
        public String checkUpdateJson(String ghToken) {
            String repo = "dhyanbirprofessional-svg/LedgerFlow";
            String[] urls = new String[] {
                "https://api.github.com/repos/" + repo + "/releases/latest",
                "https://raw.githubusercontent.com/" + repo + "/main/version.json"
            };
            int lastCode = 0;
            for (int u = 0; u < urls.length; u++) {
                HttpURLConnection conn = null;
                try {
                    conn = (HttpURLConnection) new URL(urls[u]).openConnection();
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(7000);
                    conn.setReadTimeout(7000);
                    conn.setRequestProperty("User-Agent", "LedgerFlow-Android/1.0");
                    conn.setRequestProperty("Accept", "application/vnd.github+json");
                    if (ghToken != null && !ghToken.trim().isEmpty()) {
                        conn.setRequestProperty("Authorization", "Bearer " + ghToken.trim());
                    }
                    int code = conn.getResponseCode();
                    lastCode = code;
                    if (code >= 200 && code < 300) {
                        StringBuilder sb = new StringBuilder();
                        try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                            String line;
                            while ((line = br.readLine()) != null) sb.append(line).append('\n');
                        }
                        JSONObject raw = new JSONObject(sb.toString());
                        JSONObject out = new JSONObject();
                        if (u == 0) {
                            String tag = raw.optString("tag_name", "").replaceFirst("^[vV]", "");
                            out.put("ok", !tag.isEmpty());
                            out.put("version", tag);
                            out.put("notes", raw.optString("body", ""));
                            out.put("releaseUrl", raw.optString("html_url", "https://github.com/" + repo + "/releases/latest"));
                            String winUrl = "", apkUrl = "";
                            org.json.JSONArray assets = raw.optJSONArray("assets");
                            if (assets != null) {
                                for (int i = 0; i < assets.length(); i++) {
                                    JSONObject a = assets.optJSONObject(i);
                                    if (a == null) continue;
                                    String nm = a.optString("name", "");
                                    String dl = a.optString("browser_download_url", "");
                                    if (nm.toLowerCase(Locale.US).endsWith(".exe")) winUrl = dl;
                                    else if (nm.toLowerCase(Locale.US).endsWith(".apk")) apkUrl = dl;
                                }
                            }
                            out.put("windowsUrl", winUrl);
                            out.put("androidUrl", apkUrl);
                            if (!tag.isEmpty()) return out.toString();
                        } else {
                            String ver = raw.optString("version", "").replaceFirst("^[vV]", "");
                            out.put("ok", !ver.isEmpty());
                            out.put("version", ver);
                            out.put("notes", raw.optString("notes", ""));
                            out.put("windowsUrl", "https://raw.githubusercontent.com/" + repo + "/main/LedgerFlow-Setup.exe");
                            out.put("androidUrl", "https://raw.githubusercontent.com/" + repo + "/main/LedgerFlow.apk");
                            out.put("releaseUrl", raw.optString("releaseUrl", "https://github.com/" + repo + "/releases/latest"));
                            if (!ver.isEmpty()) return out.toString();
                        }
                    }
                } catch (Exception ignored) {
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
            return "{\"ok\":false,\"status\":" + lastCode + ",\"error\":" + JSONObject.quote(lastCode == 404 ? "GitHub repo is Private or has no release yet." : ("GitHub update check returned HTTP " + lastCode)) + "}";
        }

        @JavascriptInterface
        public String openExternalUrl(String urlStr) {
            try {
                if (urlStr == null || (!urlStr.startsWith("https://") && !urlStr.startsWith("http://"))) {
                    return "{\"ok\":false,\"error\":\"Invalid URL\"}";
                }
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(urlStr));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
                return "{\"ok\":true}";
            } catch (Exception ex) {
                return "{\"ok\":false,\"error\":" + JSONObject.quote(ex.getMessage()) + "}";
            }
        }

        @JavascriptInterface
        public String aiHttpPost(String urlStr, String headersJson, String bodyJson) {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(urlStr);
                String proto = url.getProtocol();
                if (!"https".equalsIgnoreCase(proto) && !"http".equalsIgnoreCase(proto)) {
                    return "{\"ok\":false,\"status\":0,\"error\":\"Only HTTP/HTTPS endpoints are allowed.\"}";
                }
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(45000);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                if (headersJson != null && headersJson.trim().startsWith("{")) {
                    JSONObject hdrs = new JSONObject(headersJson);
                    Iterator<String> keys = hdrs.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        conn.setRequestProperty(k, hdrs.optString(k, ""));
                    }
                }
                byte[] outBytes = (bodyJson == null ? "" : bodyJson).getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(outBytes);
                }
                int code = conn.getResponseCode();
                InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
                StringBuilder sb = new StringBuilder();
                if (is != null) {
                    try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = br.readLine()) != null) sb.append(line).append('\n');
                    }
                }
                JSONObject res = new JSONObject();
                res.put("ok", code >= 200 && code < 300);
                res.put("status", code);
                res.put("body", sb.toString());
                if (code < 200 || code >= 300) {
                    res.put("error", "HTTP " + code + ": " + sb.toString());
                }
                return res.toString();
            } catch (Exception ex) {
                return "{\"ok\":false,\"status\":0,\"error\":" + JSONObject.quote(ex.getMessage()) + "}";
            } finally {
                if (conn != null) conn.disconnect();
            }
        }

        private void showAndroidToast(final String msg) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
        }

        private void pruneOldBackups() {
            File[] files = backupsDir.listFiles((dir, name) -> name.startsWith("ledgerflow-") && name.endsWith(".json"));
            if (files == null || files.length <= 14) return;
            Arrays.sort(files, Comparator.comparingLong(File::lastModified).reversed());
            for (int i = 14; i < files.length; i++) {
                files[i].delete();
            }
        }
    }
}
