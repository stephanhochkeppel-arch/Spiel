const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { WaveSignal } = require('../src/signals/wave');
const { PhaseSignal } = require('../src/signals/phase');
const { IntradaySeasonality } = require('../src/indicators/seasonality');
const { OFI } = require('../src/indicators/ofi');
const { CVD } = require('../src/indicators/cvd');
const { VPIN } = require('../src/indicators/vpin');
const { OIRegime } = require('../src/indicators/oi_regime');
const { FundingExtreme } = require('../src/indicators/funding');
const { VolatilityRegime } = require('../src/indicators/volatility');

const app = express();
const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'sessions.json');
const WEB_DIR = path.join(__dirname, '..', 'app');

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(WEB_DIR));

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const seed = {
      sessions: [
        {
          id: 'session-1',
          title: 'Hermes Hauptagent',
          createdAt: new Date().toISOString(),
          messages: [
            {
              id: 'm-1',
              role: 'assistant',
              content: 'Hallo! Ich bin Hermes Window. Ich kann lokal laufen, auf Android und Windows schön aussehen und später mit einem echten Hermes-Endpoint verbunden werden.'
            }
          ]
        }
      ]
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2), 'utf8');
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeStore(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function createId(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function getSystemStatus() {
  return {
    appName: process.env.APP_NAME || 'Hermes Window',
    mode: process.env.OPENAI_COMPAT_BASE_URL ? 'openai-compatible-proxy' : 'mock',
    openAICompatBaseUrl: process.env.OPENAI_COMPAT_BASE_URL || null,
    model: process.env.OPENAI_COMPAT_MODEL || null,
    platformHints: {
      android: true,
      windows: true,
      wslNeededForNativeHermesOnWindows: true,
      termuxSuggestedForAndroidHermes: true
    },
    capabilities: [
      'chat',
      'sessions',
      'activity-feed',
      'openai-compatible-proxy',
      'android-wrapper-ready',
      'windows-wrapper-ready'
    ]
  };
}

function mockAgentReply(message) {
  const lower = String(message || '').toLowerCase();

  if (lower.includes('ofi') || lower.includes('order flow imbalance')) {
    return 'OFI (Order Flow Imbalance) misst den Netto-Druck aus Bid/Ask-Änderungen im Orderbuch über mehrere Levels. Cont, Kukanov & Stoikov (2014) zeigen R²≈65% für gleichzeitige Mid-Price-Änderungen. Edge ist klein (~0.42 bps/30s für BTC) – Maker-Ausführung erforderlich. Nutze POST /api/indicators/wave für ein konfluenz-basiertes Signal.';
  }
  if (lower.includes('vpin') || lower.includes('toxicity') || lower.includes('toxizität')) {
    return 'VPIN misst Order-Flow-Toxizität über volumen-synchronisierte Buckets. Kitvanitphasu et al. (2025, RIBAF) zeigen Granger-Kausalität zu BTC-Preissprüngen mit ~16h Vorlauf (8h-Block-Aggregation). Kein absoluter Schwellenwert valide – nur Perzentil-relativ nutzen. POST /api/indicators/vpin-batch für Batch-Berechnung.';
  }
  if (lower.includes('cvd') || lower.includes('cumulative volume delta') || lower.includes('volume delta')) {
    return 'CVD zeigt kumulativen Netto-Kaufdruck. Divergenz (Preis neues High, CVD nicht) warnt vor nachlassender Aggression. Am zuverlässigsten auf 15m/1h/4h mit Tick-Daten über mehrere Venues. Kein eigenständiger Prädiktor – immer mit OFI kombinieren.';
  }
  if (lower.includes('funding') || lower.includes('funding rate')) {
    return 'Funding-Extreme (persistently negativ/positiv über mehrere 8h-Perioden) sind dokumentierte Contrarian-Signale an BTC-Tiefs/-Hochs. Nov 2022: ~50 Tage negativer Funding → Rally von $15.5k auf $23k. Kein fixer Schwellenwert – adaptives Perzentil-Modell. POST /api/indicators/funding-state für Status.';
  }
  if (lower.includes('open interest') || lower.includes('oi regime') || lower.includes('oi regim')) {
    return 'OI+Preis-Regime: LONG_BUILD (OI↑+Preis↑, stärkstes Trendsignal), SHORT_BUILD (neue Shorts, Squeeze-Risiko akkumuliert), SHORT_COVER (schwächerer Aufschwung), LONG_EXIT (Liquidation). POST /api/indicators/oi-regime für aktuellen Status.';
  }
  if (lower.includes('wave') || lower.includes('welle') || (lower.includes('15') && lower.includes('min'))) {
    return 'Wave-Signal (15-45 Min): Konfluenz aus OFI-z-Score + Orderbuch-Tiefe-Asymmetrie + CVD-Ausrichtung + Volatilitätskompression. Erwartete Trefferquote ~52-58%. POST /api/indicators/wave mit ofi, cvd, orderbook, volatility Feldern.';
  }
  if (lower.includes('phase') || (lower.includes('trend') && lower.includes('reversal'))) {
    return 'Phase-Signal (30min-6h): TREND_LONG/SHORT (OI-Regime + CVD-Bestätigung), REVERSAL_LONG/SHORT (persistentes Funding-Extrem + Liquidationskaskade erschöpft). POST /api/indicators/phase mit oiRegime, funding, cvd, liquidation Feldern.';
  }
  if (lower.includes('seasonality') || lower.includes('saisonalität') || lower.includes('session') || lower.includes('timing')) {
    return 'BTC-Intraday-Saisonalität: Montag-Asia-Open-Effekt (Zarattini et al., Sharpe ~1.6 für Trend), Vola-Peak 13-17 UTC (EU/US-Overlap), Samstag niedrigste Toxizität. POST /api/indicators/seasonality mit timestamp.';
  }
  if (lower.includes('indicator') || lower.includes('indikator') || lower.includes('btc') || lower.includes('bitcoin') || lower.includes('microstructure') || lower.includes('mikrostruktur')) {
    return 'Verfügbare BTC-Mikrostruktur-Indikatoren:\n• POST /api/indicators/wave – Wave-Signal (15-45 Min, OFI+CVD+Tiefe+Vola)\n• POST /api/indicators/phase – Phase-Signal (30min-6h, OI+Funding+Liquidation)\n• POST /api/indicators/seasonality – Timing-Qualität (Session/Tag/Funding-Settlement)\n• POST /api/indicators/wave-demo – Demo mit Beispieldaten\n• GET /api/indicators – API-Übersicht\n\nEvidenzgrade: OFI (peer-reviewed), VPIN (peer-reviewed), Saisonalität (peer-reviewed), Funding/OI/Liquidation (Quant-Research, kein sauberer OOS-Backtest öffentlich).';
  }
  if (lower.includes('research') || lower.includes('recherche')) {
    return 'Ich würde zuerst eine kurze Strategie festlegen, dann die relevantesten Quellen sammeln und danach eine saubere Zusammenfassung mit klaren nächsten Schritten geben.';
  }
  if (lower.includes('code') || lower.includes('programm')) {
    return 'Ich kann dir bei Architektur, Dateien, UI, API-Proxy, Packaging für Android und Windows sowie bei der späteren Hermes-Anbindung helfen.';
  }
  if (lower.includes('android')) {
    return 'Für Android ist diese App als gemeinsame Web-Oberfläche vorbereitet. Hermes selbst läuft dort am besten über Termux.';
  }
  if (lower.includes('windows')) {
    return 'Für Windows ist eine Desktop-Hülle vorbereitet. Der echte Hermes-Core läuft nach offizieller Empfehlung am saubersten in WSL2.';
  }
  return 'Verstanden. Diese lokale Demo ist bereit. Sobald du einen OpenAI-kompatiblen Endpoint einträgst, leite ich die Unterhaltung an ein echtes Backend weiter. Frage mich nach: OFI, CVD, VPIN, Funding, Open Interest, Wave-Signal, Phase-Signal oder Seasonality.';
}

async function proxyToOpenAICompatible(messages) {
  const base = process.env.OPENAI_COMPAT_BASE_URL;
  const prefix = process.env.OPENAI_COMPAT_PREFIX || '/v1';
  const model = process.env.OPENAI_COMPAT_MODEL;
  const apiKey = process.env.OPENAI_COMPAT_API_KEY;

  if (!base || !model) {
    return null;
  }

  const url = `${base.replace(/\/$/, '')}${prefix}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI-kompatibler Proxy-Fehler (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || 'Leere Antwort vom kompatiblen Endpoint.';
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ...getSystemStatus() });
});

app.get('/api/sessions', (_req, res) => {
  const store = readStore();
  res.json(store.sessions);
});

app.post('/api/sessions', (req, res) => {
  const title = String(req.body?.title || 'Neuer Chat');
  const store = readStore();
  const session = {
    id: createId('session'),
    title,
    createdAt: new Date().toISOString(),
    messages: [
      {
        id: createId('msg'),
        role: 'assistant',
        content: 'Neuer Chat gestartet. Schreibe mir, was du machen möchtest.'
      }
    ]
  };
  store.sessions.unshift(session);
  writeStore(store);
  res.status(201).json(session);
});

app.get('/api/sessions/:id', (req, res) => {
  const store = readStore();
  const session = store.sessions.find((item) => item.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
  res.json(session);
});

app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body || {};
  if (!sessionId || !message) {
    return res.status(400).json({ error: 'sessionId und message sind erforderlich' });
  }

  const store = readStore();
  const session = store.sessions.find((item) => item.id === sessionId);
  if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

  const userMessage = {
    id: createId('msg'),
    role: 'user',
    content: String(message)
  };
  session.messages.push(userMessage);

  let assistantText;
  try {
    assistantText = await proxyToOpenAICompatible(
      session.messages.map((msg) => ({ role: msg.role, content: msg.content }))
    );
  } catch (error) {
    assistantText = `Der konfigurierte kompatible Endpoint hat nicht geantwortet. Ich falle auf den lokalen Modus zurück.\n\nDetails: ${error.message}`;
  }

  if (!assistantText) {
    assistantText = mockAgentReply(message);
  }

  const assistantMessage = {
    id: createId('msg'),
    role: 'assistant',
    content: assistantText
  };
  session.messages.push(assistantMessage);

  if (session.title === 'Neuer Chat' || session.title === 'Untitled') {
    session.title = String(message).slice(0, 32);
  }

  writeStore(store);
  res.json({ session, assistantMessage });
});

// ─── BTC Microstructure Indicator API ────────────────────────────────────────

app.get('/api/indicators', (_req, res) => {
  res.json({
    description: 'BTC Microstructure Indicators – evidence-based signal layer',
    evidenceNote: 'Realistic hit rates 52-63%. Edge requires R:R ≥ 1.5:1 and Maker fills. No public OOS backtests exist for funding/OI/liquidation signals on minute-level.',
    endpoints: {
      'POST /api/indicators/wave': {
        description: 'Wave signal (15-45 min impulse) – OFI + CVD + orderbook depth + volatility regime',
        body: { ofi: '{ zScore, signal }', cvd: '{ cumDelta, divergence }', orderbook: '{ bidDepthUSD, askDepthUSD }', volatility: '{ regime }', priceChange: 'number' },
      },
      'POST /api/indicators/phase': {
        description: 'Phase signal (30 min – 6 h trend/reversal) – OI regime + funding extremes + liquidation cascade',
        body: { oiRegime: 'string', funding: '{ signal, isExtreme, isPersistent, consecutiveExtreme }', cvd: '{ cumDelta, divergence }', priceChange: 'number', liquidation: '{ longLiqUSD, shortLiqUSD, isSpike }', seasonality: '(output of /seasonality)' },
      },
      'POST /api/indicators/seasonality': {
        description: 'Analyze timing quality for BTC trading (session, day-of-week, funding settlement, Monday Asia Open Effect)',
        body: { timestamp: 'ISO string or Unix ms (default: now)' },
      },
      'GET /api/indicators/wave-demo': {
        description: 'Demo wave evaluation with synthetic example data',
      },
    },
  });
});

app.post('/api/indicators/wave', (req, res) => {
  try {
    const { ofi = {}, cvd = {}, orderbook = null, volatility = {}, priceChange = 0 } = req.body || {};
    const signal = new WaveSignal();
    const result = signal.evaluate({ ofi, cvd, orderbook, volatility, priceChange });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/indicators/phase', (req, res) => {
  try {
    const { oiRegime = 'neutral', funding = {}, cvd = {}, priceChange = 0, liquidation = null, seasonality = null } = req.body || {};
    const signal = new PhaseSignal();
    const result = signal.evaluate({ oiRegime, funding, cvd, priceChange, liquidation, seasonality });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/indicators/seasonality', (req, res) => {
  try {
    const ts = req.body?.timestamp ?? Date.now();
    const timestamp = typeof ts === 'string' ? new Date(ts).getTime() : Number(ts);
    if (isNaN(timestamp)) return res.status(400).json({ error: 'Invalid timestamp' });
    const analyzer = new IntradaySeasonality();
    res.json(analyzer.analyze(timestamp));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/indicators/wave-demo', (_req, res) => {
  const signal = new WaveSignal();
  const result = signal.evaluate({
    ofi: { zScore: 2.3, signal: 'long' },
    cvd: { cumDelta: 1500, divergence: 'none' },
    orderbook: { bidDepthUSD: 3_200_000, askDepthUSD: 1_100_000 },
    volatility: { regime: 'compressed' },
    priceChange: 0.0018,
  });
  res.json({
    _demo: true,
    _description: 'Example: strong long OFI z-score + thin ask side + CVD aligned + volatility compressed',
    ...result,
  });
});

app.get('/api/indicators/seasonality-now', (_req, res) => {
  const analyzer = new IntradaySeasonality();
  res.json(analyzer.analyze(Date.now()));
});

// ─── Static / SPA fallback ───────────────────────────────────────────────────

app.get('*', (_req, res) => {
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

app.listen(PORT, () => {
  ensureStore();
  console.log(`Hermes Window läuft auf http://localhost:${PORT}`);
});
