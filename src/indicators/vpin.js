'use strict';

/**
 * VPIN – Volume-Synchronized Probability of Informed Trading
 * Easley, López de Prado & O'Hara (2012) methodology.
 *
 * BTC-specific peer-reviewed evidence:
 * Kitvanitphasu, Kyaw, Likitapiwat & Treepongkaruna (2025)
 * "Bitcoin wild moves: Evidence from order flow toxicity and price jumps"
 * Research in International Business and Finance, Vol. 81, Art. 103163
 * DOI: 10.1016/j.ribaf.2025.103163
 * Dataset: ~2.13bn Binance ticks, Apr 2020 – Dec 2022, aggregated to 8-hour blocks.
 *
 * Key findings:
 *  - VPIN Granger-causes BTC price jumps with 2 lags (~16h lead time at 8h blocks)
 *  - Positive jumps LOWER VPIN; negative jumps RAISE VPIN
 *  - Shock persistence: ~10 blocks (~3.3 days)
 *
 * IMPORTANT: No absolute threshold is validated. The paper provides no "VPIN > 0.7" rule.
 * Use percentile-relative classification only.
 *
 * Volume classification uses Bulk Volume Classification (BVC) per Easley et al.:
 *   P(buy) = Φ( (close - open) / σ_price )
 * where Φ is the standard normal CDF.
 */

function normalCDF(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const approx = 1 - poly * Math.exp(-x * x);
  return x >= 0 ? approx : 1 - approx;
}

class VPIN {
  /**
   * @param {Object} options
   * @param {number} options.numBuckets  - Standard 50 (Easley et al.)
   * @param {number} options.windowBuckets - Rolling window of completed buckets for VPIN calculation
   * @param {number} options.priceStdDevBars - Bars for rolling price std dev estimation (BVC)
   */
  constructor({ numBuckets = 50, windowBuckets = 50, priceStdDevBars = 50 } = {}) {
    this.numBuckets = numBuckets;
    this.windowBuckets = windowBuckets;
    this.priceStdDevBars = priceStdDevBars;
    this.bucketVolume = null;
    this.currentBucket = { buyVolume: 0, sellVolume: 0, filled: 0 };
    this.completedBuckets = [];
    this.priceHistory = [];
    this.volumeHistory = [];
  }

  /**
   * Feed a completed OHLCV bar. BVC classifies bar volume into buy/sell.
   *
   * @param {Object} bar
   * @param {number} bar.time
   * @param {number} bar.open
   * @param {number} bar.close
   * @param {number} bar.volume
   * @returns {{ vpin: number, level: string, percentile: number|null }}
   */
  addBar(bar) {
    this.priceHistory.push(bar.close - bar.open);
    if (this.priceHistory.length > this.priceStdDevBars) this.priceHistory.shift();

    this.volumeHistory.push(bar.volume);
    if (this.volumeHistory.length > this.priceStdDevBars) this.volumeHistory.shift();

    if (!this.bucketVolume && this.volumeHistory.length >= 5) {
      const avgVol = this.volumeHistory.reduce((a, b) => a + b, 0) / this.volumeHistory.length;
      this.bucketVolume = avgVol * this.numBuckets / 50;
    }

    if (!this.bucketVolume) return this.state;

    const sigma = this._stdDev(this.priceHistory);
    let pBuy = 0.5;
    if (sigma > 0) {
      pBuy = normalCDF((bar.close - bar.open) / sigma);
    }

    const buyVol = bar.volume * pBuy;
    const sellVol = bar.volume * (1 - pBuy);

    this._distributeToBuckets(buyVol, sellVol, bar.volume);
    return this.state;
  }

  _distributeToBuckets(buyVol, sellVol, totalVol) {
    let remaining = totalVol;
    let buyRemaining = buyVol;
    let sellRemaining = sellVol;

    while (remaining > 1e-8) {
      const space = this.bucketVolume - this.currentBucket.filled;

      if (remaining >= space) {
        const frac = space / totalVol;
        this.currentBucket.buyVolume += buyVol * frac;
        this.currentBucket.sellVolume += sellVol * frac;
        this.currentBucket.filled = this.bucketVolume;

        this.completedBuckets.push({ ...this.currentBucket });
        if (this.completedBuckets.length > this.windowBuckets * 3) {
          this.completedBuckets.shift();
        }

        remaining -= space;
        buyRemaining -= buyVol * frac;
        sellRemaining -= sellVol * frac;
        buyVol = buyRemaining;
        sellVol = sellRemaining;
        this.currentBucket = { buyVolume: 0, sellVolume: 0, filled: 0 };
      } else {
        const frac = remaining / totalVol;
        this.currentBucket.buyVolume += buyVol;
        this.currentBucket.sellVolume += sellVol;
        this.currentBucket.filled += remaining;
        remaining = 0;
      }
    }
  }

  _computeVPIN(buckets) {
    if (!buckets.length) return 0;
    const sum = buckets.reduce((acc, b) => {
      const total = b.buyVolume + b.sellVolume;
      return acc + (total > 0 ? Math.abs(b.buyVolume - b.sellVolume) / total : 0);
    }, 0);
    return sum / buckets.length;
  }

  _historicalVPINs() {
    const result = [];
    const all = this.completedBuckets;
    const w = this.windowBuckets;
    for (let i = w; i <= all.length; i++) {
      result.push(this._computeVPIN(all.slice(i - w, i)));
    }
    return result;
  }

  _percentileOf(value, arr) {
    if (!arr.length) return null;
    const rank = arr.filter(v => v <= value).length;
    return rank / arr.length;
  }

  _stdDev(arr) {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
  }

  get state() {
    const buckets = this.completedBuckets.slice(-this.windowBuckets);
    const vpin = this._computeVPIN(buckets);
    const history = this._historicalVPINs();
    const percentile = this._percentileOf(vpin, history);

    let level = 'insufficient_data';
    let interpretation = 'Not enough data (need ≥50 completed volume buckets)';

    if (history.length >= 10) {
      if (percentile >= 0.9) {
        level = 'extreme_high';
        interpretation = 'Extreme toxicity – elevated risk of negative price jump (~16h horizon, Kitvanitphasu et al. 2025)';
      } else if (percentile >= 0.75) {
        level = 'high';
        interpretation = 'Above-average toxicity – monitor for negative jump risk';
      } else if (percentile !== null && percentile <= 0.1) {
        level = 'extreme_low';
        interpretation = 'Very low toxicity – often follows positive price moves (post-jump normalization)';
      } else if (percentile !== null && percentile <= 0.25) {
        level = 'low';
        interpretation = 'Below-average toxicity – benign flow environment';
      } else {
        level = 'normal';
        interpretation = 'Normal order flow toxicity regime';
      }
    }

    return {
      vpin: +vpin.toFixed(4),
      level,
      percentile: percentile !== null ? +(percentile * 100).toFixed(1) : null,
      bucketsCompleted: this.completedBuckets.length,
      interpretation,
    };
  }

  reset() {
    this.currentBucket = { buyVolume: 0, sellVolume: 0, filled: 0 };
    this.completedBuckets = [];
    this.priceHistory = [];
    this.volumeHistory = [];
    this.bucketVolume = null;
  }
}

module.exports = { VPIN };
