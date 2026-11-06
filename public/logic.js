// Game state and rules shared by the room server (Durable Object, authoritative) and the Mastermind's page.
// The Mastermind resolves the physical cards on the table and records the result here; this code tracks tokens,
// applies the mandatory effects the rules leave no choice about, and lists what to resolve in each phase.
// Rule references: 5th edition 《主人公の書》 (page numbers in README) and the official summary sheets.
import { LOCS, LOC_ZH, CHARS, ROLES, PLOTS, INCIDENTS, SETS, SCRIPT } from './data.js';

// The 9 phases of a day.
export const PHASES = [
  { k: 'dayStart', n: '回合开始' },
  { k: 'mmCards', n: '剧作家行动' },
  { k: 'proCards', n: '主人公行动' },
  { k: 'resolve', n: '行动结算' },
  { k: 'mmAbility', n: '剧作家能力' },
  { k: 'gwAbility', n: '主人公能力' },
  { k: 'incident', n: '事件' },
  { k: 'leader', n: '队长交接' },
  { k: 'dayEnd', n: '回合结束' }
];
export const TOKENS = { g: '友好', p: '不安', i: '密谋' };
// Once-per-loop cards and abilities the Mastermind keeps track of.
export const ONCE = { mmDiag: '剧作家「移动斜向」', mmI2: '剧作家「密谋+2」', rumor: '流言四起：版图 +1 密谋' };
// Effects of goodwill abilities that last for the rest of the loop.
export const FLAGS = {
  soldier: { who: 'soldier', n: '军人：本轮回主人公不会死亡' },
  patientFree: { who: 'doctor', n: '医生：本轮回住院患者没有禁止区域' },
  hench: { who: 'henchman', n: '手下：本轮回以手下为当事人的事件不发生' }
};
const MAX_TOKENS = 99;

const clone = o => JSON.parse(JSON.stringify(o));
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

export function initialState() {
  return {
    v: 0, stage: 'setup', sid: null, opt: 0, gid: null,
    loop: 0, day: 0, ph: 0,
    ch: {}, bd: { hospital: 0, shrine: 0, city: 0, school: 0 },
    starts: {},          // this loop's initial area of every character on the board
    inc: {},             // incident index → 'yes' | 'no' (this loop)
    once: {},            // once-per-loop cards used (this loop)
    flags: {},           // goodwill effects lasting this loop
    log: [],             // this loop's events (private)
    loops: [],           // finished loops: { n, lost, day, why: [...], log: [...] }
    rev: { role: {}, cul: {}, x: {} },   // what has been revealed to the Protagonists
    lastGw: [],          // characters that had goodwill when the previous loop ended (因果线)
    end: null,           // the loop that just ended, while stage is 'loopEnd'
    result: null         // 'pro' (Protagonists win) | 'mm' (Mastermind wins)
  };
}

/* ---------- script helpers ---------- */
export const scriptOf = S => SCRIPT[S.sid];
export const optOf = S => scriptOf(S).opts[S.opt];
export const maxLoops = S => optOf(S)[0];
export const rulesOf = sc => [sc.y, ...sc.x];
const hasRule = (sc, r) => rulesOf(sc).includes(r);
export const extraOf = (sc, id) => (sc.extra || {})[id] || {};
const alive = (S, id) => !!S.ch[id] && !S.ch[id].dead;
const living = S => Object.keys(S.ch).filter(id => !S.ch[id].dead);
// Other living characters in the same area (corpses are not characters).
const sameArea = (S, id) => living(S).filter(o => o !== id && S.ch[o].loc === S.ch[id].loc);
export const charName = id => CHARS[id].name;

// The role a character has right now: 妄想扩大病毒 turns a 平民 with 3+ paranoia into a 杀人狂.
export function roleOf(S, id) {
  const sc = scriptOf(S), r = sc.cast[id];
  if (r === 'person' && hasRule(sc, 'paranoiaVirus') && S.ch[id] && S.ch[id].p >= 3) return 'serialKiller';
  return r;
}
// 不安定因子 gains other roles' abilities while the school / city hold 2+ intrigue.
const factorGains = S => ({ ct: S.bd.school >= 2, kp: S.bd.city >= 2 });
const ofRole = (S, role) => Object.keys(S.ch).filter(id => roleOf(S, id) === role);
// Characters with the 关键人物 ability (the role, or a 不安定因子 while the city has 2+ intrigue).
const keyPersons = S => Object.keys(S.ch).filter(id => roleOf(S, id) === 'keyPerson' || (roleOf(S, id) === 'factor' && factorGains(S).kp));
// Paranoia that counts for the culprit's incident (A.I.: every token counts).
export const incPara = (S, id) => { const c = S.ch[id]; return CHARS[id].allTokens ? c.g + c.p + c.i : c.p; };
export const forbidden = (S, id, loc) => (CHARS[id].forbid || []).includes(loc) && !(id === 'patient' && S.flags.patientFree);
export const incidentCanHappen = (S, [, , cul]) => alive(S, cul) && incPara(S, cul) >= CHARS[cul].limit && !(cul === 'henchman' && S.flags.hench);

/* ---------- reducer ---------- */
// Applies one Mastermind action. Returns the new state, or null when the action is invalid.
export function reduce(s, a) {
  if (!a || typeof a !== 'object') return null;
  const S = clone(s);
  const done = () => { S.v = s.v + 1; return S; };
  const playing = S.stage === 'play';

  switch (a.t) {
    case 'pick': {   // choose the script and its loop count
      const sc = SCRIPT[a.sid];
      if (S.stage !== 'setup' || !sc || !isInt(a.opt, 0, sc.opts.length - 1)) return null;
      S.sid = a.sid; S.opt = a.opt;
      return done();
    }

    case 'start': {
      if (S.stage !== 'setup' || !S.sid) return null;
      Object.assign(S, { gid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        loops: [], rev: { role: {}, cul: {}, x: {} }, lastGw: [], result: null, end: null });
      if (!newLoop(S, 1, a.place)) return null;
      return done();
    }

    case 'ch': {   // set a character's area / tokens / guard / death
      if (!playing || !S.ch[a.id]) return null;
      const c = S.ch[a.id];
      if (a.loc !== undefined) { if (!LOCS.includes(a.loc) || c.dead) return null; c.loc = a.loc; }
      for (const k of [...Object.keys(TOKENS), 'gd']) if (a[k] !== undefined) { if (!isInt(a[k], 0, MAX_TOKENS)) return null; c[k] = a[k]; }
      if (a.add !== undefined) {   // relative change, so quick taps on two phones don't overwrite each other
        if (!a.add || typeof a.add !== 'object') return null;
        for (const [k, d] of Object.entries(a.add)) { if (!(k in TOKENS || k === 'gd') || !isInt(d, -MAX_TOKENS, MAX_TOKENS)) return null; c[k] = Math.min(MAX_TOKENS, Math.max(0, c[k] + d)); }
      }
      if (a.dead !== undefined) {
        if (typeof a.dead !== 'boolean') return null;
        if (a.dead && !c.dead) { if (roleOf(S, a.id) === 'timeTraveler') return null; kill(S, [a.id], cleanText(a.why, 40) || '剧作家记录'); }
        else if (!a.dead && c.dead) { c.dead = false; S.log.push(ev(S, `${charName(a.id)} 复活`)); }
      }
      afterEffects(S);
      return done();
    }

    case 'bd':
      if (!playing || !LOCS.includes(a.loc)) return null;
      if (a.add !== undefined) { if (!isInt(a.add, -MAX_TOKENS, MAX_TOKENS)) return null; S.bd[a.loc] = Math.min(MAX_TOKENS, Math.max(0, S.bd[a.loc] + a.add)); }
      else { if (!isInt(a.n, 0, MAX_TOKENS)) return null; S.bd[a.loc] = a.n; }
      afterEffects(S);
      return done();

    case 'ph':
      if (!playing || !isInt(a.to, 0, PHASES.length - 1)) return null;
      S.ph = a.to;
      return done();

    case 'day': {   // next day
      const sc = scriptOf(S);
      if (!playing || a.from !== S.day || S.day >= sc.days) return null;   // `from` stops a stale double tap
      S.day += 1; S.ph = 0;
      for (const [id, ex] of Object.entries(sc.extra || {})) {
        if (ex.enterDay === S.day && !S.ch[id]) { place(S, id, CHARS[id].start); S.log.push(ev(S, `${charName(id)} 登场（${LOC_ZH[CHARS[id].start]}）`)); }
      }
      return done();
    }

    case 'inc': {   // record whether today's incident happened, and its effect
      if (!playing) return null;
      const sc = scriptOf(S), it = sc.incidents[a.k];
      if (!it || it[0] !== S.day || !['yes', 'no'].includes(a.r) || S.inc[a.k]) return null;
      if (a.r === 'yes' && !incidentCanHappen(S, it)) return null;   // culprit must be alive with paranoia at its limit
      S.inc[a.k] = a.r;
      if (a.r === 'yes') { if (!incidentEffect(S, it, a.fx || {})) return null; }
      else S.log.push(ev(S, `事件「${INCIDENTS[it[1]].name}」未发生`));
      afterEffects(S);
      return done();
    }

    case 'once':
      if (!playing || !ONCE[a.k] || typeof a.on !== 'boolean') return null;
      S.once[a.k] = a.on;
      return done();

    case 'flag': {
      const f = FLAGS[a.k];
      if (!playing || !f || typeof a.on !== 'boolean' || !scriptOf(S).cast[f.who]) return null;
      S.flags[a.k] = a.on;
      if (a.on) S.log.push(ev(S, f.n));
      return done();
    }

    case 'note': {
      const x = cleanText(a.x, 120);
      if (!playing || !x) return null;
      S.log.push(ev(S, x, 'note'));
      return done();
    }

    case 'lose': {   // the Protagonists lose (or die) right now: an optional ability the Mastermind uses, or a case the app can't see
      const why = cleanText(a.why, 60);
      if (!playing || !why) return null;
      if (a.death && S.flags.soldier) { S.log.push(ev(S, `${why}——军人的能力生效，主人公不会死亡，什么也不发生`)); return done(); }
      endLoop(S, [why]);
      return done();
    }

    case 'endLoop': {   // the last day is over: check the loss conditions
      const sc = scriptOf(S);
      if (!playing || S.day !== sc.days) return null;
      endLoop(S, loopEndChecks(S).filter(c => c.met).map(c => c.why));
      return done();
    }

    case 'next': {   // after the loop summary: next loop, final guess, or game over
      if (S.stage !== 'loopEnd') return null;
      if (!S.end.lost) { S.stage = 'over'; S.result = 'pro'; return done(); }
      if (S.loop < maxLoops(S)) { if (!newLoop(S, S.loop + 1, a.place)) return null; return done(); }
      if (SETS[scriptOf(S).set].finalGuess) { S.stage = 'final'; return done(); }
      S.stage = 'over'; S.result = 'mm';
      return done();
    }

    case 'final':   // result of the final guess (最终决战)
      if (S.stage !== 'final' || typeof a.ok !== 'boolean') return null;
      S.stage = 'over'; S.result = a.ok ? 'pro' : 'mm'; S.finalOk = a.ok;
      return done();

    case 'rev': {   // reveal a role / a culprit / a subplot to the Protagonists (or take it back)
      if (S.stage === 'setup' || typeof a.on !== 'boolean') return null;
      const sc = scriptOf(S);
      const ok = a.kind === 'role' ? Object.hasOwn(sc.cast, a.key) : a.kind === 'cul' ? isInt(a.key, 0, sc.incidents.length - 1) : a.kind === 'x' ? isInt(a.key, 0, sc.x.length - 1) : false;
      if (!ok) return null;
      if (a.on) S.rev[a.kind][a.key] = true; else delete S.rev[a.kind][a.key];
      return done();
    }

    case 'reset':
      return { ...initialState(), v: s.v + 1 };
  }
  return null;
}

const ev = (S, x, k = 'ev') => ({ d: S.day, k, x });

// Sets up loop n: every character alive in its initial area with no tokens, then the loop-start effects.
function newLoop(S, n, placeArg) {
  const sc = scriptOf(S);
  const choose = Object.keys(sc.cast).filter(id => CHARS[id].start === null && onBoardAtStart(sc, id, n));
  const chosen = {};
  for (const id of choose) { const l = placeArg?.[id]; if (!LOCS.includes(l)) return false; chosen[id] = l; }
  Object.assign(S, { stage: 'play', loop: n, day: 1, ph: 0, ch: {}, starts: {}, bd: { hospital: 0, shrine: 0, city: 0, school: 0 },
    inc: {}, once: {}, flags: {}, log: [], end: null });
  for (const id of Object.keys(sc.cast)) if (onBoardAtStart(sc, id, n)) place(S, id, chosen[id] ?? CHARS[id].start);
  const notes = [];
  for (const id of Object.keys(S.ch)) {
    if (sc.cast[id] === 'friend' && S.rev.role[id]) { S.ch[id].g += 1; notes.push(`${charName(id)}（身份公开过的亲友）+1 友好`); }
    if (CHARS[id].loopShrine) { S.bd.shrine += CHARS[id].loopShrine; notes.push(`${charName(id)}的特性：神社 +${CHARS[id].loopShrine} 密谋`); }
  }
  if (hasRule(sc, 'threadsFate')) {
    for (const id of S.lastGw) if (S.ch[id]) { S.ch[id].p += 2; notes.push(`因果线：${charName(id)}（上轮回结束时有友好）+2 不安`); }
  }
  S.log.push(ev(S, `第 ${n} 轮回开始` + (notes.length ? `：${notes.join('；')}` : '')));
  return true;
}
const onBoardAtStart = (sc, id, n) => { const ex = extraOf(sc, id); return !(ex.enterLoop > n) && !(ex.enterDay > 1); };
function place(S, id, loc) { S.ch[id] = { loc, g: 0, p: 0, i: 0, gd: 0, dead: false }; S.starts[id] = loc; }

// Characters die at the same time, with the mandatory effects that follow.
// 时间旅者 can't die; a guard token is removed instead of dying.
function kill(S, ids, why) {
  const dying = [];
  for (const id of ids) {
    const c = S.ch[id];
    if (!c || c.dead) continue;
    if (roleOf(S, id) === 'timeTraveler') { S.log.push(ev(S, `${charName(id)} 没有死亡（不死）`)); continue; }
    if (c.gd > 0) { c.gd -= 1; S.log.push(ev(S, `${charName(id)} 的护卫指示物抵消了死亡（${why}）`)); continue; }
    dying.push(id);
  }
  const roles = Object.fromEntries(dying.map(id => [id, roleOf(S, id)])), kps = keyPersons(S);
  for (const id of dying) { S.ch[id].dead = true; S.log.push(ev(S, `${charName(id)} 死亡（${why}）`)); }
  for (const id of dying) {
    const partner = { lover: 'lovedOne', lovedOne: 'lover' }[roles[id]];
    if (partner) for (const o of ofRole(S, partner)) if (alive(S, o)) { S.ch[o].p += 6; S.log.push(ev(S, `强制：${ROLES[roles[id]].name}死亡 → ${charName(o)} +6 不安`)); }
    if (kps.includes(id)) S.pendingLoss = (S.pendingLoss || []).concat(`关键人物（${charName(id)}）死亡`);
  }
}
// The Protagonists die / a 关键人物 died: the loop ends at once.
function proDie(S, why) {
  if (S.flags.soldier) { S.log.push(ev(S, `${why}——军人的能力生效，主人公不会死亡`)); return; }
  S.pendingLoss = (S.pendingLoss || []).concat(why);
}
function afterEffects(S) {
  const w = S.pendingLoss; delete S.pendingLoss;
  if (w && S.stage === 'play') endLoop(S, w);
}

function incidentEffect(S, [, kind, culprit], fx) {
  const name = INCIDENTS[kind].name, log = x => S.log.push(ev(S, `事件「${name}」发生：${x}`));
  if (CHARS[culprit].noEffect) { log(`当事人${charName(culprit)}的特性：没有效果`); return true; }
  const pick = (id, test = () => true) => id === undefined || id === null ? null : (alive(S, id) && test(id) ? id : false);
  switch (kind) {
    case 'murder': {
      const cands = sameArea(S, culprit), v = pick(fx.victim, id => cands.includes(id));
      if (v === false || (v === null && cands.length)) return false;
      if (v === null) { log('同区域没有其他角色，无效果'); return true; }
      log(`${charName(v)} 被杀害`); kill(S, [v], `谋杀，当事人 ${charName(culprit)}`); return true;
    }
    case 'suicide':
      log(`${charName(culprit)} 死亡`); kill(S, [culprit], '自杀'); return true;
    case 'hospitalIncident': {
      const n = S.bd.hospital;
      if (n >= 1) { const here = living(S).filter(id => S.ch[id].loc === 'hospital'); log(here.length ? `医院 ${n} 枚密谋，医院里的角色死亡：${here.map(charName).join('、')}` : `医院 ${n} 枚密谋，医院里没有角色`); kill(S, here, '医院事故'); }
      else log('医院没有密谋，无效果');
      if (n >= 2) proDie(S, '医院事故：医院有 2 枚以上密谋，主人公死亡');
      return true;
    }
    case 'farawayMurder': {
      const cands = living(S).filter(id => S.ch[id].i >= 2), v = pick(fx.victim, id => cands.includes(id));
      if (v === false || (v === null && cands.length)) return false;
      if (v === null) { log('没有 2 枚以上密谋的角色，无效果'); return true; }
      log(`${charName(v)} 被杀害`); kill(S, [v], '远距离杀人'); return true;
    }
    case 'missingPerson':   // can't go into a forbidden area (designer's ruling); staying put is allowed
      if (!LOCS.includes(fx.to) || forbidden(S, culprit, fx.to)) return false;
      S.ch[culprit].loc = fx.to; S.bd[fx.to] += 1;
      log(`${charName(culprit)} 移到${LOC_ZH[fx.to]}，${LOC_ZH[fx.to]} +1 密谋`); return true;
    case 'foulEvil':
      S.bd.shrine += 2; log('神社 +2 密谋'); return true;
    case 'increasingUnease': {
      const p = pick(fx.p), i = pick(fx.i);
      if (!p || !i || p === i) return false;
      S.ch[p].p += 2; S.ch[i].i += 1; log(`${charName(p)} +2 不安，${charName(i)} +1 密谋`); return true;
    }
    case 'spreading': {
      const f = pick(fx.from), t = pick(fx.to);
      if (!f || !t || f === t) return false;
      const n = Math.min(2, S.ch[f].g);
      S.ch[f].g -= n; S.ch[t].g += 2; log(`${charName(f)} −${n} 友好，${charName(t)} +2 友好`); return true;
    }
    case 'butterflyEffect': {
      const cands = living(S).filter(id => S.ch[id].loc === S.ch[culprit].loc), v = pick(fx.target, id => cands.includes(id));
      if (!v || !TOKENS[fx.tok]) return false;
      S.ch[v][fx.tok] += 1; log(`${charName(v)} +1 ${TOKENS[fx.tok]}`); return true;
    }
  }
  return false;
}

function endLoop(S, why) {
  const sc = scriptOf(S), lost = why.length > 0;
  for (const id of ofRole(S, 'friend')) if (S.ch[id].dead) S.rev.role[id] = true;   // a dead 亲友's role is revealed
  S.lastGw = Object.keys(S.ch).filter(id => S.ch[id].g > 0);
  S.end = { lost, day: S.day, why };
  S.loops.push({ n: S.loop, lost, day: S.day, days: sc.days, why, log: S.log.slice(0, 80) });
  S.stage = 'loopEnd';
}

/* ---------- checks ---------- */
// Loss conditions checked when a loop ends normally: { met, text, why }.
export function loopEndChecks(S) {
  const sc = scriptOf(S), out = [];
  const bd = l => S.bd[l] || 0;
  const add = (met, text, why) => out.push({ met, text, why });
  const startOf = id => S.starts[id] ?? CHARS[id].start;
  switch (sc.y) {
    case 'lightAvenger': for (const id of Object.keys(sc.cast).filter(i => sc.cast[i] === 'brain')) add(bd(startOf(id)) >= 2, `主谋（${charName(id)}）的初始区域${LOC_ZH[startOf(id)]}有 2 枚以上密谋（现在 ${bd(startOf(id))}）`, '复仇的火种：主谋的初始区域有 2 枚以上密谋'); break;
    case 'placeProtect': add(bd('school') >= 2, `学校有 2 枚以上密谋（现在 ${bd('school')}）`, '守护此地：学校有 2 枚以上密谋'); break;
    case 'sealedItem': add(bd('shrine') >= 2, `神社有 2 枚以上密谋（现在 ${bd('shrine')}）`, '被封印的邪灵：神社有 2 枚以上密谋'); break;
    case 'signWithMe': for (const id of Object.keys(sc.cast).filter(i => sc.cast[i] === 'keyPerson')) add((S.ch[id]?.i || 0) >= 2, `关键人物（${charName(id)}）有 2 枚以上密谋（现在 ${S.ch[id]?.i || 0}）`, '和我签订契约吧！：关键人物有 2 枚以上密谋'); break;
    case 'changeOfFuture': { const k = sc.incidents.findIndex((it, i) => it[1] === 'butterflyEffect' && S.inc[i] === 'yes'); add(k >= 0, '本轮回发生过蝴蝶效应', '改变未来：本轮回发生过蝴蝶效应'); break; }
    case 'giantTimeBomb': for (const id of Object.keys(sc.cast).filter(i => sc.cast[i] === 'witch')) {
      // a 神灵 that hasn't entered yet still has its initial area (official 5th FAQ)
      const l = startOf(id); add(bd(l) >= 2, `魔女（${charName(id)}）的初始区域${LOC_ZH[l]}有 2 枚以上密谋（现在 ${bd(l)}）`, '巨大定时炸弹X：魔女的初始区域有 2 枚以上密谋');
    } break;
  }
  for (const id of Object.keys(sc.cast).filter(i => sc.cast[i] === 'friend')) add(!!S.ch[id]?.dead, `亲友（${charName(id)}）已死亡（${S.ch[id]?.dead ? '轮回结束时公开其身份' : '存活'}）`, `亲友（${charName(id)}）死亡`);
  return out;
}

// What to resolve in each phase right now, for the Mastermind's screen. Mandatory items come first:
// the rules resolve every mandatory ability before any optional one at the same timing.
// level: 'must' 强制 / 'loss' an optional ability that would make the Protagonists lose / 'may' 任意 / 'info'.
// act: a button the page can offer.
export function reminders(S) {
  const sc = scriptOf(S), set = SETS[sc.set], out = {};
  const add = (ph, level, text, act) => (out[ph] ||= []).push({ level, text, act });
  const last = S.day === sc.days;
  const fg = factorGains(S);
  const has = role => ofRole(S, role).filter(id => alive(S, id));
  const at = id => LOC_ZH[S.ch[id].loc];

  // day start
  for (const [id, ex] of Object.entries(sc.extra || {})) if (ex.enterDay === S.day && S.ch[id]) add('dayStart', 'info', `${charName(id)}今天登场（${at(id)}）`);
  for (const [id, ex] of Object.entries(sc.extra || {})) if (ex.enterDay > S.day) add('dayStart', 'info', `${charName(id)}第 ${ex.enterDay} 天才登场`);
  if (last) add('dayStart', 'info', `今天是本轮回最后一天（第 ${S.day}/${sc.days} 天）`);

  // cards
  add('mmCards', 'info', '从手牌选 3 张，背面朝上放在 3 个不同的角色或版图上；尸体不能放牌');
  for (const [k, n] of Object.entries(ONCE)) if (k !== 'rumor' && !(sc.remove || []).includes(k)) add('mmCards', S.once[k] ? 'info' : 'may', `${n}：本轮回${S.once[k] ? '已用（不回手）' : '未用'}`, { t: 'once', k });
  for (const r of sc.special) add('mmCards', 'must', `特殊规则：${r}`);
  add('proCards', 'info', '队长先出，顺时针每人暗置 1 张；主人公之间不能叠在同一目标，可以叠在剧作家的牌上');

  // resolve
  add('resolve', 'info', '翻开 6 张牌：先结算移动（两张移动合成一次），再结算其他牌；禁止类牌抵消同目标上的对应牌；不安+1 与 不安−1 叠放时先 +1 后 −1');
  add('resolve', 'info', '两名以上主人公同一天出「禁止密谋」时，这些禁止密谋全部失效');
  for (const id of ofRole(S, 'timeTraveler')) if (alive(S, id)) add('resolve', 'must', `时间旅者（${charName(id)}）：放在他身上的「禁止友好」无效`);
  for (const id of has('cultist')) add('resolve', 'may', `邪教徒（${charName(id)}，${at(id)}）：可以无视同区域角色和${at(id)}版图上的「禁止密谋」`);
  for (const id of living(S)) for (const f of CHARS[id].forbid || []) {
    if (S.ch[id].loc === f && !(id === 'patient' && S.flags.patientFree)) add('resolve', 'info', `${charName(id)}现在在禁止区域${LOC_ZH[f]}：移动到禁止区域的牌应当无效，请核对`);
  }

  // Mastermind abilities
  add('mmAbility', 'info', '每个可用能力各用 1 次；宣布结果时只说发生了什么，不说是谁的能力');
  for (const id of has('brain')) add('mmAbility', 'may', `主谋（${charName(id)}，${at(id)}）：给同区域 1 名角色（可含自己）或${at(id)}版图放 1 枚密谋`);
  for (const id of has('conspiracyTheorist')) add('mmAbility', 'may', `传谣人（${charName(id)}，${at(id)}）：给同区域 1 名角色（可含自己）放 1 枚不安`);
  if (fg.ct) for (const id of has('factor')) add('mmAbility', 'may', `不安定因子（${charName(id)}）：学校有 2 枚以上密谋，获得传谣人能力——给同区域 1 名角色放 1 枚不安`);
  if (hasRule(sc, 'unsettlingRumor')) add('mmAbility', S.once.rumor ? 'info' : 'may', `流言四起：任选 1 块版图放 1 枚密谋（每轮回限 1 次，${S.once.rumor ? '已用' : '未用'}）`, { t: 'once', k: 'rumor' });
  if (alive(S, 'doctor') && ROLES[roleOf(S, 'doctor')]?.refuse && S.ch.doctor.g >= 2) add('mmAbility', 'may', `医生身份${ROLES[roleOf(S, 'doctor')].name}无视友好且有 ${S.ch.doctor.g} 枚友好：剧作家也可以用医生的能力（同区域 1 名角色 ±1 不安）`);
  if (sc.extra?.boss?.turf && alive(S, 'boss')) add('mmAbility', 'info', `大人物的领地是${LOC_ZH[sc.extra.boss.turf]}：他的能力也可以作用于领地里的角色和版图`);

  // goodwill abilities
  add('gwAbility', 'info', '队长宣言能力并先指定目标；只有身份无视友好的角色可以拒绝，必定无视友好的必须拒绝；被拒绝的「每轮回1次」能力也算用过');
  for (const id of living(S)) {
    const c = S.ch[id], gw = (CHARS[id].gw || []).filter(([n, , fl]) => c.g >= n && !(fl?.from > S.loop));
    if (!gw.length) continue;
    const role = roleOf(S, id), refuse = ROLES[role]?.refuse;
    const tail = refuse === 'must' ? `——身份${ROLES[role].name}必定无视友好：必须拒绝（标了不可拒绝的除外）` : refuse === 'may' ? `——身份${ROLES[role].name}无视友好：可以拒绝` : '';
    add('gwAbility', refuse ? 'may' : 'info', `${charName(id)}（友好 ${c.g}）可用：${gw.map(([n, t, fl]) => `[${n}] ${t}${fl?.once ? '（每轮回1次）' : ''}${fl?.noRefuse ? '（不可拒绝）' : ''}`).join('；')}${tail}`);
  }
  for (const [k, f] of Object.entries(FLAGS)) if (sc.cast[f.who]) add('gwAbility', S.flags[k] ? 'must' : 'info', `${f.n}：${S.flags[k] ? '本轮回已生效' : '未生效'}`, { t: 'flag', k, on: !S.flags[k] });

  // incidents today
  sc.incidents.forEach((it, k) => {
    const [d, kind, cul] = it;
    if (d !== S.day) return;
    const c = S.ch[cul], lim = CHARS[cul].limit, rec = S.inc[k];
    const meet = incidentCanHappen(S, it);
    const state = !c ? '当事人未登场' : c.dead ? '当事人已死亡' : cul === 'henchman' && S.flags.hench ? '手下的能力：不发生' : `当事人${CHARS[cul].allTokens ? '指示物合计' : '不安'} ${incPara(S, cul)}/${lim}`;
    add('incident', rec ? 'info' : meet ? 'must' : 'info',
      `事件「${INCIDENTS[kind].name}」（当事人 ${charName(cul)}，${state}）${rec ? `：已记录为${rec === 'yes' ? '发生' : '未发生'}` : meet ? '：条件满足，必须发生' : '：条件不满足，不发生'}——${INCIDENTS[kind].fx}${CHARS[cul].noEffect ? '（当事人是黑猫：照常发生但没有效果）' : ''}`,
      rec ? null : { t: 'inc', k, meet });
  });
  if (sc.incidents.some(([d]) => d === S.day)) add('incident', 'info', '没有效果也要宣布“事件发生了”；只宣布发生与否，不说当事人');
  add('leader', 'info', '队长卡交给左手边的主人公');

  // turn end: mandatory first
  for (const id of has('serialKiller')) {
    const o = sameArea(S, id);
    const virus = sc.cast[id] === 'person' ? '（妄想扩大病毒：平民 3 枚以上不安变为杀人狂）' : '';
    if (o.length === 1) add('dayEnd', 'must', `杀人狂（${charName(id)}）${virus}：同区域只有${charName(o[0])}，${charName(o[0])}必须死亡`, { t: 'ch', id: o[0], dead: true, why: `杀人狂 ${charName(id)}` });
    else add('dayEnd', 'info', `杀人狂（${charName(id)}）${virus}：同区域有 ${o.length} 名其他角色，不发动`);
  }
  if (fg.kp) for (const id of has('factor')) add('dayEnd', 'info', `不安定因子（${charName(id)}）：都市有 2 枚以上密谋，现在拥有关键人物的能力（死亡即主人公失败）`);
  for (const id of has('killer')) {
    const loc = S.ch[id].loc;
    for (const kp of keyPersons(S).filter(k => alive(S, k) && S.ch[k].loc === loc && k !== id && S.ch[k].i >= 2))
      add('dayEnd', 'loss', `杀手（${charName(id)}）：同区域的关键人物${charName(kp)}有 ${S.ch[kp].i} 枚密谋，可以杀死关键人物`, { t: 'ch', id: kp, dead: true, why: `杀手 ${charName(id)}` });
    if (S.ch[id].i >= 4) add('dayEnd', 'loss', `杀手（${charName(id)}）自身有 ${S.ch[id].i} 枚密谋：可以让主人公死亡`, { t: 'lose', death: true, why: `杀手（${charName(id)}）：自身 4 枚以上密谋，主人公死亡` });
  }
  for (const id of has('lovedOne')) if (S.ch[id].i >= 1 && S.ch[id].p >= 3)
    add('dayEnd', 'loss', `求爱者（${charName(id)}）有 ${S.ch[id].i} 枚密谋、${S.ch[id].p} 枚不安：可以让主人公死亡`, { t: 'lose', death: true, why: `求爱者（${charName(id)}）：1 枚以上密谋且 3 枚以上不安，主人公死亡` });
  if (last) for (const id of ofRole(S, 'timeTraveler').filter(i => alive(S, i))) {
    const g = S.ch[id].g;
    add('dayEnd', g <= 2 ? 'loss' : 'info', `最后一天：时间旅者（${charName(id)}）友好 ${g} 枚${g <= 2 ? '（2 枚以下），可以让主人公失败' : '，超过 2 枚，不能发动'}`,
      g <= 2 ? { t: 'lose', why: `时间旅者（${charName(id)}）：最后一天友好 2 枚以下` } : null);
  }
  if (last) {
    const lc = loopEndChecks(S);
    add('dayEnd', 'info', `最后一天：回合结束后结束本轮回，检查失败条件——${lc.length ? lc.map(c => `${c.met ? '✔' : '✘'} ${c.text}`).join('；') : '无'}`);
    if (!set.finalGuess && S.loop === maxLoops(S)) add('dayEnd', 'info', 'First Steps 没有最终决战：最后一个轮回主人公失败即剧作家获胜');
  }
  const order = { must: 0, loss: 1, may: 2, info: 3 };
  for (const k of Object.keys(out)) out[k].sort((a, b) => order[a.level] - order[b.level]);
  return out;
}

/* ---------- views ---------- */
// What the Protagonists may see. Built field by field from what is public on the table (whitelist):
// the public script sheet, the board, tokens, deaths, which incidents happened, and what was revealed.
// Never the script name, roles, culprits, rules or the Mastermind's notes.
export function publicView(s) {
  const v = { v: s.v, stage: s.stage, loop: s.loop, day: s.day, ph: s.ph };
  if (s.mode === 'bot') v.pv = botPublic(s);
  if (!s.sid) return v;
  const sc = SCRIPT[s.sid], set = SETS[sc.set];
  v.sheet = { set: set.name, setRules: set.rules.slice(), loops: sc.opts[s.opt][0], days: sc.days, special: sc.special.slice(),
    incidents: sc.incidents.map(([day, kind]) => ({ day, name: INCIDENTS[kind].name })) };
  if (sc.extra?.boss?.turf && s.ch?.boss) v.sheet.turf = sc.extra.boss.turf;   // the turf marker sits on the board (p18)
  if (s.stage === 'setup') return v;
  v.ch = Object.fromEntries(Object.entries(s.ch).map(([id, c]) => [id, { loc: c.loc, g: c.g, p: c.p, i: c.i, gd: c.gd, dead: c.dead }]));
  v.bd = { hospital: s.bd.hospital, shrine: s.bd.shrine, city: s.bd.city, school: s.bd.school };
  v.happened = sc.incidents.map((it, k) => s.inc[k] || null);
  v.rev = {
    role: Object.fromEntries(Object.keys(s.rev.role).filter(id => Object.hasOwn(sc.cast, id)).map(id => [id, ROLES[sc.cast[id]].name])),
    cul: Object.fromEntries(Object.keys(s.rev.cul).filter(k => sc.incidents[k]).map(k => [k, charName(sc.incidents[k][2])])),
    x: Object.keys(s.rev.x).filter(k => sc.x[k]).map(k => PLOTS[sc.x[k]].name)
  };
  v.loops = s.loops.map(l => ({ n: l.n, lost: l.lost, day: l.day }));
  if (s.stage === 'over') v.result = s.result;
  return v;
}

// Robot games: the public part of the robot's turn (s.pv), field by field. s.bot (its cards and plan) is never read here.
// The robot's cards are public only once revealed; before that only their targets are.
function botPublic(s) {
  const p = s.pv, cp = o => JSON.parse(JSON.stringify(o ?? null));
  const out = { step: p.step, chosen: p.chosen ?? null, np: p.np ?? null, leader: p.leader ?? null,
    mmTargets: cp(p.mmTargets) || [], pro: cp(p.pro) || {}, revealed: cp(p.revealed),
    mmUsed: cp(p.mmUsed) || {}, proUsed: cp(p.proUsed) || {}, gwUsed: cp(p.gwUsed) || {},
    news: (p.news || []).map(n => ({ d: n.d, k: n.k, x: n.x })), guess: cp(p.guess) || {}, seen: cp(p.seen) || [] };
  if (s.stage === 'over' && p.truth) out.truth = cp(p.truth);
  return out;
}

// What the room keeps for a finished game.
export function gameRecord(S) {
  if (S.stage !== 'over' || !S.gid) return null;
  return { gid: S.gid, sid: S.sid, max: maxLoops(S), result: S.result, finalOk: S.finalOk ?? null,
    loops: S.loops.map(l => ({ n: l.n, lost: l.lost, day: l.day, why: l.why, log: l.log.map(e => `第${e.d}天 ${e.x}`) })) };
}

export { LOCS, LOC_ZH, CHARS, ROLES, PLOTS, INCIDENTS, SETS, SCRIPT };

// Internals reused by the server-only robot Mastermind (src/engine.js, src/bot.js).
export const core = { clone, hasRule, alive, living, sameArea, factorGains, ofRole, keyPersons, ev, newLoop, place, kill, proDie, afterEffects, incidentEffect, endLoop };
