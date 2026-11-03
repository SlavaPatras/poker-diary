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
    startedAt: now,
    endedAt: null,
  };
  const blind = blindType(players, seat);
  if (blind) {
    const amount = Math.min(blind === 'sb' ? session.sb : session.bb, stack);
    hand.actions.push({ street: 'preflop', who: 'hero', type: 'blind', to: amount, paid: amount });
  }
  return hand;
}

const heroActions = (h, street) =>
  h.actions.filter((a) => a.who === 'hero' && (!street || a.street === street));

export const invested = (h) => heroActions(h).reduce((sum, a) => sum + a.paid, 0);
export const stackLeft = (h) => h.stackBefore - invested(h);
export const heroStreetTotal = (h, street = h.street) =>
  heroActions(h, street).reduce((sum, a) => sum + a.paid, 0);

// Был ли у игрока выбор после блайнда: пока его нет, настройки стола ещё можно менять.
export const hasDecided = (h) => h.actions.some((a) => a.who === 'hero' && a.type !== 'blind');

// Что нужно уравнять сейчас: { facing, to }. to === null — сумма соперника не введена.
export function facing(h) {
  const onStreet = h.actions.filter((a) => a.street === h.street);
  const lastVillainIndex = onStreet.map((a) => a.who).lastIndexOf('villain');
  const heroTotal = heroStreetTotal(h);
  if (lastVillainIndex >= 0) {
    const villain = onStreet[lastVillainIndex];
    const heroAfter = onStreet.slice(lastVillainIndex + 1).some((a) => a.who === 'hero');
    if (villain.to === null) return { facing: !heroAfter, to: null };
    return { facing: villain.to > heroTotal, to: villain.to };
  }
  if (h.street === 'preflop') return { facing: heroTotal < h.bb, to: h.bb };
  return { facing: false, to: 0 };
}

export function heroOptions(h) {
  if (facing(h).facing) return ['fold', 'call', 'raise', 'allin'];
  return ['check', h.street === 'preflop' ? 'raise' : 'bet', 'allin'];
}

export function setRaisedBefore(h, value, to = null) {
  h.actions = h.actions.filter((a) => !a.pre);
  h.raisedBefore = value;
  if (value) h.actions.push({ street: 'preflop', who: 'villain', type: 'raise', to, pre: true });
}

export function villainBet(h, to = null) {
  const opened = h.street === 'preflop' ||
    h.actions.some((a) => a.street === h.street && ['bet', 'raise', 'allin'].includes(a.type));
  h.actions.push({ street: h.street, who: 'villain', type: opened ? 'raise' : 'bet', to });
  h.phase = 'decide';
}

function allinKind(h) {
  const f = facing(h);
  if (!f.facing) return h.street === 'preflop' ? 'raise' : 'bet';
  if (f.to === null) return 'raise';
  return heroStreetTotal(h) + stackLeft(h) > f.to ? 'raise' : 'call';
}

// to — сумма игрока на этой улице («до»). Сумма выше стека становится олл-ином.
export function heroAction(h, type, to) {
  const total = heroStreetTotal(h);
  if (type === 'fold' || type === 'check') {
    h.actions.push({ street: h.street, who: 'hero', type, to: total, paid: 0 });
  } else {
    const left = stackLeft(h);
    if (type === 'allin') {
      const as = allinKind(h);
      h.actions.push({ street: h.street, who: 'hero', type, as, to: total + left, paid: left });
    } else {
      const wanted = Math.max(0, to - total);
      const paid = Math.min(wanted, left);
      const action = { street: h.street, who: 'hero', type, to: total + paid, paid };
      if (paid === left && paid > 0) {
        action.as = type;
        action.type = 'allin';
      }
      h.actions.push(action);
    }
  }
  h.phase = 'next';
}

export function nextStreet(h) {
  const index = STREETS.indexOf(h.street);
  if (index === STREETS.length - 1) {
    h.showdown = true;
    h.phase = 'result';
    return;
  }
  h.street = STREETS[index + 1];
  h.phase = 'board';
}

export const boardNeeded = (h) => ({ flop: 3, turn: 4, river: 5 }[h.street] ?? 0);

// Пропущенные общие карты остаются пустыми, чтобы следующие улицы не сдвинулись.
export function skipBoard(h) {
  while (h.board.length < boardNeeded(h)) h.board.push(null);
  h.phase = 'decide';
}

export function finishHand(h, { result, collected = 0, showdown = h.showdown }, now) {
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

// Одна рука после всех поправок: олл-ин считается тем действием, которым был.
const kind = (a) => a.as ?? a.type;

function sawFlop(h) {
  return h.showdown || STREETS.indexOf(h.street) >= 1;
}

function firstDecision(h) {
  const preflop = h.actions.filter((a) => a.street === 'preflop' && a.type !== 'blind');
  const index = preflop.findIndex((a) => a.who === 'hero');
  if (index < 0) return null;
  return { action: preflop[index], facedRaise: preflop.slice(0, index).some((a) => a.who === 'villain') };
}

function checkRaiseStreets(h) {
  let chances = 0;
  let made = 0;
  for (const street of STREETS) {
    const list = h.actions.filter((a) => a.street === street && a.type !== 'blind' && !a.pre);
    const check = list.findIndex((a) => a.who === 'hero' && a.type === 'check');
    if (check < 0) continue;
    const villain = list.findIndex((a, i) => i > check && a.who === 'villain');
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

const ACTION_WORDS = {
  blind: 'blind', check: 'check', call: 'call', bet: 'bet', raise: 'raise', fold: 'fold',
};

export function actionText(a) {
  if (a.who === 'villain') {
    const word = a.type === 'raise' ? 'raise' : 'bet';
    return a.to === null ? `opponent ${word}` : `opponent ${word} ${a.to}`;
  }
  if (a.type === 'fold' || a.type === 'check') return ACTION_WORDS[a.type];
  if (a.type === 'blind') return `blind ${a.paid}`;
  if (a.type === 'allin') return `all-in ${a.to}`;
  if (a.type === 'call') return `call ${a.to}`;
  return `${ACTION_WORDS[a.type]} ${a.to}`;
}

const cardText = (c) => (c[0] === 'T' ? '10' : c[0]) + SUIT_SYMBOLS[c[1]];
export const cardsText = (cards) => cards.filter(Boolean).map(cardText).join(' ');

export function handLines(h) {
  const lines = [];
  const counts = { flop: [0, 3], turn: [3, 4], river: [4, 5] };
  for (const street of STREETS) {
    const list = h.actions.filter((a) => a.street === street);
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
