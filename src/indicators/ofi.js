'use strict';

/**
 * Order Flow Imbalance (OFI)
 * Cont, Kukanov & Stoikov (2014) "The Price Impact of Order Book Events"
 * Journal of Financial Econometrics, Vol. 12, No. 1, pp. 47-88.
 *
 * Multi-level aggregation (default 5 levels) mitigates top-of-book spoofing noise,
 * which affects 40-70% of visible limit orders on major venues (Kalena 2026 research).
 *
 * R² ≈ 65% for contemporaneous mid-price changes (equity data).
 * Crypto confirmation: Bieganowski & Ślepaczuk, arXiv 2602.00776, Binance Futures Perpetuals.
 *
 * Expected edge post-Taker costs: ~0.42 bps alpha on 30s for BTC vs ~4 bps round-trip
 * taker cost → Maker execution or strict confluence filter required for profitability.
 */

class OFI {
  /**
   * @param {Object} options
   * @param {number} options.levels - Orderbook depth levels to aggregate (default 5)
   * @param {number} options.windowSize - Max orderbook snapshots retained
   * @param {number} options.zScoreWindow - Rolling window for z-score baseline
   * @param {number} options.threshold - |z-score| required to emit directional signal (default 1.5)
   */
  constructor({ levels = 5, windowSize = 300, zScoreWindow = 60, threshold = 1.5 } = {}) {
    this.levels = levels;
    this.windowSize = windowSize;
    this.zScoreWindow = zScoreWindow;
    this.threshold = threshold;
    this.snapshots = [];
    this.rawValues = [];
  }

  /**
   * Update with a new orderbook snapshot.
   *
   * @param {Object} snapshot
   * @param {number} snapshot.time - Unix ms timestamp
   * @param {Array}  snapshot.bids - [[price, size], ...] sorted best first
   * @param {Array}  snapshot.asks - [[price, size], ...] sorted best first
   * @returns {{ ofi: number, zScore: number, signal: string }}
   */
  update(snapshot) {
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.windowSize) this.snapshots.shift();

    if (this.snapshots.length < 2) return { ofi: 0, zScore: 0, signal: 'neutral' };

    const prev = this.snapshots[this.snapshots.length - 2];
    const curr = this.snapshots[this.snapshots.length - 1];
    const ofi = this._computeOFI(prev, curr);

    this.rawValues.push(ofi);
    if (this.rawValues.length > this.zScoreWindow) this.rawValues.shift();

    const zScore = this._zScore(ofi);
    return { ofi, zScore, signal: this._classify(zScore) };
  }

  /**
   * Compute multi-level OFI between two consecutive snapshots.
   * For each level i:
   *   bid contribution = e_b * q_b_curr - (1-e_b) * q_b_prev
   *   ask contribution = e_a * q_a_curr - (1-e_a) * q_a_prev
   * where e_b=1 iff bid_price_curr >= bid_price_prev, e_a=1 iff ask_price_curr <= ask_price_prev
   */
  _computeOFI(prev, curr) {
    let ofi = 0;
    const depth = Math.min(this.levels, prev.bids.length, curr.bids.length, prev.asks.length, curr.asks.length);

    for (let i = 0; i < depth; i++) {
      const [pb, pq] = prev.bids[i];
      const [cb, cq] = curr.bids[i];
      const [pa, paq] = prev.asks[i];
      const [ca, caq] = curr.asks[i];

      const e_b = cb >= pb ? 1 : 0;
      const e_a = ca <= pa ? 1 : 0;

      ofi += (e_b * cq) - ((1 - e_b) * pq);
      ofi -= (e_a * caq) - ((1 - e_a) * paq);
    }

    return ofi;
  }

  _zScore(value) {
    const n = this.rawValues.length;
    if (n < 2) return 0;
    const mean = this.rawValues.reduce((a, b) => a + b, 0) / n;
    const variance = this.rawValues.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    return std > 0 ? (value - mean) / std : 0;
  }

  _classify(zScore) {
    if (zScore > this.threshold) return 'long';
    if (zScore < -this.threshold) return 'short';
    return 'neutral';
  }

  reset() {
    this.snapshots = [];
    this.rawValues = [];
  }
}

module.exports = { OFI };
