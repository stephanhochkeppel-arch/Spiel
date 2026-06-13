'use strict';

/**
 * Funding Rate Extreme Detector
 *
 * Empirically documented BTC funding extremes at local price turning points:
 *   - Mar 2020 (COVID crash bottom): negative funding preceded bottom
 *   - Mid-2021 (~$30k, China mining ban): negative funding at local bottom
 *   - Nov 2022 (FTX collapse): ~50 days negative funding before short capitulation;
 *     price ripped from ~$15,500 to $23,000 by Jan 2023 (Phemex/Glassnode data)
 *   - Oct 2025 cascade: extreme positive funding pre-crash, $19.13bn liquidated (~87% longs)
 *
 * Key caveat: NO fixed absolute threshold is academically validated.
 * Funding can remain extreme for weeks in strong trends; traders who shorted
 * solely on high funding "got run over" (anecdotal but consistent across sources).
 * This implementation uses adaptive percentile-based thresholds only.
 *
 * Signal requires PERSISTENCE (multiple consecutive extreme readings) to filter
 * single-bar spikes which have low contrarian predictive value.
 *
 * Funding settles every 8 hours: 00:00, 08:00, 16:00 UTC.
 */

class FundingExtreme {
  /**
   * @param {Object} options
   * @param {number} options.lookback - Max funding observations to retain (default 500 ≈ ~166 days at 8h)
   * @param {number} options.extremePct - Top/bottom percentile cutoff (default 0.10 = top/bottom 10%)
   * @param {number} options.persistenceBars - Consecutive extreme bars before emitting contrarian signal
   */
  constructor({ lookback = 500, extremePct = 0.10, persistenceBars = 3 } = {}) {
    this.lookback = lookback;
    this.extremePct = extremePct;
    this.persistenceBars = persistenceBars;
    this.history = [];
    this.consecutiveExtreme = 0;
    this.extremeDirection = null;
  }

  /**
   * @param {Object} data
   * @param {number} data.time - Unix ms
   * @param {number} data.fundingRate - 8-hour funding rate (e.g. 0.0001 = 0.01%)
   * @returns {{ fundingRate, percentile, signal, isExtreme, isPersistent, consecutiveExtreme, contrarian, interpretation }}
   */
  update(data) {
    this.history.push(data.fundingRate);
    if (this.history.length > this.lookback) this.history.shift();

    const percentile = this._percentileRank(data.fundingRate);
    const classification = this._classify(percentile);

    if (classification.isExtreme) {
      this.consecutiveExtreme++;
      this.extremeDirection = classification.direction;
    } else {
      this.consecutiveExtreme = 0;
      this.extremeDirection = null;
    }

    const isPersistent = this.consecutiveExtreme >= this.persistenceBars;

    return {
      fundingRate: data.fundingRate,
      percentile: +(percentile * 100).toFixed(1),
      signal: classification.direction,
      isExtreme: classification.isExtreme,
      isPersistent,
      consecutiveExtreme: this.consecutiveExtreme,
      contrarian: isPersistent ? classification.contrarian : null,
      interpretation: this._interpret(classification, isPersistent),
    };
  }

  _percentileRank(value) {
    if (this.history.length === 0) return 0.5;
    const below = this.history.filter(v => v < value).length;
    return below / this.history.length;
  }

  _classify(percentile) {
    if (percentile >= 1 - this.extremePct) {
      return { direction: 'extreme_positive', isExtreme: true, contrarian: 'short_bias' };
    }
    if (percentile <= this.extremePct) {
      return { direction: 'extreme_negative', isExtreme: true, contrarian: 'long_bias' };
    }
    if (percentile >= 0.75) return { direction: 'elevated', isExtreme: false, contrarian: null };
    if (percentile <= 0.25) return { direction: 'depressed', isExtreme: false, contrarian: null };
    return { direction: 'neutral', isExtreme: false, contrarian: null };
  }

  _interpret(cls, isPersistent) {
    if (cls.direction === 'extreme_positive' && isPersistent) {
      return `PERSISTENT extreme positive funding (${this.consecutiveExtreme} consecutive periods) – crowded longs, contrarian SHORT bias. Requires liquidation trigger before entry. Historical precedent: Oct 2025 cascade (~87% long liquidations).`;
    }
    if (cls.direction === 'extreme_negative' && isPersistent) {
      return `PERSISTENT extreme negative funding (${this.consecutiveExtreme} consecutive periods) – crowded shorts. Contrarian LONG bias forming. Historical precedent: Nov 2022 ~50-day negative funding → rally to $23k.`;
    }
    if (cls.direction === 'extreme_positive') {
      return `Extreme positive funding – longs paying shorts. Not yet persistent enough for reliable contrarian signal (need ${this.persistenceBars} consecutive bars).`;
    }
    if (cls.direction === 'extreme_negative') {
      return `Extreme negative funding – shorts paying longs. Monitor for persistence.`;
    }
    return `Funding in ${cls.direction} range – no contrarian signal active.`;
  }

  get stats() {
    if (this.history.length < 2) return null;
    const sorted = [...this.history].sort((a, b) => a - b);
    return {
      count: this.history.length,
      mean: +(this.history.reduce((a, b) => a + b, 0) / this.history.length).toFixed(6),
      p10: +sorted[Math.floor(sorted.length * 0.1)].toFixed(6),
      p90: +sorted[Math.floor(sorted.length * 0.9)].toFixed(6),
    };
  }

  reset() {
    this.history = [];
    this.consecutiveExtreme = 0;
    this.extremeDirection = null;
  }
}

module.exports = { FundingExtreme };
