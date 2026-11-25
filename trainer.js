// Тренажёр: генераторы задач и проверка ответов. Без DOM и хранилища.
import * as A from './advisor.js';

const RANKS = 'AKQJT98765432';
const SUITS = 'shdc';
export const EXERCISES = {
  preflop: { title: 'Raise or fold', text: 'Open-raise or fold by the chart, everyone folded to you.' },
  outs: { title: 'Count the outs', text: 'How many cards give you a straight or a flush?' },
  equity: { title: 'Guess the equity', text: 'One hand against another: what is your chance to win?' },
  potodds: { title: 'Call or fold', text: 'Compare the price of a call with your equity.' },
};
export const SESSION_LENGTH = 10;

const fullDeck = () => [...RANKS].flatMap((r) => [...SUITS].map((s) => r + s));
function deal(random, exclude = []) {
  const deck = fullDeck().filter((c) => !exclude.includes(c));
  return (n) => {
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(deck.splice(Math.floor(random() * deck.length), 1)[0]);
    return out;
  };
}
const pick = (list, random) => list[Math.floor(random() * list.length)];

// Карты для класса руки «A9o»: случайные масти.
export function cardsForClass(cls, random = Math.random) {
  const [a, b, kind] = cls;
  const s1 = pick([...SUITS], random);
  if (a === b) return [a + s1, b + pick([...SUITS].filter((s) => s !== s1), random)];
  if (kind === 's') return [a + s1, b + s1];
  return [a + s1, b + pick([...SUITS].filter((s) => s !== s1), random)];
}

const ALL_CLASSES = [];
for (let i = 0; i < 13; i += 1) {
  for (let j = i; j < 13; j += 1) {
    if (i === j) ALL_CLASSES.push(RANKS[i] + RANKS[j]);
    else ALL_CLASSES.push(RANKS[i] + RANKS[j] + 's', RANKS[i] + RANKS[j] + 'o');
  }
}
const PREFLOP_POSITIONS = ['UTG', 'HJ', 'CO', 'BTN', 'SB'];
const EDGE_CLASSES = ALL_CLASSES.filter((c) => A.topRange(0.55).has(c) && !A.topRange(0.06).has(c));

// 1. Рейз или фолд по таблице. Ошибки возвращаются чаще.
export function preflopTask(random = Math.random, mistakes = []) {
  let position;
  let cls;
  if (mistakes.length && random() < 0.35) {
    [position, cls] = pick(mistakes, random).key.split('|');
  } else {
    position = pick(PREFLOP_POSITIONS, random);
    // Чаще пограничные руки: очевидный мусор почти не учит.
    cls = pick(random() < 0.7 ? EDGE_CLASSES : ALL_CLASSES, random);
  }
  const cards = cardsForClass(cls, random);
  const advice = A.preflopAdvice({ cards, position, players: 6, situation: 'open' });
  return { type: 'preflop', position, cls, cards, answer: advice.action, note: advice.note, key: `${position}|${cls}` };
}

export function checkPreflop(task, choice) {
  return { correct: choice === task.answer };
}

// Ауты на стрит и флеш: карты, после которых у тебя стрит или сильнее.
export function outsFor(hero, board) {
  const base = A.categoryOf(A.handScore([...hero, ...board]));
  if (base >= 4) return [];
  const used = new Set([...hero, ...board]);
  const boardRanks = new Set(board.map((c) => c[0]));
  return fullDeck().filter((c) => !used.has(c)).filter((c) => {
    if (board.length + 1 > 5) return false;
    const mine = A.categoryOf(A.handScore([...hero, ...board, c]));
    // Если стрит или флеш собирается одной доской, он общий и аутом не считается.
    const shared = board.length + 1 >= 5 && A.categoryOf(A.handScore([...board, c])) >= mine;
    return mine >= 4 && !shared;
  }).map((c) => ({ card: c, dirty: boardRanks.has(c[0]) }));
}

function drawSpot(random, boardSize) {
  for (let tries = 0; tries < 2000; tries += 1) {
    const take = deal(random);
    const hero = take(2);
    const board = take(boardSize);
    const made = A.categoryOf(A.handScore([...hero, ...board]));
    if (made > 1) continue;
    const outs = outsFor(hero, board);
    if (outs.length >= 4) return { hero, board, outs };
  }
  throw new Error('no draw spot');
}

// 2. Посчитай ауты.
export function outsTask(random = Math.random) {
  const { hero, board, outs } = drawSpot(random, random() < 0.7 ? 3 : 4);
  return { type: 'outs', hero, board, outs, answer: outs.length };
}

export function checkOuts(task, value) {
  const miss = Math.abs(value - task.answer);
  return { correct: miss === 0, close: miss === 1, miss };
}

// Правило 2 и 4: приблизительный шанс по числу аутов.
export const ruleOfTwoFour = (outs, cardsToCome) => Math.min(100, outs * (cardsToCome === 2 ? 4 : 2));
export const exactOutsChance = (outs, unseen, cardsToCome) =>
  (cardsToCome === 1 ? outs / unseen : 1 - ((unseen - outs) * (unseen - outs - 1)) / (unseen * (unseen - 1)));

// Соперник с готовой рукой (пара или лучше) против дро.
function madeOpponent(random, hero, board) {
  for (let tries = 0; tries < 400; tries += 1) {
    const opp = deal(random, [...hero, ...board])(2);
    const cat = A.categoryOf(A.handScore([...opp, ...board]));
    const pairsBoard = board.some((c) => c[0] === opp[0][0] || c[0] === opp[1][0]) || opp[0][0] === opp[1][0];
    if (cat >= 1 && cat <= 3 && pairsBoard && A.handScore([...opp, ...board]) > A.handScore([...hero, ...board])) return opp;
  }
  return null;
}

// 3. Угадай эквити: до флопа или дро против готовой руки на флопе.
export function equityTask(random = Math.random) {
  if (random() < 0.5) {
    const strong = ALL_CLASSES.filter((c) => A.topRange(0.4).has(c));
    for (;;) {
      const a = cardsForClass(pick(strong, random), random);
      const b = cardsForClass(pick(strong, random), random);
      if (new Set([...a, ...b]).size < 4) continue;
      return { type: 'equity', street: 'preflop', hero: a, opp: b, board: [], answer: A.equityVsHand(a, b, [], { iterations: 20000, random }) };
    }
  }
  for (;;) {
    const { hero, board } = drawSpot(random, 3);
    const opp = madeOpponent(random, hero, board);
    if (!opp) continue;
    return { type: 'equity', street: 'flop', hero, opp, board, answer: A.equityVsHand(hero, opp, board) };
  }
}

export function checkEquity(task, percent) {
  const miss = Math.abs(percent - Math.round(task.answer * 100));
  return { correct: miss <= 5, close: miss <= 10, miss };
}

// 4. Колл или фолд по шансам банка.
const BET_SIZES = [0.33, 0.5, 0.66, 0.75, 1, 1.5];
export function potOddsTask(random = Math.random) {
  for (;;) {
    const allIn = random() < 0.3;
    const { hero, board, outs } = drawSpot(random, allIn ? 3 : 4);
    const opp = madeOpponent(random, hero, board);
    if (!opp) continue;
    const pot = 5 * (4 + Math.floor(random() * 37));
    const bet = Math.max(5, Math.round((pot * pick(BET_SIZES, random)) / 5) * 5);
    const need = bet / (pot + 2 * bet);
    const equity = A.equityVsHand(hero, opp, board);
    return {
      type: 'potodds', hero, opp, board, pot, bet, need, equity, outs: outs.length, allIn,
      answer: equity >= need ? 'call' : 'fold', close: Math.abs(equity - need) < 0.02,
    };
  }
}

export function checkPotOdds(task, choice) {
  return { correct: choice === task.answer || task.close };
}

export const makeTask = { preflop: preflopTask, outs: outsTask, equity: equityTask, potodds: potOddsTask };

// Результаты: попытки, верные ответы, последние ответы и колода ошибок префлопа.
export function emptyProgress() {
  const blank = () => ({ attempts: 0, correct: 0, streak: 0, best: 0, recent: [], missTotal: 0 });
  return { ...Object.fromEntries(Object.keys(EXERCISES).map((k) => [k, blank()])), mistakes: [], errors: {} };
}

export function record(progress, task, result) {
  const p = progress[task.type];
  p.attempts += 1;
  if (result.correct) { p.correct += 1; p.streak += 1; p.best = Math.max(p.best, p.streak); } else p.streak = 0;
  p.recent = [...p.recent, result.correct ? 1 : 0].slice(-30);
  if (typeof result.miss === 'number') p.missTotal += result.miss;
  if (task.type === 'preflop') {
    const deck = progress.mistakes;
    const item = deck.find((m) => m.key === task.key);
    if (!result.correct) {
      if (item) item.hits = 0;
      else deck.push({ key: task.key, hits: 0 });
      progress.errors[task.key] = (progress.errors[task.key] ?? 0) + 1;
    } else if (item) {
      item.hits += 1;
      if (item.hits >= 2) deck.splice(deck.indexOf(item), 1);
    }
  }
  return progress;
}

export function topMistakes(progress, n = 5) {
  return Object.entries(progress.errors ?? {}).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([key, count]) => ({ position: key.split('|')[0], hand: key.split('|')[1], count }));
}
