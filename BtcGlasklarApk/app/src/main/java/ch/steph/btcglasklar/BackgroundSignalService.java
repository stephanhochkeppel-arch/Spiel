package ch.steph.btcglasklar;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class BackgroundSignalService extends Service {
    public static final String ACTION_STOP = "ch.steph.btcglasklar.STOP_BACKGROUND";
    private static final String SERVICE_CHANNEL = "btc_glasklar_service";
    private static final String SIGNAL_CHANNEL = "btc_glasklar_signal";
    private static final int SERVICE_NOTIFICATION_ID = 101;
    private static final int SIGNAL_NOTIFICATION_ID = 102;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private volatile boolean running = false;
    private String lastAction = "";
    private long lastSignalMs = 0L;

    private final Runnable loop = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            new Thread(() -> {
                SignalResult result = calculateSignal();
                updateServiceNotification(result);
                maybeSendSignalNotification(result);
            }).start();
            handler.postDelayed(this, 30000);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            running = false;
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        running = true;
        startForeground(SERVICE_NOTIFICATION_ID, buildServiceNotification("BTC Glasklar läuft", "Prüfe alle 30 Sekunden."));
        handler.removeCallbacks(loop);
        handler.post(loop);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacks(loop);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            NotificationChannel service = new NotificationChannel(SERVICE_CHANNEL, "BTC Glasklar Hintergrund", NotificationManager.IMPORTANCE_LOW);
            service.setDescription("Dauerhafte Anzeige, solange BTC Glasklar im Hintergrund prüft.");
            NotificationChannel signal = new NotificationChannel(SIGNAL_CHANNEL, "BTC Glasklar Signale", NotificationManager.IMPORTANCE_HIGH);
            signal.setDescription("Kaufen, Verkaufen, Crash- und Squeeze-Warnungen.");
            signal.enableVibration(true);
            nm.createNotificationChannel(service);
            nm.createNotificationChannel(signal);
        }
    }

    private PendingIntent openAppIntent() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
        return PendingIntent.getActivity(this, 0, intent, flags);
    }

    private PendingIntent stopIntent() {
        Intent intent = new Intent(this, BackgroundSignalService.class);
        intent.setAction(ACTION_STOP);
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
        return PendingIntent.getService(this, 1, intent, flags);
    }

    private Notification buildServiceNotification(String title, String text) {
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, SERVICE_CHANNEL)
                : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(openAppIntent())
                .setOngoing(true)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopIntent());
        return b.build();
    }

    private void updateServiceNotification(SignalResult r) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        String text = r.action + " · Kauf " + r.buy + "/100 · Verkauf " + r.sell + "/100 · $" + String.format(Locale.US, "%.0f", r.price);
        nm.notify(SERVICE_NOTIFICATION_ID, buildServiceNotification("BTC Glasklar Hintergrund aktiv", text));
    }

    private void maybeSendSignalNotification(SignalResult r) {
        if ("WARTEN".equals(r.action)) return;
        long now = System.currentTimeMillis();
        if (r.action.equals(lastAction) && now - lastSignalMs < 5 * 60 * 1000L) return;
        lastAction = r.action;
        lastSignalMs = now;

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, SIGNAL_CHANNEL)
                : new Notification.Builder(this);
        String text = "Kauf " + r.buy + "/100 · Verkauf " + r.sell + "/100 · $" + String.format(Locale.US, "%.0f", r.price);
        b.setSmallIcon(android.R.drawable.stat_sys_warning)
                .setContentTitle("BTC Glasklar: " + r.action)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text + "\n" + r.reason))
                .setContentIntent(openAppIntent())
                .setAutoCancel(true)
                .setDefaults(Notification.DEFAULT_SOUND | Notification.DEFAULT_VIBRATE);
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(SIGNAL_NOTIFICATION_ID, b.build());
    }

    private static String readUrl(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(10000);
        c.setRequestProperty("User-Agent", "BTC-Glasklar-Android");
        InputStream in = c.getResponseCode() >= 200 && c.getResponseCode() < 300 ? c.getInputStream() : c.getErrorStream();
        BufferedReader br = new BufferedReader(new InputStreamReader(in));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) sb.append(line);
        br.close();
        c.disconnect();
        return sb.toString();
    }

    private SignalResult calculateSignal() {
        try {
            JSONArray kl = new JSONArray(readUrl("https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=480"));
            JSONArray depBids = new JSONObject(readUrl("https://data-api.binance.vision/api/v3/depth?symbol=BTCUSDT&limit=100")).getJSONArray("bids");
            JSONArray depAsks = new JSONObject(readUrl("https://data-api.binance.vision/api/v3/depth?symbol=BTCUSDT&limit=100")).getJSONArray("asks");
            double funding = safeFunding();
            double oi = safeOi();
            double tr = safeTakerRatio();

            Market d = prepare(kl, bookImbalance(depBids, depAsks), funding, oi, tr);
            Score s = score(d);
            SignalResult r = decide(s);
            r.price = d.price;
            r.buy = s.buy;
            r.sell = s.sell;
            r.reason = "Welle L/S " + s.wL + "/" + s.wS + " · Phase L/S " + s.pL + "/" + s.pS + " · Funding " + String.format(Locale.US, "%.5f", d.fund * 100) + "%";
            return r;
        } catch (Exception e) {
            SignalResult r = new SignalResult();
            r.action = "WARTEN";
            r.reason = "Fehler: " + e.getMessage();
            return r;
        }
    }

    private double safeFunding() {
        try { return new JSONObject(readUrl("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT")).optDouble("lastFundingRate", 0.0); }
        catch (Exception e) { return 0.0; }
    }

    private double safeOi() {
        try {
            JSONArray a = new JSONArray(readUrl("https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=12"));
            if (a.length() < 4) return 0.0;
            double first = a.getJSONObject(Math.max(0, a.length() - 7)).optDouble("sumOpenInterest", 0.0);
            double last = a.getJSONObject(a.length() - 1).optDouble("sumOpenInterest", 0.0);
            return first == 0.0 ? 0.0 : 100.0 * (last - first) / first;
        } catch (Exception e) { return 0.0; }
    }

    private double safeTakerRatio() {
        try {
            JSONArray a = new JSONArray(readUrl("https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=5m&limit=12"));
            int start = Math.max(0, a.length() - 4);
            double sum = 0.0; int n = 0;
            for (int i = start; i < a.length(); i++) { sum += a.getJSONObject(i).optDouble("buySellRatio", 1.0); n++; }
            return n == 0 ? 1.0 : sum / n;
        } catch (Exception e) { return 1.0; }
    }

    private double bookImbalance(JSONArray bids, JSONArray asks) throws Exception {
        double b = 0.0, a = 0.0;
        int n = Math.min(50, Math.min(bids.length(), asks.length()));
        for (int i = 0; i < n; i++) {
            double w = 1.0 / Math.sqrt(i + 1.0);
            b += bids.getJSONArray(i).getDouble(1) * w;
            a += asks.getJSONArray(i).getDouble(1) * w;
        }
        return (b - a) / Math.max(1e-9, b + a);
    }

    private Market prepare(JSONArray kl, double imb, double funding, double oi, double tr) throws Exception {
        Market d = new Market();
        for (int i = 0; i < kl.length(); i++) {
            JSONArray k = kl.getJSONArray(i);
            d.o.add(k.getDouble(1)); d.h.add(k.getDouble(2)); d.l.add(k.getDouble(3)); d.c.add(k.getDouble(4)); d.v.add(k.getDouble(5)); d.tbv.add(k.optDouble(9, k.getDouble(5) / 2.0));
        }
        d.price = last(d.c); d.v60 = vwap(d, 60); d.v180 = vwap(d, 180); d.e9 = ema(d.c, 9); d.e21 = ema(d.c, 21); d.e55 = ema(d.c, 55);
        d.rsi = rsi(d.c, 14); d.r5 = ret(d.c, 5); d.r15 = ret(d.c, 15); d.r30 = ret(d.c, 30); d.r60 = ret(d.c, 60);
        d.vol = avg(tail(d.v, 3)) / Math.max(1e-9, avg(slice(d.v, Math.max(0, d.v.size() - 34), Math.max(0, d.v.size() - 4))));
        List<Double> ranges = new ArrayList<>();
        for (int i = 0; i < d.h.size(); i++) ranges.add(d.h.get(i) - d.l.get(i));
        d.spread = last(ranges) / Math.max(1e-9, avg(tail(ranges, 30)));
        d.tb = sum(tail(d.tbv, 5)) / Math.max(1e-9, sum(tail(d.v, 5)));
        d.imb = imb; d.fund = funding; d.oi = oi; d.tr = tr;
        d.h45 = maxRange(d.h, 46, 2); d.l45 = minRange(d.l, 46, 2); d.h180 = maxRange(d.h, 181, 2); d.l180 = minRange(d.l, 181, 2);
        d.sweepL = last(d.l) < d.l45 && last(d.c) > d.l45; d.sweepH = last(d.h) > d.h45 && last(d.c) < d.h45; d.breakH = last(d.c) > d.h45; d.breakL = last(d.c) < d.l45;
        return d;
    }

    private Score score(Market d) {
        Score s = new Score();
        s.wL += pts(d.price > d.v60, 12); s.wS += pts(d.price < d.v60, 12);
        s.wL += pts(d.e9 > d.e21, 10); s.wS += pts(d.e9 < d.e21, 10);
        s.wL += pts(d.r5 > .10 && d.r15 > .15, 12); s.wS += pts(d.r5 < -.10 && d.r15 < -.15, 12);
        s.wL += pts(d.vol > 1.45 && d.spread > 1.05, 14); s.wS += pts(d.vol > 1.45 && d.spread > 1.05, 14);
        s.wL += pts(d.tb > .56 || d.tr > 1.08, 14); s.wS += pts(d.tb < .44 || d.tr < .92, 14);
        s.wL += pts(d.imb > .12, 10); s.wS += pts(d.imb < -.12, 10);
        s.wL += pts(d.sweepL || d.breakH, 14); s.wS += pts(d.sweepH || d.breakL, 14);
        s.wL += pts(d.rsi > 42 && d.rsi < 72, 8); s.wS += pts(d.rsi < 58 && d.rsi > 28, 8);
        s.wL += pts(d.fund < .00025, 6); s.wS += pts(d.fund > -.00015, 6);
        s.pL += pts(d.price > d.v180, 12); s.pS += pts(d.price < d.v180, 12);
        s.pL += pts(d.e9 > d.e21 && d.e21 > d.e55, 16); s.pS += pts(d.e9 < d.e21 && d.e21 < d.e55, 16);
        s.pL += pts(d.r30 > .25 && d.r60 > .20, 14); s.pS += pts(d.r30 < -.25 && d.r60 < -.20, 14);
        s.pL += pts(d.vol > 1.25, 10); s.pS += pts(d.vol > 1.25, 10);
        s.pL += pts(d.tb > .53 || d.tr > 1.03, 12); s.pS += pts(d.tb < .47 || d.tr < .97, 12);
        s.pL += pts(d.price > d.h180 || d.sweepL, 14); s.pS += pts(d.price < d.l180 || d.sweepH, 14);
        s.pL += pts(d.oi > 0 && d.fund < .00035, 8); s.pS += pts(d.oi > 0 && d.fund > -.00025, 8);
        s.crash = clamp(20 * pts(d.price < d.v60, 1) + 18 * pts(d.e9 < d.e21, 1) + 18 * pts(d.tb < .44 || d.tr < .92, 1) + 14 * pts(d.breakL || d.sweepH, 1) + 12 * pts(d.oi > 0, 1) + 18 * pts(d.fund > .00025, 1));
        s.sq = clamp(20 * pts(d.price > d.v60, 1) + 18 * pts(d.e9 > d.e21, 1) + 18 * pts(d.tb > .56 || d.tr > 1.08, 1) + 14 * pts(d.breakH || d.sweepL, 1) + 12 * pts(d.oi > 0, 1) + 18 * pts(d.fund < -.00015, 1));
        s.buy += s.wL >= 55 && s.wL > s.wS + 8 ? 18 : 0; s.sell += s.wS >= 55 && s.wS > s.wL + 8 ? 18 : 0;
        s.buy += s.pL >= 55 && s.pL > s.pS + 8 ? 18 : 0; s.sell += s.pS >= 55 && s.pS > s.pL + 8 ? 18 : 0;
        s.buy += s.wL >= 70 ? 10 : 0; s.sell += s.wS >= 70 ? 10 : 0;
        s.buy += s.pL >= 70 ? 10 : 0; s.sell += s.pS >= 70 ? 10 : 0;
        s.buy += d.price > d.v60 ? 8 : 0; s.sell += d.price < d.v60 ? 8 : 0;
        s.buy += d.e9 > d.e21 ? 8 : 0; s.sell += d.e9 < d.e21 ? 8 : 0;
        s.buy += (d.tb > .53 || d.tr > 1.03) ? 8 : 0; s.sell += (d.tb < .47 || d.tr < .97) ? 8 : 0;
        s.buy += s.sq > s.crash + 8 ? 12 : 0; s.sell += s.crash > s.sq + 8 ? 12 : 0;
        s.wL = clamp(s.wL); s.wS = clamp(s.wS); s.pL = clamp(s.pL); s.pS = clamp(s.pS); s.buy = clamp(s.buy); s.sell = clamp(s.sell);
        return s;
    }

    private SignalResult decide(Score s) {
        SignalResult r = new SignalResult();
        r.action = "WARTEN";
        if (s.buy >= 82 && s.buy > s.sell + 10) r.action = "STARK KAUFEN";
        else if (s.sell >= 82 && s.sell > s.buy + 10) r.action = "STARK VERKAUFEN";
        else if (s.buy >= 66 && s.buy > s.sell + 8) r.action = "KAUFEN";
        else if (s.sell >= 66 && s.sell > s.buy + 8) r.action = "VERKAUFEN";
        return r;
    }

    private static int pts(boolean c, int p) { return c ? p : 0; }
    private static int clamp(int x) { return Math.max(0, Math.min(100, x)); }
    private static double last(List<Double> a) { return a.get(a.size() - 1); }
    private static double avg(List<Double> a) { return a.isEmpty() ? 0.0 : sum(a) / a.size(); }
    private static double sum(List<Double> a) { double s = 0.0; for (double v : a) s += v; return s; }
    private static List<Double> tail(List<Double> a, int n) { return slice(a, Math.max(0, a.size() - n), a.size()); }
    private static List<Double> slice(List<Double> a, int s, int e) { return new ArrayList<>(a.subList(Math.max(0, s), Math.min(a.size(), e))); }
    private static double ema(List<Double> a, int p) { double k = 2.0 / (p + 1.0), e = a.get(0); for (double v : a) e = v * k + e * (1.0 - k); return e; }
    private static double ret(List<Double> c, int m) { return c.size() > m ? 100.0 * (last(c) - c.get(c.size() - 1 - m)) / c.get(c.size() - 1 - m) : 0.0; }
    private static double vwap(Market d, int p) { int s = Math.max(0, d.c.size() - p); double pv = 0.0, v = 0.0; for (int i = s; i < d.c.size(); i++) { double tp = (d.h.get(i) + d.l.get(i) + d.c.get(i)) / 3.0; pv += tp * d.v.get(i); v += d.v.get(i); } return pv / Math.max(1e-9, v); }
    private static double rsi(List<Double> c, int p) { double g = 0.0, l = 0.0; for (int i = Math.max(1, c.size() - p); i < c.size(); i++) { double ch = c.get(i) - c.get(i - 1); if (ch >= 0) g += ch; else l -= ch; } if (l == 0.0) return 100.0; double rs = (g / p) / (l / p); return 100.0 - 100.0 / (1.0 + rs); }
    private static double maxRange(List<Double> a, int p, int ex) { int end = Math.max(0, a.size() - ex); int start = Math.max(0, a.size() - p); double m = -Double.MAX_VALUE; for (int i = start; i < end; i++) m = Math.max(m, a.get(i)); return m; }
    private static double minRange(List<Double> a, int p, int ex) { int end = Math.max(0, a.size() - ex); int start = Math.max(0, a.size() - p); double m = Double.MAX_VALUE; for (int i = start; i < end; i++) m = Math.min(m, a.get(i)); return m; }

    private static class Market { List<Double> o = new ArrayList<>(), h = new ArrayList<>(), l = new ArrayList<>(), c = new ArrayList<>(), v = new ArrayList<>(), tbv = new ArrayList<>(); double price, v60, v180, e9, e21, e55, rsi, r5, r15, r30, r60, vol, spread, tb, imb, fund, oi, tr, h45, l45, h180, l180; boolean sweepL, sweepH, breakH, breakL; }
    private static class Score { int wL, wS, pL, pS, buy, sell, crash, sq; }
    private static class SignalResult { String action = "WARTEN"; String reason = ""; double price = 0.0; int buy = 0; int sell = 0; }
}
