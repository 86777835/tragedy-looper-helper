// Robot Mastermind games: the full rules engine. Server only.
// In a robot game nobody holds the Mastermind's key. The robot (bot.js) decides; this file applies the rules.
// State layout:
//   S.bot  hidden: the robot's cards for today and its memory. Never sent to any connection.
//   S.pv   public: what everyone at the table may know (face-down card targets, revealed cards, used once-per-loop
//          cards, the leader, announcements). Only phenomena are announced, never their cause (rulebook p23).
// Rule references are to the 5th edition 《主人公の書》.
import { initialState, scriptOf, maxLoops, roleOf, incidentCanHappen, forbidden, loopEndChecks, core,
  LOCS, LOC_ZH, CHARS, ROLES, PLOTS, INCIDENTS, SETS, SCRIPT } from '../public/logic.js';
import { SCRIPTS } from '../public/data.js';
import * as bot from './bot.js';

const { alive, living, sameArea, ofRole, keyPersons, newLoop, kill, proDie, afterEffects, incidentEffect, endLoop, factorGains } = core;
const name = id => CHARS[id].name;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/* ---------- cards (rulebook p42–43) ---------- */
export const MM_CARDS = {
  mV: { n: '移动↑↓', move: 'v' }, mH: { n: '移动←→', move: 'h' }, mD: { n: '移动斜向', move: 'd', once: true },
  fG: { n: '禁止友好', forbid: 'g' }, p1a: { n: '不安+1', p: 1 }, p1b: { n: '不安+1', p: 1 }, pM: { n: '不安−1', p: -1 },
  fP: { n: '禁止不安', forbid: 'p' }, i1: { n: '密谋+1', i: 1 }, i2: { n: '密谋+2', i: 2, once: true }
};
export const PRO_CARDS = {
  V: { n: '移动↑↓', move: 'v' }, H: { n: '移动←→', move: 'h' }, fM: { n: '移动禁止', forbid: 'm', once: true },
  g1: { n: '友好+1', g: 1 }, g2: { n: '友好+2', g: 2, once: true }, p1: { n: '不安+1', p: 1 }, pM: { n: '不安−1', p: -1, once: true },
  fI: { n: '禁止密谋', forbid: 'i' }
};
const REMOVE = { mmDiag: 'mD', forbidGw: 'fG' };   // cards a script's special rule takes out of the Mastermind's hand
const STEP = {
  v: { hospital: 'city', city: 'hospital', shrine: 'school', school: 'shrine' },
  h: { hospital: 'shrine', shrine: 'hospital', city: 'school', school: 'city' },
  d: { hospital: 'school', school: 'hospital', shrine: 'city', city: 'shrine' }
};
// Two movement cards on one character make one move: ↑↓+←→ = 斜, ↑↓+斜 = ←→, ←→+斜 = ↑↓; the same twice moves once.
export const combine = (a, b) => !b || a === b ? a : ({ vh: 'd', hv: 'd', vd: 'h', dv: 'h', hd: 'v', dh: 'v' })[a + b];
export const isLoc = t => typeof t === 'string' && t.startsWith('loc:') && LOCS.includes(t.slice(4));
const tgtName = t => isLoc(t) ? LOC_ZH[t.slice(4)] : name(t);

export function mmHand(S) {
  const sc = scriptOf(S), out = Object.keys(MM_CARDS).filter(c => !(sc.remove || []).some(r => REMOVE[r] === c));
  return out.filter(c => !(MM_CARDS[c].once && S.pv.mmUsed[c]));
}
const proHand = (S, seat) => Object.keys(PRO_CARDS).filter(c => !(PRO_CARDS[c].once && S.pv.proUsed[seat]?.[c]));
const validTarget = (S, t) => isLoc(t) || alive(S, t);

/* ---------- a new robot game ---------- */
export function botInitial() {
  return { ...initialState(), mode: 'bot', pv: { step: 'setup', news: [] }, bot: {} };
}
const say = (S, x, k = 'ev') => S.pv.news.push({ d: S.day, k, x });

/* ---------- player actions ---------- */
// Returns the new state, or null when the action isn't allowed now.
export function botReduce(s, a, rnd = Math.random) {
  if (!a || typeof a !== 'object' || s.mode !== 'bot') return null;
  const S = core.clone(s);
  const done = () => { S.v = s.v + 1; return S; };
  const pv = S.pv;
  switch (a.t) {
    case 'bpick': {   // which script: a random one of a tragedy set, or a given one; loops picked from its options
      if (S.stage !== 'setup') return null;
      let sc;
      if (a.sid) sc = SCRIPT[a.sid];
      else if (a.set && SETS[a.set]) { const list = SCRIPTS.filter(x => x.set === a.set); sc = list[Math.floor(rnd() * list.length)]; }
      if (!sc) return null;
      S.sid = sc.id; S.opt = 0; pv.chosen = a.sid ? 'given' : 'random';
      return done();
    }
    case 'bopt':
      if (S.stage !== 'setup' || !S.sid || !isInt(a.opt, 0, scriptOf(S).opts.length - 1)) return null;
      S.opt = a.opt; return done();

    case 'bstart': {
      if (S.stage !== 'setup' || !S.sid || !isInt(a.np, 1, 3)) return null;
      Object.assign(S, { gid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), loops: [], rev: { role: {}, cul: {}, x: {} }, lastGw: [], result: null, end: null });
      pv.np = a.np; pv.leader = 1; pv.seen = [];
      startLoop(S, 1, rnd);
      return done();
    }

    case 'pcard': {   // a protagonist places (or takes back) a card
      if (S.stage !== 'play' || pv.step !== 'pro' || !isInt(a.seat, 1, 3)) return null;
      if (a.c === null) { delete pv.pro[a.seat]; return done(); }
      if (!PRO_CARDS[a.c] || !proHand(S, a.seat).includes(a.c) || !validTarget(S, a.tgt)) return null;
      if (Object.entries(pv.pro).some(([k, x]) => +k !== a.seat && x.tgt === a.tgt)) return null;   // Protagonists can't share a target
      pv.pro[a.seat] = { tgt: a.tgt, c: a.c };
      return done();
    }

    case 'reveal': {   // all three cards are down: reveal, resolve, the robot's abilities, then wait for goodwill abilities
      if (S.stage !== 'play' || pv.step !== 'pro' || [1, 2, 3].some(k => !pv.pro[k])) return null;
      resolveDay(S, rnd);
      return done();
    }

    case 'gw': {   // a goodwill ability declared by the leader
      if (S.stage !== 'play' || pv.step !== 'gw') return null;
      const r = useGoodwill(S, a, rnd);
      if (!r) return null;
      afterEffects(S); afterLoss(S);
      return done();
    }

    case 'gwDone':   // goodwill phase over: incidents, leader change, turn end, next day
      if (S.stage !== 'play' || pv.step !== 'gw') return null;
      finishDay(S, rnd);
      return done();

    case 'bnext': {   // after a loop: next loop, final guess or game over
      if (S.stage !== 'loopEnd') return null;
      if (!S.end.lost) { gameOver(S, 'pro'); return done(); }
      if (S.loop < maxLoops(S)) { startLoop(S, S.loop + 1, rnd); return done(); }
      if (SETS[scriptOf(S).set].finalGuess) { S.stage = 'final'; pv.step = 'final'; pv.guess = {}; return done(); }
      gameOver(S, 'mm');
      return done();
    }

    case 'guess': {   // final guess: one character's role
      if (S.stage !== 'final' || !pv.seen.includes(a.ch) || !(a.role === null || SETS[scriptOf(S).set].roles.includes(a.role))) return null;
      if (a.role === null) delete pv.guess[a.ch]; else pv.guess[a.ch] = a.role;
      return done();
    }
    case 'guessDone': {
      const sc = scriptOf(S);
      // every character that appeared on the board during the game (the rulebook doesn't say how to treat
      // characters that enter late and never appeared; this site asks only for those the Protagonists saw)
      if (S.stage !== 'final' || pv.seen.some(id => !pv.guess[id])) return null;
      const wrong = pv.seen.filter(id => pv.guess[id] !== sc.cast[id]);
      S.finalOk = wrong.length === 0;
      gameOver(S, S.finalOk ? 'pro' : 'mm');
      return done();
    }

    case 'breset':
      return { ...botInitial(), v: s.v + 1 };
  }
  return null;
}

// The game is over: only now the script's truth goes into the public part.
function gameOver(S, result) {
  const sc = scriptOf(S);
  S.stage = 'over'; S.result = result; S.pv.step = 'over';
  S.pv.truth = { sid: sc.id, y: sc.y, x: sc.x.slice(), cast: { ...sc.cast }, incidents: sc.incidents.map(i => i.slice()) };
}

/* ---------- loop and day flow ---------- */
function startLoop(S, n, rnd) {
  const sc = scriptOf(S), place = bot.chooseStarts(S, n);
  newLoop(S, n, place);
  Object.assign(S.pv, { step: 'pro', news: [], mmUsed: {}, proUsed: {}, gwUsed: {}, pro: {}, mmTargets: [], revealed: null, rumorUsed: false });
  S.pv.leader = 1;
  say(S, `第 ${n} 轮回开始。所有角色回到初始区域，指示物清空`, 'loop');
  for (const id of Object.keys(S.ch)) if (sc.cast[id] === 'friend' && S.rev.role[id] && S.ch[id].g) say(S, `${name(id)}的身份公开过：+1 友好`);
  for (const id of Object.keys(S.ch)) if (CHARS[id].loopShrine) say(S, `${name(id)}的特性：神社 +${CHARS[id].loopShrine} 密谋`);
  if (sc.x.includes('threadsFate')) for (const id of S.lastGw) if (S.ch[id]) say(S, `${name(id)} +2 不安`);
  for (const id of Object.keys(sc.cast)) if (CHARS[id].start === null && S.ch[id]) say(S, `${name(id)}的初始区域：${LOC_ZH[S.ch[id].loc]}`);
  for (const [id, ex] of Object.entries(sc.extra || {})) if (ex.enterLoop === n) say(S, `${name(id)}登场（${LOC_ZH[CHARS[id].start]}）`);
  startDay(S, rnd);
}

function startDay(S, rnd) {
  const sc = scriptOf(S);
  for (const [id, ex] of Object.entries(sc.extra || {})) {
    if (ex.enterDay === S.day && !S.ch[id]) { core.place(S, id, CHARS[id].start); say(S, `${name(id)}登场（${LOC_ZH[CHARS[id].start]}）`); }
  }
  for (const id of Object.keys(S.ch)) if (!S.pv.seen.includes(id)) S.pv.seen.push(id);
  // the robot places its three cards face down; only their targets are public
  S.bot.cards = bot.chooseCards(S, rnd);
  S.pv.mmTargets = S.bot.cards.map(c => c.tgt);
  S.pv.pro = {}; S.pv.revealed = null; S.pv.step = 'pro'; S.ph = 2;
  say(S, `第 ${S.day} 天：剧作家把 3 张牌背面朝上放在${S.pv.mmTargets.map(tgtName).join('、')}`, 'day');
}

function resolveDay(S, rnd) {
  const mm = S.bot.cards, pro = [1, 2, 3].map(k => ({ ...S.pv.pro[k], seat: k }));
  S.ph = 3;
  S.pv.revealed = [...mm.map(c => ({ tgt: c.tgt, c: c.c, who: 'mm' })), ...pro.map(c => ({ tgt: c.tgt, c: c.c, who: c.seat }))];
  for (const c of mm) if (MM_CARDS[c.c].once) S.pv.mmUsed[c.c] = true;
  for (const c of pro) if (PRO_CARDS[c.c].once) (S.pv.proUsed[c.seat] ||= {})[c.c] = true;
  const byT = [...new Set(S.pv.revealed.map(r => r.tgt))].map(tg => `${tgtName(tg)}：${S.pv.revealed.filter(r => r.tgt === tg).map(r => `${r.who === 'mm' ? '剧作家' : `主人公${r.who}`}「${(r.who === 'mm' ? MM_CARDS : PRO_CARDS)[r.c].n}」`).join(' + ')}`);
  say(S, `翻牌——${byT.join('；')}`, 'cards');
  const out = resolveCards(S, mm, pro, t => bot.cultistIgnores(S, t));
  for (const x of out) say(S, x);
  if (!out.length) say(S, '没有角色或版图发生变化');
  // Mastermind ability phase
  S.ph = 4;
  for (const x of bot.mmAbilities(S, rnd)) say(S, x);
  if (afterLoss(S)) return;
  S.ph = 5; S.pv.step = 'gw';
}

function finishDay(S, rnd) {
  const sc = scriptOf(S);
  // incidents (p24): must happen when the culprit is alive with paranoia at its limit
  S.ph = 6;
  sc.incidents.forEach((it, k) => {
    if (it[0] !== S.day || S.stage !== 'play') return;
    const kind = INCIDENTS[it[1]].name;
    if (!incidentCanHappen(S, it)) { S.inc[k] = 'no'; say(S, `事件「${kind}」没有发生`); return; }
    S.inc[k] = 'yes';
    const fx = bot.incidentFx(S, k, rnd);
    const before = snapshot(S);
    incidentEffect(S, it, fx);
    const diff = phenomena(before, S);
    say(S, `事件「${kind}」发生了${diff.length ? `：${diff.join('，')}` : '，但什么也没有发生'}`, 'inc');
    afterEffects(S);
  });
  if (afterLoss(S)) return;
  // leader change
  S.ph = 7; S.pv.leader = S.pv.leader % 3 + 1;
  // turn end: mandatory abilities first (serial killers), then the robot's optional ones
  S.ph = 8;
  const before = snapshot(S);
  const sk = ofRole(S, 'serialKiller').filter(id => alive(S, id));
  const victims = sk.map(id => sameArea(S, id)).filter(o => o.length === 1).map(o => o[0]);
  if (victims.some(v => keyPersons(S).includes(v))) S.bot.mem = { ...S.bot.mem, lastKill: 'sk' };
  if (victims.length) kill(S, [...new Set(victims)], '回合结束');
  afterEffects(S);
  const d1 = phenomena(before, S);
  if (d1.length) say(S, `夜里：${d1.join('，')}`);
  if (afterLoss(S)) return;
  const opt = bot.dayEndAbilities(S, rnd);
  if (opt) { say(S, opt.text); if (opt.lose) { endLoopPublic(S, [opt.why], opt.death); return; } }
  afterEffects(S);
  if (afterLoss(S)) return;
  if (S.day >= sc.days) { endLoopPublic(S, loopEndChecks(S).filter(c => c.met).map(c => c.why)); return; }
  S.day += 1; S.ph = 0;
  startDay(S, rnd);
}

// A loss already queued by kill()/proDie() ended the loop: announce it.
function afterLoss(S) {
  if (S.stage !== 'loopEnd' || S.pv.step === 'loopEnd') return S.stage !== 'play';
  announceLoopEnd(S);
  return true;
}
function endLoopPublic(S, why, death) {
  if (death && S.flags.soldier) { say(S, '什么也没有发生'); return; }
  endLoop(S, why);
  announceLoopEnd(S);
}
function announceLoopEnd(S) {
  const e = S.end, sc = scriptOf(S);
  S.pv.step = 'loopEnd';
  if (e.why.some(w => w.includes('主人公死亡'))) say(S, '主人公死亡', 'lose');
  say(S, e.lost ? `第 ${S.loop} 轮回结束：你们失败了` : `第 ${S.loop} 轮回结束：主人公获胜！`, 'loop');
  for (const id of Object.keys(sc.cast)) if (sc.cast[id] === 'friend' && S.ch[id]?.dead) say(S, `${name(id)}的身份公开：${ROLES.friend.name}`);
}

/* ---------- resolving the six cards (p22, p42–43) ---------- */
// mm / pro: [{ tgt, c }]. Returns the public phenomena.
export function resolveCards(S, mm, pro, cultistIgnores = () => false, quiet = false) {
  const all = [...mm.map(x => ({ ...x, k: MM_CARDS[x.c], mm: true })), ...pro.map(x => ({ ...x, k: PRO_CARDS[x.c], mm: false }))];
  const on = t => all.filter(x => x.tgt === t);
  const before = quiet ? null : snapshot(S);
  // movement first
  for (const t of new Set(all.map(x => x.tgt))) {
    if (isLoc(t) || !alive(S, t)) continue;
    const cs = on(t);
    if (cs.some(x => x.k.forbid === 'm')) continue;
    const mv = cs.filter(x => x.k.move).map(x => x.k.move);
    if (!mv.length) continue;
    const dir = combine(mv[0], mv[1]), to = STEP[dir][S.ch[t].loc];
    if (!forbidden(S, t, to)) S.ch[t].loc = to;
  }
  // then everything else; two or more 禁止密谋 in one day all fail
  const fiVoid = pro.filter(x => PRO_CARDS[x.c].forbid === 'i').length >= 2;
  for (const t of new Set(all.map(x => x.tgt))) {
    const cs = on(t), loc = isLoc(t);
    if (!loc && !alive(S, t)) continue;
    const fG = cs.some(x => x.k.forbid === 'g') && !(!loc && roleOf(S, t) === 'timeTraveler');
    const fP = cs.some(x => x.k.forbid === 'p');
    const fI = cs.some(x => x.k.forbid === 'i') && !fiVoid && !cultistIgnores(t);
    const c = loc ? null : S.ch[t];
    if (loc) { for (const x of cs) if (x.k.i && !fI) S.bd[t.slice(4)] += x.k.i; continue; }
    for (const x of cs) {
      if (x.k.g && !fG) c.g += x.k.g;
      if (x.k.i && !fI) c.i += x.k.i;
    }
    if (!fP) { const plus = cs.filter(x => x.k.p > 0).reduce((s, x) => s + x.k.p, 0), minus = cs.filter(x => x.k.p < 0).length; c.p = Math.max(0, c.p + plus - minus); }
  }
  return quiet ? [] : phenomena(before, S);
}

// What changed on the table, as the Protagonists see it.
const snapshot = S => ({ ch: Object.fromEntries(Object.entries(S.ch).map(([id, c]) => [id, { ...c }])), bd: { ...S.bd } });
function phenomena(b, S) {
  const out = [];
  for (const [id, c] of Object.entries(S.ch)) {
    const o = b.ch[id];
    if (!o) { out.push(`${name(id)}出现在${LOC_ZH[c.loc]}`); continue; }
    if (c.loc !== o.loc) out.push(`${name(id)}移到${LOC_ZH[c.loc]}`);
    for (const [k, n] of [['g', '友好'], ['p', '不安'], ['i', '密谋'], ['gd', '护卫']]) if (c[k] !== o[k]) out.push(`${name(id)} ${c[k] > o[k] ? '+' : '−'}${Math.abs(c[k] - o[k])} ${n}`);
    if (c.dead && !o.dead) out.push(`${name(id)}死亡`);
    if (!c.dead && o.dead) out.push(`${name(id)}复活`);
  }
  for (const l of LOCS) if (S.bd[l] !== b.bd[l]) out.push(`${LOC_ZH[l]} ${S.bd[l] > b.bd[l] ? '+' : '−'}${Math.abs(S.bd[l] - b.bd[l])} 密谋`);
  return out;
}

/* ---------- goodwill abilities (p37–41) ---------- */
// One entry per ability, in the order of CHARS[id].gw. arg kinds the page asks for:
//   other: another living character in the same area   self: none   student: a student in the same area
//   same: any living character in the same area (self allowed)   sameOrBoard: same, or the character's board
//   any: any other living character   corpseSame / corpse: a corpse   inc / incDone: an incident on the public sheet
//   rulex: a rule X name of the set   two: two other characters + a token   pm: '+' or '-'   card: a used once-per-loop card
const STUDENT = id => CHARS[id].tags.includes('学生');
export const GW = {
  boyStudent: [{ arg: 'other', test: (S, id, t) => STUDENT(t), fx: (S, id, a) => dec(S, a.tg, 'p') }],
  girlStudent: [{ arg: 'other', test: (S, id, t) => STUDENT(t), fx: (S, id, a) => dec(S, a.tg, 'p') }],
  richStudent: [{ arg: 'same', where: (S, id) => ['school', 'city'].includes(S.ch[id].loc), fx: (S, id, a) => inc(S, a.tg, 'g', 1) }],
  classRep: [{ arg: 'card', fx: (S, id, a) => { delete S.pv.proUsed[S.pv.leader][a.c]; return `队长取回了「${PRO_CARDS[a.c].n}」`; } }],
  mysteryBoy: [{ arg: 'self', fx: (S, id) => reveal(S, id) }],
  shrineMaiden: [{ arg: 'self', where: (S, id) => S.ch[id].loc === 'shrine', fx: S => decBoard(S, 'shrine') },
                 { arg: 'same', fx: (S, id, a) => reveal(S, a.tg) }],
  alien: [{ arg: 'other', fx: (S, id, a) => { kill(S, [a.tg], '异界人'); return ''; } },
          { arg: 'corpseSame', fx: (S, id, a) => { S.ch[a.tg].dead = false; return ''; } }],
  godlyBeing: [{ arg: 'inc', fx: (S, id, a) => revealCul(S, a.k) }, { arg: 'sameOrBoard', fx: (S, id, a) => isLoc(a.tg) ? decBoard(S, a.tg.slice(4)) : dec(S, a.tg, 'i') }],
  policeOfficer: [{ arg: 'incDone', fx: (S, id, a) => revealCul(S, a.k) }, { arg: 'same', fx: (S, id, a) => inc(S, a.tg, 'gd', 1) }],
  officeWorker: [{ arg: 'self', fx: (S, id) => reveal(S, id) }],
  informer: [{ arg: 'rulex', fx: (S, id, a) => {
    const sc = scriptOf(S), k = sc.x.findIndex(x => x !== a.r);
    S.rev.x[k] = true; return `剧本使用的一条规则X：${PLOTS[sc.x[k]].name}`; } }],
  popIdol: [{ arg: 'other', fx: (S, id, a) => dec(S, a.tg, 'p') }, { arg: 'other', fx: (S, id, a) => inc(S, a.tg, 'g', 1) }],
  journalist: [{ arg: 'any', fx: (S, id, a) => inc(S, a.tg, 'p', 1) }, { arg: 'sameOrBoard', fx: (S, id, a) => isLoc(a.tg) ? incBoard(S, a.tg.slice(4)) : inc(S, a.tg, 'i', 1) }],
  boss: [{ arg: 'turf', fx: (S, id, a) => reveal(S, a.tg) }],
  doctor: [{ arg: 'other', pm: true, fx: (S, id, a) => a.pm === '+' ? inc(S, a.tg, 'p', 1) : dec(S, a.tg, 'p') },
           { arg: 'self', fx: S => { S.flags.patientFree = true; return '本轮回住院患者没有禁止区域'; } }],
  patient: [],
  nurse: [{ arg: 'other', test: (S, id, t) => S.ch[t].p >= CHARS[t].limit, fx: (S, id, a) => dec(S, a.tg, 'p') }],
  henchman: [{ arg: 'self', fx: S => { S.flags.hench = true; return '本轮回以手下为当事人的事件不会发生'; } }],
  transferStudent: [{ arg: 'other', fx: (S, id, a) => { const c = S.ch[a.tg]; if (c.i) { c.i -= 1; c.g += 1; } return ''; } }],
  forensicSpecialist: [{ arg: 'two', fx: (S, id, a) => { const f = S.ch[a.from], t = S.ch[a.to]; if (f[a.tok]) { f[a.tok] -= 1; t[a.tok] += 1; } return ''; } },
                       { arg: 'corpse', fx: (S, id, a) => reveal(S, a.tg) }],
  ai: [{ arg: 'aiInc', fx: (S, id, a) => { const it = scriptOf(S).incidents[a.k]; incidentEffect(S, [it[0], it[1], 'ai'], a.fx || {}); return ''; } }],
  teacher: [{ arg: 'student', pm: true, fx: (S, id, a) => a.pm === '+' ? inc(S, a.tg, 'p', 1) : dec(S, a.tg, 'p') }, { arg: 'student', fx: (S, id, a) => reveal(S, a.tg) }],
  soldier: [{ arg: 'other', fx: (S, id, a) => inc(S, a.tg, 'p', 2) }, { arg: 'self', fx: S => { S.flags.soldier = true; return '本轮回主人公不会死亡'; } }],
  blackCat: []
};
// Token changes return '': what happened is announced from the before/after difference.
const dec = (S, t, k) => { if (S.ch[t][k]) S.ch[t][k] -= 1; return ''; };
const inc = (S, t, k, n) => { S.ch[t][k] += n; return ''; };
const decBoard = (S, l) => { if (S.bd[l]) S.bd[l] -= 1; return ''; };
const incBoard = (S, l) => { S.bd[l] += 1; return ''; };
const reveal = (S, t) => { S.rev.role[t] = true; return `${name(t)}的身份是「${ROLES[scriptOf(S).cast[t]].name}」`; };
const revealCul = (S, k) => { S.rev.cul[k] = true; const it = scriptOf(S).incidents[k]; return `第 ${it[0]} 天「${INCIDENTS[it[1]].name}」的当事人是${name(it[2])}`; };

// Can this ability be declared now? Returns null if fine, else the reason (shown to the players).
export function gwProblem(S, id, n, a) {
  const c = S.ch[id], spec = GW[id]?.[n], card = CHARS[id].gw[n];
  if (!c || c.dead || !spec || !card) return '这个能力现在不能用';
  const [need, , fl] = card;
  if (c.g < need) return `友好不够（需要 ${need}）`;
  if (fl?.from && S.loop < fl.from) return `第 ${fl.from} 轮回起才能用`;
  if (fl?.once && S.pv.gwUsed[`${id}:${n}`]) return '本轮回已经用过';
  if (spec.where && !spec.where(S, id)) return '现在所在的区域不能用';
  const here = c.loc, live = t => alive(S, t), same = t => live(t) && S.ch[t].loc === here;
  const t = a?.tg;
  switch (spec.arg) {
    case 'self': return null;
    case 'other': return t && t !== id && same(t) && (!spec.test || spec.test(S, id, t)) ? (spec.pm && !['+', '-'].includes(a.pm) ? '选加还是减' : null) : '选一名同区域的其他角色';
    case 'student': return t && same(t) && STUDENT(t) ? (spec.pm && !['+', '-'].includes(a.pm) ? '选加还是减' : null) : '选一名同区域的学生';
    case 'same': return t && same(t) ? null : '选一名同区域的角色';
    case 'sameOrBoard': return t && (same(t) || t === `loc:${here}`) ? null : '选同区域的角色或这块版图';
    case 'any': return t && t !== id && live(t) ? null : '选一名其他角色';
    case 'corpseSame': return t && S.ch[t]?.dead && S.ch[t].loc === here ? null : '选一具同区域的尸体';
    case 'corpse': return t && S.ch[t]?.dead ? null : '选一具尸体';
    case 'inc': return isInt(a?.k, 0, scriptOf(S).incidents.length - 1) ? null : '选一个事件';
    case 'incDone': return isInt(a?.k, 0, scriptOf(S).incidents.length - 1) && S.inc[a.k] === 'yes' ? null : '选一个本轮回已经发生的事件';
    case 'rulex': return SETS[scriptOf(S).set].x.some(x => PLOTS[x].name === a?.r || x === a?.r) ? null : '说出一条规则X';
    case 'turf': { const turf = scriptOf(S).extra?.boss?.turf; return t && t !== id && live(t) && S.ch[t].loc === turf ? null : '选一名在领地里的其他角色'; }
    case 'two': return a?.from && a?.to && a.from !== a.to && [a.from, a.to].every(x => x !== id && same(x)) && ['g', 'p', 'i'].includes(a.tok) ? null : '选同区域的两名其他角色和一种指示物';
    case 'card': return a?.c && PRO_CARDS[a.c]?.once && S.pv.proUsed[S.pv.leader]?.[a.c] ? null : '选一张队长用过的「每轮回1次」的牌';
    case 'aiInc': {
      if (!isInt(a?.k, 0, scriptOf(S).incidents.length - 1)) return '选一个事件';
      const it = scriptOf(S).incidents[a.k], X = core.clone(S);
      return incidentEffect(X, [it[0], it[1], 'ai'], a.fx || {}) ? null : '选好事件效果的目标';
    }
  }
  return '这个能力现在不能用';
}

function useGoodwill(S, a, rnd) {
  const id = a.ch, n = a.n;
  if (gwProblem(S, id, n, a) !== null) return false;
  const spec = GW[id][n], [need, text, fl] = CHARS[id].gw[n];
  if (spec.arg === 'rulex') a = { ...a, r: SETS[scriptOf(S).set].x.find(x => PLOTS[x].name === a.r || x === a.r) };
  const role = roleOf(S, id), refuse = ROLES[role]?.refuse;
  if (fl?.once) S.pv.gwUsed[`${id}:${n}`] = true;   // a refused once-per-loop ability counts as used (p23)
  const head = `${name(id)}的能力（友好 ${need}）`;
  if (refuse && !fl?.noRefuse && (refuse === 'must' || bot.refuses(S, id, n, a, rnd))) { say(S, `${head}：剧作家拒绝了`, 'gw'); return true; }
  const b = snapshot(S), info = spec.fx(S, id, a), diff = phenomena(b, S);
  say(S, `${head}：${[info, ...diff].filter(Boolean).join('，') || '什么也没有发生'}`, 'gw');
  return true;
}

export { tgtName };
