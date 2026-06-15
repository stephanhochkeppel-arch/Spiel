package ch.steph.btcglasklar;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
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
    private static final String PREFS = "btc_glasklar_native_prefs";
    private static final String KEY_BACKGROUND_RUNNING = "background_alarm_running";

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
            html = html.replace("BTC Glasklar V101", "BTC Glasklar V104");
            html = html.replace("BTC Glasklar V102", "BTC Glasklar V104");
            html = html.replace("BTC Glasklar V103", "BTC Glasklar V104");
            html = html.replace("BTC Glasklar V9", "BTC Glasklar V104");
            html = html.replace("BTC GLASKLAR V100 FIX", "BTC Glasklar V104");
            html = html.replace("Lernen dauerhaft · seit Installation", "Dauerlernen · Alarmstatus bleibt gespeichert V104");
            html = html.replace("Dauerlernen · Hintergrundalarm V102", "Dauerlernen · Alarmstatus bleibt gespeichert V104");
            html = html.replace("Dauerlernen · Hintergrundalarm V103", "Dauerlernen · Alarmstatus bleibt gespeichert V104");
            html = persistNormalAlarmInHtml(html);
            html = injectBackgroundAlarmUi(html);
            webView.loadDataWithBaseURL("https://btc-glasklar-v104.local/", html, "text/html", "UTF-8", null);
        } catch (Exception e) {
            webView.loadData("<h1>BTC Glasklar V104</h1><p>Alarmstatus bleibt gespeichert.</p>", "text/html", "UTF-8");
        }
    }

    private String persistNormalAlarmInHtml(String html) {
        html = html.replace(
                "let timer=null,alarm=false,ctx=null,lastAlarm='',lastMs=0;",
                "let timer=null,alarm=localStorage.getItem('btc_glasklar_alarm_on')==='1',ctx=null,lastAlarm='',lastMs=0;"
        );
        html = html.replace(
                "$('alarm').onclick=()=>{alarm=!alarm;$('alarm').textContent=alarm?'☑ Alarm an':'☐ Alarm aus';$('alarm').className=alarm?'on':'';beep('buy')};",
                "$('alarm').onclick=()=>{alarm=!alarm;localStorage.setItem('btc_glasklar_alarm_on',alarm?'1':'0');$('alarm').textContent=alarm?'☑ Alarm an':'☐ Alarm aus';$('alarm').className=alarm?'on':'';beep('buy')};setTimeout(()=>{$('alarm').textContent=alarm?'☑ Alarm an':'☐ Alarm aus';$('alarm').className=alarm?'on':'';},300);"
        );
        return html;
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private boolean isBackgroundAlarmMarkedRunning() {
        return prefs().getBoolean(KEY_BACKGROUND_RUNNING, false);
    }

    private void setBackgroundAlarmMarkedRunning(boolean running) {
        prefs().edit().putBoolean(KEY_BACKGROUND_RUNNING, running).apply();
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 102);
        }
    }

    private String injectBackgroundAlarmUi(String html) {
        String box = "<section class=\"card\" style=\"border:2px solid rgba(0,229,155,.45)\">" +
                "<div class=\"lab\">V104 HINTERGRUNDALARM</div>" +
                "<div class=\"details\">Läuft auch weiter, wenn du die App schliesst. Der Start-Status bleibt gespeichert und wird beim nächsten Öffnen wieder angezeigt.</div>" +
                "<div class=\"row\" style=\"margin-top:12px\">" +
                "<button id=\"bgStart\">☑ Hintergrundalarm starten</button>" +
                "<button id=\"bgStop\">☐ Hintergrundalarm stoppen</button>" +
                "</div><div id=\"bgState\" class=\"muted\" style=\"margin-top:10px\">Status wird geladen ...</div></section>";
        String script = "<script>setTimeout(function(){" +
                "var s=document.getElementById('bgStart'),t=document.getElementById('bgStop'),st=document.getElementById('bgState');" +
                "function set(x){if(st)st.textContent=x;}" +
                "function refresh(){try{set(AndroidBridge.isBackgroundRunning()?'Hintergrundalarm läuft bereits. Du darfst die App schliessen.':'Noch nicht gestartet.');}catch(e){set('Status nicht lesbar: '+e.message)}}" +
                "if(s)s.onclick=function(){try{AndroidBridge.startBackgroundAlarm();set('Hintergrundalarm läuft. Du darfst die App schliessen.');}catch(e){set('Start nicht möglich: '+e.message)}};" +
                "if(t)t.onclick=function(){try{AndroidBridge.stopBackgroundAlarm();set('Hintergrundalarm gestoppt.');}catch(e){set('Stopp nicht möglich: '+e.message)}};" +
                "refresh();" +
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
                setBackgroundAlarmMarkedRunning(true);
            });
        }

        @JavascriptInterface
        public void stopBackgroundAlarm() {
            runOnUiThread(() -> {
                Intent intent = new Intent(MainActivity.this, BackgroundSignalService.class);
                intent.setAction(BackgroundSignalService.ACTION_STOP);
                startService(intent);
                setBackgroundAlarmMarkedRunning(false);
            });
        }

        @JavascriptInterface
        public boolean isBackgroundRunning() {
            return isBackgroundAlarmMarkedRunning();
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
