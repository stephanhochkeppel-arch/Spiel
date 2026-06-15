package ch.steph.btcglasklar;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class MainActivity extends Activity {
    private WebView webView;
    private static boolean backgroundRunning = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestNotificationPermissionIfNeeded();

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.clearCache(true);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        try {
            InputStream input = getAssets().open("index.html");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int length;
            while ((length = input.read(buffer)) != -1) {
                output.write(buffer, 0, length);
            }
            input.close();
            String html = output.toString("UTF-8");
            html = html.replace("BTC Glasklar V101", "BTC Glasklar V102");
            html = html.replace("BTC Glasklar V9", "BTC Glasklar V102");
            html = html.replace("BTC GLASKLAR V100 FIX", "BTC Glasklar V102");
            html = html.replace("Lernen dauerhaft · seit Installation", "Dauerlernen · Hintergrundalarm V102");
            html = injectBackgroundAlarmUi(html);
            webView.loadDataWithBaseURL("https://btc-glasklar-v102.local/", html, "text/html", "UTF-8", null);
        } catch (Exception e) {
            webView.loadData("<h1>BTC Glasklar V102</h1><p>Hintergrundalarm bereit.</p>", "text/html", "UTF-8");
        }
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 102);
        }
    }

    private String injectBackgroundAlarmUi(String html) {
        String box = "<section class=\"card\" style=\"border:2px solid rgba(0,229,155,.45)\">" +
                "<div class=\"lab\">V102 HINTERGRUNDALARM</div>" +
                "<div class=\"details\">Läuft auch weiter, wenn du die App schliesst. Android zeigt dann oben eine dauerhafte Benachrichtigung.</div>" +
                "<div class=\"row\" style=\"margin-top:12px\">" +
                "<button id=\"bgStart\">☑ Hintergrundalarm starten</button>" +
                "<button id=\"bgStop\">☐ Hintergrundalarm stoppen</button>" +
                "</div><div id=\"bgState\" class=\"muted\" style=\"margin-top:10px\">Noch nicht gestartet.</div></section>";
        String script = "<script>setTimeout(function(){" +
                "var s=document.getElementById('bgStart'),t=document.getElementById('bgStop'),st=document.getElementById('bgState');" +
                "function set(x){if(st)st.textContent=x;}" +
                "if(s)s.onclick=function(){try{AndroidBridge.startBackgroundAlarm();set('Hintergrundalarm läuft. Du darfst die App schliessen.');}catch(e){set('Start nicht möglich: '+e.message)}};" +
                "if(t)t.onclick=function(){try{AndroidBridge.stopBackgroundAlarm();set('Hintergrundalarm gestoppt.');}catch(e){set('Stopp nicht möglich: '+e.message)}};" +
                "try{if(AndroidBridge.isBackgroundRunning())set('Hintergrundalarm läuft bereits.');}catch(e){}" +
                "},700);</script>";
        if (html.contains("<div class=\"card\"><div class=\"row\"><input")) {
            return html.replaceFirst("<div class=\\\"card\\\"><div class=\\\"row\\\"><input", box + "<div class=\"card\"><div class=\"row\"><input") + script;
        }
        return html.replace("<main>", "<main>" + box).replace("</body>", script + "</body>");
    }

    public class AndroidBridge {
        @JavascriptInterface
        public void startBackgroundAlarm() {
            runOnUiThread(() -> {
                requestNotificationPermissionIfNeeded();
                Intent intent = new Intent(MainActivity.this, BackgroundSignalService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(intent);
                } else {
                    startService(intent);
                }
                backgroundRunning = true;
            });
        }

        @JavascriptInterface
        public void stopBackgroundAlarm() {
            runOnUiThread(() -> {
                Intent intent = new Intent(MainActivity.this, BackgroundSignalService.class);
                intent.setAction(BackgroundSignalService.ACTION_STOP);
                startService(intent);
                backgroundRunning = false;
            });
        }

        @JavascriptInterface
        public boolean isBackgroundRunning() {
            return backgroundRunning;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
