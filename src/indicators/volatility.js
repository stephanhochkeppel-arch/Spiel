'use strict';

/**
 * Volatility Regime Detector (ATR-based)
 *
 * Volatility compression → expansion is a robust but DIRECTION-NEUTRAL pattern.
 * The "coiled spring" effect (low ATR percentile predicts high ATR ahead) is well-documented.
 * Direction of the expansion is determined by accompanying flow signals (OFI/CVD),
 * NOT by the compression itself.
 *
 * Regime labels:
 *   compressed – ATR at or below lowPct percentile of recent history (default 25th)
 *   expanded   – ATR at or above highPct percentile (default 75th)
 *   normal     – between the two thresholds
 *
 * Practical note: Breakout strategies during compressed regimes work only when
 * accompanied by OFI/CVD confirmation. Without flow confirmation, breakouts fail
 * at roughly the same rate in both directions.
 */

class VolatilityRegime {
  /**
   * @param {Object} options
   * @param {number} options.atrPeriod - ATR lookback (default 14 bars)
   * @param {number} options.percentilePeriod - Rolling window for percentile classification (default 100)
   * @param {number} options.lowPct - Percentile cutoff for "compressed" (default 25)
   * @param {number} options.highPct - Percentile cutoff for "expanded" (default 75)
   */
  constructor({ atrPeriod = 14, percentilePeriod = 100, lowPct = 25, highPct = 75 } = {}) {
    this.atrPeriod = atrPeriod;
    this.percentilePeriod = percentilePeriod;
    this.lowPct = lowPct;
    this.highPct = highPct;
    this.bars = [];
    this.atrHistory = [];
  }

  /**
   * @param {Object} bar
   * @param {number} bar.time
   * @param {number} bar.high
   * @param {number} bar.low
   * @param {number} bar.close
   * @returns {{ atr, percentile, regime, interpretation }}
   */
  update(bar) {
    this.bars.push(bar);
    const maxRetain = this.atrPeriod + this.percentilePeriod + 10;
    if (this.bars.length > maxRetain) this.bars.shift();

    if (this.bars.length < this.atrPeriod + 1) {
      return { atr: null, percentile: null, regime: 'insufficient_data', interpretation: `Need ${this.atrPeriod + 1} bars` };
    }

    const atr = this._atr();
    this.atrHistory.push(atr);
    if (this.atrHistory.length > this.percentilePeriod) this.atrHistory.shift();

    const percentile = this._percentileRank(atr) * 100;
    const regime = percentile <= this.lowPct ? 'compressed' : percentile >= this.highPct ? 'expanded' : 'normal';

    return {
      atr: +atr.toFixed(6),
      percentile: +percentile.toFixed(1),
      regime,
      interpretation: this._interpret(regime, percentile),
    };
  }

  _atr() {
    const slice = this.bars.slice(-this.atrPeriod - 1);
    let trSum = 0;
    for (let i = 1; i < slice.length; i++) {
      const curr = slice[i];
      const prev = slice[i - 1];
      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close),
      );
      trSum += tr;
    }
    return trSum / this.atrPeriod;
  }

  _percentileRank(value) {
    if (!this.atrHistory.length) return 0.5;
    const below = this.atrHistory.filter(v => v < value).length;
    return below / this.atrHistory.length;
  }

  _interpret(regime, pct) {
    if (regime === 'compressed') {
      return `ATR at ${pct.toFixed(0)}th percentile – volatility COMPRESSED. Expansion likely. Direction TBD by OFI/CVD flow signals. Favorable setup for breakout/wave if flow confirms.`;
    }
    if (regime === 'expanded') {
      return `ATR at ${pct.toFixed(0)}th percentile – volatility EXPANDED. Trend likely in progress; late to enter breakouts. Suitable for momentum following.`;
    }
    return `ATR at ${pct.toFixed(0)}th percentile – normal volatility. Standard signal criteria apply.`;
  }

  reset() {
    this.bars = [];
    this.atrHistory = [];
  }
}

module.exports = { VolatilityRegime };
