# BTC Glasklar 4-Jahres-Backtest

Dieses Modul testet zwei Varianten:

A = altes System: VWAP, EMA, Momentum, Volumen, Taker-Buy-Ratio, Sweep/Breakout-Struktur.

C = altes System plus testbarer Liquiditätsfilter: Volume-Profile-Magnet aus historischen 1-Minuten-Kerzen. Das ist bewusst keine echte Coinglass-Heatmap und kein echtes historisches Liquidationscluster, weil solche 4-Jahres-Daten nicht frei im Binance-Public-Data-Archiv enthalten sind.

Der Backtest lädt Binance USD-M Futures BTCUSDT 1m-Kerzen der letzten 48 Monate herunter und testet beide Systeme mit gleichem Risikomodell.

Output nach GitHub Actions:
- backtest_summary.md
- trades_A_old.csv
- trades_C_liquidity_filter.csv

Wichtig: Dieser Backtest ist eine Entscheidungsmaschine, kein Gewinnversprechen. Gebühren, Slippage und Datenlücken werden berücksichtigt beziehungsweise ausgewiesen.
