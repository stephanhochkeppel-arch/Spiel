'use strict';

/**
 * BTC Microstructure Signal Simulator
 * Generates realistic (but synthetic) indicator states using Ornstein-Uhlenbeck
 * processes for each signal dimension. Macro regime transitions drive correlated
 * dynamics across OFI, CVD, depth, OI, and funding — matching the documented
 * inter-dependencies from the research framework.
 *
 * This is a SIMULATION for demonstration and development. Replace with live
 * exchange feeds (Binance/Bybit L2 + Coinglass) for production use.
 */

const { WaveSignal } = require('../src/signals/wave');
const { PhaseSignal } = require('../src/signals/phase');
const { IntradaySeasonality } = require('../src/indicators/seasonality');

// Box-Muller for standard normal samples
function randn() {
  const u = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─── Persistent simulation state (module singleton) ───────────────────────────
// Randomised at startup so the dashboard shows live dynamics immediately.
const _startRegime = Math.random() < 0.40 ? 'bull' : Math.random() < 0.55 ? 'bear' : 'ranging';
const _startOfi    = (_startRegime === 'bull' ? 0.8 : _startRegime === 'bear' ? -0.8 : 0)
                   + (Math.random() - 0.5) * 1.2;
const _startOiOpts = {
  bull:    ['long_build', 'long_build', 'short_cover'],
  bear:    ['short_build', 'short_build', 'long_exit'],
  ranging: ['neutral', 'long_build', 'short_build'],
};
const _startOi = _startOiOpts[_startRegime][Math.floor(Math.random() * 3)];

const s = {
  lastTick:     Date.now() - 60_000,  // pretend 60s already elapsed for first tick
  regime:       _startRegime,
  regimeTTL:    60 + Math.random() * 350,
  ofiZ:         clamp(_startOfi, -3.8, 3.8),
  cvdDelta:     _startOfi * 300 + (Math.random() - 0.5) * 200,
  depthRatio:   Math.exp(_startOfi * 0.35) * (0.85 + Math.random() * 0.3),
  volatility:   Math.random() < 0.28 ? 'compressed' : 'normal',
  volTTL:       60 + Math.random() * 350,
  oiRegime:     _startOi,
  funding:      (_startRegime === 'bull' ? 0.00035 : _startRegime === 'bear' ? -0.00010 : 0.0001)
              + (Math.random() - 0.5) * 0.0002,
  fundingConsec: 0,
  priceChange:  _startOfi * 0.002 + (Math.random() - 0.5) * 0.002,
};

const REGIME_BIAS = { bull: 1.3, bear: -1.3, ranging: 0 };

function tick() {
  const now = Date.now();
  const dt = clamp((now - s.lastTick) / 1000, 0, 30);
  s.lastTick = now;
  if (dt < 0.001) return buildSnapshot();

  // 1. Macro regime (Markov transitions)
  s.regimeTTL -= dt;
  if (s.regimeTTL <= 0) {
    const r = Math.random();
    s.regime = {
      ranging: r < 0.38 ? 'bull' : r < 0.68 ? 'bear' : 'ranging',
      bull:    r < 0.52 ? 'ranging' : r < 0.72 ? 'bear' : 'bull',
      bear:    r < 0.52 ? 'ranging' : r < 0.72 ? 'bull' : 'bear',
    }[s.regime];
    s.regimeTTL = 150 + Math.random() * 550;
  }

  const bias = REGIME_BIAS[s.regime];
  const sqdt = Math.sqrt(dt);

  // 2. OFI z-score – OU toward regime bias, σ=0.45
  s.ofiZ += 0.15 * (bias - s.ofiZ) * dt + 0.45 * randn() * sqdt;
  s.ofiZ = clamp(s.ofiZ, -3.8, 3.8);

  // 3. CVD – integrates OFI with slow mean-reversion
  s.cvdDelta += s.ofiZ * 100 * dt + 50 * randn() * sqdt;
  s.cvdDelta *= Math.pow(0.982, dt);

  // 4. Orderbook depth ratio – correlated with OFI (aggressive buyers thin ask side)
  const dTarget = Math.exp(s.ofiZ * 0.35);
  s.depthRatio += 0.2 * (dTarget - s.depthRatio) * dt + 0.05 * randn() * sqdt;
  s.depthRatio = clamp(s.depthRatio, 0.25, 4.2);

  // 5. Volatility regime – compressed → expanded → normal cycle
  s.volTTL -= dt;
  if (s.volTTL <= 0) {
    s.volatility = s.volatility === 'compressed' ? 'expanded'
      : s.volatility === 'expanded' ? 'normal'
      : (Math.random() < 0.32 ? 'compressed' : 'normal');
    s.volTTL = 90 + Math.random() * 480;
  }

  // 6. OI regime – follows macro, updates stochastically (~4% chance per second)
  if (Math.random() < clamp(0.04 * dt, 0, 0.25)) {
    const pools = {
      bull:    ['long_build', 'long_build', 'long_build', 'short_cover'],
      bear:    ['short_build', 'short_build', 'short_build', 'long_exit'],
      ranging: ['neutral', 'long_build', 'short_build', 'neutral', 'long_exit'],
    };
    const p = pools[s.regime];
    s.oiRegime = p[Math.floor(Math.random() * p.length)];
  }

  // 7. Funding rate – very slow OU (8h analog), occasional extremes
  const fTarget = { bull: 0.00065, bear: -0.00020, ranging: 0.00010 }[s.regime];
  s.funding += 0.008 * (fTarget - s.funding) * dt + 0.000035 * randn() * sqdt;
  s.funding = clamp(s.funding, -0.0015, 0.002);
  const fundPct = clamp(50 + (s.funding - 0.00025) / 0.0004 * 40, 0, 100);

  let fundSignal = 'neutral';
  let fundExtreme = false;
  if (fundPct >= 90) { fundSignal = 'extreme_positive'; fundExtreme = true; s.fundingConsec++; }
  else if (fundPct <= 10) { fundSignal = 'extreme_negative'; fundExtreme = true; s.fundingConsec++; }
  else {
    s.fundingConsec = 0;
    if (fundPct >= 72) fundSignal = 'elevated';
    else if (fundPct <= 28) fundSignal = 'depressed';
  }
  const fundPersistent = s.fundingConsec >= 3;

  // 8. Price change (short-term, driven by OFI with noise)
  s.priceChange += s.ofiZ * 0.0003 * dt + 0.0008 * randn() * sqdt;
  s.priceChange *= Math.pow(0.988, dt);
  s.priceChange = clamp(s.priceChange, -0.05, 0.05);

  return buildSnapshot(fundPct, fundSignal, fundExtreme, fundPersistent);
}

function buildSnapshot(fundPct = 50, fundSignal = 'neutral', fundExtreme = false, fundPersistent = false) {
  return {
    ofi:      { zScore: s.ofiZ, signal: s.ofiZ > 1.5 ? 'long' : s.ofiZ < -1.5 ? 'short' : 'neutral' },
    cvd:      { cumDelta: s.cvdDelta, divergence: 'none' },
    orderbook: { bidDepthUSD: 2_000_000 * s.depthRatio, askDepthUSD: 2_000_000 },
    volatility: { regime: s.volatility },
    priceChange: s.priceChange,
    oiRegime:  s.oiRegime,
    funding:   { signal: fundSignal, isExtreme: fundExtreme, isPersistent: fundPersistent, consecutiveExtreme: s.fundingConsec },
    meta:      { regime: s.regime, regimeTTL: Math.round(s.regimeTTL), fundPct: Math.round(fundPct) },
  };
}

// ─── Signal evaluators (reused across requests) ───────────────────────────────
const waveEval   = new WaveSignal();
const phaseEval  = new PhaseSignal();
const seasonCalc = new IntradaySeasonality();

function scoreLabel(score, active) {
  if (!active || score < 55) return 'WARTEN';
  if (score >= 83) return 'GOLDGRUBE';
  if (score >= 68) return 'STARK';
  return 'AKTIV';
}

function getLiveState() {
  const ind    = tick();
  const season = seasonCalc.analyze(Date.now());

  const wave = waveEval.evaluate({
    ofi:         ind.ofi,
    cvd:         ind.cvd,
    orderbook:   ind.orderbook,
    volatility:  ind.volatility,
    priceChange: ind.priceChange,
  });

  const phase = phaseEval.evaluate({
    oiRegime:  ind.oiRegime,
    funding:   ind.funding,
    cvd:       ind.cvd,
    priceChange: ind.priceChange,
    seasonality: season,
  });

  const waveScore = Math.round(Math.max(wave.longScore, wave.shortScore));
  const waveDir   = wave.triggered ? wave.signal : 'neutral';

  const phaseScore = Math.round(phase.confidence);
  const phaseDir   = phase.phase === 'neutral' ? 'neutral'
    : phase.phase.includes('long') ? 'long' : 'short';

  return {
    wave: {
      score:         waveScore,
      direction:     waveDir,
      label:         scoreLabel(waveScore, wave.triggered),
      targetRR:      wave.triggered ? 1.5 : null,
      recommendation: wave.recommendation,
    },
    phase: {
      score:         phaseScore,
      direction:     phaseDir,
      label:         scoreLabel(phaseScore, phase.phase !== 'neutral'),
      type:          phase.phase,
      isReversal:    phase.isReversal,
      targetRR:      phase.targetRR,
      squeezeWarning: phase.squeezeWarning,
      recommendation: phase.recommendation,
    },
    indicators: {
      ofiZ:          +s.ofiZ.toFixed(2),
      cvdTrend:      s.cvdDelta > 0 ? '▲' : '▼',
      volatility:    ind.volatility.regime,
      oiRegime:      ind.oiRegime,
      fundingSignal: ind.funding.signal,
      session:       season.session,
      activityScore: season.activityScore,
    },
    meta:      ind.meta,
    timestamp: Date.now(),
  };
}

module.exports = { getLiveState };
