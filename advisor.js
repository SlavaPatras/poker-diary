// Подсказки: оценка руки, шанс выиграть, примерные таблицы префлопа.
// Таблицы приблизительные (обычные стартовые руки для кэша), это не расчёт солвера.

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const rankOf = (card) => RANKS.indexOf(card[0]);
const toInt = (card) => rankOf(card) * 4 + SUITS.indexOf(card[1]);

// Класс стартовой руки: «AKs», «T9o», «77».
export function handClass(cards) {
  const [a, b] = [...cards].sort((x, y) => rankOf(y) - rankOf(x));
  if (a[0] === b[0]) return a[0] + b[0];
  return a[0] + b[0] + (a[1] === b[1] ? 's' : 'o');
}

// Разбор записи диапазона: «77+», «ATs+», «A5s-A2s», «KQo».
export function parseRange(text) {
  const set = new Set();
  for (const raw of text.split(',').map((t) => t.trim()).filter(Boolean)) {
    const [from, to] = raw.split('-');
    const plus = from.endsWith('+');
    const token = plus ? from.slice(0, -1) : from;
    const hi = rankOf(token[0]);
    const lo = rankOf(token[1]);
    const kind = token[2] ?? '';
    if (hi === lo) {
      const end = to ? rankOf(to[0]) : plus ? 12 : hi;
      for (let r = Math.min(hi, end); r <= Math.max(hi, end); r += 1) set.add(RANKS[r] + RANKS[r]);
      continue;
    }
    let first = lo;
    let last = lo;
    if (plus) last = hi - 1;
    if (to) { first = Math.min(lo, rankOf(to[1])); last = Math.max(lo, rankOf(to[1])); }
    for (let r = first; r <= last; r += 1) set.add(RANKS[hi] + RANKS[r] + kind);
  }
  return set;
}

// Сила 7 карт одним числом: больше — сильнее.
const CATEGORY = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

function straightTop(mask) {
  const m = (mask << 1) | ((mask >> 12) & 1);
  for (let hi = 13; hi >= 4; hi -= 1) if (((m >> (hi - 4)) & 31) === 31) return hi - 1;
  return -1;
}

const pack = (cat, ks) => ks.slice(0, 5).reduce((acc, k, i) => acc + k * 16 ** (4 - i), cat * 16 ** 5);

function topBits(mask, n) {
  const out = [];
  for (let r = 12; r >= 0 && out.length < n; r -= 1) if (mask & (1 << r)) out.push(r);
  return out;
}

export function score7(ints) {
  const counts = new Array(13).fill(0);
  const suitMask = [0, 0, 0, 0];
  let mask = 0;
  for (const c of ints) {
    const r = c >> 2;
    counts[r] += 1;
    suitMask[c & 3] |= 1 << r;
    mask |= 1 << r;
  }
  const flushMask = suitMask.find((m) => popcount(m) >= 5);
  if (flushMask) {
    const sf = straightTop(flushMask);
    if (sf >= 0) return pack(8, [sf]);
  }
  const quads = [], trips = [], pairs = [];
  for (let r = 12; r >= 0; r -= 1) {
    if (counts[r] === 4) quads.push(r);
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
  }
  if (quads.length) return pack(7, [quads[0], ...topBits(mask & ~(1 << quads[0]), 1)]);
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const pair = Math.max(trips[1] ?? -1, pairs[0] ?? -1);
    return pack(6, [trips[0], pair]);
  }
  if (flushMask) return pack(5, topBits(flushMask, 5));
  const st = straightTop(mask);
  if (st >= 0) return pack(4, [st]);
  if (trips.length) return pack(3, [trips[0], ...topBits(mask & ~(1 << trips[0]), 2)]);
  if (pairs.length >= 2) {
    const rest = mask & ~(1 << pairs[0]) & ~(1 << pairs[1]);
    return pack(2, [pairs[0], pairs[1], ...topBits(rest, 1)]);
  }
  if (pairs.length) return pack(1, [pairs[0], ...topBits(mask & ~(1 << pairs[0]), 3)]);
  return pack(0, topBits(mask, 5));
}

function popcount(m) {
  let n = 0;
  for (let x = m; x; x &= x - 1) n += 1;
  return n;
}

export const categoryOf = (score) => Math.floor(score / 16 ** 5);

// Что собрано и какие есть дро.
export function describeHand(cards, board) {
  const known = board.filter(Boolean);
  if (known.length < 3) return null;
  const all = [...cards, ...known].map(toInt);
  const made = CATEGORY[categoryOf(score7(all))];
  const draws = [];
  if (known.length < 5) {
    const bySuit = [0, 0, 0, 0];
    for (const c of all) bySuit[c & 3] += 1;
    const heroSuits = cards.map((c) => SUITS.indexOf(c[1]));
    if (bySuit.some((n, s) => n === 4 && heroSuits.includes(s))) draws.push('flush draw');
    let mask = 0;
    for (const c of all) mask |= 1 << (c >> 2);
    if (straightTop(mask) < 0) {
      let outs = 0;
      for (let r = 0; r < 13; r += 1) if (!(mask & (1 << r)) && straightTop(mask | (1 << r)) >= 0) outs += 1;
      if (outs >= 2) draws.push('open-ended straight draw');
      else if (outs === 1) draws.push('gutshot');
    }
  }
  return { made, draws };
}

// Порядок стартовых рук по формуле Чена: нужен для примерного диапазона соперников.
function chen(cls) {
  const points = (r) => ({ 12: 10, 11: 8, 10: 7, 9: 6 }[r] ?? (r + 2) / 2);
  const a = rankOf(cls[0]);
  const b = rankOf(cls[1]);
  if (a === b) return Math.max(5, points(a) * 2);
  let score = points(a);
  if (cls[2] === 's') score += 2;
  const gap = a - b - 1;
  score -= [0, 1, 2, 4][gap] ?? 5;
  if (gap <= 1 && a < 10) score += 1;
  return Math.ceil(score);
}

const ALL_CLASSES = [];
for (let a = 12; a >= 0; a -= 1) {
  for (let b = a; b >= 0; b -= 1) {
    if (a === b) ALL_CLASSES.push(RANKS[a] + RANKS[b]);
    else ALL_CLASSES.push(RANKS[a] + RANKS[b] + 's', RANKS[a] + RANKS[b] + 'o');
  }
}
const combos = (cls) => (cls.length === 2 ? 6 : cls[2] === 's' ? 4 : 12);
const RANKED = [...ALL_CLASSES].sort((x, y) => chen(y) - chen(x) || (rankOf(y[0]) + rankOf(y[1])) - (rankOf(x[0]) + rankOf(x[1])));

export function topRange(share) {
  const set = new Set();
  let total = 0;
  for (const cls of RANKED) {
    if (total >= share * 1326) break;
    set.add(cls);
    total += combos(cls);
  }
  return set;
}

// Примерный диапазон соперников по ситуации до флопа.
export const SITUATIONS = {
  open: { label: 'Unopened', range: null, share: 1 },
  limp: { label: 'Limpers', range: null, share: 0.45 },
  raise: { label: 'Raise', range: null, share: 0.2 },
  threebet: { label: '3-bet', range: null, share: 0.07 },
};
for (const s of Object.values(SITUATIONS)) s.range = s.share < 1 ? topRange(s.share) : null;

// Шанс выиграть методом Монте-Карло против нескольких соперников.
export function equity({ cards, board = [], opponents = 1, situation = 'open', iterations = 3000, random = Math.random }) {
  const heroInts = cards.map(toInt);
  const boardInts = board.filter(Boolean).map(toInt);
  const used = new Set([...heroInts, ...boardInts]);
  const deck = [];
  for (let c = 0; c < 52; c += 1) if (!used.has(c)) deck.push(c);
  const range = SITUATIONS[situation]?.range;
  const classOf = (x, y) => {
    const [hi, lo] = (x >> 2) >= (y >> 2) ? [x, y] : [y, x];
    const a = RANKS[hi >> 2];
    const b = RANKS[lo >> 2];
    if (a === b) return a + b;
    return a + b + ((hi & 3) === (lo & 3) ? 's' : 'o');
  };
  let share = 0;
  let done = 0;
  const pool = deck.slice();
  for (let it = 0; it < iterations; it += 1) {
    let n = pool.length;
    const draw = () => {
      const i = Math.floor(random() * n);
      const card = pool[i];
      n -= 1;
      pool[i] = pool[n];
      pool[n] = card;
      return card;
    };
    const opps = [];
    let ok = true;
    for (let o = 0; o < opponents && ok; o += 1) {
      let hand = null;
      for (let tries = 0; tries < 60; tries += 1) {
        const x = draw();
        const y = draw();
        if (!range || range.has(classOf(x, y))) { hand = [x, y]; break; }
        n += 2; // карты возвращаются в колоду
      }
      if (!hand) ok = false;
      else opps.push(hand);
    }
    if (!ok) continue;
    const full = boardInts.slice();
    while (full.length < 5) full.push(draw());
    const mine = score7([...heroInts, ...full]);
    let best = -1;
    let ties = 0;
    for (const hand of opps) {
      const s = score7([...hand, ...full]);
      if (s > best) { best = s; ties = 0; }
      if (s === best) ties += 1;
    }
    if (mine > best) share += 1;
    else if (mine === best) share += 1 / (ties + 1);
    done += 1;
  }
  return done ? share / done : null;
}

// Таблицы префлопа по группам позиций.
const OPEN = {
  EP: '77+,ATs+,KJs+,QJs,JTs,AQo+',
  UTG: '66+,A9s+,A5s-A4s,KTs+,QTs+,JTs,T9s,98s,AJo+,KQo',
  HJ: '55+,A7s+,A5s-A2s,K9s+,Q9s+,J9s+,T9s,98s,87s,ATo+,KJo+,QJo',
  CO: '33+,A2s+,K7s+,Q8s+,J8s+,T8s+,97s+,86s+,76s,65s,A8o+,KTo+,QTo+,JTo',
  BTN: '22+,A2s+,K4s+,Q6s+,J7s+,T7s+,96s+,85s+,75s+,64s+,54s,A4o+,K9o+,Q9o+,J9o+,T9o,98o',
  SB: '22+,A2s+,K6s+,Q8s+,J8s+,T8s+,97s+,87s,76s,65s,A7o+,KTo+,QTo+,JTo',
  BB: '88+,ATs+,KQs,AQo+',
};
const ISO = { raise: '77+,ATs+,KTs+,QJs,AJo+,KQo', call: '22-66,A2s-A9s,K9s,Q9s,J9s,T9s,98s,87s,76s,65s' };
const VS_RAISE = {
  raise: 'QQ+,AKs,AKo,A5s-A4s',
  call: '22-JJ,ATs-AQs,KTs+,QTs+,JTs,T9s,98s,AJo-AQo,KQo',
};
const BB_VS_RAISE = {
  raise: 'JJ+,AQs+,AKo,A5s-A4s',
  call: '22-TT,A2s-AJs,K8s+,Q9s+,J9s+,T8s+,97s+,86s+,76s,65s,54s,ATo-AQo,KJo+,QJo,JTo',
};
const VS_3BET = { raise: 'KK+,AKs,AKo', call: 'QQ-TT,AJs-AQs,KQs,AQo' };

const sets = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, parseRange(v)]));
const CHARTS = {
  open: Object.fromEntries(Object.entries(OPEN).map(([k, v]) => [k, parseRange(v)])),
  iso: sets(ISO),
  raise: sets(VS_RAISE),
  bbRaise: sets(BB_VS_RAISE),
  threebet: sets(VS_3BET),
};

const groupOf = (position) => {
  if (['UTG', 'UTG+1', 'UTG+2'].includes(position)) return 'EP';
  if (['MP', 'LJ'].includes(position)) return 'UTG';
  return position;
};

// Совет до флопа: { action: 'raise' | 'call' | 'check' | 'fold', note }.
export function preflopAdvice({ cards, position, players, situation }) {
  if (!cards || cards.length < 2) return null;
  const cls = handClass(cards);
  // За маленьким столом группы позиций шире.
  const group = players <= 6 && position === 'UTG' ? 'UTG' : groupOf(position);
  if (situation === 'open') {
    if (position === 'BB') {
      return CHARTS.open.BB.has(cls) ? { action: 'raise', note: 'Raise from the big blind' } : { action: 'check', note: 'Check your option' };
    }
    return CHARTS.open[group].has(cls)
      ? { action: 'raise', note: `${cls} is an open-raise from ${position}` }
      : { action: 'fold', note: `${cls} is outside the ${position} opening range` };
  }
  if (situation === 'limp') {
    if (CHARTS.iso.raise.has(cls)) return { action: 'raise', note: `Isolation raise with ${cls}` };
    if (position === 'BB') return { action: 'check', note: 'Check behind the limpers' };
    if (CHARTS.iso.call.has(cls)) return { action: 'call', note: `${cls} plays well in a multiway pot` };
    return { action: 'fold', note: `${cls} is too weak to limp along` };
  }
  const chart = situation === 'threebet' ? CHARTS.threebet : position === 'BB' ? CHARTS.bbRaise : CHARTS.raise;
  const name = situation === 'threebet' ? '4-bet' : '3-bet';
  if (chart.raise.has(cls)) return { action: 'raise', note: `${cls}: ${name}` };
  if (chart.call.has(cls)) return { action: 'call', note: `${cls}: call` };
  return { action: 'fold', note: `${cls} is a fold against a ${situation === 'threebet' ? '3-bet' : 'raise'}` };
}

// Сколько процентов нужно, чтобы колл окупался.
export const neededEquity = (pot, toCall) => (toCall > 0 ? toCall / (pot + toCall) : 0);

// Точный шанс одной руки против другой: перебор всех досок, если открыт флоп или дальше.
export function equityVsHand(hero, opp, board = [], { iterations = 20000, random = Math.random } = {}) {
  const h = hero.map(toInt);
  const o = opp.map(toInt);
  const b = board.filter(Boolean).map(toInt);
  const used = new Set([...h, ...o, ...b]);
  const deck = [];
  for (let c = 0; c < 52; c += 1) if (!used.has(c)) deck.push(c);
  let win = 0, tie = 0, total = 0;
  const judge = (full) => {
    const x = score7([...h, ...full]);
    const y = score7([...o, ...full]);
    if (x > y) win += 1;
    else if (x === y) tie += 1;
    total += 1;
  };
  const need = 5 - b.length;
  if (need === 0) judge(b);
  else if (need === 1) for (const c of deck) judge([...b, c]);
  else if (need === 2) {
    for (let i = 0; i < deck.length; i += 1) for (let j = i + 1; j < deck.length; j += 1) judge([...b, deck[i], deck[j]]);
  } else {
    const pool = deck.slice();
    for (let it = 0; it < iterations; it += 1) {
      for (let k = 0; k < need; k += 1) {
        const i = k + Math.floor(random() * (pool.length - k));
        [pool[k], pool[i]] = [pool[i], pool[k]];
      }
      judge([...b, ...pool.slice(0, need)]);
    }
  }
  return (win + tie / 2) / total;
}

export const cardInts = (cards) => cards.map(toInt);
export const handScore = (cards) => score7(cards.map(toInt));
