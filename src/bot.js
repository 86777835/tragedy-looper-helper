// The robot Mastermind. Server only: this file knows every script's truth and plan.
// It plays the way the official Mastermind hints recommend: per script, a table of winning routes with the official
// priority per loop, the official day-1 openings, and the official choices (e.g. where the 手下 starts).
// Each decision scores the options against those routes and takes the best; randomness only breaks exact ties.
// Sources: FS-01 — BakaFire's free trial kit (playguide.pdf, 脚本家への指針 and play guide).
// FS-02, BTX-01, 02, 04, 05, 06 — Mastermind hints of the English New Tragedies handbook (as transcribed in the
// tragedy-looper.github.io database). BTX-03, 07, 08 — no official hints available: this site's own routes (unofficial).
import { scriptOf, roleOf, incPara, forbidden, core, CHARS, ROLES, LOCS } from '../public/logic.js';
import { MM_CARDS, mmHand, resolveCards, isLoc, GW } from './engine.js';

const { alive, living, sameArea, ofRole, keyPersons, incidentEffect } = core;

/* ---------- route conditions ---------- */
// Each condition gives progress 0..1 on a state X (the real state or a light copy of it).
const sameLoc = (X, a, b) => alive(X, a) && alive(X, b) && X.ch[a].loc === X.ch[b].loc;
const lim = id => CHARS[id].limit;
const COND = {
  // `victim` alone with a serial killer at the end of a day
  sk: (X, c) => {
    if (!alive(X, c.v)) return 0;
    let best = 0;
    for (const k of ofRole(X, 'serialKiller').filter(i => alive(X, i) && i !== c.v)) {
      const o = sameArea(X, k);
      best = Math.max(best, o.length === 1 && o[0] === c.v ? 1 : X.ch[k].loc === X.ch[c.v].loc ? 0.5 : 0.2);
    }
    return best;
  },
  // the killer and a key person with 2 intrigue together
  killerKP: X => {
    let best = 0;
    for (const k of ofRole(X, 'killer').filter(i => alive(X, i))) for (const kp of keyPersons(X).filter(i => alive(X, i) && i !== k))
      best = Math.max(best, 0.5 * Math.min(X.ch[kp].i, 2) / 2 + 0.5 * (sameLoc(X, k, kp) ? 1 : 0));
    return best;
  },
  killerSelf: X => Math.max(0, ...ofRole(X, 'killer').filter(i => alive(X, i)).map(k => Math.min(X.ch[k].i, 4) / 4)),
  // an incident happens: the culprit's paranoia at its limit by its day
  inc: (X, c) => {
    const it = scriptOf(X).incidents[c.k];
    if (X.inc?.[c.k] === 'yes') return 1;
    if (X.day > it[0] || !alive(X, it[2])) return 0;
    const l = lim(it[2]);
    return l === 0 ? 1 : Math.min(incPara(X, it[2]), l) / l;
  },
  board: (X, c) => Math.min(X.bd[c.l], c.n) / c.n,
  tok: (X, c) => alive(X, c.id) ? Math.min(X.ch[c.id][c.t], c.n) / c.n : 0,
  with: (X, c) => sameLoc(X, c.a, c.b) ? 1 : 0,
  at: (X, c) => alive(X, c.id) && X.ch[c.id].loc === c.l ? 1 : 0,
  away: (X, c) => alive(X, c.id) && X.ch[c.id].loc !== c.l ? 1 : 0,
  loved: (X, c) => alive(X, c.id) ? (Math.min(X.ch[c.id].p, 3) / 3 + Math.min(X.ch[c.id].i, 1)) / 2 : 0,
  tt: (X, c) => alive(X, c.id) ? (X.ch[c.id].g <= 2 ? 1 : 2 / X.ch[c.id].g) : 0,
  dead: (X, c) => X.ch[c.id]?.dead ? 1 : 0
};
const C = (kind, o = {}) => ({ ...o, kind });

/* ---------- per-script plans ---------- */
// routes: { id, w: [loop1, loop2, loop3+], all: [conditions], main: the character to keep a card on }
// open: official day-1 cards per loop ([target, card]); a function may pick among official options.
// starts: official initial area for characters whose start the Mastermind chooses.
// keepHidden: roles whose goodwill abilities the robot doesn't refuse (official: refusing would expose them).
const L = l => `loc:${l}`;
export const PLANS = {
  fs01: { official: true,
    routes: [
      { id: 'sk', w: [1, 0.4, 0.7], main: 'girlStudent', all: [C('sk', { v: 'girlStudent' })] },
      { id: 'suicide', w: [0.2, 1, 0.7], main: 'girlStudent', all: [C('inc', { k: 0 }), C('with', { a: 'popIdol', b: 'girlStudent' })] },
      { id: 'killerSelf', w: [0.1, 0.3, 0.7], all: [C('killerSelf'), C('with', { a: 'doctor', b: 'officeWorker' })] },
      { id: 'killerKP', w: [0.1, 0.3, 0.7], main: 'girlStudent', all: [C('killerKP')] }
    ],
    // official play guide: loop 1 (and loop 2 if the serial killer wasn't exposed) / loop 2 after a serial-killer kill
    open: (S) => S.loop === 1 || !S.bot.mem?.skExposed
      ? [['girlStudent', 'mV'], ['officeWorker', 'i1'], ['doctor', 'p1a']]
      : S.loop === 2 ? [['girlStudent', 'p1a'], ['popIdol', 'mH'], ['doctor', 'mV']] : null },
  fs02: { official: true,
    routes: [
      { id: 'shrine', w: [1, 1, 1], all: [C('board', { l: 'shrine', n: 2 })] },
      { id: 'cityCover', w: [0.3, 0.3, 0.3], all: [C('board', { l: 'city', n: 2 })] },
      { id: 'hospitalFriend', w: [0.4, 0.6, 0.8], main: 'shrineMaiden', all: [C('inc', { k: 1 }), C('board', { l: 'hospital', n: 1 })] },
      { id: 'hospitalKill', w: [0.2, 0.3, 0.5], all: [C('inc', { k: 1 }), C('board', { l: 'hospital', n: 2 })] },
      { id: 'missing', w: [0.4, 0.4, 0.4], all: [C('inc', { k: 0 })] }
    ],
    open: (S, rnd) => S.loop === 1
      ? [[L('city'), 'i2'], [L('shrine'), 'i1'], [L('hospital'), 'fP']]
      : pickN([[L('shrine'), 'i1'], [L('hospital'), 'i2'], ['officeWorker', 'p1a'], ['shrineMaiden', 'mV']], 3, rnd) },
  btx01: { official: true,
    routes: [
      { id: 'hospitalKP', w: [1, 1, 1], all: [C('inc', { k: 1 }), C('board', { l: 'hospital', n: 1 }), C('at', { id: 'popIdol', l: 'hospital' })] },
      { id: 'hospitalKill', w: [1, 1, 1], all: [C('inc', { k: 1 }), C('board', { l: 'hospital', n: 2 })] },
      { id: 'unease', w: [0.6, 0.6, 0.6], all: [C('inc', { k: 0 })] },
      { id: 'contract', w: [0.6, 0.7, 0.8], main: 'popIdol', all: [C('tok', { id: 'popIdol', t: 'i', n: 2 })] },
      { id: 'skKP', w: [0.05, 0.1, 0.4], all: [C('sk', { v: 'popIdol' })] }   // last resort (official)
    ],
    open: S => S.loop === 1 && S.day <= 2 ? [['patient', S.day === 1 ? 'p1a' : 'p1b'], [L('shrine'), 'fP'], [L('hospital'), 'i1']] : null },
  btx02: { official: true,
    routes: [
      { id: 'bomb', w: [1, 1, 1], all: [C('board', { l: 'hospital', n: 2 })] },
      { id: 'loved', w: [0.6, 0.7, 0.8], main: 'officeWorker', all: [C('loved', { id: 'officeWorker' })] },
      { id: 'missingOW', w: [0.4, 0.4, 0.4], all: [C('inc', { k: 1 })] },
      { id: 'school', w: [0.3, 0.3, 0.3], all: [C('board', { l: 'school', n: 2 })] },
      { id: 'decoy', w: [0.3, 0.1, 0.1], all: [C('inc', { k: 0 })] }
    ],
    open: S => S.loop === 1 ? [[L('school'), 'i2'], [L('hospital'), 'i1'], [L('shrine'), 'fP']] : null },
  btx03: { official: false,
    routes: [
      { id: 'butterfly', w: [1, 1, 1], main: 'classRep', all: [C('inc', { k: 0 })] },
      { id: 'skFriend', w: [0.4, 0.4, 0.5], all: [C('sk', { v: 'shrineMaiden' })] },
      { id: 'skFriend2', w: [0.3, 0.3, 0.4], all: [C('sk', { v: 'classRep' })] },
      { id: 'faraway', w: [0.3, 0.4, 0.5], all: [C('inc', { k: 1 }), C('tok', { id: 'shrineMaiden', t: 'i', n: 2 })] },
      { id: 'hospitalKill', w: [0.2, 0.3, 0.4], all: [C('inc', { k: 2 }), C('board', { l: 'hospital', n: 2 })] },
      { id: 'tt', w: [0.3, 0.3, 0.4], all: [C('tt', { id: 'patient' })] }
    ] },
  btx04: { official: true, starts: { henchman: 'hospital' },
    routes: [
      { id: 'factorSuicide', w: [1, 1, 0.6], main: 'boyStudent', all: [C('board', { l: 'city', n: 2 }), C('inc', { k: 0 })] },
      { id: 'hospitalKP', w: [0.5, 0.6, 0.8], all: [C('inc', { k: 1 }), C('board', { l: 'hospital', n: 1 }), C('at', { id: 'informer', l: 'hospital' })] },
      { id: 'hospitalKill', w: [0.5, 0.6, 0.8], all: [C('inc', { k: 1 }), C('board', { l: 'hospital', n: 2 })] },
      { id: 'faraway', w: [0.3, 0.4, 0.7], main: 'informer', all: [C('inc', { k: 2 }), C('tok', { id: 'informer', t: 'i', n: 2 })] },
      { id: 'killerKP', w: [0.2, 0.2, 0.4], all: [C('killerKP')] },
      { id: 'skKP', w: [0.1, 0.2, 0.4], all: [C('sk', { v: 'informer' })] }
    ],
    open: S => S.loop === 1 ? [[L('school'), 'i2'], [L('city'), 'i1'], [L('hospital'), 'fP']]
      : S.loop === 2 ? [[L('school'), 'i1'], [L('city'), 'i2'], [L('hospital'), 'fP']] : null },
  btx05: { official: true, starts: { henchman: 'school' },
    routes: [
      { id: 'butterfly', w: [1, 1, 1], main: 'richStudent', all: [C('inc', { k: 0 })] },
      { id: 'threads', w: [0.5, 0.5, 0.5], all: [C('tok', { id: 'richStudent', t: 'g', n: 1 })] },   // official: goodwill on her feeds 因果线
      { id: 'tt', w: [0.5, 0.5, 0.6], all: [C('tt', { id: 'informer' })] },
      { id: 'foul', w: [0.2, 0.2, 0.2], all: [C('inc', { k: 1 })] }   // misdirection toward 被封印的邪灵 (official)
    ],
    open: S => S.loop === 1 ? [['richStudent', 'p1a'], ['henchman', 'p1b'], ['forensicSpecialist', 'fG']] : null },
  btx06: { official: true, keepHidden: ['ai'],
    routes: [
      { id: 'shrine', w: [1, 1, 1], all: [C('board', { l: 'shrine', n: 2 })] },
      { id: 'foul', w: [0.6, 0.7, 0.7], all: [C('inc', { k: 1 })] },
      { id: 'missing', w: [0.4, 0.6, 0.8], all: [C('inc', { k: 2 })] },
      { id: 'murderFriend', w: [0.3, 0.3, 0.4], all: [C('inc', { k: 5 }), C('with', { a: 'officeWorker', b: 'alien' })] },
      { id: 'feedAI', w: [0.2, 0.3, 0.3], all: [C('tok', { id: 'ai', t: 'g', n: 1 }), C('tok', { id: 'mysteryBoy', t: 'g', n: 1 })] }
    ],
    open: S => S.day === 1 && S.ch.ai?.p > 0 && S.ch.mysteryBoy?.p > 0 ? [['ai', 'i2'], [L('shrine'), 'i1'], ['mysteryBoy', 'p1a']]
      : S.loop === 1 ? [['richStudent', 'mV'], [L('shrine'), 'i1'], [L('city'), 'i2']] : null },
  btx07: { official: false,
    routes: [
      { id: 'killerKP', w: [0.6, 0.6, 0.8], main: 'shrineMaiden', all: [C('killerKP')] },
      { id: 'loveChain', w: [0.8, 0.8, 0.8], main: 'girlStudent', all: [C('inc', { k: 1 }), C('board', { l: 'hospital', n: 1 })] },
      { id: 'hospitalKill', w: [0.5, 0.5, 0.6], all: [C('inc', { k: 2 }), C('board', { l: 'hospital', n: 2 })] },
      { id: 'loved', w: [0.3, 0.3, 0.4], all: [C('loved', { id: 'girlStudent' })] },
      { id: 'murder', w: [0.3, 0.4, 0.5], all: [C('inc', { k: 3 }), C('with', { a: 'policeOfficer', b: 'informer' })] },
      { id: 'unease', w: [0.3, 0.3, 0.3], all: [C('inc', { k: 0 })] }
    ] },
  btx08: { official: false,
    routes: [
      { id: 'loved', w: [1, 1, 1], main: 'richStudent', all: [C('loved', { id: 'richStudent' })] },
      { id: 'bomb', w: [0.8, 0.8, 1], all: [C('board', { l: 'shrine', n: 2 })] },
      { id: 'missing', w: [0.3, 0.3, 0.4], all: [C('inc', { k: 2 })] },
      { id: 'missing2', w: [0.3, 0.3, 0.4], all: [C('inc', { k: 4 })] },
      { id: 'decoy', w: [0.1, 0.1, 0.1], all: [C('tok', { id: 'girlStudent', t: 'i', n: 1 })] }   // community advice: intrigue on another girl
    ] }
};
const planOf = S => PLANS[S.sid];
const weight = (S, r) => r.w[Math.min(S.loop, r.w.length) - 1];
const pickN = (arr, n, rnd) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };

// How well the robot is doing in state X: the weighted progress of every route, plus a lot for a sure loss.
export function value(X) {
  if (X.pendingLoss) return 100;
  let v = 0;
  for (const r of planOf(X).routes) {
    const ps = r.all.map(c => COND[c.kind](X, c));
    const p = ps.reduce((s, x) => s + x, 0) / ps.length;
    v += weight(X, r) * (p + (ps.every(x => x >= 1) ? 1 : 0));
  }
  return v;
}
// A light copy for trying things out (only what the rules read).
const lite = S => ({ sid: S.sid, opt: S.opt, day: S.day, loop: S.loop, inc: S.inc, flags: S.flags, starts: S.starts, bot: S.bot,
  ch: Object.fromEntries(Object.entries(S.ch).map(([id, c]) => [id, { ...c }])), bd: { ...S.bd } });

/* ---------- decisions ---------- */
export function chooseStarts(S, n) {
  const sc = scriptOf(S), plan = planOf(S), out = {};
  for (const id of Object.keys(sc.cast)) if (CHARS[id].start === null) out[id] = plan.starts?.[id] || 'city';
  // memory carried over from the last loop (official FS-01 guide: was the serial killer exposed?)
  const last = S.loops.at(-1), mem = S.bot.mem || {};
  S.bot.mem = { skExposed: !!(mem.skExposed || (last?.lost && mem.lastKill === 'sk')), lastKill: null };
  return out;
}

// The three face-down cards for today.
export function chooseCards(S, rnd) {
  const plan = planOf(S), hand = mmHand(S);
  const open = typeof plan.open === 'function' ? plan.open(S, rnd) : null;
  if (open) {
    const ok = open && open.length === 3 && new Set(open.map(o => o[0])).size === 3 && new Set(open.map(o => o[1])).size === 3
      && open.every(([t, c]) => hand.includes(c) && (isLoc(t) || alive(S, t)));
    if (ok) return open.map(([tgt, c]) => ({ tgt, c }));
  }
  const targets = [...living(S), ...LOCS.map(L)];
  const picked = [];
  const base = () => { const X = lite(S); resolveCards(X, picked, [], undefined, true); return X; };
  for (let n = 0; n < 3; n++) {
    const X0 = base(), v0 = value(X0);
    let best = [], bestV = -Infinity;
    for (const c of hand) {
      if (picked.some(p => p.c === c)) continue;
      for (const t of targets) {
        if (picked.some(p => p.tgt === t) || (MM_CARDS[c].move && isLoc(t))) continue;
        const X = lite(S); resolveCards(X, [...picked, { tgt: t, c }], [], undefined, true);
        const d = value(X) - v0;
        if (d > bestV + 1e-9) { bestV = d; best = [{ tgt: t, c }]; } else if (Math.abs(d - bestV) <= 1e-9) best.push({ tgt: t, c });
      }
    }
    if (bestV <= 1e-9) break;   // nothing left helps: the rest are cover cards
    picked.push(best[Math.floor(rnd() * best.length)]);
  }
  // cover (official hint: keep a card on the main target every day) and bluffs with no effect
  const mains = plan.routes.filter(r => r.main && alive(S, r.main)).sort((a, b) => weight(S, b) - weight(S, a)).map(r => r.main);
  const covers = [];
  for (const m of mains) if (!picked.some(p => p.tgt === m)) covers.push(m);
  const fill = [...covers, ...LOCS.map(L).filter(t => !picked.some(p => p.tgt === t))];
  for (const t of fill) {
    if (picked.length >= 3) break;
    if (picked.some(p => p.tgt === t)) continue;
    // a card that changes nothing on that target: 禁止不安 / 禁止友好 (they only cancel the Protagonists' cards)
    const c = ['fP', 'fG', 'pM', 'p1a', 'p1b', 'i1'].find(c => hand.includes(c) && !picked.some(p => p.c === c) && harmless(S, picked, t, c));
    if (c) picked.push({ tgt: t, c });
  }
  // the rules want three cards: if nothing harmless is left, any remaining card on any free target
  for (const c of hand) { if (picked.length >= 3) break; if (picked.some(p => p.c === c)) continue;
    const t = [...LOCS.map(L), ...targets].find(t => !picked.some(p => p.tgt === t) && !(MM_CARDS[c].move && isLoc(t)));
    if (t) picked.push({ tgt: t, c }); }
  return picked.slice(0, 3);
}
const harmless = (S, picked, t, c) => { const X = lite(S); resolveCards(X, picked, [], undefined, true); const v = value(X); const Y = lite(S); resolveCards(Y, [...picked, { tgt: t, c }], [], undefined, true); return value(Y) >= v - 1e-9; };

// 邪教徒: ignore a 禁止密谋 on characters in its area or on its board when the intrigue there helps a route.
export function cultistIgnores(S, t) {
  for (const id of ofRole(S, 'cultist').filter(i => alive(S, i))) {
    const loc = S.ch[id].loc, here = isLoc(t) ? t.slice(4) === loc : alive(S, t) && S.ch[t].loc === loc;
    if (here) return true;
  }
  return false;
}

// Mastermind ability phase: every ability once, each on its best target (only when it helps). Returns phenomena.
export function mmAbilities(S, rnd) {
  const sc = scriptOf(S), out = [];
  const areasOf = id => [S.ch[id].loc, ...(id === 'boss' && sc.extra?.boss?.turf ? [sc.extra.boss.turf] : [])];
  const opts = [];
  for (const id of ofRole(S, 'brain').filter(i => alive(S, i)))
    for (const a of areasOf(id)) { for (const t of living(S).filter(o => S.ch[o].loc === a)) opts.push({ k: 'brain' + id, f: X => X.ch[t].i++ }); opts.push({ k: 'brain' + id, f: X => X.bd[a]++ }); }
  const cts = ofRole(S, 'conspiracyTheorist').filter(i => alive(S, i));
  if (S.bd.school >= 2) cts.push(...ofRole(S, 'factor').filter(i => alive(S, i)));
  for (const id of cts) for (const a of areasOf(id)) for (const t of living(S).filter(o => S.ch[o].loc === a)) opts.push({ k: 'ct' + id, f: X => X.ch[t].p++ });
  if (sc.x.includes('unsettlingRumor') && !S.pv.rumorUsed) for (const l of LOCS) opts.push({ k: 'rumor', f: X => X.bd[l]++, once: true });
  if (alive(S, 'doctor') && ROLES[roleOf(S, 'doctor')]?.refuse && S.ch.doctor.g >= 2)
    for (const t of sameArea(S, 'doctor')) { opts.push({ k: 'doc', f: X => X.ch[t].p++ }); opts.push({ k: 'doc', f: X => { if (X.ch[t].p) X.ch[t].p--; } }); }
  // greedy: best ability use first, each ability once
  const used = new Set();
  for (;;) {
    const v0 = value(lite(S));
    let best = [], bestV = 0;
    for (const o of opts) {
      if (used.has(o.k)) continue;
      const X = lite(S); o.f(X); const d = value(X) - v0;
      if (d <= 1e-9) continue;   // an ability that gains nothing only gives clues away
      if (d > bestV + 1e-9) { bestV = d; best = [o]; } else if (Math.abs(d - bestV) <= 1e-9) best.push(o);
    }
    if (!best.length) break;
    const o = best[Math.floor(rnd() * best.length)];
    const before = JSON.stringify([S.ch, S.bd]);
    o.f(S); used.add(o.k); if (o.once) S.pv.rumorUsed = true;
    if (JSON.stringify([S.ch, S.bd]) !== before) out.push(...diffText(JSON.parse(before), S));
  }
  return out;
}
function diffText([ch, bd], S) {
  const out = [];
  for (const [id, c] of Object.entries(S.ch)) for (const [k, n] of [['p', '不安'], ['i', '密谋']]) if (ch[id] && c[k] !== ch[id][k]) out.push(`${CHARS[id].name} ${c[k] > ch[id][k] ? '+' : '−'}${Math.abs(c[k] - ch[id][k])} ${n}`);
  for (const l of LOCS) if (S.bd[l] !== bd[l]) out.push(`${({ hospital: '医院', shrine: '神社', city: '都市', school: '学校' })[l]} +${S.bd[l] - bd[l]} 密谋`);
  return out;
}

// Refuse a goodwill ability (only asked for roles that may refuse): refuse when it would reveal a role that matters
// or set the routes back; let it through otherwise, so the refusal itself doesn't give the role away.
const QUIET = ['person', 'curmudgeon', 'friend', 'conspiracyTheorist', 'serialKiller', 'lover'];
export function refuses(S, id, n, a) {
  const plan = planOf(S);
  if ((plan.keepHidden || []).includes(id)) return false;
  const spec = GW[id][n];
  const revealT = ['self'].includes(spec.arg) && /身份/.test(CHARS[id].gw[n][1]) ? id : /身份/.test(CHARS[id].gw[n][1]) ? a.tg : null;
  if (revealT && scriptOf(S).cast[revealT] && !QUIET.includes(scriptOf(S).cast[revealT])) return true;
  const X = core.clone(S); const v0 = value(X);
  try { spec.fx(X, id, a); } catch { return false; }
  return value(X) < v0 - 0.05;
}

// Choices inside an incident's effect: try each, keep the best for the routes.
export function incidentFx(S, k, rnd) {
  const it = scriptOf(S).incidents[k], kind = it[1], cul = it[2];
  const live = living(S), cands = [];
  if (kind === 'murder') for (const v of sameArea(S, cul)) cands.push({ victim: v });
  if (kind === 'farawayMurder') for (const v of live.filter(i => S.ch[i].i >= 2)) cands.push({ victim: v });
  if (kind === 'missingPerson') for (const l of LOCS) if (!forbidden(S, cul, l)) cands.push({ to: l });
  if (kind === 'increasingUnease') for (const p of live) for (const i of live) if (p !== i) cands.push({ p, i });
  if (kind === 'spreading') for (const f of live) for (const t of live) if (f !== t) cands.push({ from: f, to: t });
  if (kind === 'butterflyEffect') for (const t of live.filter(i => S.ch[i].loc === S.ch[cul].loc)) for (const tok of ['g', 'p', 'i']) cands.push({ target: t, tok });
  if (!cands.length) return {};
  let best = [], bestV = -Infinity;
  for (const fx of cands) {
    const X = core.clone(S); X.log = []; incidentEffect(X, it, fx);
    const v = value(X);
    if (v > bestV + 1e-9) { bestV = v; best = [fx]; } else if (Math.abs(v - bestV) <= 1e-9) best.push(fx);
  }
  return best[Math.floor(rnd() * best.length)];
}

// Turn end, after the mandatory abilities: the optional ones that make the Protagonists lose. Always used.
export function dayEndAbilities(S) {
  for (const k of ofRole(S, 'killer').filter(i => alive(S, i))) {
    const kp = keyPersons(S).find(p => alive(S, p) && p !== k && S.ch[p].loc === S.ch[k].loc && S.ch[p].i >= 2);
    if (kp) { core.kill(S, [kp], '杀手'); S.bot.mem = { ...S.bot.mem, lastKill: 'killer' }; return { text: `夜里：${CHARS[kp].name}死亡`, lose: false }; }
    if (S.ch[k].i >= 4) return { text: '夜里：主人公死亡', lose: true, death: true, why: '杀手：自身 4 枚以上密谋，主人公死亡' };
  }
  for (const id of ofRole(S, 'lovedOne').filter(i => alive(S, i))) if (S.ch[id].i >= 1 && S.ch[id].p >= 3)
    return { text: '夜里：主人公死亡', lose: true, death: true, why: '求爱者：1 枚以上密谋且 3 枚以上不安，主人公死亡' };
  if (S.day === scriptOf(S).days) for (const id of ofRole(S, 'timeTraveler').filter(i => alive(S, i))) if (S.ch[id].g <= 2)
    return { text: '最后一天的回合结束：你们失败了', lose: true, why: '时间旅者：最后一天友好 2 枚以下' };
  return null;
}
