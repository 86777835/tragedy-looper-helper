// Script data checks and rule unit tests, no server needed. Usage: node tests/test_logic.mjs
import { SCRIPTS, SETS, PLOTS, ROLES, CHARS, INCIDENTS, LOCS } from '../public/data.js';
import { NOTES } from '../public/notes.js';
import { initialState, reduce, reminders, loopEndChecks, publicView, roleOf } from '../public/logic.js';
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

/* ---------- script data follows the tragedy sets' rules ---------- */
for (const sc of SCRIPTS) {
  const set = SETS[sc.set], n = sc.no;
  eq(`${n} rules belong to its set`, [set.y.includes(sc.y), sc.x.length === set.xCount, sc.x.every(x => set.x.includes(x))], [true, true, true]);
  // roles the rules add, capped by each role's limit; the 局外人 takes a role from a rule not chosen
  const want = {};
  for (const r of [sc.y, ...sc.x]) for (const [role, k] of Object.entries(PLOTS[r].roles)) want[role] = (want[role] || 0) + k;
  for (const role of Object.keys(want)) if (ROLES[role].cap) want[role] = Math.min(want[role], ROLES[role].cap);
  const got = {};
  for (const [c, role] of Object.entries(sc.cast)) if (role !== 'person' && c !== 'mysteryBoy') got[role] = (got[role] || 0) + 1;
  const optional = sc.x.includes('hideousScript') ? ['curmudgeon'] : [];   // 最黑暗的剧本: 0–2 暴徒
  const fixed = o => Object.fromEntries(Object.entries(o).filter(([r]) => !optional.includes(r)).sort());
  eq(`${n} roles match its rules`, fixed(got), fixed(want));
  if (optional.length) eq(`${n} curmudgeons 0–2`, (got.curmudgeon || 0) <= 2, true);
  if (sc.cast.mysteryBoy) {
    const r = sc.cast.mysteryBoy, chosen = [sc.y, ...sc.x].some(p => PLOTS[p].roles[r]);
    const inSet = [...set.y, ...set.x].some(p => PLOTS[p].roles[r]);
    eq(`${n} 局外人 has a role from an unchosen rule of the set`, [chosen, inSet], [false, true]);
  }
  if (sc.y === 'signWithMe') eq(`${n} key person is a girl`, Object.keys(sc.cast).filter(c => sc.cast[c] === 'keyPerson').every(c => CHARS[c].tags.includes('少女')), true);
  eq(`${n} characters and incidents exist`, [Object.keys(sc.cast).every(c => CHARS[c]), sc.incidents.every(([d, k, c]) => set.incidents.includes(k) && sc.cast[c] && d >= 1 && d <= sc.days)], [true, true]);
  eq(`${n} each culprit only once, one incident a day`, [new Set(sc.incidents.map(i => i[2])).size, new Set(sc.incidents.map(i => i[0])).size], [sc.incidents.length, sc.incidents.length]);
  eq(`${n} has notes`, !!(NOTES[sc.id]?.core && NOTES[sc.id].routes.length && NOTES[sc.id].hide.length && NOTES[sc.id].watch.length), true);
}

/* ---------- rules ---------- */
const play = (sid, place) => { let s = reduce(initialState(), { t: 'pick', sid, opt: 0 }); return reduce(s, { t: 'start', place }); };
const go = (s, a) => { const n = reduce(s, a); if (!n) throw new Error('rejected ' + JSON.stringify(a)); return n; };

// key person dies → loop ends at once; friends' roles are revealed at loop end
let s = play('btx07');
s = go(s, { t: 'ch', id: 'patient', dead: true });
s = go(s, { t: 'ch', id: 'shrineMaiden', dead: true });
eq('key person death ends the loop', [s.stage, s.end.why], ['loopEnd', ['关键人物（巫女）死亡']]);
eq('dead friend revealed', s.rev.role, { patient: true });
s = go(s, { t: 'next' });
eq('revealed friend +1 goodwill next loop', s.ch.patient.g, 1);
eq('public view shows the revealed role only', publicView(s).rev.role, { patient: '亲友' });

// lovers: one dies → the other +6 paranoia; both at once → nothing
s = play('btx07');
s = go(s, { t: 'ch', id: 'girlStudent', dead: true });
eq('loved one dies → lover +6', s.ch.boyStudent.p, 6);
s = play('btx07');
s = go(s, { t: 'ch', id: 'boyStudent', loc: 'hospital' }); s = go(s, { t: 'ch', id: 'girlStudent', loc: 'hospital' });
s = go(s, { t: 'bd', loc: 'hospital', n: 1 });
for (let d = 1; d < 5; d++) s = go(s, { t: 'day', from: d });
s = go(s, { t: 'ch', id: 'boyStudent', p: 2 });
s = go(s, { t: 'inc', k: 2, r: 'yes' });   // day 5 hospital incident
eq('hospital incident kills everyone there', ['boyStudent', 'girlStudent', 'patient', 'doctor'].map(i => s.ch[i].dead), [true, true, true, true]);
eq('lovers dying together: no +6', [s.ch.boyStudent.p, s.ch.girlStudent.p], [2, 0]);

// time traveler can't die; guard token stops a death
s = play('btx03');
eq('time traveler can\'t be marked dead', reduce(s, { t: 'ch', id: 'patient', dead: true }), null);
s = go(s, { t: 'ch', id: 'girlStudent', gd: 1 }); s = go(s, { t: 'ch', id: 'girlStudent', dead: true });
eq('guard token used instead of dying', [s.ch.girlStudent.dead, s.ch.girlStudent.gd], [false, 0]);

// incidents: must meet the limit; butterfly effect → change of future loss
s = play('btx03');
s = go(s, { t: 'day', from: 1 });
eq('incident below the limit can\'t happen', reduce(s, { t: 'inc', k: 0, r: 'yes', fx: { target: 'classRep', tok: 'g' } }), null);
s = go(s, { t: 'ch', id: 'classRep', p: 2 });
s = go(s, { t: 'inc', k: 0, r: 'yes', fx: { target: 'girlStudent', tok: 'g' } });
eq('butterfly effect counted', loopEndChecks(s).find(c => c.why.startsWith('改变未来')).met, true);

// missing person can't go into a forbidden area
s = play('btx02');
for (let d = 1; d < 4; d++) s = go(s, { t: 'day', from: d });
s = go(s, { t: 'ch', id: 'officeWorker', p: 2 });
eq('missing person: forbidden area refused', reduce(s, { t: 'inc', k: 1, r: 'yes', fx: { to: 'school' } }), null);
s = go(s, { t: 'inc', k: 1, r: 'yes', fx: { to: 'hospital' } });
eq('missing person: moved and +1 intrigue', [s.ch.officeWorker.loc, s.bd.hospital], ['hospital', 1]);

// black cat: shrine +1 at loop start; its incident happens without effect. A.I.: all tokens count
s = play('btx06');
eq('black cat puts intrigue on the shrine', s.bd.shrine, 1);
s = go(s, { t: 'inc', k: 0, r: 'yes' });
eq('black cat suicide: no effect', s.ch.blackCat.dead, false);
s = go(s, { t: 'day', from: 1 });
s = go(s, { t: 'ch', id: 'ai', g: 1, i: 2, p: 1 });
s = go(s, { t: 'inc', k: 1, r: 'yes' });
eq('A.I.: every token counts → foul evil', s.bd.shrine, 3);
eq('special rule removes the diagonal card from the reminders', JSON.stringify(reminders(s).mmCards).includes('移动斜向'), true);
eq('…and no once-per-loop toggle for it', (reminders(s).mmCards || []).some(r => r.act?.k === 'mmDiag'), false);

// paranoia virus: person with 3 paranoia is a serial killer; two serial killers alone both must die
s = play('btx05', { henchman: 'school' });
s = go(s, { t: 'ch', id: 'officeWorker', p: 3, loc: 'shrine' });   // alone with the 巫女
eq('virus: person becomes serial killer', roleOf(s, 'officeWorker'), 'serialKiller');
s = go(s, { t: 'ph', to: 8 });
eq('serial killer alone with one other: must', reminders(s).dayEnd.filter(r => r.level === 'must').length >= 1, true);

// threads of fate: goodwill at loop end → +2 paranoia next loop
s = play('btx05', { henchman: 'city' });
s = go(s, { t: 'ch', id: 'doctor', g: 1 });
s = go(s, { t: 'lose', why: '测试' });
s = go(s, { t: 'next', place: { henchman: 'shrine' } });
eq('threads of fate', [s.ch.doctor.p, s.ch.henchman.loc], [2, 'shrine']);

// soldier: protagonists can't die this loop
s = play('btx05', { henchman: 'city' });
s = go(s, { t: 'flag', k: 'soldier', on: true });
s = go(s, { t: 'lose', why: '杀手', death: true });
eq('soldier stops protagonist death', s.stage, 'play');

// godly being enters on loop 4; the time bomb still uses its initial area before that
s = play('btx08');
eq('godly being not on board in loop 1', 'godlyBeing' in s.ch, false);
s = go(s, { t: 'bd', loc: 'shrine', n: 2 });
eq('time bomb counts the shrine before the witch enters', loopEndChecks(s).find(c => c.why.startsWith('巨大')).met, true);

// transfer student enters on day 5
s = play('btx04', { henchman: 'hospital' });
for (let d = 1; d < 5; d++) s = go(s, { t: 'day', from: d });
eq('transfer student enters on day 5', s.ch.transferStudent?.loc, 'school');

// final guess only in Basic Tragedy X; First Steps ends with the Mastermind's win
s = play('fs01');
for (let l = 1; l <= 3; l++) { s = go(s, { t: 'lose', why: 'x' }); s = go(s, { t: 'next' }); }
eq('First Steps: no final guess', [s.stage, s.result], ['over', 'mm']);
s = play('btx02');
for (let l = 1; l <= 4; l++) { s = go(s, { t: 'lose', why: 'x' }); s = go(s, { t: 'next' }); }
eq('Basic Tragedy X: final guess', s.stage, 'final');
s = go(s, { t: 'final', ok: true });
eq('final guess right → Protagonists win', s.result, 'pro');

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
