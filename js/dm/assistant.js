// DM console -- ShimAI, the assistant (the user's call, 2026-11-17; named ShimAI 2026-11-18): a chat drawer on the right, opened from the 💬 at the
// bottom of the rail, over whatever module is open (it isn't a module of its own, so the DM can ask about the screen
// they're on). The DM asks how to do something in the app, whether something is possible, for a battle log's summary,
// or for an encounter to their criteria; the Pi asks Claude and runs the lookups (pi-server/app/assistant.py).
//
// The chat is kept for this browser tab (sessionStorage) -- the Pi keeps the conversation itself in memory, so after a
// restart of the Pi the next question starts a fresh one there (the panel still shows the old messages).
import { DmAPI } from '../api.js';
import { escapeHtml } from './dm-common.js';

const STORE_KEY = 'dm-assistant-chat';
// One with blanks (X, Y, Z) goes into the message box to be filled in, with the first blank selected (Tab selects the
// next one); the rest are sent at once.
const SUGGESTIONS = [
  'Summarize the last battle',
  "Party's current status",
  "Create an encounter with X Pokémon with typings Y and Z, with comparable levels to the party's active Pokémon",
];
const BLANK = /\b[XYZ]\b/;

let _chat = load();         // {conversation, items: [{role: 'user'|'assistant'|'error', text, steps?, changed?}]}
let _busy = false;
let _status = null;
let _drawer = null;

function load() {
  try {
    const c = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
    if (c && Array.isArray(c.items)) return c;
  } catch (e) { /* none kept */ }
  return { conversation: null, items: [] };
}

function save() {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(_chat)); } catch (e) { /* not kept */ }
}

// ---------------------------------------------------------------------------
// A small, safe markdown: the text is escaped first, then **bold**, *italic*, `code`, headings, lists, paragraphs.
// ---------------------------------------------------------------------------

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
}

function markdown(text) {
  const lines = escapeHtml(text || '').split('\n');
  let html = '';
  let list = null; // 'ul' | 'ol'
  let para = [];
  const flushPara = () => { if (para.length) { html += `<p>${inline(para.join('<br>'))}</p>`; para = []; } };
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) { closeList(); html += `<${kind}>`; list = kind; }
      html += `<li>${inline((ul || ol)[1])}</li>`;
    } else if (h) {
      flushPara(); closeList();
      html += `<h4>${inline(h[1])}</h4>`;
    } else if (!line.trim()) {
      flushPara(); closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara(); closeList();
  return html;
}

// ---------------------------------------------------------------------------
// The drawer
// ---------------------------------------------------------------------------

/** The rail button and the (closed) drawer -- called once when the console starts. */
export function initAssistant() {
  const rail = document.getElementById('dmRail');
  const btn = document.createElement('button');
  btn.className = 'dm-rail-btn dm-rail-assistant';
  btn.id = 'dmAssistantBtn';
  btn.title = 'ShimAI -- ask how to do something in the app, have a battle summarized, or get an encounter drafted';
  btn.innerHTML = '<span>💬</span>ShimAI';
  // not a module: the rail's own click handler looks for [data-module], which this hasn't got
  btn.addEventListener('click', () => toggle());
  rail.appendChild(btn);

  _drawer = document.createElement('aside');
  _drawer.className = 'dm-assistant';
  _drawer.hidden = true;
  document.body.appendChild(_drawer);
  // keys typed here are the chat's -- not the map editor's or the battle's shortcuts
  _drawer.addEventListener('keydown', (e) => e.stopPropagation());
}

function toggle(open = _drawer.hidden) {
  _drawer.hidden = !open;
  document.getElementById('dmAssistantBtn')?.classList.toggle('active', open);
  if (open) {
    draw();
    refreshStatus();
    _drawer.querySelector('textarea')?.focus();
  }
}

async function refreshStatus() {
  try {
    _status = await DmAPI.assistantStatus();
  } catch (err) {
    _status = { ready: false, reason: `Couldn't reach the Pi: ${err.message}` };
  }
  drawStatus();
}

function drawStatus() {
  const el = _drawer.querySelector('.dm-asst-status');
  if (!el || !_status) return;
  if (!_status.ready) {
    el.innerHTML = `<div class="dm-asst-notready">${escapeHtml(_status.reason || 'ShimAI is not set up.')}</div>`;
    return;
  }
  const spent = Number(_status.spentToday || 0);
  const shown = spent > 0 && spent < 0.01 ? 'under $0.01' : `$${spent.toFixed(2)}`;
  el.innerHTML = `<span class="dm-hint" title="What ShimAI has cost today, against the Pi's daily limit">Today: ${shown} of $${Number(_status.dailyLimit || 0).toFixed(2)}</span>`;
}

function itemHtml(it) {
  if (it.role === 'user') return `<div class="dm-asst-msg user">${escapeHtml(it.text).replace(/\n/g, '<br>')}</div>`;
  if (it.role === 'error') return `<div class="dm-asst-msg error">${escapeHtml(it.text)}</div>`;
  const steps = (it.steps || []).length
    ? `<details class="dm-asst-steps"><summary>What I looked at (${it.steps.length})</summary><ul>${it.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul></details>`
    : '';
  const open = (it.changed || []).includes('encounters')
    ? '<button class="dm-btn small" data-asst-open="encounters">📋 Open Encounter setup</button>' : '';
  return `<div class="dm-asst-msg assistant">${markdown(it.text)}${open}${steps}</div>`;
}

function draw() {
  const empty = !_chat.items.length;
  _drawer.innerHTML = `
    <header class="dm-asst-head">
      <strong>💬 ShimAI</strong>
      <span class="dm-asst-status"></span>
      <button class="dm-btn small" data-asst="new" title="Start over -- forget this conversation">New chat</button>
      <button class="dm-icon-btn" data-asst="close" title="Close">✕</button>
    </header>
    <div class="dm-asst-log">
      ${empty ? `
        <div class="dm-asst-intro">
          <p>Ask me how to do something in the app, whether something is possible, to summarize a battle, or to draft an encounter.</p>
          <div class="dm-asst-suggest">${SUGGESTIONS.map(s => `<button class="dm-btn small" data-asst-suggest="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>
        </div>` : _chat.items.map(itemHtml).join('')}
      ${_busy ? '<div class="dm-asst-msg assistant pending"><span class="dm-asst-dots"><i></i><i></i><i></i></span> Looking into it…</div>' : ''}
    </div>
    <form class="dm-asst-form">
      <textarea class="dm-input" rows="2" placeholder="Ask anything… (Enter sends, Shift+Enter for a new line)" ${_busy ? 'disabled' : ''}></textarea>
      <button class="dm-btn primary" type="submit" ${_busy ? 'disabled' : ''}>Send</button>
    </form>`;
  drawStatus();
  const log = _drawer.querySelector('.dm-asst-log');
  log.scrollTop = log.scrollHeight;

  _drawer.querySelector('[data-asst="close"]').addEventListener('click', () => toggle(false));
  _drawer.querySelector('[data-asst="new"]').addEventListener('click', () => {
    if (_busy) return;
    _chat = { conversation: null, items: [] };
    save();
    draw();
    _drawer.querySelector('textarea')?.focus();
  });
  _drawer.querySelectorAll('[data-asst-suggest]').forEach(b => b.addEventListener('click', () => {
    const text = b.dataset.asstSuggest;
    const blank = text.match(BLANK);
    if (!blank) { send(text); return; }
    const box = _drawer.querySelector('textarea');
    box.value = text;
    box.focus();
    box.setSelectionRange(blank.index, blank.index + 1);
  }));
  _drawer.querySelectorAll('[data-asst-open="encounters"]').forEach(b => b.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('dm:open-encounters'));
  }));
  const form = _drawer.querySelector('form');
  const box = form.querySelector('textarea');
  form.addEventListener('submit', (e) => { e.preventDefault(); send(box.value); });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(box.value); }
    // Tab: the next blank left to fill in (X, Y, Z of a suggestion)
    if (e.key === 'Tab' && !e.shiftKey) {
      const blank = box.value.match(BLANK);
      if (blank) { e.preventDefault(); box.setSelectionRange(blank.index, blank.index + 1); }
    }
  });
}

async function send(text) {
  text = String(text || '').trim();
  if (!text || _busy) return;
  _chat.items.push({ role: 'user', text });
  _busy = true;
  save();
  draw();
  try {
    const res = await DmAPI.askAssistant(_chat.conversation, text);
    _chat.conversation = res.conversation;
    _chat.items.push({ role: 'assistant', text: res.reply, steps: res.steps, changed: res.changed });
    // a new encounter saved: Encounter setup shows it at once (encounters.js)
    if ((res.changed || []).includes('encounters')) window.dispatchEvent(new CustomEvent('dm:encounters-changed'));
    if (_status) { _status.spentToday = res.spentToday; _status.dailyLimit = res.dailyLimit; }
  } catch (err) {
    _chat.items.push({ role: 'error', text: err.message });
  } finally {
    _busy = false;
    save();
    if (!_drawer.hidden) {
      draw();
      _drawer.querySelector('textarea')?.focus();
    }
  }
}
