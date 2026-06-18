'use strict';

/**
 * BTC Intraday Seasonality Analyzer
 *
 * Evidence sources:
 * 1. Kitvanitphasu et al. (2025, RIBAF 81:103163):
 *    - Monday effect: highest VPIN/toxicity (baseline = Sunday)
 *    - Saturday effect: lowest toxicity
 *    - Toxicity concentrated 08:00–24:00 UTC (EU+US blocks)
 *
 * 2. Zarattini, Pagani & Barbon (Concretum Group / Univ. St. Gallen, 2018–2025):
 *    "Monday Asia Open Effect" starting Sunday ~19:00 ET (≈ Monday 00:00 UTC)
 *    Gross Sharpe ~1.6 for trend strategies during this window vs ~0.8 long-only benchmark.
 *
 * 3. Multiple intraday studies: volatility peak ~12:00 EST (17:00 UTC) = EU/US overlap.
 *
 * Funding settlements (Binance/Bybit/OKX perpetuals): 00:00, 08:00, 16:00 UTC.
 * Near settlement, funding pressure resolves → positioning shifts possible.
 */

const SESSIONS = Object.freeze({
  ASIA: 'asia',
  EUROPE: 'europe',
  US: 'us',
  EU_US_OVERLAP: 'eu_us_overlap',
  LATE_US: 'late_us',
  DEAD_ZONE: 'dead_zone',
});

const FUNDING_HOURS_UTC = [0, 8, 16];

class IntradaySeasonality {
  /**
   * Analyze timing quality for BTC trading.
   *
   * @param {Date|number} timestamp - JS Date or Unix ms
   * @returns {{ utcHour, dayOfWeek, dayName, session, dayBias, fundingProximity, mondayAsiaEffect, activityScore, recommendation }}
   */
  analyze(timestamp) {
    const d = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const utcHour = d.getUTCHours();
    const utcMin = d.getUTCMinutes();
    const dow = d.getUTCDay();
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow];

    const session = this._classifySession(utcHour);
    const dayBias = this._dayBias(dow);
    const fundingProximity = this._fundingProximity(utcHour, utcMin);
    const mondayAsiaEffect = this._mondayAsiaEffect(dow, utcHour);
    const activityScore = this._activityScore(session, dayBias, mondayAsiaEffect);

    return {
      utcHour,
      utcMinute: utcMin,
      dayOfWeek: dow,
      dayName,
      session,
      dayBias,
      fundingProximity,
      mondayAsiaEffect,
      activityScore,
      recommendation: this._recommend(session, dayBias, mondayAsiaEffect, activityScore),
    };
  }

  _classifySession(h) {
    if (h >= 13 && h < 17) return SESSIONS.EU_US_OVERLAP;  // Peak volatility window ~12-16 EST = 17-21 UTC; 13-17 UTC as tight overlap
    if (h >= 7 && h < 13) return SESSIONS.EUROPE;
    if (h >= 17 && h < 22) return SESSIONS.US;
    if (h >= 0 && h < 7) return SESSIONS.ASIA;
    return SESSIONS.DEAD_ZONE;
  }

  _dayBias(dow) {
    const biases = {
      0: { label: 'baseline', volatility: 'normal', toxicity: 'normal', note: 'Sunday baseline; Monday Asia Open effect begins ~00:00 UTC' },
      1: { label: 'elevated', volatility: 'elevated', toxicity: 'elevated', note: 'Highest historical VPIN/toxicity (Kitvanitphasu et al. 2025); Monday Asia Open trend effect' },
      2: { label: 'normal', volatility: 'normal', toxicity: 'normal', note: '' },
      3: { label: 'normal', volatility: 'normal', toxicity: 'normal', note: '' },
      4: { label: 'normal', volatility: 'normal', toxicity: 'normal', note: '' },
      5: { label: 'normal', volatility: 'normal', toxicity: 'normal', note: '' },
      6: { label: 'reduced', volatility: 'reduced', toxicity: 'reduced', note: 'Saturday: historically lowest toxicity/volatility (Kitvanitphasu et al. 2025)' },
    };
    return biases[dow];
  }

  _fundingProximity(h, m) {
    const minutesNow = h * 60 + m;
    const settlements = FUNDING_HOURS_UTC.map(sh => {
      const sm = sh * 60;
      let diff = (sm - minutesNow + 1440) % 1440;
      return { hourUTC: sh, minutesUntil: diff };
    }).sort((a, b) => a.minutesUntil - b.minutesUntil);

    const next = settlements[0];
    const isNear = next.minutesUntil <= 30;

    return {
      nextSettlementUTC: next.hourUTC,
      minutesUntil: next.minutesUntil,
      isNear,
      note: isNear
        ? `Funding settlement in ${next.minutesUntil}m (${next.hourUTC}:00 UTC) – funding pressure resolving, watch for positioning shifts`
        : null,
    };
  }

  _mondayAsiaEffect(dow, h) {
    // Zarattini et al.: effect starts Sunday ~19:00 ET = Monday 00:00 UTC, runs through Monday Asia session
    const active = (dow === 1 && h < 8) || (dow === 0 && h >= 0);
    return {
      active,
      note: active
        ? 'Monday Asia Open Effect active – historically elevated trend probability (Zarattini et al., gross Sharpe ~1.6 for trend strategies)'
        : null,
    };
  }

  _activityScore(session, dayBias, mondayAsiaEffect) {
    let score = 40;
    const sessionBonus = { eu_us_overlap: 35, us: 20, europe: 15, asia: 5, dead_zone: 0, late_us: 10 };
    score += sessionBonus[session] ?? 0;
    if (dayBias.label === 'elevated') score += 15;
    else if (dayBias.label === 'reduced') score -= 20;
    if (mondayAsiaEffect.active) score += 10;
    return Math.min(100, Math.max(0, score));
  }

  _recommend(session, dayBias, mondayAsiaEffect, activityScore) {
    if (mondayAsiaEffect.active) {
      return 'Monday Asia Open Effect window – optimal for trend-following strategies; elevated positive trend probability';
    }
    if (session === SESSIONS.EU_US_OVERLAP) {
      return 'EU/US session overlap – peak volatility and liquidity window; best for breakout and momentum setups';
    }
    if (dayBias.label === 'reduced') {
      return 'Saturday low-activity session – reduce position sizing, avoid breakout strategies, widen stop tolerance';
    }
    if (session === SESSIONS.DEAD_ZONE) {
      return 'Dead zone (22:00–00:00 UTC) – low liquidity, wider spreads, elevated spoofing risk; reduce exposure';
    }
    if (activityScore >= 60) {
      return `Active session (${session.replace('_', '/')} overlap) – standard signal criteria apply, good liquidity`;
    }
    return `Moderate activity (score ${activityScore}/100) – apply standard criteria, prefer maker fills`;
  }
}

module.exports = { IntradaySeasonality, SESSIONS };
