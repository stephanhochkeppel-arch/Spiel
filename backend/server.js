const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

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
  return 'Verstanden. Diese lokale Demo ist bereit. Sobald du einen OpenAI-kompatiblen Endpoint einträgst, leite ich die Unterhaltung an ein echtes Backend weiter.';
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

app.get('*', (_req, res) => {
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

app.listen(PORT, () => {
  ensureStore();
  console.log(`Hermes Window läuft auf http://localhost:${PORT}`);
});
