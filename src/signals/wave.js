'use strict';

/**
 * Wave Signal – 15 to 45 minute micro-impulse detector
 *
 * Confluence model combining four components:
 *   1. OFI z-score (strongest academic evidence; Cont et al. 2014, R²≈65%)
 *   2. CVD alignment / divergence (Practitioner evidence)
 *   3. Orderbook depth asymmetry (Cont et al.: slope ∝ 1/depth)
 *   4. Volatility regime (compressed → expansion setup)
 *
 * Realistic hit rates: 52–58% (academic evidence for OFI-based signals).
 * Edge is not in hit rate but in R:R ≥ 1.5:1 and cost control.
 * Maker execution preferred: BTC taker cost ~4 bps round-trip; raw OFI alpha ~0.42 bps/30s → netto negative on taker fills.
 *
 * Long setup:  aggressive net buy pressure + thin ask side + CVD rising + vol compressed
 * Short setup: mirror image
 * Reversal wave: CVD divergence + Absorption at HVN/POC + OFI weakening
 */

const DEFAULTS = {
  OFI_ZSCORE_THRESHOLD: 1.5,
  OFI_WEIGHT: 40,
  CVD_WEIGHT: 25,
  DEPTH_WEIGHT: 20,
  VOL_WEIGHT: 15,
  SIGNAL_THRESHOLD: 55,
};

class WaveSignal {
  /**
   * @param {Object} thresholds - Override default scoring weights/thresholds
   */
  constructor(thresholds = {}) {
    this.cfg = { ...DEFAULTS, ...thresholds };
  }

  /**
   * Evaluate a wave signal from current sub-indicator states.
   *
   * @param {Object} inputs
   * @param {Object} inputs.ofi
   *   { zScore: number, signal: string } – from OFI.update()
   * @param {Object} inputs.cvd
   *   { cumDelta: number, divergence: string } – from CVD.state
   * @param {Object} inputs.orderbook
   *   { bidDepthUSD: number, askDepthUSD: number } – USD depth within 0.5% of mid-price
   * @param {Object} inputs.volatility
   *   { regime: string } – from VolatilityRegime.update()
   * @param {number} inputs.priceChange
   *   Recent price change (e.g. 5-min return); used for CVD alignment check
   *
   * @returns {{
   *   signal: string,
   *   triggered: boolean,
   *   longScore: number,
   *   shortScore: number,
   *   netScore: number,
   *   components: Object,
   *   recommendation: string,
   *   caveats: string[]
   * }}
   */
  evaluate({ ofi = {}, cvd = {}, orderbook = null, volatility = {}, priceChange = 0 } = {}) {
    let longScore = 0;
    let shortScore = 0;
    const components = {};

    // 1. OFI – primary predictor
    const ofiZ = ofi.zScore ?? 0;
    if (Math.abs(ofiZ) >= this.cfg.OFI_ZSCORE_THRESHOLD) {
      const pts = Math.min(this.cfg.OFI_WEIGHT, (Math.abs(ofiZ) / 3) * this.cfg.OFI_WEIGHT);
      if (ofiZ > 0) longScore += pts; else shortScore += pts;
      components.ofi = { pts: +pts.toFixed(1), direction: ofiZ > 0 ? 'long' : 'short', zScore: +ofiZ.toFixed(2) };
    } else {
      components.ofi = { pts: 0, note: `|z| ${Math.abs(ofiZ).toFixed(2)} < threshold ${this.cfg.OFI_ZSCORE_THRESHOLD}` };
    }

    // 2. CVD – divergence overrides trend alignment
    const cvdDelta = cvd.cumDelta ?? 0;
    const cvdDiv = cvd.divergence ?? 'none';

    if (cvdDiv !== 'none') {
      const pts = this.cfg.CVD_WEIGHT * 0.8;
      if (cvdDiv === 'bearish_divergence') shortScore += pts; else longScore += pts;
      components.cvd = { pts: +pts.toFixed(1), direction: cvdDiv === 'bearish_divergence' ? 'short' : 'long', note: cvdDiv };
    } else if (priceChange !== 0) {
      const aligned = (priceChange > 0 && cvdDelta > 0) || (priceChange < 0 && cvdDelta < 0);
      if (aligned) {
        const pts = this.cfg.CVD_WEIGHT * 0.6;
        if (priceChange > 0) longScore += pts; else shortScore += pts;
        components.cvd = { pts: +pts.toFixed(1), direction: priceChange > 0 ? 'long' : 'short', note: 'aligned with price' };
      } else {
        components.cvd = { pts: 0, note: 'diverging from price (subtle warning)' };
      }
    } else {
      components.cvd = { pts: 0, note: 'no price change reference' };
    }

    // 3. Orderbook depth asymmetry (within 0.5% of mid)
    if (orderbook && orderbook.bidDepthUSD != null && orderbook.askDepthUSD != null) {
      const { bidDepthUSD, askDepthUSD } = orderbook;
      const ratio = askDepthUSD > 0 ? bidDepthUSD / askDepthUSD : 1;

      if (ratio > 1.5) {
        // Bid > Ask depth → ask side thin → long momentum easier (Cont: slope ∝ 1/depth)
        const pts = Math.min(this.cfg.DEPTH_WEIGHT, (ratio / 3) * this.cfg.DEPTH_WEIGHT);
        longScore += pts;
        components.depth = { pts: +pts.toFixed(1), direction: 'long', ratio: +ratio.toFixed(2), note: 'ask side thin – upside friction reduced' };
      } else if (ratio < 0.67) {
        const pts = Math.min(this.cfg.DEPTH_WEIGHT, ((1 / ratio) / 3) * this.cfg.DEPTH_WEIGHT);
        shortScore += pts;
        components.depth = { pts: +pts.toFixed(1), direction: 'short', ratio: +ratio.toFixed(2), note: 'bid side thin – downside friction reduced' };
      } else {
        components.depth = { pts: 0, note: `balanced book (ratio ${ratio.toFixed(2)})` };
      }
    } else {
      components.depth = { pts: 0, note: 'no orderbook depth data' };
    }

    // 4. Volatility regime – compressed adds to dominant direction
    const volRegime = volatility.regime ?? 'normal';
    if (volRegime === 'compressed') {
      const pts = this.cfg.VOL_WEIGHT;
      if (longScore >= shortScore) longScore += pts; else shortScore += pts;
      components.volatility = { pts, note: 'compressed – breakout setup, direction from flow' };
    } else {
      components.volatility = { pts: 0, note: volRegime === 'expanded' ? 'expanded – potentially late stage' : 'normal' };
    }

    // Determine signal
    const dominated = longScore > shortScore ? 'long' : shortScore > longScore ? 'short' : 'neutral';
    const domScore = Math.max(longScore, shortScore);
    const triggered = domScore >= this.cfg.SIGNAL_THRESHOLD;

    return {
      signal: triggered ? dominated : 'neutral',
      triggered,
      longScore: +longScore.toFixed(1),
      shortScore: +shortScore.toFixed(1),
      netScore: +(longScore - shortScore).toFixed(1),
      components,
      recommendation: this._recommend(triggered, dominated, domScore, components),
      caveats: [
        'Expected hit rate 52-58%; live edge requires R:R ≥ 1.5:1 and Maker fills',
        'Verify OFI via multi-level (5+ levels) – top-of-book alone is spoofing-prone',
        'Stop at last micro-swing; TP at next LVN/HVN from Volume Profile',
      ],
    };
  }

  _recommend(triggered, direction, score, components) {
    if (!triggered) {
      return `No wave signal – score ${score.toFixed(0)}/100 below threshold (${this.cfg.SIGNAL_THRESHOLD}). Wait for stronger OFI z-score or thinner opposing book side.`;
    }
    const confluenceStr = Object.entries(components)
      .filter(([, v]) => v.pts > 0)
      .map(([k, v]) => `${k.toUpperCase()}(${v.pts.toFixed(0)}pts)`)
      .join(' + ');
    return `${direction.toUpperCase()} wave signal – score ${score.toFixed(0)}/100. Confluence: ${confluenceStr}. Use Maker entry, stop at micro-swing, target LVN/HVN. R:R ≥ 1.5:1.`;
  }
}

module.exports = { WaveSignal, WAVE_DEFAULTS: DEFAULTS };
