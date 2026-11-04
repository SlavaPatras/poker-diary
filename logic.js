// Чистая логика покера: позиции, стек, раздача, статистика. Без DOM и хранилища.

export const STREETS = ['preflop', 'flop', 'turn', 'river'];
export const STREET_NAMES = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };
export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
export const SUITS = ['s', 'h', 'd', 'c'];
export const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };

const POSITIONS = {
  2: ['BTN', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'UTG'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  7: ['BTN', 'SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'LJ', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'],
  10: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO'],
};
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

export const positionNames = (players) => POSITIONS[players];
export const positionFor = (players, seat) => POSITIONS[players][seat - 1];
export const nextSeat = (seat, players) => (seat <= 1 ? players : seat - 1);

// Какой блайнд платит игрок. Вдвоём номер 1 — баттон и малый блайнд.
export function blindType(players, seat) {
  if (players === 2) return seat === 1 ? 'sb' : 'bb';
  if (seat === 2) return 'sb';
  if (seat === 3) return 'bb';
  return null;
}

const nextClockwise = (seat, players) => (seat >= players ? 1 : seat + 1);

export function newHand({ id, session, number, players, seat, stack, now }) {
  const hand = {
    id,
    sessionId: session.id,
    number,
    players,
    seat,
    position: positionFor(players, seat),
    sb: session.sb,
    bb: session.bb,
    stackBefore: stack,
    cards: [],
    board: [],
    raisedBefore: false,
    actions: [],
    street: 'preflop',
    phase: 'cards',
    showdown: false,
    result: null,
    collected: 0,
    invested: 0,
    net: 0,
    pot: 0,
    startedAt: now,
    endedAt: null,
  };
  for (let number = 1; number <= players; number += 1) {
    const blind = blindType(players, number);
    if (!blind) continue;
    const size = blind === 'sb' ? session.sb : session.bb;
    const hero = number === seat;
    const amount = hero ? Math.min(size, stack) : size;
    hand.actions.push({
      street: 'preflop', who: hero ? 'hero' : 'villain', seat: number,
      pos: positionFor(players, number), type: 'blind', to: amount, paid: amount,
    });
  }
  return hand;
}

const heroActions = (h, street) =>
  h.actions.filter((a) => a.who === 'hero' && (!street || a.street === street));

export const invested = (h) => heroActions(h).reduce((sum, a) => sum + a.paid, 0);
export const stackLeft = (h) => h.stackBefore - invested(h);
export const heroStreetTotal = (h, street = h.street) =>
  heroActions(h, street).reduce((sum, a) => sum + a.paid, 0);

// Пока никто не сделал ход, настройки стола ещё можно менять.
export const hasDecided = (h) => h.actions.some((a) => a.type !== 'blind' && !a.pre);

// Полная картина стола восстанавливается из записанных действий.
export function tableState(h) {
  const n = h.players;
  const seats = Array.from({ length: n }, (_, i) => ({
    seat: i + 1, position: positionFor(n, i + 1), folded: false, allin: false, bet: 0, total: 0, last: null,
  }));
  const at = (seat) => seats[seat - 1];
  const street = h.street;
  let bet = street === 'preflop' ? h.bb : 0;
  const acted = new Set();
  let lastSeat = null;

  for (const a of h.actions) {
    if (!a.seat || a.pre) continue;
    const seat = at(a.seat);
    seat.total += a.paid;
    if (a.type === 'fold') seat.folded = true;
    if (a.type === 'allin') seat.allin = true;
    if (a.street !== street) continue;
    seat.bet += a.paid;
    if (a.type === 'blind') continue;
    seat.last = a;
    lastSeat = a.seat;
    acted.add(a.seat);
    if (seat.bet > bet) {
      bet = seat.bet;
      acted.clear();
      acted.add(a.seat);
    }
  }

  if (h.stackBefore - seats[h.seat - 1].total <= 0) seats[h.seat - 1].allin = true;
  const canAct = (s) => !s.folded && !s.allin;
  const open = seats.filter(canAct);
  const needs = (s) => canAct(s) && (!acted.has(s.seat) || s.bet < bet);
  const alone = open.length <= 1 && open.every((s) => s.bet >= bet);
  let first = street === 'preflop' ? (n === 2 ? 1 : nextClockwise(3, n)) : 2;
  if (lastSeat) first = nextClockwise(lastSeat, n);
  let actor = null;
  if (!alone) {
    for (let i = 0, seat = first; i < n; i += 1, seat = nextClockwise(seat, n)) {
      if (needs(at(seat))) { actor = seat; break; }
    }
  }
  return {
    seats, street, bet, actor,
    pot: seats.reduce((sum, s) => sum + s.total, 0),
    active: seats.filter((s) => !s.folded).length,
    hero: at(h.seat),
  };
}

export function optionsFor(h, seat) {
  const st = tableState(h);
  const owes = st.bet > st.seats[seat - 1].bet;
  if (owes) return ['fold', 'call', 'raise', 'allin'];
  return ['check', st.bet > 0 ? 'raise' : 'bet', 'allin'];
}

// Для быстрого сброса с первого экрана: остальные ходы до тебя тогда не вводятся.
export function setRaisedBefore(h, value) {
  h.actions = h.actions.filter((a) => !a.pre);
  h.raisedBefore = value;
  if (value) h.actions.push({ street: 'preflop', who: 'villain', type: 'raise', to: null, pre: true });
}

function advance(h) {
  const st = tableState(h);
  if (st.hero.folded) return;
  if (st.active === 1) { h.autoWin = true; return; }
  if (st.actor !== null) { h.phase = 'table'; return; }
  const index = STREETS.indexOf(h.street);
  if (index === STREETS.length - 1) {
    h.showdown = true;
    h.phase = 'result';
    return;
  }
  h.street = STREETS[index + 1];
  h.phase = 'board';
}

// to — сумма игрока на этой улице («до»).
export function act(h, seat, type, to) {
  const st = tableState(h);
  const player = st.seats[seat - 1];
  const hero = seat === h.seat;
  const base = {
    street: h.street, who: hero ? 'hero' : 'villain', seat, pos: player.position,
  };
  if (type === 'fold' || type === 'check') {
    h.actions.push({ ...base, type, to: player.bet, paid: 0 });
  } else {
    const left = hero ? stackLeft(h) : Infinity;
    let target = player.bet + left;
    if (type === 'call') target = st.bet;
    else if (type !== 'allin' || !hero) target = to;
    const paid = Math.min(Math.max(0, target - player.bet), left);
    const total = player.bet + paid;
    const kindOf = total <= st.bet ? 'call' : st.bet > 0 ? 'raise' : 'bet';
    const action = { ...base, type, to: total, paid };
    if (type === 'allin') action.as = kindOf;
    else if (hero && paid === left && paid > 0) { action.as = type; action.type = 'allin'; }
    h.actions.push(action);
  }
  advance(h);
}

export function foldToHero(h) {
  for (let i = 0; i < h.players; i += 1) {
    const { actor } = tableState(h);
    if (actor === null || actor === h.seat) break;
    h.actions.push({
      street: h.street, who: 'villain', seat: actor, pos: positionFor(h.players, actor),
      type: 'fold', to: 0, paid: 0,
    });
  }
  advance(h);
}

export const boardNeeded = (h) => ({ flop: 3, turn: 4, river: 5 }[h.street] ?? 0);

export function addBoardCard(h, card) {
  h.board.push(card);
  if (h.board.length >= boardNeeded(h)) { h.phase = 'table'; advance(h); }
}

// Пропущенные общие карты остаются пустыми, чтобы следующие улицы не сдвинулись.
export function skipBoard(h) {
  while (h.board.length < boardNeeded(h)) h.board.push(null);
  h.phase = 'table';
  advance(h);
}

export function startTable(h) {
  setRaisedBefore(h, false);
  h.phase = 'table';
  advance(h);
}

export function finishHand(h, { result, collected = 0, showdown = h.showdown }, now) {
  h.pot = tableState(h).pot;
  delete h.autoWin;
  h.result = result;
  h.collected = result === 'won' || result === 'split' ? collected : 0;
  h.showdown = result === 'folded' ? false : showdown;
  h.invested = invested(h);
  h.net = h.collected - h.invested;
  h.phase = 'done';
  h.endedAt = now;
}

export const eventsTotal = (session) =>
  (session.stackEvents ?? []).reduce((sum, e) => sum + e.amount, 0);

export const buyInsTotal = (session) =>
  (session.stackEvents ?? []).filter((e) => e.type === 'buyin').reduce((sum, e) => sum + e.amount, 0);

export const correctionsTotal = (session) =>
  (session.stackEvents ?? []).filter((e) => e.type === 'correction').reduce((sum, e) => sum + e.amount, 0);

export const currentStack = (session, hands) =>
  session.startStack + eventsTotal(session) + hands.reduce((sum, h) => sum + h.net, 0);

export function sessionSummary(session, hands) {
  const end = session.endedAt ?? hands.at(-1)?.endedAt ?? session.startedAt;
  const hours = (end - session.startedAt) / 3600000;
  const finalStack = session.finalStack ?? currentStack(session, hands);
  const buyIns = buyInsTotal(session);
  const result = finalStack - session.startStack - buyIns;
  return {
    result,
    resultBB: result / session.bb,
    buyIns,
    finalStack,
    hours,
    perHour: hours > 0 ? result / hours : null,
    hands: hands.length,
  };
}

// Японские свечи: результат вечера относительно старта, сгруппированный по равным отрезкам времени.
export function stackCandles(session, hands, slots = 24) {
  const start = session.startedAt;
  const end = Math.max(session.endedAt ?? start, hands.at(-1)?.endedAt ?? start, start + 1);
  const items = [
    ...hands.map((h) => ({ at: h.endedAt, delta: h.net, dip: h.invested, hand: h.number })),
    ...(session.stackEvents ?? []).filter((e) => e.type === 'correction')
      .map((e) => ({ at: e.at ?? end, delta: e.amount, dip: 0, hand: null })),
  ].sort((a, b) => a.at - b.at);
  const span = (end - start) / slots;
  const candles = new Map();
  let run = 0;
  for (const item of items) {
    const index = Math.min(slots - 1, Math.max(0, Math.floor((item.at - start) / span)));
    const open = run;
    run += item.delta;
    const candle = candles.get(index) ?? {
      index, at: start + (index + 0.5) * span, open, close: run, high: open, low: open, hands: [],
    };
    candle.close = run;
    candle.high = Math.max(candle.high, open, run);
    candle.low = Math.min(candle.low, open - item.dip, run);
    if (item.hand !== null) candle.hands.push(item.hand);
    candles.set(index, candle);
  }
  return { start, end, slots, candles: [...candles.values()] };
}

// Одна рука после всех поправок: олл-ин считается тем действием, которым был.
const kind = (a) => a.as ?? a.type;

function sawFlop(h) {
  return h.showdown || STREETS.indexOf(h.street) >= 1;
}

function firstDecision(h) {
  const preflop = h.actions.filter((a) => a.street === 'preflop' && a.type !== 'blind');
  const index = preflop.findIndex((a) => a.who === 'hero');
  if (index < 0) return null;
  const raised = preflop.slice(0, index).some((a) => a.who === 'villain' && kind(a) === 'raise');
  return { action: preflop[index], facedRaise: raised };
}

function checkRaiseStreets(h) {
  let chances = 0;
  let made = 0;
  for (const street of STREETS) {
    const list = h.actions.filter((a) => a.street === street && a.type !== 'blind' && !a.pre);
    const check = list.findIndex((a) => a.who === 'hero' && a.type === 'check');
    if (check < 0) continue;
    const villain = list.findIndex((a, i) => i > check && a.who === 'villain' && ['bet', 'raise'].includes(kind(a)));
    if (villain < 0) continue;
    const reply = list.find((a, i) => i > villain && a.who === 'hero');
    if (!reply) continue;
    chances += 1;
    if (kind(reply) === 'raise') made += 1;
  }
  return { chances, made };
}

export function startingHand(cards) {
  if (!cards || cards.length < 2) return null;
  const [a, b] = [...cards].sort((x, y) => RANKS.indexOf(x[0]) - RANKS.indexOf(y[0]));
  if (a[0] === b[0]) return a[0] + b[0];
  return a[0] + b[0] + (a[1] === b[1] ? 's' : 'o');
}

const ratio = (n, d) => ({ n, d, value: d > 0 ? n / d : null });

// corrections — ручные поправки стека в выбранных вечерах: входят в результат и винрейт.
export function computeStats(hands, { corrections = 0, correctionsBB = 0, hours = 0 } = {}) {
  let vpip = 0, pfr = 0, threeBet = 0, threeBetChances = 0;
  let pfrWins = 0, wins = 0, winsNoShowdown = 0;
  let checkRaises = 0, checkRaiseChances = 0;
  let flops = 0, showdowns = 0, showdownWins = 0;
  let net = 0, netBB = 0;
  const positions = new Map();
  const starts = new Map();

  for (const h of hands) {
    const preflop = heroActions(h, 'preflop').filter((a) => a.type !== 'blind');
    const voluntary = preflop.some((a) => ['call', 'raise', 'bet'].includes(kind(a)));
    const raised = preflop.some((a) => kind(a) === 'raise');
    if (voluntary) vpip += 1;
    if (raised) pfr += 1;
    if (raised && h.result === 'won') pfrWins += 1;

    const first = firstDecision(h);
    if (first?.facedRaise) {
      threeBetChances += 1;
      if (kind(first.action) === 'raise') threeBet += 1;
    }

    if (h.result === 'won') {
      wins += 1;
      if (!h.showdown) winsNoShowdown += 1;
    }

    const cr = checkRaiseStreets(h);
    checkRaiseChances += cr.chances;
    checkRaises += cr.made;

    if (sawFlop(h)) flops += 1;
    if (h.showdown) {
      showdowns += 1;
      if (h.result === 'won') showdownWins += 1;
    }

    net += h.net;
    netBB += h.net / h.bb;

    const pos = positions.get(h.position) ?? { position: h.position, hands: 0, net: 0, netBB: 0, vpip: 0 };
    pos.hands += 1;
    pos.net += h.net;
    pos.netBB += h.net / h.bb;
    if (voluntary) pos.vpip += 1;
    positions.set(h.position, pos);

    const start = startingHand(h.cards);
    if (start) {
      const item = starts.get(start) ?? { hand: start, hands: 0, net: 0 };
      item.hands += 1;
      item.net += h.net;
      starts.set(start, item);
    }
  }

  const total = hands.length;
  const totalBB = netBB + correctionsBB;
  const startList = [...starts.values()].sort((a, b) => b.net - a.net);
  return {
    hands: total,
    net: net + corrections,
    vpip: ratio(vpip, total),
    pfr: ratio(pfr, total),
    threeBet: ratio(threeBet, threeBetChances),
    pfrWin: ratio(pfrWins, pfr),
    winNoShowdown: ratio(winsNoShowdown, wins),
    checkRaise: ratio(checkRaises, checkRaiseChances),
    wtsd: ratio(showdowns, flops),
    wsd: ratio(showdownWins, showdowns),
    bb100: total > 0 ? (totalBB / total) * 100 : null,
    perHour: hours > 0 ? (net + corrections) / hours : null,
    positions: POSITIONS[10].concat('BB').filter((p, i, all) => all.indexOf(p) === i)
      .map((p) => positions.get(p)).filter(Boolean),
    bestHands: startList.filter((s) => s.net > 0).slice(0, 5),
    worstHands: startList.filter((s) => s.net < 0).slice(-5).reverse(),
  };
}

export function actionText(a) {
  const words = { fold: 'fold', check: 'check', call: 'call', bet: 'bet', raise: 'raise', allin: 'all-in', blind: 'blind' };
  const who = a.who === 'villain' ? `${a.pos ?? 'opponent'} ` : '';
  const amount = a.to === null || a.type === 'fold' || a.type === 'check' ? '' : ` ${a.type === 'blind' ? a.paid : a.to}`;
  return `${who}${words[a.type]}${amount}`;
}

const cardText = (c) => (c[0] === 'T' ? '10' : c[0]) + SUIT_SYMBOLS[c[1]];
export const cardsText = (cards) => cards.filter(Boolean).map(cardText).join(' ');

export function handLines(h) {
  const lines = [];
  const counts = { flop: [0, 3], turn: [3, 4], river: [4, 5] };
  for (const street of STREETS) {
    const list = h.actions.filter((a) => a.street === street && !(a.who === 'villain' && a.type === 'blind'));
    const range = counts[street];
    const cards = range ? h.board.slice(range[0], range[1]) : [];
    if (!list.length && !cards.length) continue;
    const title = STREET_NAMES[street] + (cards.length ? ` ${cardsText(cards)}` : '');
    lines.push({ title, text: list.map(actionText).join(', ') });
  }
  return lines;
}

export function csvRows(sessions, hands) {
  const names = new Map(sessions.map((s) => [s.id, s.name]));
  const rows = [['table', 'hand', 'position', 'cards', 'board', 'outcome', 'showdown', 'result', 'stack before', 'stack after']];
  for (const h of hands) {
    rows.push([
      names.get(h.sessionId) ?? '', h.number, h.position, cardsText(h.cards), cardsText(h.board),
      h.result, h.showdown ? 'yes' : 'no', h.net, h.stackBefore, h.stackBefore + h.net,
    ]);
  }
  return rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n');
}
