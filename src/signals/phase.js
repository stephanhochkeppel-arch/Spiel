'use strict';

/**
 * Phase Signal – 30 minute to 6 hour trend / reversal classifier
 *
 * Two setup families:
 *
 * A) TREND CONFIRMATION (R:R target ≥ 1.5:1, trailing stop)
 *    Long: OI↑+Price↑ (LONG_BUILD) + CVD↑ + Funding not extreme positive
 *    Short: OI↑+Price↓ (SHORT_BUILD) + CVD↓ + Funding not extreme negative
 *
 * B) REVERSAL / SQUEEZE (R:R target ≥ 3:1 – rare but historically large moves)
 *    Long reversal (short squeeze):
 *      - Persistent extreme negative funding (~50-day precedent, Nov 2022)
 *      - OI regime shifting (SHORT_COVER or LONG_EXIT)
 *      - Short liquidation cascade exhausting (forced buying cascading upward)
 *      - CVD bullish divergence
 *    Short reversal (long squeeze):
 *      - Persistent extreme positive funding
 *      - Long liquidation cascade (OKX Oct 2025: ~87% long-side, $16.7bn in 40 min)
 *      - CVD bearish divergence
 *
 * Documented historical prototypes:
 *   Long reversal: Nov 2022 (FTX, $15,500 bottom, ~50 days negative funding → $23k)
 *   Short reversal: Oct 2025 (Tariff cascade, $122k → $105k → V-bounce $113k in 48h)
 *
 * Seasonality overlay: Monday Asia Open Effect and EU/US overlap boost confidence.
 */

const PHASE_TYPES = Object.freeze({
  TREND_LONG: 'trend_long',
  TREND_SHORT: 'trend_short',
  REVERSAL_LONG: 'reversal_long',
  REVERSAL_SHORT: 'reversal_short',
  NEUTRAL: 'neutral',
});

const CONFIDENCE_THRESHOLD = 40;

class PhaseSignal {
  /**
   * @param {Object} inputs
   * @param {string} inputs.oiRegime
   *   Output of OIRegime.update().regime
   * @param {Object} inputs.funding
   *   Output of FundingExtreme.update(): { signal, isExtreme, isPersistent, consecutiveExtreme, contrarian }
   * @param {Object} inputs.cvd
   *   { cumDelta: number, divergence: string }
   * @param {number} inputs.priceChange
   *   Price change over the phase period (30m–6h return)
   * @param {Object} [inputs.liquidation]
   *   Optional live liquidation data: { longLiqUSD: number, shortLiqUSD: number, isSpike: boolean }
   * @param {Object} [inputs.seasonality]
   *   Output of IntradaySeasonality.analyze()
   *
   * @returns {{
   *   phase: string,
   *   confidence: number,
   *   allScores: Object,
   *   isReversal: boolean,
   *   targetRR: number|null,
   *   recommendation: string,
   *   squeezeWarning: string|null
   * }}
   */
  evaluate({ oiRegime = 'neutral', funding = {}, cvd = {}, priceChange = 0, liquidation = null, seasonality = null } = {}) {
    const scores = {
      trendLong: this._scoreTrendLong({ oiRegime, funding, cvd, priceChange }),
      trendShort: this._scoreTrendShort({ oiRegime, funding, cvd, priceChange }),
      reversalLong: this._scoreReversalLong({ funding, oiRegime, liquidation, cvd }),
      reversalShort: this._scoreReversalShort({ funding, oiRegime, liquidation, cvd }),
    };

    const phaseMap = {
      trendLong: PHASE_TYPES.TREND_LONG,
      trendShort: PHASE_TYPES.TREND_SHORT,
      reversalLong: PHASE_TYPES.REVERSAL_LONG,
      reversalShort: PHASE_TYPES.REVERSAL_SHORT,
    };

    const [bestKey, bestScore] = Object.entries(scores).reduce((a, b) => b[1] > a[1] ? b : a);
    const phase = bestScore >= CONFIDENCE_THRESHOLD ? phaseMap[bestKey] : PHASE_TYPES.NEUTRAL;

    let confidence = bestScore;
    if (seasonality?.mondayAsiaEffect?.active) confidence += 10;
    if (seasonality?.session === 'eu_us_overlap') confidence += 5;
    confidence = Math.min(100, confidence);

    const isReversal = phase === PHASE_TYPES.REVERSAL_LONG || phase === PHASE_TYPES.REVERSAL_SHORT;

    return {
      phase,
      confidence,
      allScores: scores,
      isReversal,
      targetRR: isReversal ? 3.0 : (phase !== PHASE_TYPES.NEUTRAL ? 1.5 : null),
      recommendation: this._recommend(phase, confidence),
      squeezeWarning: this._squeezeWarning(funding),
    };
  }

  _scoreTrendLong({ oiRegime, funding, cvd, priceChange }) {
    let s = 0;
    if (oiRegime === 'long_build') s += 40;
    else if (oiRegime === 'short_cover') s += 15;

    if ((cvd.cumDelta ?? 0) > 0 && priceChange > 0) s += 25;

    const fSig = funding.signal ?? 'neutral';
    if (fSig === 'extreme_positive' && funding.isPersistent) s -= 30;
    else if (fSig === 'neutral' || fSig === 'depressed' || fSig === 'extreme_negative') s += 15;

    return Math.max(0, s);
  }

  _scoreTrendShort({ oiRegime, funding, cvd, priceChange }) {
    let s = 0;
    if (oiRegime === 'short_build') s += 40;
    else if (oiRegime === 'long_exit') s += 15;

    if ((cvd.cumDelta ?? 0) < 0 && priceChange < 0) s += 25;

    const fSig = funding.signal ?? 'neutral';
    if (fSig === 'extreme_negative' && funding.isPersistent) s -= 30;
    else if (fSig === 'neutral' || fSig === 'elevated' || fSig === 'extreme_positive') s += 15;

    return Math.max(0, s);
  }

  _scoreReversalLong({ funding, oiRegime, liquidation, cvd }) {
    let s = 0;

    if (funding.isPersistent && funding.signal === 'extreme_negative') s += 45;
    else if (funding.isExtreme && funding.signal === 'extreme_negative') s += 20;

    if (oiRegime === 'short_cover') s += 25;
    else if (oiRegime === 'long_exit') s += 8;

    if (liquidation?.shortLiqUSD > 0) {
      // Short liquidations = forced buying events; use log-scale scoring
      s += Math.min(20, Math.log10(Math.max(1, liquidation.shortLiqUSD / 1e6)) * 8);
    }

    if ((cvd.divergence ?? 'none') === 'bullish_divergence') s += 15;

    return Math.max(0, s);
  }

  _scoreReversalShort({ funding, oiRegime, liquidation, cvd }) {
    let s = 0;

    if (funding.isPersistent && funding.signal === 'extreme_positive') s += 45;
    else if (funding.isExtreme && funding.signal === 'extreme_positive') s += 20;

    if (oiRegime === 'long_exit') s += 25;
    else if (oiRegime === 'short_build') s += 8;

    if (liquidation?.longLiqUSD > 0) {
      s += Math.min(20, Math.log10(Math.max(1, liquidation.longLiqUSD / 1e6)) * 8);
    }

    if ((cvd.divergence ?? 'none') === 'bearish_divergence') s += 15;

    return Math.max(0, s);
  }

  _recommend(phase, confidence) {
    const conf = confidence.toFixed(0);
    switch (phase) {
      case PHASE_TYPES.TREND_LONG:
        return `TREND LONG (confidence ${conf}/100) – OI building with price. Trail stop. Hold while OI↑+Price↑ and funding < 90th pct. Target R:R ≥ 1.5:1.`;
      case PHASE_TYPES.TREND_SHORT:
        return `TREND SHORT (confidence ${conf}/100) – shorts building, CVD confirming. Target R:R ≥ 1.5:1.`;
      case PHASE_TYPES.REVERSAL_LONG:
        return `REVERSAL LONG / SHORT SQUEEZE (confidence ${conf}/100) – crowded shorts + cascade exhausting. Wait for price RECLAIM of key support before entry. Target R:R ≥ 3:1. High asymmetry but low frequency.`;
      case PHASE_TYPES.REVERSAL_SHORT:
        return `REVERSAL SHORT / LONG SQUEEZE (confidence ${conf}/100) – crowded longs + cascade triggering. Wait for distribution confirmation + cascade spike. Target R:R ≥ 3:1.`;
      default:
        return `No phase signal (threshold ${CONFIDENCE_THRESHOLD}) – highest score insufficient. Wait for OI regime confirmation or funding extreme to persist.`;
    }
  }

  _squeezeWarning(funding) {
    if ((funding.consecutiveExtreme ?? 0) >= 10) {
      return `SQUEEZE ALERT: Funding extreme for ${funding.consecutiveExtreme} consecutive periods. Historical precedent: Nov 2022 (~50 periods negative → violent reversal), Oct 2025 (extreme positive → $19bn cascade).`;
    }
    return null;
  }
}

module.exports = { PhaseSignal, PHASE_TYPES };
