import * as L from './logic.js';
import * as store from './store.js';

const VERSION = '0.2.1';
const MINUS = '−';
const appEl = document.getElementById('app');
const sheetEl = document.getElementById('sheet');

const state = {
  sessions: [],
  hands: [],
  view: 'home',
  tab: 'tables',
  sessionId: null,
  summaryTab: 'overview',
  handFilter: 'all',
  filters: { period: 'all', session: 'all', blinds: 'all', position: 'all' },
  form: null,
  sheet: null,
  updateReady: false,
  storageError: false,
};

const uid = () => crypto.randomUUID();
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (n, digits = 0) => Math.abs(n).toLocaleString('en-GB', { maximumFractionDigits: digits });
const signed = (n, digits = 0) => {
  const rounded = Number(n.toFixed(digits));
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : MINUS}${num(rounded, digits)}`;
};
const tone = (n) => (n > 0 ? 'win' : n < 0 ? 'loss' : '');
const pct = (r) => (r.value === null ? 'no data' : `${Math.round(r.value * 100)}%`);
const dateText = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
const hoursText = (h) => {
  const minutes = Math.round(h * 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

const sessionById = (id) => state.sessions.find((s) => s.id === id);
const activeSession = () => state.sessions.find((s) => !s.endedAt);
const finishedSessions = () =>
  state.sessions.filter((s) => s.endedAt).sort((a, b) => b.startedAt - a.startedAt);
const handsOf = (id) =>
  state.hands.filter((h) => h.sessionId === id).sort((a, b) => a.number - b.number);
const current = () => sessionById(state.sessionId);
const clone = (v) => JSON.parse(JSON.stringify(v));

function guard(promise) {
  promise.catch(() => {
    state.storageError = true;
    render();
  });
}
const saveSession = (s) => guard(store.putSession(s));

function ensureDraft(s) {
  if (s.draft) return;
  const hands = handsOf(s.id);
  const stack = L.currentStack(s, hands);
  if (stack <= 0) return;
  s.draft = L.newHand({
    id: uid(), session: s, number: (hands.at(-1)?.number ?? 0) + 1,
    players: s.players, seat: s.seat, stack, now: Date.now(),
  });
  s.undo = [];
}

// Каждый шаг раздачи сразу сохраняется и его можно отменить.
function step(work) {
  const s = current();
  s.undo = [...(s.undo ?? []).slice(-40), clone(s.draft)];
  work(s.draft);
  saveSession(s);
  render();
}

function finish(s, outcome, before) {
  const h = s.draft;
  L.finishHand(h, outcome, Date.now());
  state.hands.push(h);
  guard(store.putHand(h));
  s.lastDraft = before;
  s.lastHandId = h.id;
  s.seat = L.nextSeat(h.seat, h.players);
  s.players = h.players;
  s.draft = null;
  ensureDraft(s);
  saveSession(s);
  state.sheet = null;
  render();
}

function closeSheet() {
  state.sheet = null;
  renderSheet();
}

function openAmount(options) {
  const quick = options.quick?.filter((q) => q.value >= (options.min ?? 0));
  state.sheet = { type: 'amount', error: '', ...options, quick, value: options.value ? String(options.value) : '' };
  renderSheet();
}

function quickAmounts(h, withCall) {
  const list = [
    { label: '2 BB', value: h.bb * 2 },
    { label: '3 BB', value: h.bb * 3 },
  ];
  const villain = h.actions.filter((a) => a.street === h.street && a.who === 'villain').at(-1);
  if (withCall && villain?.to) list.push({ label: `Opponent ${villain.to}`, value: villain.to });
  list.push({ label: 'All-in', value: L.heroStreetTotal(h) + L.stackLeft(h) });
  return list;
}

const handlers = {
  tab: (el) => { state.tab = el.dataset.v; render(); },
  home: () => { state.view = 'home'; render(); },
  newTable: () => {
    let name = `Night ${dateText(Date.now())}`;
    const taken = (n) => state.sessions.some((s) => s.name === n);
    for (let i = 2; taken(name); i += 1) name = `Night ${dateText(Date.now())} (${i})`;
    state.form = { name, stack: '200', sb: '1', bb: '2', players: 6, seat: 1, error: '' };
    state.view = 'setup';
    render();
  },
  setPlayers: (el) => {
    const f = state.form;
    f.players = Math.min(L.MAX_PLAYERS, Math.max(L.MIN_PLAYERS, f.players + Number(el.dataset.v)));
    f.seat = Math.min(f.seat, f.players);
    render();
  },
  setSeat: (el) => { state.form.seat = Number(el.dataset.v); render(); },
  start: () => {
    const f = state.form;
    const [stack, sb, bb] = [f.stack, f.sb, f.bb].map(Number);
    const name = f.name.trim();
    const whole = [stack, sb, bb].every((v) => Number.isInteger(v) && v > 0);
    f.error = !name ? 'Enter a table name.'
      : state.sessions.some((s) => s.name === name) ? 'A table with this name already exists.'
      : !whole ? 'Stack and blinds must be whole numbers above zero.'
      : sb > bb ? 'The small blind can’t be larger than the big blind.' : '';
    if (f.error) { render(); return; }
    const s = {
      id: uid(), type: 'cash', name, startStack: stack, sb, bb, players: f.players, seat: f.seat,
      stackEvents: [], startedAt: Date.now(), endedAt: null, finalStack: null, draft: null, undo: [],
    };
    state.sessions.push(s);
    ensureDraft(s);
    saveSession(s);
    navigator.storage?.persist?.();
    state.sessionId = s.id;
    state.view = 'hand';
    render();
  },
  resume: () => { state.sessionId = activeSession().id; state.view = 'hand'; render(); },
  open: (el) => {
    state.sessionId = el.dataset.v;
    state.summaryTab = 'overview';
    state.handFilter = 'all';
    state.view = 'session';
    render();
  },

  // Раздача
  card: (el) => step((h) => {
    const card = el.dataset.v;
    if (h.phase === 'cards') {
      h.cards.push(card);
      if (h.cards.length === 2) h.phase = 'decide';
    } else {
      h.board.push(card);
      if (h.board.length >= L.boardNeeded(h)) h.phase = 'decide';
    }
  }),
  skipCards: () => step((h) => { h.phase = 'decide'; }),
  skipBoard: () => step((h) => L.skipBoard(h)),
  toggleRaised: () => step((h) => L.setRaisedBefore(h, !h.raisedBefore)),
  raiseAmount: () => {
    const h = current().draft;
    openAmount({
      title: 'Raise before you', quick: [{ label: '2 BB', value: h.bb * 2 }, { label: '3 BB', value: h.bb * 3 }],
      min: h.bb + 1, ok: (v) => { closeSheet(); step((d) => L.setRaisedBefore(d, true, v)); },
    });
  },
  fold: () => {
    const s = current();
    const before = clone(s.draft);
    L.heroAction(s.draft, 'fold');
    finish(s, { result: 'folded' }, before);
  },
  check: () => step((h) => L.heroAction(h, 'check')),
  allin: () => step((h) => L.heroAction(h, 'allin')),
  call: () => {
    const h = current().draft;
    const f = L.facing(h);
    if (f.to !== null) { step((d) => L.heroAction(d, 'call', f.to)); return; }
    openAmount({
      title: 'Call to what amount', hint: hintFor(h), quick: quickAmounts(h, false), min: L.heroStreetTotal(h) + 1,
      ok: (v) => { closeSheet(); step((d) => L.heroAction(d, 'call', v)); },
    });
  },
  raise: (el) => {
    const h = current().draft;
    const type = el.dataset.v;
    const f = L.facing(h);
    const min = Math.max(L.heroStreetTotal(h), f.to ?? 0) + 1;
    const allIn = L.heroStreetTotal(h) + L.stackLeft(h);
    openAmount({
      title: type === 'bet' ? 'Bet' : 'Raise to', hint: hintFor(h), quick: quickAmounts(h, true), min: Math.min(min, allIn),
      ok: (v) => { closeSheet(); step((d) => L.heroAction(d, type, v)); },
    });
  },
  villain: () => {
    const h = current().draft;
    openAmount({
      title: 'Opponent bet', hint: 'Total on this street, optional.',
      quick: [{ label: '2 BB', value: h.bb * 2 }, { label: '3 BB', value: h.bb * 3 }],
      min: 1, skip: 'No amount',
      ok: (v) => { closeSheet(); step((d) => L.villainBet(d, v)); },
    });
  },
  nextStreet: () => step((h) => L.nextStreet(h)),
  handOver: () => step((h) => { h.phase = 'result'; }),
  showdown: () => step((h) => { h.showdown = !h.showdown; }),
  lost: () => {
    const s = current();
    finish(s, { result: 'lost' }, clone(s.draft));
  },
  collect: (el) => {
    const s = current();
    const result = el.dataset.v;
    openAmount({
      title: result === 'won' ? 'Chips collected' : 'Chips received',
      hint: `Include your own bet. You put in ${L.invested(s.draft)}.`, min: 1,
      ok: (v) => finish(s, { result, collected: v }, clone(s.draft)),
    });
  },
  undo: () => {
    const s = current();
    s.draft = s.undo.pop();
    saveSession(s);
    render();
  },
  undoHand: () => {
    const s = current();
    const id = s.lastHandId;
    const before = s.lastDraft;
    state.hands = state.hands.filter((h) => h.id !== id);
    guard(store.deleteHand(id));
    s.draft = before;
    s.draft.stackBefore = L.currentStack(s, handsOf(s.id));
    s.seat = before.seat;
    s.players = before.players;
    s.lastDraft = null;
    s.lastHandId = null;
    s.undo = [];
    saveSession(s);
    render();
  },

  // Стол
  menu: () => { state.sheet = { type: 'menu' }; renderSheet(); },
  buyin: () => openAmount({
    title: 'Rebuy', min: 1,
    ok: (v) => {
      const s = current();
      s.stackEvents.push({ id: uid(), type: 'buyin', amount: v, at: Date.now() });
      if (s.draft) s.draft.stackBefore += v;
      ensureDraft(s);
      saveSession(s);
      state.sheet = null;
      render();
    },
  }),
  fixStack: () => {
    const s = current();
    const left = s.draft ? L.stackLeft(s.draft) : L.currentStack(s, handsOf(s.id));
    openAmount({
      title: 'Actual chip count', value: left, min: 0,
      hint: 'The correction is saved with this session.',
      ok: (v) => {
        const diff = v - left;
        if (diff) s.stackEvents.push({ id: uid(), type: 'correction', amount: diff, at: Date.now() });
        if (s.draft) s.draft.stackBefore += diff;
        ensureDraft(s);
        saveSession(s);
        state.sheet = null;
        render();
      },
    });
  },
  tableEdit: () => {
    const s = current();
    state.sheet = { type: 'table', players: s.players, seat: s.seat };
    renderSheet();
  },
  sheetPlayers: (el) => {
    const t = state.sheet;
    t.players = Math.min(L.MAX_PLAYERS, Math.max(L.MIN_PLAYERS, t.players + Number(el.dataset.v)));
    t.seat = Math.min(t.seat, t.players);
    renderSheet();
  },
  sheetSeat: (el) => { state.sheet.seat = Number(el.dataset.v); renderSheet(); },
  tableSave: () => {
    const s = current();
    const old = s.draft;
    s.players = state.sheet.players;
    s.seat = state.sheet.seat;
    s.draft = null;
    ensureDraft(s);
    if (s.draft && old) {
      s.draft.id = old.id;
      s.draft.number = old.number;
      s.draft.cards = old.cards;
      s.draft.phase = old.phase;
      if (old.raisedBefore) L.setRaisedBefore(s.draft, true, old.actions.find((a) => a.pre)?.to ?? null);
    }
    saveSession(s);
    state.sheet = null;
    render();
  },
  submit: () => {
    const s = current();
    const hands = handsOf(s.id);
    const unfinished = s.draft && (s.draft.cards.length > 0 || L.hasDecided(s.draft));
    openAmount({
      title: 'Final stack', value: L.currentStack(s, hands), min: 0, okLabel: 'End session',
      hint: unfinished ? `Hand ${s.draft.number} isn’t finished and won’t be saved.` : 'Check this against your chips.',
      ok: (v) => {
        const diff = v - L.currentStack(s, hands);
        if (diff) s.stackEvents.push({ id: uid(), type: 'correction', amount: diff, at: Date.now() });
        s.finalStack = v;
        s.endedAt = Date.now();
        s.draft = null;
        s.undo = [];
        s.lastDraft = null;
        s.lastHandId = null;
        saveSession(s);
        state.summaryTab = 'overview';
        state.view = 'session';
        state.sheet = null;
        render();
      },
    });
  },

  // Шторка суммы
  key: (el) => {
    const t = state.sheet;
    const k = el.dataset.v;
    t.value = k === 'del' ? t.value.slice(0, -1) : (t.value + k).replace(/^0+(?=\d)/, '').slice(0, 7);
    t.error = '';
    renderSheet();
  },
  quick: (el) => state.sheet.ok(Number(el.dataset.v)),
  amountSkip: () => state.sheet.ok(null),
  amountOk: () => {
    const t = state.sheet;
    const v = Number(t.value);
    if (t.value === '' || v < (t.min ?? 0)) {
      t.error = `Enter ${t.min ?? 0} or more.`;
      renderSheet();
      return;
    }
    t.ok(v);
  },
  close: closeSheet,
  scrim: (el, event) => { if (event.target === el) closeSheet(); },

  // Итоги
  summaryTab: (el) => { state.summaryTab = el.dataset.v; render(); },
  handFilter: (el) => { state.handFilter = el.dataset.v; render(); },
  handDetail: (el) => { state.sheet = { type: 'detail', id: el.dataset.v }; renderSheet(); },
  deleteAsk: () => { state.sheet = { type: 'delete' }; renderSheet(); },
  deleteYes: () => {
    const s = current();
    const ids = handsOf(s.id).map((h) => h.id);
    state.sessions = state.sessions.filter((x) => x.id !== s.id);
    state.hands = state.hands.filter((h) => h.sessionId !== s.id);
    guard(store.deleteSession(s.id, ids));
    state.sheet = null;
    state.view = 'home';
    render();
  },
  exportJson: () => shareFile(
    `poker-diary-${new Date().toISOString().slice(0, 10)}.json`, 'application/json',
    JSON.stringify({ app: 'poker-diary', version: 1, sessions: state.sessions, hands: state.hands }, null, 1),
  ),
  exportCsv: () => shareFile(
    `poker-diary-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv',
    `﻿${L.csvRows(state.sessions, state.hands)}`,
  ),
  importFile: () => document.getElementById('importInput').click(),
  reload: () => location.reload(),
};

function hintFor(h) {
  const total = L.heroStreetTotal(h);
  const left = L.stackLeft(h);
  return total ? `Already in on this street: ${total}. Left: ${left}.` : `Left: ${left}.`;
}

async function shareFile(name, type, text) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch { /* пользователь закрыл меню */ }
    return;
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'poker-diary' || !Array.isArray(data.sessions) || !Array.isArray(data.hands)) throw new Error();
    await store.putMany(data.sessions, data.hands);
    const loaded = await store.load();
    state.sessions = loaded.sessions;
    state.hands = loaded.hands;
    state.importMessage = `Restored tables: ${data.sessions.length}, hands: ${data.hands.length}.`;
  } catch {
    state.importMessage = 'This file doesn’t fit. Choose a backup saved from this app.';
  }
  render();
}

// Отрисовка

const miniCard = (c) => (c
  ? `<span class="pc s-${c[1]}">${c[0] === 'T' ? '10' : c[0]}<small>${L.SUIT_SYMBOLS[c[1]]}</small></span>`
  : '<span class="pc blank"></span>');

function rail(h) {
  const heroCards = [0, 1].map((i) => miniCard(h.cards[i])).join('');
  const board = [0, 1, 2, 3, 4].map((i) => miniCard(h.board[i])).join('');
  return `<div class="rail" aria-label="Cards">${heroCards}<span class="gap"></span>${board}</div>`;
}

function picker(h) {
  const used = new Set([...h.cards, ...h.board].filter(Boolean));
  const tile = (rank, suit) => {
    const card = rank + suit;
    return `<button class="tile s-${suit}" data-a="card" data-v="${card}" ${used.has(card) ? 'disabled' : ''}
      aria-label="${rank === 'T' ? '10' : rank}${L.SUIT_SYMBOLS[suit]}">${rank === 'T' ? '10' : rank}<small>${L.SUIT_SYMBOLS[suit]}</small></button>`;
  };
  const blocks = L.SUITS.map((suit) => [
    ...L.RANKS.map((rank) => tile(rank, suit)),
    `<span class="tile mark s-${suit}" aria-hidden="true">${L.SUIT_SYMBOLS[suit]}</span>`,
  ].join(''));
  return `<div class="picker">${blocks.join('<span class="sep"></span>')}</div>`;
}

const raisedToggle = (h) => `
  <button class="toggle" data-a="toggleRaised" aria-pressed="${h.raisedBefore}">
    <span>Raised before me</span><i></i>
  </button>`;

function log(h) {
  const lines = L.handLines(h);
  return `<ul class="log">${lines.map((l) => `<li><b>${esc(l.title)}:</b> ${esc(l.text) || '<span class="muted">no actions</span>'}</li>`).join('')}</ul>`;
}

function handView(s) {
  const h = s.draft;
  if (!h) {
    return `<div class="page"><h1>Out of chips</h1><p class="muted" style="margin:8px 0 20px">Rebuy or end the session.</p>
      <div class="stack"><button class="primary" data-a="buyin">Rebuy</button>
      <button class="secondary" data-a="submit">End session</button>
      <button class="link" data-a="home">Home</button></div></div>`;
  }
  const f = L.facing(h);
  const canUndo = (s.undo ?? []).length > 0;
  const preDecision = h.street === 'preflop' && !L.hasDecided(h);
  const last = handsOf(s.id).find((x) => x.id === s.lastHandId);
  let body = '';
  let foot = '';

  if (h.phase === 'cards') {
    body = `${raisedToggle(h)}${picker(h)}`;
    foot = `${last && s.lastDraft ? `<div class="lasthand"><span>Hand ${last.number}: ${signed(last.net)}</span><button class="link small" data-a="undoHand">Restore</button></div>` : ''}
      <div class="choices"><button class="act red" data-a="fold">Fold</button>
      <button class="act low" data-a="skipCards">No cards</button></div>`;
  } else if (h.phase === 'board') {
    const left = L.boardNeeded(h) - h.board.length;
    body = `<p class="prompt">${L.STREET_NAMES[h.street]}: ${left === 1 ? 'pick a card' : `pick ${left} more`}</p>${picker(h)}`;
    foot = '<button class="act low" style="width:100%" data-a="skipBoard">Skip cards</button>';
  } else if (h.phase === 'decide') {
    const toggle = preDecision ? raisedToggle(h) : '';
    const preRaise = h.actions.find((a) => a.pre);
    const amount = preRaise && preDecision
      ? `<button class="link" data-a="raiseAmount">${preRaise.to ? `Raise amount: ${preRaise.to}` : 'Add raise amount'}</button>` : '';
    body = `${toggle}${amount}${log(h)}`;
    const opts = L.heroOptions(h);
    const buttons = {
      fold: '<button class="act red" data-a="fold">Fold</button>',
      check: '<button class="act ivory" data-a="check">Check</button>',
      call: () => {
        const paid = f.to === null ? null : Math.min(f.to - L.heroStreetTotal(h), L.stackLeft(h));
        return `<button class="act ivory" data-a="call">Call${f.to ? ` ${f.to}` : ''}${paid !== null ? `<small>costs ${paid}</small>` : ''}</button>`;
      },
      raise: '<button class="act gold" data-a="raise" data-v="raise">Raise</button>',
      bet: '<button class="act gold" data-a="raise" data-v="bet">Bet</button>',
      allin: `<button class="act" data-a="allin">All-in<small>${L.stackLeft(h)}</small></button>`,
    };
    foot = `<div class="choices">${opts.map((o) => (typeof buttons[o] === 'function' ? buttons[o]() : buttons[o])).join('')}
      ${!f.facing && h.street !== 'preflop' ? '<button class="act low" data-a="villain">Opponent bet</button>' : ''}
      ${h.street === 'preflop' && !f.facing ? '<button class="act low" data-a="handOver">Everyone folded</button>' : ''}</div>`;
  } else if (h.phase === 'next') {
    body = log(h);
    const river = h.street === 'river';
    foot = `<p class="prompt">What’s next?</p><div class="choices">
      <button class="act gold wide" data-a="villain">Opponent bet</button>
      <button class="act ivory" data-a="nextStreet">${river ? 'Showdown' : 'Next street'}</button>
      <button class="act" data-a="handOver">Hand over</button></div>`;
  } else if (h.phase === 'result') {
    body = log(h);
    foot = `<p class="prompt">Hand result</p>
      <button class="toggle" data-a="showdown" aria-pressed="${h.showdown}"><span>Went to showdown</span><i></i></button>
      <div class="choices"><button class="act gold wide" data-a="collect" data-v="won">Won</button>
      <button class="act red" data-a="lost">Lost<small>${MINUS}${L.invested(h)}</small></button>
      <button class="act" data-a="collect" data-v="split">Split pot</button></div>`;
  }

  const left = L.stackLeft(h);
  return `<div class="hand">
    <div class="handtop">
      <button class="disc ${h.position.length > 3 ? 'long' : ''}" data-a="home" aria-label="Home, position ${h.position}"><span>${h.position}</span><small>SLOWPLAY</small></button>
      <div class="handinfo"><b>${num(left)}</b><span class="muted small">Hand ${h.number}, blinds ${h.sb}/${h.bb}</span></div>
      <div class="topactions"><button data-a="menu">Table</button>
      <button data-a="undo" ${canUndo ? '' : 'disabled'}>Undo</button></div>
    </div>
    ${rail(h)}
    <div class="handbody">${body}</div>
    <div class="handfoot">${foot}</div>
  </div>`;
}

function homeView() {
  const active = activeSession();
  const nav = `<nav class="nav">${[['tables', 'Tables'], ['stats', 'Stats'], ['data', 'Data']]
    .map(([k, t]) => `<button data-a="tab" data-v="${k}" aria-current="${state.tab === k}">${t}</button>`).join('')}</nav>`;
  let body = '';
  if (state.tab === 'tables') {
    const list = finishedSessions();
    body = `<h1>Poker Diary</h1>
      ${active ? `<button class="resume" data-a="resume"><strong>${esc(active.name)}</strong>
        Back to the table: hand ${(handsOf(active.id).at(-1)?.number ?? 0) + 1}, stack ${num(L.currentStack(active, handsOf(active.id)))}</button>`
      : '<div class="stack" style="margin-top:16px"><button class="primary" data-a="newTable">New table</button></div>'}
      ${list.length ? '<h2>Sessions</h2>' : active ? '' : '<p class="empty">No sessions yet. Create a table before you play and your hands will be saved here.</p>'}
      ${list.map((s) => {
        const sum = L.sessionSummary(s, handsOf(s.id));
        return `<button class="row" data-a="open" data-v="${s.id}"><span class="grow"><span class="title" style="display:block">${esc(s.name)}</span>
          <span class="muted small">${dateText(s.startedAt)}, hands: ${sum.hands}</span></span><b class="${tone(sum.result)}">${signed(sum.result)}</b></button>`;
      }).join('')}`;
  } else if (state.tab === 'stats') {
    body = overallStats();
  } else {
    body = `<h1>Data</h1>
      <p class="muted" style="margin-top:8px">Everything is stored only on this phone. Save a backup regularly: deleting the app deletes your data.</p>
      <div class="stack" style="margin-top:16px">
        <button class="primary" data-a="exportJson">Save backup</button>
        <button class="secondary" data-a="importFile">Restore backup</button>
        <button class="secondary" data-a="exportCsv">Export hands to CSV</button>
      </div>
      <input id="importInput" type="file" accept=".json,application/json" hidden>
      ${state.importMessage ? `<p style="margin-top:14px">${esc(state.importMessage)}</p>` : ''}
      <p class="muted small" style="margin-top:24px">Version ${VERSION}</p>`;
  }
  return `<div class="page">${body}</div>${nav}`;
}

function overallStats() {
  const f = state.filters;
  const done = finishedSessions();
  const since = { all: 0, d30: Date.now() - 30 * 864e5, d90: Date.now() - 90 * 864e5 }[f.period];
  const sessions = done.filter((s) => s.startedAt >= since
    && (f.session === 'all' || s.id === f.session)
    && (f.blinds === 'all' || `${s.sb}/${s.bb}` === f.blinds));
  const ids = new Set(sessions.map((s) => s.id));
  const hands = state.hands.filter((h) => ids.has(h.sessionId) && (f.position === 'all' || h.position === f.position));
  const whole = f.position === 'all';
  const stats = L.computeStats(hands, {
    corrections: whole ? sessions.reduce((a, s) => a + L.correctionsTotal(s), 0) : 0,
    correctionsBB: whole ? sessions.reduce((a, s) => a + L.correctionsTotal(s) / s.bb, 0) : 0,
    hours: whole ? sessions.reduce((a, s) => a + L.sessionSummary(s, handsOf(s.id)).hours, 0) : 0,
  });
  const option = (key, value, label) => `<option value="${esc(value)}" ${f[key] === value ? 'selected' : ''}>${esc(label)}</option>`;
  const blinds = [...new Set(done.map((s) => `${s.sb}/${s.bb}`))];
  const positions = [...new Set(state.hands.map((h) => h.position))];
  const filters = `<div class="filters">
    <label class="field"><span>Period</span><select data-filter="period">${option('period', 'all', 'All time')}${option('period', 'd30', '30 days')}${option('period', 'd90', '90 days')}</select></label>
    <label class="field"><span>Session</span><select data-filter="session">${option('session', 'all', 'All')}${done.map((s) => option('session', s.id, s.name)).join('')}</select></label>
    <label class="field"><span>Blinds</span><select data-filter="blinds">${option('blinds', 'all', 'All')}${blinds.map((b) => option('blinds', b, b)).join('')}</select></label>
    <label class="field"><span>Position</span><select data-filter="position">${option('position', 'all', 'All')}${positions.map((p) => option('position', p, p)).join('')}</select></label>
  </div>`;
  if (!done.length) {
    return '<h1>Stats</h1><p class="empty">Stats appear after your first finished session.</p>';
  }
  const ordered = [...sessions].reverse();
  let bank = 0;
  const points = [{ y: 0, label: 'Start' }, ...ordered.map((s) => {
    bank += L.sessionSummary(s, handsOf(s.id)).result;
    return { y: bank, label: `${s.name}: total ${signed(bank)} lei` };
  })];
  return `<h1>Stats</h1><h2>Filters</h2>${filters}
    <div class="bigresult ${tone(stats.net)}">${signed(stats.net)} lei</div>
    <p class="muted">Sessions: ${sessions.length}, hands: ${stats.hands}</p>
    ${whole ? `<h2>Bankroll</h2>${chart(points, 'Bankroll by session', 0)}` : ''}
    ${statsBlock(stats)}`;
}

function statsBlock(s) {
  const stat = (name, r) => `<div class="stat"><span>${name}</span><b>${pct(r)}</b><small>${r.n} of ${r.d}</small></div>`;
  const plain = (name, value) => `<div class="stat"><span>${name}</span><b>${value}</b></div>`;
  const sign = (list) => list.map((x) => `<tr><td>${x.hand}</td><td>${x.hands}</td><td class="${tone(x.net)}">${signed(x.net)}</td></tr>`).join('');
  return `<h2>Numbers</h2>
    ${stat('VPIP, entered the pot', s.vpip)}
    ${stat('PFR, preflop raise', s.pfr)}
    ${stat('3-bet', s.threeBet)}
    ${stat('Preflop raise and win', s.pfrWin)}
    ${stat('Won without showdown', s.winNoShowdown)}
    ${stat('Check-raise', s.checkRaise)}
    ${stat('WTSD, went to showdown', s.wtsd)}
    ${stat('W$SD, won at showdown', s.wsd)}
    ${plain('Win rate, BB per 100 hands', s.bb100 === null ? 'no data' : signed(s.bb100, 1))}
    ${s.perHour === null ? '' : plain('Result per hour', `${signed(s.perHour)} lei`)}
    ${s.positions.length ? `<h2>By position</h2><table><tr><th>Position</th><th>Hands</th><th>VPIP</th><th>Lei</th></tr>
      ${s.positions.map((p) => `<tr><td>${p.position}</td><td>${p.hands}</td><td>${Math.round((p.vpip / p.hands) * 100)}%</td><td class="${tone(p.net)}">${signed(p.net)}</td></tr>`).join('')}</table>` : ''}
    ${s.bestHands.length ? `<h2>Best hands</h2><table><tr><th>Hand</th><th>Hands</th><th>Lei</th></tr>${sign(s.bestHands)}</table>` : ''}
    ${s.worstHands.length ? `<h2>Worst hands</h2><table><tr><th>Hand</th><th>Hands</th><th>Lei</th></tr>${sign(s.worstHands)}</table>` : ''}`;
}

// Один ряд значений: линия, линия отсчёта и подпись по нажатию.
function chart(points, title, baseline) {
  if (points.length < 2) return '<p class="muted">Not enough data for a chart yet.</p>';
  const w = 340, h = 150, pad = 8;
  const ys = points.map((p) => p.y).concat(baseline);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const span = hi - lo || 1;
  const x = (i) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v) => pad + (1 - (v - lo) / span) * (h - pad * 2);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const data = esc(JSON.stringify(points.map((p, i) => ({ x: x(i), y: y(p.y), label: p.label }))));
  const end = points.at(-1);
  return `<div class="chart" data-points="${data}">
    <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
      <line x1="${pad}" x2="${w - pad}" y1="${y(baseline)}" y2="${y(baseline)}" stroke="#a89f90" stroke-width="1" stroke-dasharray="4 4"/>
      <polyline points="${line}" fill="none" stroke="#c9a35b" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle class="dot" cx="${x(points.length - 1)}" cy="${y(end.y)}" r="5" fill="#c9a35b" stroke="#121114" stroke-width="2"/>
    </svg><p class="charttip">${esc(end.label)}</p></div>`;
}

function sessionView(s) {
  const hands = handsOf(s.id);
  const sum = L.sessionSummary(s, hands);
  const tabs = `<div class="segments">${[['overview', 'Summary'], ['stats', 'Stats'], ['hands', 'Hands']]
    .map(([k, t]) => `<button data-a="summaryTab" data-v="${k}" aria-pressed="${state.summaryTab === k}">${t}</button>`).join('')}</div>`;
  let body = '';
  if (state.summaryTab === 'overview') {
    const row = (name, value) => `<div class="stat"><span>${name}</span><b>${value}</b></div>`;
    const corrections = L.correctionsTotal(s);
    const points = [{ y: s.startStack, label: `Start: ${num(s.startStack)}` }, ...hands.map((h) => ({
      y: h.stackBefore + h.net, label: `Hand ${h.number}: stack ${num(h.stackBefore + h.net)}`,
    }))];
    body = `<div class="bigresult ${tone(sum.result)}">${signed(sum.result)} lei</div>
      <p class="muted">${signed(sum.resultBB, 1)} BB</p>
      <h2>Stack chart</h2>${chart(points, 'Stack by hand', s.startStack)}
      <h2>Details</h2>
      ${row('Starting stack', num(s.startStack))}
      ${row('Rebuys', num(sum.buyIns))}
      ${corrections ? row('Stack corrections', signed(corrections)) : ''}
      ${row('Final stack', num(sum.finalStack))}
      ${row('Time played', hoursText(sum.hours))}
      ${sum.perHour === null ? '' : row('Result per hour', `${signed(sum.perHour)} lei`)}
      ${row('Hands', sum.hands)}
      <button class="danger" style="margin-top:28px" data-a="deleteAsk">Delete session</button>`;
  } else if (state.summaryTab === 'stats') {
    body = statsBlock(L.computeStats(hands, {
      corrections: L.correctionsTotal(s), correctionsBB: L.correctionsTotal(s) / s.bb, hours: sum.hours,
    }));
  } else {
    const big = (h) => Math.max(h.collected, h.invested) >= 20 * h.bb;
    const tests = {
      all: () => true, won: (h) => h.net > 0, lost: (h) => h.net < 0, big,
    };
    const list = hands.filter(tests[state.handFilter]);
    const chips = [['all', 'All'], ['won', 'Won'], ['lost', 'Lost'], ['big', '20+ BB']]
      .map(([k, t]) => `<button data-a="handFilter" data-v="${k}" aria-pressed="${state.handFilter === k}">${t}</button>`).join('');
    body = `<div class="chips">${chips}</div>
      ${list.length ? list.map((h) => `<button class="row" data-a="handDetail" data-v="${h.id}">
        <span class="muted" style="width:32px">${h.number}</span><span style="width:52px">${h.position}</span>
        <span class="grow">${esc(L.cardsText(h.cards)) || '<span class="muted">no cards</span>'}</span>
        <b class="${tone(h.net)}">${signed(h.net)}</b></button>`).join('') : '<p class="empty">No hands here.</p>'}`;
  }
  return `<div class="topbar"><button class="link" data-a="home">Back</button><h1>${esc(s.name)}</h1></div>
    <div class="page" style="padding-top:0">${tabs}${body}</div>`;
}

function setupView() {
  const f = state.form;
  const names = L.positionNames(f.players);
  return `<div class="topbar"><button class="link" data-a="home">Cancel</button><h1>New table</h1></div>
    <div class="page" style="padding-top:0">
      <label class="field"><span>Table name</span><input data-f="name" value="${esc(f.name)}" autocomplete="off"></label>
      <label class="field"><span>Starting stack, chips</span><input data-f="stack" value="${esc(f.stack)}" inputmode="numeric"></label>
      <div class="two">
        <label class="field"><span>Small blind</span><input data-f="sb" value="${esc(f.sb)}" inputmode="numeric"></label>
        <label class="field"><span>Big blind</span><input data-f="bb" value="${esc(f.bb)}" inputmode="numeric"></label>
      </div>
      <div class="field"><span>Players at the table</span>
        <div class="stepper"><button data-a="setPlayers" data-v="-1" aria-label="Fewer">−</button><b>${f.players}</b>
        <button data-a="setPlayers" data-v="1" aria-label="More">+</button></div></div>
      <div class="field"><span>Your seat from the button</span>
        <div class="seats">${names.map((p, i) => `<button class="seat" data-a="setSeat" data-v="${i + 1}" aria-pressed="${f.seat === i + 1}"><b>${i + 1}</b><small>${p}</small></button>`).join('')}</div></div>
      <p class="error">${esc(f.error)}</p>
    </div>
    <div class="formfoot"><button class="primary" data-a="start">Start recording</button></div>`;
}

function renderSheet() {
  const t = state.sheet;
  if (!t) { sheetEl.innerHTML = ''; return; }
  const s = current();
  const wrap = (html) => `<div class="scrim" data-a="scrim"><div class="panel" role="dialog" aria-modal="true">${html}</div></div>`;
  if (t.type === 'amount') {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0'];
    sheetEl.innerHTML = wrap(`
      <div class="panelhead"><h2>${esc(t.title)}</h2><button class="link" data-a="close">Close</button></div>
      ${t.hint ? `<p class="muted small">${esc(t.hint)}</p>` : ''}
      <div class="amount">${esc(t.value || '0')}</div>
      ${t.quick ? `<div class="quick">${t.quick.map((q) => `<button data-a="quick" data-v="${q.value}">${esc(q.label)}</button>`).join('')}</div>` : ''}
      <div class="keys">${keys.map((k) => `<button data-a="key" data-v="${k}" ${k === 'del' ? 'aria-label="Delete"' : ''}>${k === 'del' ? '⌫' : k}</button>`).join('')}
      <button data-a="amountOk" style="background:var(--brass);color:var(--brass-ink)" aria-label="Done">OK</button></div>
      ${t.error ? `<p class="error">${esc(t.error)}</p>` : ''}
      ${t.okLabel ? `<button class="primary" data-a="amountOk">${esc(t.okLabel)}</button>` : ''}
      ${t.skip ? `<button class="secondary" data-a="amountSkip">${esc(t.skip)}</button>` : ''}`);
  } else if (t.type === 'menu') {
    const locked = s.draft && L.hasDecided(s.draft);
    sheetEl.innerHTML = wrap(`
      <div class="panelhead"><h2>${esc(s.name)}</h2><button class="link" data-a="close">Close</button></div>
      <button class="secondary" data-a="buyin">Rebuy</button>
      <button class="secondary" data-a="fixStack">Fix stack</button>
      <button class="secondary" data-a="tableEdit" ${locked ? 'disabled' : ''}>Players and seat</button>
      ${locked ? '<p class="muted small" style="margin-top:6px">Players and seat can change until your first action in a hand.</p>' : ''}
      <button class="primary" data-a="submit">End session</button>
      <button class="link" data-a="home" style="width:100%;margin-top:8px">Home</button>`);
  } else if (t.type === 'table') {
    const names = L.positionNames(t.players);
    sheetEl.innerHTML = wrap(`
      <div class="panelhead"><h2>Players and seat</h2><button class="link" data-a="close">Close</button></div>
      <div class="stepper"><button data-a="sheetPlayers" data-v="-1" aria-label="Fewer">−</button><b>${t.players}</b>
      <button data-a="sheetPlayers" data-v="1" aria-label="More">+</button></div>
      <div class="seats" style="margin-top:12px">${names.map((p, i) => `<button class="seat" data-a="sheetSeat" data-v="${i + 1}" aria-pressed="${t.seat === i + 1}"><b>${i + 1}</b><small>${p}</small></button>`).join('')}</div>
      <button class="primary" data-a="tableSave">Save</button>`);
  } else if (t.type === 'detail') {
    const h = state.hands.find((x) => x.id === t.id);
    const lines = L.handLines(h);
    sheetEl.innerHTML = wrap(`
      <div class="panelhead"><h2>Hand ${h.number}</h2><button class="link" data-a="close">Close</button></div>
      <p>${h.position}, ${esc(L.cardsText(h.cards) || 'no cards')}, blinds ${h.sb}/${h.bb}</p>
      <ul class="log" style="margin:10px 0">${lines.map((l) => `<li><b>${esc(l.title)}:</b> ${esc(l.text) || 'no actions'}</li>`).join('')}</ul>
      <p><b class="${tone(h.net)}">Result: ${signed(h.net)}</b>, stack ${num(h.stackBefore)} → ${num(h.stackBefore + h.net)}${h.showdown ? ', showdown' : ''}</p>`);
  } else if (t.type === 'delete') {
    sheetEl.innerHTML = wrap(`
      <div class="panelhead"><h2>Delete “${esc(s.name)}”?</h2></div>
      <p class="muted">All hands from this session will be permanently deleted.</p>
      <button class="danger" data-a="deleteYes">Delete session</button>
      <button class="secondary" data-a="close">Keep</button>`);
  }
}

function render() {
  let html;
  if (state.view === 'setup') html = setupView();
  else if (state.view === 'hand') html = handView(current());
  else if (state.view === 'session') html = sessionView(current());
  else html = homeView();
  const alerts = [
    state.storageError ? '<div class="update"><span>Couldn’t save. Check free space on your phone.</span></div>' : '',
    state.updateReady && state.view === 'home' ? '<div class="update"><span>New version ready</span><button data-a="reload">Update</button></div>' : '',
  ].join('');
  const scroller = appEl.querySelector('.page');
  const top = scroller?.scrollTop ?? 0;
  appEl.innerHTML = html + alerts;
  const next = appEl.querySelector('.page');
  if (next && render.lastKey === `${state.view}:${state.tab}:${state.summaryTab}`) next.scrollTop = top;
  render.lastKey = `${state.view}:${state.tab}:${state.summaryTab}`;
  renderSheet();
}

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const name = el.dataset.a;
  if (name === 'home') state.sheet = null;
  handlers[name]?.(el, event);
});

document.addEventListener('input', (event) => {
  const key = event.target.dataset.f;
  if (key) state.form[key] = event.target.value;
});

document.addEventListener('change', (event) => {
  const key = event.target.dataset.filter;
  if (key) { state.filters[key] = event.target.value; render(); }
  if (event.target.id === 'importInput' && event.target.files[0]) importData(event.target.files[0]);
});

function chartPointer(event) {
  const box = event.target.closest('.chart');
  if (!box) return;
  const points = JSON.parse(box.dataset.points);
  const rect = box.querySelector('svg').getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 340;
  const nearest = points.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
  const dot = box.querySelector('.dot');
  dot.setAttribute('cx', nearest.x);
  dot.setAttribute('cy', nearest.y);
  box.querySelector('.charttip').textContent = nearest.label;
}
document.addEventListener('pointerdown', chartPointer);
document.addEventListener('pointermove', chartPointer);

async function main() {
  try {
    const data = await store.load();
    state.sessions = data.sessions;
    state.hands = data.hands;
  } catch {
    state.storageError = true;
  }
  const active = activeSession();
  if (active) {
    state.sessionId = active.id;
    ensureDraft(active);
    state.view = 'hand';
  }
  render();
  if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) { state.updateReady = true; render(); }
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main();
