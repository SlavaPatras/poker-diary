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

// Раздача глазами игрока: свои карты, ситуация, свои решения и ставки соперников одним числом.
export const POT_SITUATIONS = ['open', 'limp', 'raise', 'threebet'];

export function defaultOpponents(players, situation) {
  if (situation === 'limp') return Math.min(2, players - 1);
  return 1;
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
    situation: 'open',
    opponents: defaultOpponents(players, 'open'),
    potAdjust: 0,
    decisions: [],
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
    hand.decisions.push({ street: 'preflop', who: 'hero', action: 'blind', to: amount, paid: amount });
  }
  return hand;
}

const heroMoves = (h, street) =>
  h.decisions.filter((d) => d.who === 'hero' && (!street || d.street === street));

export const invested = (h) => heroMoves(h).reduce((sum, d) => sum + d.paid, 0);
export const stackLeft = (h) => h.stackBefore - invested(h);
export const heroStreetTotal = (h, street = h.street) =>
  heroMoves(h, street).reduce((sum, d) => sum + d.paid, 0);
export const hasDecided = (h) => h.decisions.some((d) => d.who === 'hero' && d.action !== 'blind');

const oppTo = (h, street = h.street) =>
  Math.max(0, ...h.decisions.filter((d) => d.who === 'opp' && d.street === street).map((d) => d.to));

export function facingTo(h) {
  const opp = oppTo(h);
  return h.street === 'preflop' ? Math.max(h.bb, opp) : opp;
}
export const toCall = (h) => Math.max(0, Math.min(facingTo(h) - heroStreetTotal(h), stackLeft(h)));

// Примерный банк: блайнды, свои фишки, ставки соперников по одному разу и ручная поправка.
export function potSize(h) {
  let pot = h.sb + h.bb + h.potAdjust;
  for (const d of h.decisions) {
    if (d.who === 'hero' && d.action !== 'blind') pot += d.paid;
  }
  for (const street of STREETS) {
    let last = 0;
    for (const d of h.decisions.filter((x) => x.who === 'opp' && x.street === street)) {
      pot += Math.max(0, d.to - last);
      last = Math.max(last, d.to);
    }
  }
  return pot;
}

export function setPot(h, value) {
  h.potAdjust += value - potSize(h);
}

export function setSituation(h, situation, raiseTo = null) {
  h.decisions = h.decisions.filter((d) => !d.pre);
  h.situation = situation;
  if (!h.oppsTouched) h.opponents = defaultOpponents(h.players, situation);
  if (situation === 'raise' || situation === 'threebet') {
    const to = raiseTo ?? h.bb * (situation === 'raise' ? 3 : 9);
    h.decisions.push({ street: 'preflop', who: 'opp', action: situation, to, pre: true });
  }
}

export function setOpponents(h, n) {
  h.opponents = Math.min(h.players - 1, Math.max(1, n));
  h.oppsTouched = true;
}

export function heroOptions(h) {
  const owes = toCall(h) > 0;
  if (stackLeft(h) <= 0) return [];
  if (owes) return ['fold', 'call', 'raise', 'allin'];
  return ['check', h.street === 'preflop' ? 'raise' : 'bet', 'allin'];
}

const KIND = { raise: 'raise', bet: 'raise', allin: 'raise', call: 'call', check: 'check', fold: 'fold' };

// Оценка решения: по таблице до флопа, по шансам банка после.
export function gradeDecision(h, action, { advice = null, equity = null } = {}) {
  const kind = KIND[action];
  if (h.street === 'preflop') {
    if (!advice) return null;
    const ok = kind === advice || (advice === 'fold' && kind === 'check') || (advice === 'check' && kind === 'fold' && toCall(h) === 0);
    return ok ? 'good' : 'bad';
  }
  const price = toCall(h);
  if (price <= 0 || equity === null) return null;
  const need = price / (potSize(h) + price);
  if (kind === 'fold') return equity < need ? 'good' : 'bad';
  return equity >= need ? 'good' : 'bad';
}

// to — сумма игрока на этой улице («до»). info — совет и шанс на момент решения.
export function heroAct(h, action, to = null, info = {}) {
  const total = heroStreetTotal(h);
  const left = stackLeft(h);
  const price = toCall(h);
  const pot = potSize(h);
  const record = {
    street: h.street, who: 'hero', action, to: total, paid: 0,
    advice: info.advice ?? null, equity: info.equity ?? null,
    need: price > 0 ? price / (pot + price) : null,
    grade: gradeDecision(h, action, info),
  };
  if (action === 'call') record.paid = price;
  else if (action === 'allin') record.paid = left;
  else if (action === 'raise' || action === 'bet') record.paid = Math.min(Math.max(0, to - total), left);
  record.to = total + record.paid;
  if (record.paid > 0 && record.paid === left && action !== 'allin') { record.as = action; record.action = 'allin'; }
  h.decisions.push(record);
  h.phase = action === 'fold' ? 'done' : 'next';
}

export function opponentBet(h, to) {
  const action = heroStreetTotal(h) > 0 || oppTo(h) > 0 ? 'raise' : 'bet';
  h.decisions.push({ street: h.street, who: 'opp', action, to: Math.max(to, facingTo(h)) });
  // Рейз в ответ на твой ход до флопа меняет ситуацию для следующего совета.
  if (h.street === 'preflop' && hasDecided(h)) {
    const raised = heroMoves(h, 'preflop').some((d) => KIND[d.as ?? d.action] === 'raise' && d.action !== 'blind');
    h.situation = raised ? 'threebet' : 'raise';
  }
  h.phase = 'decide';
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

export function addBoardCard(h, card) {
  h.board.push(card);
  if (h.board.length >= boardNeeded(h)) h.phase = stackLeft(h) > 0 ? 'decide' : 'next';
}

// Пропущенные общие карты остаются пустыми, чтобы следующие улицы не сдвинулись.
export function skipBoard(h) {
  while (h.board.length < boardNeeded(h)) h.board.push(null);
  h.phase = stackLeft(h) > 0 ? 'decide' : 'next';
}

export function finishHand(h, { result, collected = 0, showdown = h.showdown }, now) {
  h.pot = potSize(h);
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

export function startingHand(cards) {
  if (!cards || cards.length < 2) return null;
  const [a, b] = [...cards].sort((x, y) => RANKS.indexOf(x[0]) - RANKS.indexOf(y[0]));
  if (a[0] === b[0]) return a[0] + b[0];
  return a[0] + b[0] + (a[1] === b[1] ? 's' : 'o');
}

const ratio = (n, d) => ({ n, d, value: d > 0 ? n / d : null });

// Насколько решения совпадали с подсказками. Старые раздачи без подсказок не учитываются.
export function adviceStats(hands) {
  let pre = 0, preGood = 0, post = 0, postGood = 0;
  const followed = { hands: 0, net: 0, bb: 0 };
  const deviated = { hands: 0, net: 0, bb: 0 };
  const positions = new Map();
  const starts = new Map();
  let net = 0, netBB = 0;
  for (const h of hands) {
    net += h.net;
    netBB += h.net / h.bb;
    const pos = positions.get(h.position) ?? { position: h.position, hands: 0, net: 0 };
    pos.hands += 1;
    pos.net += h.net;
    positions.set(h.position, pos);
    const start = startingHand(h.cards);
    if (start) {
      const item = starts.get(start) ?? { hand: start, hands: 0, net: 0 };
      item.hands += 1;
      item.net += h.net;
      starts.set(start, item);
    }
    if (!h.decisions) continue;
    const graded = h.decisions.filter((d) => d.grade);
    const preflop = graded.filter((d) => d.street === 'preflop');
    pre += preflop.length;
    preGood += preflop.filter((d) => d.grade === 'good').length;
    const later = graded.filter((d) => d.street !== 'preflop');
    post += later.length;
    postGood += later.filter((d) => d.grade === 'good').length;
    if (preflop.length) {
      const bucket = preflop.every((d) => d.grade === 'good') ? followed : deviated;
      bucket.hands += 1;
      bucket.net += h.net;
      bucket.bb += h.net / h.bb;
    }
  }
  const order = POSITIONS[10];
  const list = [...starts.values()].sort((a, b) => b.net - a.net);
  return {
    hands: hands.length,
    net,
    bb100: hands.length ? (netBB / hands.length) * 100 : null,
    preflop: ratio(preGood, pre),
    postflop: ratio(postGood, post),
    followed,
    deviated,
    positions: order.map((p) => positions.get(p)).filter(Boolean),
    bestHands: list.filter((x) => x.net > 0).slice(0, 5),
    worstHands: list.filter((x) => x.net < 0).slice(-5).reverse(),
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

const WORDS = { blind: 'blind', check: 'check', call: 'call', bet: 'bet', raise: 'raise', allin: 'all-in', fold: 'fold', threebet: '3-bet' };

function decisionText(d) {
  if (d.who === 'opp') return `${d.pre ? `${WORDS[d.action]} before you` : `opponent ${WORDS[d.action]}`} ${d.to}`;
  const amount = ['fold', 'check'].includes(d.action) ? '' : ` ${d.action === 'blind' ? d.paid : d.to}`;
  let note = '';
  if (d.grade && d.street === 'preflop') note = d.grade === 'good' ? ' ✓ chart' : ` ✗ chart: ${d.advice}`;
  else if (d.grade) note = ` ${d.grade === 'good' ? '✓' : '✗'} ${Math.round(d.equity * 100)}% vs ${Math.round(d.need * 100)}% needed`;
  return `${WORDS[d.action]}${amount}${note}`;
}

export function handLines(h) {
  const lines = [];
  const counts = { flop: [0, 3], turn: [3, 4], river: [4, 5] };
  for (const street of STREETS) {
    const list = h.decisions
      ? h.decisions.filter((d) => d.street === street).map(decisionText)
      : (h.actions ?? []).filter((a) => a.street === street && !(a.who === 'villain' && a.type === 'blind')).map(actionText);
    const range = counts[street];
    const cards = range ? h.board.slice(range[0], range[1]) : [];
    if (!list.length && !cards.filter(Boolean).length) continue;
    const title = STREET_NAMES[street] + (cards.filter(Boolean).length ? ` ${cardsText(cards)}` : '');
    lines.push({ title, text: list.join(', ') });
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
