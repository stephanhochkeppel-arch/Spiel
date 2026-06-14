import pandas as pd
import backtest_btc_glasklar as bt

# 6-Jahres-Variante: 72 Monate statt 48 Monate.
# Sie nutzt dieselbe Engine, dasselbe Risiko-Modell und dieselbe A-vs-C-Entscheidung.

def load_data_6y():
    frames = []
    missing = []
    for y, m in bt.month_list(72):
        df = bt.download_month(y, m)
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
    cutoff = df["time"].max() - pd.Timedelta(days=2192)
    df = df[df["time"] >= cutoff].reset_index(drop=True)
    return df, missing


def main():
    bt.load_data = load_data_6y
    bt.main()


if __name__ == "__main__":
    main()
