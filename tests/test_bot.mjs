// 人机模式 without a server: card resolution, the robot's official choices, and many simulated games
// whose every public view is checked for hidden information. Usage: node tests/test_bot.mjs
import { botInitial, botReduce, resolveCards, combine, GW, PRO_CARDS } from '../src/engine.js';
import { PLANS } from '../src/bot.js';
import { ARGS } from '../public/botui.js';
import { publicView, CHARS, ROLES, PLOTS, LOCS } from '../public/logic.js';
import { SCRIPTS, SCRIPT } from '../public/data.js';
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const rng = seed => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

/* ---------- card resolution (p22, p42–43) ---------- */
const table = (sid, ch) => { const S = { sid, flags: {}, ch: {}, bd: { hospital: 0, shrine: 0, city: 0, school: 0 } }; for (const [id, loc] of Object.entries(ch)) S.ch[id] = { loc, g: 0, p: 0, i: 0, gd: 0, dead: false }; return S; };
eq('moves combine: ↑↓+←→ = 斜, ↑↓+斜 = ←→, same twice = once', [combine('v', 'h'), combine('v', 'd'), combine('h', 'h')], ['d', 'h', 'h']);
let T = table('fs01', { girlStudent: 'school', shrineMaiden: 'shrine', officeWorker: 'city' });
resolveCards(T, [{ tgt: 'girlStudent', c: 'mV' }], [{ tgt: 'girlStudent', c: 'H' }]);
eq('two moves on one character: 学校 ↑↓+←→ → 医院 (diagonal)', T.ch.girlStudent.loc, 'hospital');
T = table('fs01', { girlStudent: 'school' });
resolveCards(T, [{ tgt: 'girlStudent', c: 'mV' }], [{ tgt: 'girlStudent', c: 'fM' }]);
eq('移动禁止 cancels the move', T.ch.girlStudent.loc, 'school');
T = table('fs01', { shrineMaiden: 'shrine' });
resolveCards(T, [{ tgt: 'shrineMaiden', c: 'mD' }], []);
eq('a move into the forbidden area (巫女 → 都市) fails', T.ch.shrineMaiden.loc, 'shrine');
T = table('fs01', { girlStudent: 'school' });
resolveCards(T, [{ tgt: 'girlStudent', c: 'p1a' }], [{ tgt: 'girlStudent', c: 'pM' }]);
eq('不安+1 then 不安−1 on 0 paranoia → 0', T.ch.girlStudent.p, 0);
T = table('fs01', { girlStudent: 'school', boyStudent: 'school' });
resolveCards(T, [{ tgt: 'girlStudent', c: 'i2' }, { tgt: 'boyStudent', c: 'i1' }], [{ tgt: 'girlStudent', c: 'fI' }, { tgt: 'boyStudent', c: 'fI' }]);
eq('two 禁止密谋 on one day both fail', [T.ch.girlStudent.i, T.ch.boyStudent.i], [2, 1]);
T = table('fs01', { girlStudent: 'school' });
resolveCards(T, [{ tgt: 'girlStudent', c: 'fG' }], [{ tgt: 'girlStudent', c: 'g2' }]);
eq('禁止友好 cancels 友好+2', T.ch.girlStudent.g, 0);
T = table('btx03', { patient: 'hospital' });
resolveCards(T, [{ tgt: 'patient', c: 'fG' }], [{ tgt: 'patient', c: 'g1' }]);
eq('禁止友好 has no effect on the 时间旅者', T.ch.patient.g, 1);
T = table('fs01', { girlStudent: 'school' });
resolveCards(T, [{ tgt: 'loc:school', c: 'p1a' }, { tgt: 'loc:city', c: 'i1' }], []);
eq('on a board only intrigue cards do anything', [T.bd.school, T.bd.city], [0, 1]);

/* ---------- the robot's official choices ---------- */
const start = (sid, seed = 1) => { let S = botInitial(); S = botReduce(S, { t: 'bpick', sid }, rng(seed)); return botReduce(S, { t: 'bstart', np: 3 }, rng(seed)); };
let S = start('fs01');
eq('FS-01 day 1: the official play guide\'s three cards', S.bot.cards, [{ tgt: 'girlStudent', c: 'mV' }, { tgt: 'officeWorker', c: 'i1' }, { tgt: 'doctor', c: 'p1a' }]);
eq('the public part shows only where they are', [publicView(S).pv.mmTargets, JSON.stringify(publicView(S)).includes('"mV"')], [['girlStudent', 'officeWorker', 'doctor'], false]);
eq('BTX-04: 手下 starts in the hospital (official)', start('btx04').ch.henchman.loc, 'hospital');
eq('BTX-05: 手下 starts at school (official)', start('btx05').ch.henchman.loc, 'school');
S = start('fs02');
eq('FS-02 loop 1 day 1: official opening', S.bot.cards, [{ tgt: 'loc:city', c: 'i2' }, { tgt: 'loc:shrine', c: 'i1' }, { tgt: 'loc:hospital', c: 'fP' }]);
// FS-01 loop 1, Protagonists do nothing useful: the girl ends the day alone with the 巫女 (杀人狂) → the key person dies
S = start('fs01');
for (const seat of [1, 2, 3]) S = botReduce(S, { t: 'pcard', seat, tgt: `loc:${LOCS[seat - 1]}`, c: 'g1' });
S = botReduce(S, { t: 'reveal' }); S = botReduce(S, { t: 'gwDone' });
eq('FS-01: official loop-1 plan wins the loop on day 1', [S.stage, S.end?.lost, S.day], ['loopEnd', true, 1]);
eq('the loss is announced without the reason', S.pv.news.some(n => n.x.includes('你们失败了')) && !S.pv.news.some(n => /杀人狂|关键人物/.test(n.x)), true);
S = botReduce(S, { t: 'bnext' }, rng(2));
eq('FS-01 loop 2 after a serial-killer win: the official alternative opening', S.bot.cards, [{ tgt: 'girlStudent', c: 'p1a' }, { tgt: 'popIdol', c: 'mH' }, { tgt: 'doctor', c: 'mV' }]);
// goodwill: a 必定无视友好 role (邪教徒 大小姐) must refuse; 护士's ability is 不可拒绝 even though she is the 魔女
S = start('btx06');
for (const seat of [1, 2, 3]) S = botReduce(S, { t: 'pcard', seat, tgt: `loc:${LOCS[seat - 1]}`, c: 'g1' });
S = botReduce(S, { t: 'reveal' });
S.ch.richStudent.g = 3; S.ch.richStudent.loc = 'school'; S.ch.classRep.loc = 'school';
const g0 = S.ch.classRep.g;
S = botReduce(S, { t: 'gw', ch: 'richStudent', n: 0, tg: 'classRep' });
eq('邪教徒 refuses: nothing happens, refusal announced', [S.ch.classRep.g === g0, S.pv.news.at(-1).x.includes('拒绝')], [true, true]);
let N = start('btx02');
N.ch.nurse.g = 2; N.ch.officeWorker.p = 3; N.ch.officeWorker.loc = 'hospital';
for (const seat of [1, 2, 3]) N = botReduce(N, { t: 'pcard', seat, tgt: `loc:${LOCS[seat - 1]}`, c: 'g1' });
N = botReduce(N, { t: 'reveal' });
const p0 = N.ch.officeWorker.p;
N = botReduce(N, { t: 'gw', ch: 'nurse', n: 0, tg: 'officeWorker' });
eq('护士 (魔女): 不可拒绝 goes through', N.ch.officeWorker.p, p0 - 1);
// a goodwill ability without enough goodwill is rejected
eq('not enough goodwill → rejected', botReduce(S, { t: 'gw', ch: 'popIdol', n: 1, tg: 'richStudent' }), null);
// Protagonists can't share a target
S = start('fs01');
S = botReduce(S, { t: 'pcard', seat: 1, tgt: 'boyStudent', c: 'g1' });
eq('two Protagonists can\'t use the same target', botReduce(S, { t: 'pcard', seat: 2, tgt: 'boyStudent', c: 'g1' }), null);
S = botReduce(S, { t: 'pcard', seat: 1, tgt: 'boyStudent', c: 'g2' });
S = botReduce(S, { t: 'pcard', seat: 2, tgt: 'girlStudent', c: 'p1' }); S = botReduce(S, { t: 'pcard', seat: 3, tgt: 'loc:city', c: 'fI' });
S = botReduce(S, { t: 'reveal' }); S = botReduce(S, { t: 'gwDone' });
if (S.stage === 'loopEnd') S = botReduce(S, { t: 'bnext' }, rng(3));
eq('a once-per-loop card is used up for the loop', S.stage === 'play' && S.loop === 1 ? botReduce(S, { t: 'pcard', seat: 1, tgt: 'doctor', c: 'g2' }) : null, null);

/* ---------- page and server agree on what each goodwill ability asks for ---------- */
eq('goodwill ability arguments: page = server', Object.fromEntries(Object.keys(CHARS).map(id => [id, (GW[id] || []).map(s => s.arg)])), ARGS);
eq('every character\'s goodwill abilities are implemented', Object.keys(CHARS).filter(id => (CHARS[id].gw || []).length !== (GW[id] || []).length), []);
eq('every script has a plan', SCRIPTS.filter(s => !PLANS[s.id]).map(s => s.id), []);

/* ---------- many games: robot vs random Protagonists, public views checked frame by frame ---------- */
const PUB = ['v', 'stage', 'loop', 'day', 'ph', 'sheet', 'ch', 'bd', 'happened', 'rev', 'loops', 'result', 'pv'];
const PV = ['step', 'chosen', 'np', 'leader', 'mmTargets', 'pro', 'revealed', 'mmUsed', 'proUsed', 'gwUsed', 'news', 'guess', 'seen', 'truth'];
const roleWords = Object.values(ROLES).map(r => r.name).filter(n => n !== '平民'), plotWords = Object.values(PLOTS).map(p => p.name);
let games = 0, leak = null, ended = 0;
for (const sc of SCRIPTS) for (let g = 0; g < 12; g++) {
  const r = rng(1000 * g + sc.id.length * 7 + g);
  let S = botInitial(); games++;
  const check = () => {
    const v = publicView(S);
    if (Object.keys(v).some(k => !PUB.includes(k)) || Object.keys(v.pv || {}).some(k => !PV.includes(k))) leak ||= `${sc.id}: fields ${Object.keys(v)}`;
    if (S.stage === 'over') return;
    const txt = JSON.stringify(v), revealed = Object.values(v.rev?.role || {});
    const hit = [sc.zh, sc.jp, sc.en, sc.id, sc.no, ...plotWords.filter(w => !(v.rev?.x || []).includes(w))].find(w => txt.includes(w))
      || roleWords.find(w => txt.includes(w) && !revealed.includes(w) && !SCRIPT[sc.id].special.some(x => x.includes(w)))
      || (S.bot.cards && v.pv.step === 'pro' && txt.includes('"revealed":[') && 'cards before reveal');
    if (hit) leak ||= `${sc.id} game ${g}: "${hit}" in ${txt.slice(0, 160)}`;
  };
  const act = a => { const n = botReduce(S, a, r); if (n) { S = n; check(); } return !!n; };
  act({ t: 'bpick', sid: sc.id }); act({ t: 'bstart', np: 1 + (g % 3) });
  for (let steps = 0; S.stage !== 'over' && steps < 3000; steps++) {
    const pv = S.pv;
    if (S.stage === 'loopEnd') { act({ t: 'bnext' }); continue; }
    if (S.stage === 'final') { for (const id of S.pv.seen) act({ t: 'guess', ch: id, role: r() < 0.6 ? sc.cast[id] : 'person' }); act({ t: 'guessDone' }); continue; }
    if (pv.step === 'pro') {
      for (const seat of [1, 2, 3]) for (let k = 0; k < 40; k++) {
        const cs = Object.keys(PRO_CARDS), ts = [...Object.keys(S.ch).filter(i => !S.ch[i].dead), ...LOCS.map(l => `loc:${l}`)];
        if (act({ t: 'pcard', seat, c: cs[Math.floor(r() * cs.length)], tgt: ts[Math.floor(r() * ts.length)] })) break;
      }
      act({ t: 'reveal' }); continue;
    }
    if (pv.step === 'gw') {
      for (let k = 0; k < 4; k++) {
        const ids = Object.keys(S.ch).filter(i => !S.ch[i].dead && CHARS[i].gw.length), id = ids[Math.floor(r() * ids.length)];
        if (!id) break;
        const others = Object.keys(S.ch).filter(i => i !== id && !S.ch[i].dead && S.ch[i].loc === S.ch[id].loc);
        act({ t: 'gw', ch: id, n: Math.floor(r() * CHARS[id].gw.length), tg: others[Math.floor(r() * others.length)] ?? id, pm: r() < 0.5 ? '+' : '-', k: 0 });
      }
      if (S.stage === 'play' && S.pv.step === 'gw') act({ t: 'gwDone' });
      continue;
    }
    break;
  }
  if (S.stage === 'over') ended++; else console.log('  unfinished', sc.id, g, S.stage, S.pv.step, S.loop, S.day);
  if (S.stage === 'over' && !publicView(S).pv.truth) leak ||= `${sc.id}: no truth at the end`;
}
eq(`${games} simulated games all finish`, ended, games);
eq('no public view of any of them carries hidden information', leak, null);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
