'use strict';

/**
 * Open Interest + Price Regime Classifier
 * Implements the standard futures microstructure interpretation (CME / industry).
 *
 * Regimes:
 *   LONG_BUILD  – OI↑ + Price↑: new longs entering, trend confirmation (strongest signal)
 *   SHORT_BUILD – OI↑ + Price↓: new shorts entering, downtrend or fragility accumulating
 *   SHORT_COVER – OI↓ + Price↑: short covering rally (weaker, watch for exhaustion)
 *   LONG_EXIT   – OI↓ + Price↓: long liquidation / potential capitulation
 *   NEUTRAL     – no clear directional change
 *
 * Documented BTC context:
 *   Oct 2025 event: BTC Perp OI peaked ~$217bn, collapsed ~43% to $123bn in cascade.
 *   Short Build → persistent → eventual squeeze is well-documented (Nov 2022 FTX bottom).
 *   "Faustregel, kein Gesetz" – no clean public OOS win-rates on minute/hour level.
 */

const REGIMES = Object.freeze({
  LONG_BUILD: 'long_build',
  SHORT_BUILD: 'short_build',
  SHORT_COVER: 'short_cover',
  LONG_EXIT: 'long_exit',
  NEUTRAL: 'neutral',
});

class OIRegime {
  /**
   * @param {Object} options
   * @param {number} options.smoothingPeriod - Bars to look back for change calculation
   * @param {number} options.threshold - Minimum fractional change (e.g. 0.001 = 0.1%) to count as directional
   * @param {number} options.fragilityWindow - Bars of SHORT_BUILD to start flagging squeeze risk
   */
  constructor({ smoothingPeriod = 3, threshold = 0.001, fragilityWindow = 6 } = {}) {
    this.smoothingPeriod = smoothingPeriod;
    this.threshold = threshold;
    this.fragilityWindow = fragilityWindow;
    this.history = [];
    this.regimeHistory = [];
    this.maxHistory = 500;
  }

  /**
   * @param {Object} data
   * @param {number} data.time
   * @param {number} data.price
   * @param {number} data.openInterest
   * @returns {{ regime, oiChangePct, priceChangePct, fragility, interpretation }}
   */
  update(data) {
    this.history.push(data);
    if (this.history.length > this.maxHistory) this.history.shift();

    if (this.history.length <= this.smoothingPeriod) {
      const result = { regime: REGIMES.NEUTRAL, oiChangePct: 0, priceChangePct: 0, fragility: null, interpretation: 'Insufficient history' };
      this.regimeHistory.push(REGIMES.NEUTRAL);
      return result;
    }

    const curr = this.history[this.history.length - 1];
    const ref = this.history[this.history.length - 1 - this.smoothingPeriod];

    const oiChange = (curr.openInterest - ref.openInterest) / ref.openInterest;
    const priceChange = (curr.price - ref.price) / ref.price;

    const oiDir = oiChange > this.threshold ? 1 : oiChange < -this.threshold ? -1 : 0;
    const priceDir = priceChange > this.threshold ? 1 : priceChange < -this.threshold ? -1 : 0;

    let regime;
    if (oiDir === 1 && priceDir === 1) regime = REGIMES.LONG_BUILD;
    else if (oiDir === 1 && priceDir === -1) regime = REGIMES.SHORT_BUILD;
    else if (oiDir === -1 && priceDir === 1) regime = REGIMES.SHORT_COVER;
    else if (oiDir === -1 && priceDir === -1) regime = REGIMES.LONG_EXIT;
    else regime = REGIMES.NEUTRAL;

    this.regimeHistory.push(regime);
    if (this.regimeHistory.length > this.maxHistory) this.regimeHistory.shift();

    const fragility = this._assessFragility(regime);

    return {
      regime,
      oiChangePct: +(oiChange * 100).toFixed(3),
      priceChangePct: +(priceChange * 100).toFixed(3),
      fragility,
      interpretation: this._interpret(regime, fragility),
    };
  }

  _assessFragility(currentRegime) {
    const recent = this.regimeHistory.slice(-this.fragilityWindow);

    const shortBuildCount = recent.filter(r => r === REGIMES.SHORT_BUILD).length;
    const longBuildCount = recent.filter(r => r === REGIMES.LONG_BUILD).length;

    if (currentRegime === REGIMES.SHORT_BUILD && shortBuildCount >= Math.floor(this.fragilityWindow * 0.6)) {
      return { type: 'squeeze_risk', severity: shortBuildCount / this.fragilityWindow, note: `${shortBuildCount}/${this.fragilityWindow} recent bars SHORT_BUILD – squeeze fragility accumulating` };
    }
    if (currentRegime === REGIMES.LONG_BUILD && longBuildCount >= Math.floor(this.fragilityWindow * 0.6)) {
      return { type: 'liquidation_risk', severity: longBuildCount / this.fragilityWindow, note: `${longBuildCount}/${this.fragilityWindow} recent bars LONG_BUILD – long liquidation risk if reversal triggers` };
    }
    return null;
  }

  _interpret(regime, fragility) {
    const base = {
      [REGIMES.LONG_BUILD]: 'New longs entering – trend confirmation, follow momentum with trailing stop',
      [REGIMES.SHORT_BUILD]: 'New shorts entering – downtrend or fragility building (potential squeeze setup accumulating)',
      [REGIMES.SHORT_COVER]: 'Short covering rally – less robust than new-long driven move, watch for exhaustion',
      [REGIMES.LONG_EXIT]: 'Long liquidation/exit – potential capitulation or distribution',
      [REGIMES.NEUTRAL]: 'No clear OI/price directional signal',
    }[regime];

    return fragility ? `${base}. WARNING: ${fragility.note}` : base;
  }

  get currentRegime() {
    return this.regimeHistory[this.regimeHistory.length - 1] ?? REGIMES.NEUTRAL;
  }

  reset() {
    this.history = [];
    this.regimeHistory = [];
  }
}

module.exports = { OIRegime, REGIMES };
