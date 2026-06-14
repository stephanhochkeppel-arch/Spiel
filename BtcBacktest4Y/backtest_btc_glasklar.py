import io
import math
import os
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests

SYMBOL = "BTCUSDT"
INTERVAL = "1m"
BASE = "https://data.binance.vision/data/futures/um/monthly/klines"
OUT = Path("BtcBacktest4Y/out")
OUT.mkdir(parents=True, exist_ok=True)

TAKER_ROUND_TRIP_COST = 0.0008  # 0.08 Prozent unlevered, konservativ fuer Entry+Exit
TP = 0.006                  # +0.60 Prozent Kursmove
SL = 0.004                  # -0.40 Prozent Kursmove
MAX_HOLD = 45               # Minuten
COOLDOWN = 10               # Minuten nach Signal


def month_list(n_months=48):
    now = datetime.now(timezone.utc)
    y, m = now.year, now.month
    months = []
    for _ in range(n_months + 1):
        months.append((y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return list(reversed(months))


def download_month(year, month):
    name = f"{SYMBOL}-{INTERVAL}-{year}-{month:02d}.zip"
    url = f"{BASE}/{SYMBOL}/{INTERVAL}/{name}"
    r = requests.get(url, timeout=30)
    if r.status_code != 200:
        return None
    z = zipfile.ZipFile(io.BytesIO(r.content))
    csv_name = z.namelist()[0]
    raw = z.read(csv_name)
    cols = [
        "open_time", "open", "high", "low", "close", "volume",
        "close_time", "quote_volume", "trade_count", "taker_buy_volume",
        "taker_buy_quote_volume", "ignore"
    ]
    df = pd.read_csv(io.BytesIO(raw), header=None, names=cols)
    return df


def load_data():
    frames = []
    missing = []
    for y, m in month_list(48):
        df = download_month(y, m)
        if df is None:
            missing.append(f"{y}-{m:02d}")
            continue
        frames.append(df)
    if not frames:
        raise RuntimeError("Keine Binance-Daten geladen.")
    df = pd.concat(frames, ignore_index=True)
    df = df.drop_duplicates("open_time").sort_values("open_time").reset_index(drop=True)
    for c in ["open", "high", "low", "close", "volume", "taker_buy_volume"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["open", "high", "low", "close", "volume"])
    df["time"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    cutoff = df["time"].max() - pd.Timedelta(days=1461)
    df = df[df["time"] >= cutoff].reset_index(drop=True)
    return df, missing


def add_features(df):
    tp = (df.high + df.low + df.close) / 3.0
    df["vwap60"] = (tp * df.volume).rolling(60).sum() / df.volume.rolling(60).sum()
    df["vwap180"] = (tp * df.volume).rolling(180).sum() / df.volume.rolling(180).sum()
    df["ema9"] = df.close.ewm(span=9, adjust=False).mean()
    df["ema21"] = df.close.ewm(span=21, adjust=False).mean()
    df["ema55"] = df.close.ewm(span=55, adjust=False).mean()
    for n in [5, 15, 30, 60]:
        df[f"r{n}"] = df.close.pct_change(n) * 100.0
    df["vol_ratio"] = df.volume.rolling(3).mean() / df.volume.shift(4).rolling(30).mean()
    rng = df.high - df.low
    df["spread_ratio"] = rng / rng.rolling(30).mean()
    df["taker_ratio"] = df.taker_buy_volume.rolling(5).sum() / df.volume.rolling(5).sum()
    df["h45"] = df.high.shift(2).rolling(45).max()
    df["l45"] = df.low.shift(2).rolling(45).min()
    df["h180"] = df.high.shift(2).rolling(180).max()
    df["l180"] = df.low.shift(2).rolling(180).min()
    df["sweepL"] = (df.low < df.l45) & (df.close > df.l45)
    df["sweepH"] = (df.high > df.h45) & (df.close < df.h45)
    df["breakH"] = df.close > df.h45
    df["breakL"] = df.close < df.l45
    return df.dropna().reset_index(drop=True)


def score_row(r):
    wL = wS = pL = pS = 0
    def add(cond, pts):
        return pts if bool(cond) else 0
    wL += add(r.close > r.vwap60, 12); wS += add(r.close < r.vwap60, 12)
    wL += add(r.ema9 > r.ema21, 10); wS += add(r.ema9 < r.ema21, 10)
    wL += add(r.r5 > .10 and r.r15 > .15, 12); wS += add(r.r5 < -.10 and r.r15 < -.15, 12)
    wL += add(r.vol_ratio > 1.45 and r.spread_ratio > 1.05, 14); wS += add(r.vol_ratio > 1.45 and r.spread_ratio > 1.05, 14)
    wL += add(r.taker_ratio > .56, 14); wS += add(r.taker_ratio < .44, 14)
    wL += add(r.sweepL or r.breakH, 14); wS += add(r.sweepH or r.breakL, 14)

    pL += add(r.close > r.vwap180, 12); pS += add(r.close < r.vwap180, 12)
    pL += add(r.ema9 > r.ema21 and r.ema21 > r.ema55, 16); pS += add(r.ema9 < r.ema21 and r.ema21 < r.ema55, 16)
    pL += add(r.r30 > .25 and r.r60 > .20, 14); pS += add(r.r30 < -.25 and r.r60 < -.20, 14)
    pL += add(r.vol_ratio > 1.25, 10); pS += add(r.vol_ratio > 1.25, 10)
    pL += add(r.taker_ratio > .53, 12); pS += add(r.taker_ratio < .47, 12)
    pL += add(r.close > r.h180 or r.sweepL, 14); pS += add(r.close < r.l180 or r.sweepH, 14)

    buy = sell = 0
    buy += 18 if wL >= 55 and wL > wS + 8 else 0
    sell += 18 if wS >= 55 and wS > wL + 8 else 0
    buy += 18 if pL >= 55 and pL > pS + 8 else 0
    sell += 18 if pS >= 55 and pS > pL + 8 else 0
    buy += 10 if wL >= 70 else 0; sell += 10 if wS >= 70 else 0
    buy += 10 if pL >= 70 else 0; sell += 10 if pS >= 70 else 0
    buy += 8 if r.close > r.vwap60 else 0; sell += 8 if r.close < r.vwap60 else 0
    buy += 8 if r.ema9 > r.ema21 else 0; sell += 8 if r.ema9 < r.ema21 else 0
    buy += 8 if r.taker_ratio > .53 else 0; sell += 8 if r.taker_ratio < .47 else 0
    return min(100, buy), min(100, sell), wL, wS, pL, pS


def add_scores(df):
    vals = [score_row(r) for r in df.itertuples(index=False)]
    sc = pd.DataFrame(vals, columns=["buy", "sell", "wL", "wS", "pL", "pS"])
    return pd.concat([df.reset_index(drop=True), sc], axis=1)


def liquidity_filter(df):
    # Testbarer Proxy: Volumen-Magnet oberhalb/unterhalb aus den letzten 6 Stunden.
    # Kein echtes Liquidationscluster, aber sinnvoller Test, ob Liquiditaetszonen als Filter helfen.
    up = np.zeros(len(df)); down = np.zeros(len(df))
    closes = df.close.values; highs = df.high.values; lows = df.low.values; vols = df.volume.values
    for i in range(360, len(df)):
        price = closes[i]
        lo = lows[i-360:i].min(); hi = highs[i-360:i].max()
        if not np.isfinite(lo) or hi <= lo:
            continue
        bins = np.linspace(lo, hi, 25)
        idx = np.clip(np.digitize(closes[i-360:i], bins) - 1, 0, len(bins)-1)
        prof = np.zeros(len(bins))
        for j, b in enumerate(idx):
            prof[b] += vols[i-360+j]
        above = prof[bins > price].sum()
        below = prof[bins < price].sum()
        up[i] = above; down[i] = below
    df["liq_up"] = up
    df["liq_down"] = down
    df["magnet_up"] = df.liq_up > df.liq_down * 1.20
    df["magnet_down"] = df.liq_down > df.liq_up * 1.20
    return df


def build_signals(df, variant):
    sig = []
    cooldown_until = -1
    for i, r in enumerate(df.itertuples(index=False)):
        if i < cooldown_until:
            continue
        buy, sell = r.buy, r.sell
        if variant == "C_filter":
            # Hochstufen nur bei passendem Magnet, blockieren bei Gegenmagnet.
            if buy >= 66 and getattr(r, "magnet_down"):
                buy -= 20
            if sell >= 66 and getattr(r, "magnet_up"):
                sell -= 20
            if buy >= 62 and getattr(r, "magnet_up") and r.taker_ratio > .52 and r.close > r.vwap60:
                buy += 8
            if sell >= 62 and getattr(r, "magnet_down") and r.taker_ratio < .48 and r.close < r.vwap60:
                sell += 8
        action = None
        if buy >= 66 and buy >= sell + 8:
            action = "LONG"
            score = buy
        elif sell >= 66 and sell >= buy + 8:
            action = "SHORT"
            score = sell
        if action:
            sig.append((i, r.time, action, score, r.close))
            cooldown_until = i + COOLDOWN
    return sig


def run_trades(df, signals):
    trades = []
    in_until = -1
    for i, t, side, score, px in signals:
        if i <= in_until or i + 1 >= len(df):
            continue
        entry_i = i + 1
        entry = df.open.iloc[entry_i]
        end_i = min(entry_i + MAX_HOLD, len(df) - 1)
        exit_i = end_i; reason = "time"
        for j in range(entry_i, end_i + 1):
            hi, lo = df.high.iloc[j], df.low.iloc[j]
            if side == "LONG":
                if lo <= entry * (1 - SL):
                    exit_i = j; reason = "SL"; break
                if hi >= entry * (1 + TP):
                    exit_i = j; reason = "TP"; break
            else:
                if hi >= entry * (1 + SL):
                    exit_i = j; reason = "SL"; break
                if lo <= entry * (1 - TP):
                    exit_i = j; reason = "TP"; break
        exit_price = entry * (1 + TP) if reason == "TP" and side == "LONG" else entry * (1 - TP) if reason == "TP" else entry * (1 - SL) if reason == "SL" and side == "LONG" else entry * (1 + SL) if reason == "SL" else df.close.iloc[exit_i]
        raw = (exit_price / entry - 1) if side == "LONG" else (entry / exit_price - 1)
        net = raw - TAKER_ROUND_TRIP_COST
        trades.append({"entry_time": df.time.iloc[entry_i], "side": side, "score": score, "entry": entry, "exit_time": df.time.iloc[exit_i], "exit": exit_price, "reason": reason, "net_pct": net * 100})
        in_until = exit_i
    return pd.DataFrame(trades)


def stats(tr):
    if tr.empty:
        return {"trades":0,"win_rate":0,"avg":0,"total":0,"profit_factor":0,"max_dd":0}
    rets = tr.net_pct.values / 100.0
    eq = np.cumprod(1 + rets)
    dd = eq / np.maximum.accumulate(eq) - 1
    wins = rets[rets > 0].sum(); losses = -rets[rets < 0].sum()
    return {
        "trades": len(tr),
        "win_rate": 100 * (rets > 0).mean(),
        "avg": 100 * rets.mean(),
        "total": 100 * (eq[-1] - 1),
        "profit_factor": wins / losses if losses > 0 else float("inf"),
        "max_dd": 100 * dd.min(),
    }


def fmt(s):
    return f"Trades {s['trades']} | Treffer {s['win_rate']:.1f}% | Ø {s['avg']:.3f}% | Total {s['total']:.1f}% | PF {s['profit_factor']:.2f} | MaxDD {s['max_dd']:.1f}%"


def main():
    df, missing = load_data()
    df = add_features(df)
    df = add_scores(df)
    df = liquidity_filter(df)
    sig_a = build_signals(df, "A_old")
    sig_c = build_signals(df, "C_filter")
    tr_a = run_trades(df, sig_a)
    tr_c = run_trades(df, sig_c)
    st_a, st_c = stats(tr_a), stats(tr_c)
    tr_a.to_csv(OUT / "trades_A_old.csv", index=False)
    tr_c.to_csv(OUT / "trades_C_liquidity_filter.csv", index=False)
    better = "C_filter" if (st_c["total"] > st_a["total"] and st_c["profit_factor"] >= st_a["profit_factor"] * 0.95) else "A_old"
    text = []
    text.append("# BTC Glasklar 4-Jahres-Backtest")
    text.append(f"Zeitraum: {df.time.min()} bis {df.time.max()}")
    text.append(f"Fehlende Monate: {', '.join(missing) if missing else 'keine'}")
    text.append("")
    text.append("## A altes System")
    text.append(fmt(st_a))
    text.append("")
    text.append("## C altes System plus testbarer Liquiditaetsfilter")
    text.append(fmt(st_c))
    text.append("")
    text.append(f"## Entscheidung: {better}")
    text.append("Hinweis: C nutzt einen testbaren Volume-Profile-Magnet aus historischen 1m-Kerzen, keine echte historische Coinglass-Heatmap und keine echten Liquidationscluster.")
    (OUT / "backtest_summary.md").write_text("\n".join(text), encoding="utf-8")
    print("\n".join(text))

if __name__ == "__main__":
    main()
