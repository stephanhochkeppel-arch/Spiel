const state = {
  sessions: [],
  currentSessionId: null,
  health: null
};

const sidebar = document.getElementById('sidebar');
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
const sessionList = document.getElementById('sessionList');
const messagesEl = document.getElementById('messages');
const composerForm = document.getElementById('composerForm');
const messageInput = document.getElementById('messageInput');
const newChatBtn = document.getElementById('newChatBtn');
const chatTitle = document.getElementById('chatTitle');
const chatSubtitle = document.getElementById('chatSubtitle');
const modeLabel = document.getElementById('modeLabel');
const backendLabel = document.getElementById('backendLabel');

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `API-Fehler ${response.status}`);
  }
  return response.json();
}

async function loadHealth() {
  state.health = await api('/api/health');
  modeLabel.textContent = state.health.mode === 'mock' ? 'lokal' : 'echt';
  backendLabel.textContent = state.health.mode === 'mock' ? 'Mock-Agent' : 'API-Proxy';
}

async function loadSessions() {
  state.sessions = await api('/api/sessions');
  if (!state.currentSessionId && state.sessions.length) {
    state.currentSessionId = state.sessions[0].id;
  }
  renderSessions();
  renderCurrentSession();
}

function renderSessions() {
  sessionList.innerHTML = '';
  for (const session of state.sessions) {
    const btn = document.createElement('button');
    btn.className = `session-item ${session.id === state.currentSessionId ? 'active' : ''}`;
    btn.innerHTML = `<strong>${escapeHtml(session.title || 'Neuer Chat')}</strong><small>${formatDate(session.createdAt)}</small>`;
    btn.addEventListener('click', () => {
      state.currentSessionId = session.id;
      renderSessions();
      renderCurrentSession();
      if (window.innerWidth <= 920) sidebar.classList.remove('open');
    });
    sessionList.appendChild(btn);
  }
}

function renderCurrentSession() {
  const session = state.sessions.find((item) => item.id === state.currentSessionId);
  if (!session) return;
  chatTitle.textContent = session.title || 'Neuer Chat';
  chatSubtitle.textContent = `${session.messages.length} Nachrichten`;
  messagesEl.innerHTML = '';

  for (const msg of session.messages) {
    const div = document.createElement('div');
    div.className = `message ${msg.role}`;
    div.innerHTML = msg.role === 'assistant'
      ? `<span class="message-role">Agent</span>${escapeHtml(msg.content)}`
      : escapeHtml(msg.content);
    messagesEl.appendChild(div);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function createSession(title = 'Neuer Chat') {
  const session = await api('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ title })
  });
  state.sessions.unshift(session);
  state.currentSessionId = session.id;
  renderSessions();
  renderCurrentSession();
}

async function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed || !state.currentSessionId) return;

  const session = state.sessions.find((item) => item.id === state.currentSessionId);
  if (!session) return;

  session.messages.push({ role: 'user', content: trimmed });
  renderCurrentSession();
  messageInput.value = '';
  resizeTextarea();

  const loading = document.createElement('div');
  loading.className = 'message assistant';
  loading.innerHTML = '<span class="message-role">Agent</span>Denke nach…';
  messagesEl.appendChild(loading);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const result = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ sessionId: state.currentSessionId, message: trimmed })
    });
    const index = state.sessions.findIndex((item) => item.id === state.currentSessionId);
    state.sessions[index] = result.session;
    renderSessions();
    renderCurrentSession();
  } catch (error) {
    loading.textContent = `Fehler: ${error.message}`;
  }
}

function formatDate(dateString) {
  try {
    return new Date(dateString).toLocaleString('de-CH', {
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return 'unbekannt';
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
}

function resizeTextarea() {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 180)}px`;
}

composerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await sendMessage(messageInput.value);
});

messageInput.addEventListener('input', resizeTextarea);
messageInput.addEventListener('keydown', async (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    await sendMessage(messageInput.value);
  }
});

newChatBtn.addEventListener('click', () => createSession());
if (toggleSidebarBtn) {
  toggleSidebarBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
}

document.querySelectorAll('.action-card').forEach((button) => {
  button.addEventListener('click', async () => {
    const prompt = button.dataset.prompt || '';
    if (!state.currentSessionId) {
      await createSession('Neuer Chat');
    }
    await sendMessage(prompt);
  });
});

(async function init() {
  await loadHealth();
  await loadSessions();
  resizeTextarea();
})();
