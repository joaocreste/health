/* ============================================================
   Lumen Log — application logic
   Local-first health logging (Valium · Alcohol · Protein)
   Storage: IndexedDB (offline, persistent, unbounded history)
   ============================================================ */

'use strict';

/* ------------------------------------------------------------
   1. TRACKER REGISTRY  — add a variable by adding one object.
   ------------------------------------------------------------
   kind: 'increment'  -> fixed-step pill buttons (steps: [..])
         'numeric'    -> manual float entry (+ optional quick chips)
   ------------------------------------------------------------ */
const TRACKERS = [
  {
    id: 'valium',
    title: 'Valium',
    unit: 'mg',
    accent: 'var(--c-valium)',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-45 12 12)"/><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/></svg>',
    kind: 'increment',
    steps: [2.5, 5],
    sub: 'Tap to log a dose',
  },
  {
    id: 'alcohol',
    title: 'Alcohol',
    unit: 'units',
    accent: 'var(--c-alcohol)',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5 H17.5 C17.5 9.5 14.5 12.5 12 12.5 C9.5 12.5 6.5 9.5 6.5 3.5 Z"/><line x1="12" y1="12.5" x2="12" y2="19.5"/><line x1="8" y1="20.5" x2="16" y2="20.5"/></svg>',
    kind: 'increment',
    steps: [1],
    sub: '1 beer or 1 glass of wine = 1 unit',
  },
  {
    id: 'protein',
    title: 'Protein',
    unit: 'grams',
    accent: 'var(--c-protein)',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 7.5 C9 5 14.5 4.7 17.6 7 C20 8.8 20.2 13 17.7 15.5 C15 18.2 9.2 18.2 6.6 15.6 C4.4 13.4 4.3 9.6 6.5 7.5 Z"/><path d="M9 9.2 C11 7.8 14.3 7.8 16.2 9.4 C17.5 10.5 17.6 12.6 16.4 14"/></svg>',
    kind: 'numeric',
    quick: [20, 30, 40, 50],
    sub: 'Enter grams and add',
  },
];

const TRACKER_BY_ID = Object.fromEntries(TRACKERS.map(t => [t.id, t]));

/* ------------------------------------------------------------
   2. INDEXEDDB  — tiny promise wrapper
   ------------------------------------------------------------ */
const DB_NAME = 'lumen-log';
const STORE = 'entries';
let _dbp = null;

function db() {
  if (_dbp) return _dbp;
  _dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) {
        const os = d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        os.createIndex('timestamp', 'timestamp');
        os.createIndex('what', 'what');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbp;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const os = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(os)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqP(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* Data API */
async function addEntry(what, unit, amount) {
  const entry = {
    timestamp: new Date().toISOString(),
    what,
    unit,
    amount: parseFloat(amount),
  };
  const id = await tx('readwrite', os => reqP(os.add(entry)));
  entry.id = id;
  return entry;
}

async function allEntries() {
  return tx('readonly', os => reqP(os.getAll()));
}

async function deleteEntry(id) {
  return tx('readwrite', os => reqP(os.delete(id)));
}

/* ------------------------------------------------------------
   3. DATE HELPERS  — local-day boundaries (midnight reset)
   ------------------------------------------------------------ */
function localDayKey(d) {
  // YYYY-MM-DD in the device's local timezone
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayKey() { return localDayKey(new Date()); }

function fmtAmount(n) {
  // Trim trailing zeros: 5.0 -> "5", 2.5 -> "2.5"
  return Number(n.toFixed(2)).toString();
}

/* ------------------------------------------------------------
   4. STATE + RENDER
   ------------------------------------------------------------ */
const state = {
  entries: [],
  lastByTracker: {}, // id -> last entry logged this session (for undo)
};

async function loadEntries() {
  state.entries = await allEntries();
  state.entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function todaysEntries() {
  const tk = todayKey();
  return state.entries.filter(e => localDayKey(new Date(e.timestamp)) === tk);
}

function totalsFor(entries) {
  const totals = {};
  for (const t of TRACKERS) totals[t.id] = { amount: 0, count: 0 };
  for (const e of entries) {
    if (totals[e.what]) {
      totals[e.what].amount += e.amount;
      totals[e.what].count += 1;
    }
  }
  return totals;
}

/* ----- Today view ----- */
function renderToday() {
  const today = todaysEntries();
  const totals = totalsFor(today);
  const wrap = document.getElementById('trackerCards');
  wrap.innerHTML = '';

  for (const t of TRACKERS) {
    const tot = totals[t.id];
    const card = document.createElement('section');
    card.className = 'card';
    card.style.setProperty('--accent', t.accent);

    let controls = '';
    if (t.kind === 'increment') {
      controls = `<div class="card-controls">${
        t.steps.map(s =>
          `<button class="pill" data-add="${t.id}" data-amt="${s}"><span class="plus">+</span>${fmtAmount(s)}</button>`
        ).join('')
      }</div>`;
    } else {
      const chips = (t.quick || []).map(q =>
        `<button class="chip" data-quick="${t.id}" data-amt="${q}">${q} g</button>`
      ).join('');
      controls = `
        <div class="num-row">
          <input class="num-input" id="num-${t.id}" type="number" inputmode="decimal"
                 step="any" min="0" placeholder="grams" aria-label="${t.title} grams">
          <button class="num-add" data-numadd="${t.id}">Add</button>
        </div>
        ${chips ? `<div class="quick-chips">${chips}</div>` : ''}`;
    }

    const last = state.lastByTracker[t.id];
    card.innerHTML = `
      <div class="card-head">
        <div>
          <div class="card-title">${t.title}${t.icon ? `<span class="card-icon">${t.icon}</span>` : ''}</div>
          <div class="card-sub">${t.sub}</div>
        </div>
        <div class="card-total">
          <span class="val">${fmtAmount(tot.amount)}</span><span class="unit">${t.unit}</span>
          <span class="count">${tot.count} ${tot.count === 1 ? 'entry' : 'entries'} today</span>
        </div>
      </div>
      ${controls}
      <div class="card-foot">
        <button class="undo-btn" data-undo="${t.id}" ${last ? '' : 'hidden'}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 8"/></svg>
          Undo last
        </button>
      </div>`;
    wrap.appendChild(card);
  }
}

/* ----- History view ----- */
function renderHistory() {
  // Per-day summary (most recent first)
  const byDay = new Map();
  for (const e of state.entries) {
    const k = localDayKey(new Date(e.timestamp));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  const days = [...byDay.keys()].sort().reverse();

  const sumEl = document.getElementById('historySummary');
  if (!days.length) {
    sumEl.innerHTML = `<div class="empty">No entries yet.<br>Log something from the Today tab.</div>`;
    document.getElementById('entryList').innerHTML = '';
    return;
  }

  sumEl.innerHTML = days.map(k => {
    const entries = byDay.get(k);
    const totals = totalsFor(entries);
    const pills = TRACKERS
      .filter(t => totals[t.id].count > 0)
      .map(t => `<span class="day-pill"><span class="dot" style="background:${t.accent}"></span>${fmtAmount(totals[t.id].amount)} ${t.unit}</span>`)
      .join('');
    return `
      <div class="day-row">
        <div class="day-row-head">
          <span class="day-date">${prettyDate(k)}</span>
          <span class="day-count">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</span>
        </div>
        <div class="day-totals">${pills || '<span class="day-pill">—</span>'}</div>
      </div>`;
  }).join('');

  // Recent flat list (newest first, cap display at 100)
  const recent = [...state.entries].reverse().slice(0, 100);
  document.getElementById('entryList').innerHTML = recent.map(e => {
    const t = TRACKER_BY_ID[e.what];
    const accent = t ? t.accent : 'var(--text-faint)';
    return `
      <li class="entry">
        <span class="entry-dot" style="background:${accent}"></span>
        <div class="entry-main">
          <div class="entry-what">${e.what}</div>
          <div class="entry-time">${prettyDateTime(e.timestamp)}</div>
        </div>
        <span class="entry-amt">${fmtAmount(e.amount)} ${e.unit}</span>
        <button class="entry-del" data-del="${e.id}" aria-label="Delete entry">&times;</button>
      </li>`;
  }).join('');
}

function prettyDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const tk = todayKey();
  if (key === tk) return 'Today';
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (key === localDayKey(yest)) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function prettyDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function renderAll() {
  renderToday();
  if (currentView === 'history') renderHistory();
}

/* ------------------------------------------------------------
   5. ACTIONS
   ------------------------------------------------------------ */
async function log(trackerId, amount) {
  const t = TRACKER_BY_ID[trackerId];
  if (!t) return;
  const amt = parseFloat(amount);
  if (!isFinite(amt) || amt <= 0) { toast('Enter a valid amount'); return; }
  const entry = await addEntry(t.id, t.unit, amt);
  state.entries.push(entry);
  state.lastByTracker[t.id] = entry;
  renderAll();
  if (navigator.vibrate) navigator.vibrate(8);
  toast(`+${fmtAmount(amt)} ${t.unit} ${t.title}`);
}

async function undoLast(trackerId) {
  const entry = state.lastByTracker[trackerId];
  if (!entry) return;
  await deleteEntry(entry.id);
  state.entries = state.entries.filter(e => e.id !== entry.id);
  delete state.lastByTracker[trackerId];
  renderAll();
  toast('Removed last entry');
}

async function removeEntry(id) {
  await deleteEntry(id);
  state.entries = state.entries.filter(e => e.id !== id);
  for (const k of Object.keys(state.lastByTracker)) {
    if (state.lastByTracker[k]?.id === id) delete state.lastByTracker[k];
  }
  renderAll();
}

/* ----- CSV export (full history) ----- */
async function exportCSV() {
  const rows = [...state.entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (!rows.length) { toast('Nothing to export yet'); return; }
  const header = 'timestamp,what,unit,amount';
  const body = rows.map(e =>
    [e.timestamp, e.what, e.unit, e.amount].join(',')
  ).join('\n');
  const csv = header + '\n' + body + '\n';

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lumen-log_${todayKey()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${rows.length} entries`);
}

/* ------------------------------------------------------------
   6. VIEW SWITCHING
   ------------------------------------------------------------ */
let currentView = 'today';
function switchView(v) {
  currentView = v;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.view === v));
  document.getElementById('view-today').classList.toggle('is-active', v === 'today');
  document.getElementById('view-history').classList.toggle('is-active', v === 'history');
  if (v === 'history') renderHistory();
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------
   7. TOAST
   ------------------------------------------------------------ */
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

/* ------------------------------------------------------------
   8. MIDNIGHT WATCH  — re-render totals when the day rolls over
   ------------------------------------------------------------ */
let watchedDay = todayKey();
function checkDayRollover() {
  const now = todayKey();
  if (now !== watchedDay) {
    watchedDay = now;
    state.lastByTracker = {};   // yesterday's "undo" no longer applies
    updateDateLabel();
    renderAll();
  }
}

function updateDateLabel() {
  document.getElementById('todayLabel').textContent =
    new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

/* ------------------------------------------------------------
   9. EVENT WIRING
   ------------------------------------------------------------ */
function wire() {
  // Delegated taps for tracker controls
  document.getElementById('trackerCards').addEventListener('click', e => {
    const add = e.target.closest('[data-add]');
    if (add) { log(add.dataset.add, add.dataset.amt); return; }

    const quick = e.target.closest('[data-quick]');
    if (quick) { log(quick.dataset.quick, quick.dataset.amt); return; }

    const numAdd = e.target.closest('[data-numadd]');
    if (numAdd) {
      const id = numAdd.dataset.numadd;
      const input = document.getElementById('num-' + id);
      const v = input.value;
      if (v !== '' && parseFloat(v) > 0) { log(id, v); input.value = ''; input.blur(); }
      else toast('Enter grams first');
      return;
    }

    const undo = e.target.closest('[data-undo]');
    if (undo) { undoLast(undo.dataset.undo); return; }
  });

  // Enter key in protein input submits
  document.getElementById('trackerCards').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('num-input')) {
      e.preventDefault();
      const id = e.target.id.replace('num-', '');
      if (e.target.value && parseFloat(e.target.value) > 0) { log(id, e.target.value); e.target.value = ''; e.target.blur(); }
    }
  });

  // History delete
  document.getElementById('entryList').addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) removeEntry(Number(del.dataset.del));
  });

  // Tabs
  document.querySelectorAll('.tab').forEach(b =>
    b.addEventListener('click', () => switchView(b.dataset.view)));

  // Export
  document.getElementById('exportBtn').addEventListener('click', exportCSV);

  // Day rollover: check on focus + every 30s
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDayRollover(); });
  setInterval(checkDayRollover, 30000);
}

/* ------------------------------------------------------------
   10. BOOT
   ------------------------------------------------------------ */
async function boot() {
  updateDateLabel();
  wire();
  try {
    await loadEntries();
  } catch (err) {
    toast('Storage unavailable — check Safari settings');
    console.error(err);
  }
  renderToday();

  // Best-effort: ask the browser to keep our data
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist(); });
  }

  // Service worker for offline
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
