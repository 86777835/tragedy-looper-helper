// The public view never carries hidden information. Usage: node tests/test_leak.mjs <base-url>
// For each of the 10 scripts: a Mastermind socket plays a randomized game (moves, tokens, deaths, incidents,
// loop ends, final guess) while a viewer socket records every frame it receives. Every frame must:
//  - have only whitelisted fields,
//  - contain no role, rule, script title, culprit or Mastermind note, except what the Mastermind revealed.
// Also: viewers can't act, a wrong key doesn't make you the Mastermind, finished games need the key.
import { SCRIPTS, ROLES, PLOTS, CHARS, LOCS } from '../public/data.js';
import { reminders, PHASES } from '../public/logic.js';

const base = process.argv[2] || 'http://localhost:8812/';
const wsUrl = c => new URL(`/api/room/${c}/ws`, base).href.replace(/^http/, 'ws');
let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : extra); };
const wait = ms => new Promise(r => setTimeout(r, ms));

function open(code) {
  const ws = new WebSocket(wsUrl(code)), frames = [], inbox = [];
  let last = null, waiter = null;
  ws.onmessage = e => {
    if (e.data === 'pong') return;
    frames.push(e.data); const m = JSON.parse(e.data); if (m.type === 'state') last = m;
    if (waiter) { const w = waiter; waiter = null; w(m); } else inbox.push(m);
  };
  const ready = new Promise(r => ws.onopen = r);
  // the next message not yet consumed (messages that arrive before anyone waits are queued)
  const next = () => inbox.length ? Promise.resolve(inbox.shift()) : new Promise((r, no) => { waiter = r; setTimeout(() => no(new Error('no reply in 10 s')), 10000); });
  return { ws, frames, ready, next, get last() { return last; } };
}

const PUBLIC_KEYS = ['v', 'stage', 'loop', 'day', 'ph', 'sheet', 'ch', 'bd', 'happened', 'rev', 'loops', 'result'];
const roleNames = Object.values(ROLES).map(r => r.name).filter(n => n !== '平民');
const plotNames = Object.values(PLOTS).map(p => p.name);
const NOTE = '剧作家秘密笔记XYZ';

async function playScript(sc, rnd) {
  const { code, key } = await (await fetch(new URL('/api/room', base), { method: 'POST' })).json();
  const mm = open(code), view = open(code), intruder = open(code);
  await Promise.all([mm.ready, view.ready, intruder.ready]);
  await mm.next(); await intruder.next();   // initial public state
  mm.ws.send(JSON.stringify({ auth: key }));
  await mm.next();
  ok(`${sc.no} Mastermind socket gets private state`, mm.last.role === 'mm' && mm.last.state.stage === 'setup');
  // an intruder with a wrong key stays a viewer and can't act
  intruder.ws.send(JSON.stringify({ auth: key.replace(/./, c => c === 'a' ? 'b' : 'a') }));
  const bad = await intruder.next();
  ok(`${sc.no} wrong key refused`, bad.type === 'error' && bad.error === 'badkey');
  intruder.ws.send(JSON.stringify({ action: { t: 'pick', sid: sc.id, opt: 0 } }));
  const vo = await intruder.next();
  ok(`${sc.no} viewer can't act`, vo.type === 'error' && vo.error === 'viewonly');

  const act = async a => { mm.ws.send(JSON.stringify({ action: a })); await mm.next(); return mm.last.state; };
  let S = await act({ t: 'pick', sid: sc.id, opt: sc.opts.length - 1 });
  const place = () => Object.fromEntries(Object.keys(sc.cast).filter(id => CHARS[id].start === null).map(id => [id, LOCS[Math.floor(rnd() * 4)]]));
  S = await act({ t: 'start', place: place() });
  let revealed = new Set(), steps = 0;
  while (S.stage !== 'over' && steps++ < 600) {
    if (S.stage === 'loopEnd') { S = await act({ t: 'next', place: place() }); continue; }
    if (S.stage === 'final') { S = await act({ t: 'final', ok: rnd() < 0.5 }); continue; }
    const ids = Object.keys(S.ch), id = ids[Math.floor(rnd() * ids.length)], r = rnd();
    if (r < 0.25) await act({ t: 'ch', id, add: { [['g', 'p', 'i'][Math.floor(rnd() * 3)]]: 1 + Math.floor(rnd() * 2) } });
    else if (r < 0.35) await act({ t: 'ch', id, loc: LOCS[Math.floor(rnd() * 4)] });
    else if (r < 0.40) await act({ t: 'bd', loc: LOCS[Math.floor(rnd() * 4)], add: 1 });
    else if (r < 0.43) await act({ t: 'ch', id, dead: true, why: '测试' });
    else if (r < 0.45) await act({ t: 'note', x: NOTE });
    else if (r < 0.47 && !revealed.size) { revealed.add(id); await act({ t: 'rev', kind: 'role', key: id, on: true }); }
    else if (r < 0.49) await act({ t: 'once', k: 'mmI2', on: true });
    else {
      // follow the phases; record today's incidents with whatever the reminders say
      const rem = reminders(S);
      for (const it of rem.incident || []) if (it.act?.t === 'inc' && S.ph === 6) {
        const k = it.act.k, kind = sc.incidents[k][1], cul = sc.incidents[k][2];
        const live = Object.keys(S.ch).filter(i => !S.ch[i].dead);
        const fx = { victim: undefined, p: live[0], i: live[1], to: LOCS.find(l => !(CHARS[cul].forbid || []).includes(l)), from: live[0], target: live.find(i => S.ch[i].loc === S.ch[cul]?.loc), tok: 'i' };
        if (kind === 'murder') fx.victim = live.find(i => i !== cul && S.ch[i].loc === S.ch[cul]?.loc);
        if (kind === 'farawayMurder') fx.victim = live.find(i => S.ch[i].i >= 2);
        if (kind === 'spreading') fx.to = live[1];
        mm.ws.send(JSON.stringify({ action: { t: 'inc', k, r: it.act.meet ? 'yes' : 'no', fx } })); await mm.next(); S = mm.last.state;
      }
      if (S.stage !== 'play') continue;
      if (S.ph < PHASES.length - 1) S = await act({ t: 'ph', to: S.ph + 1 });
      else if (S.day < sc.days) S = await act({ t: 'day', from: S.day });
      else S = await act({ t: 'endLoop' });
    }
    S = mm.last.state;
  }
  ok(`${sc.no} game reached the end`, S.stage === 'over', `stage ${S.stage}`);
  await wait(300);

  // every frame the viewer got
  const states = view.frames.map(f => JSON.parse(f)).filter(m => m.type === 'state');
  ok(`${sc.no} viewer received frames`, states.length > 20, `${states.length}`);
  const titles = [sc.zh, sc.jp, sc.en, sc.id, sc.no];
  let leak = null;
  for (const m of states) {
    if (m.role !== 'view') { leak = `role ${m.role}`; break; }
    const extra = Object.keys(m.state).filter(k => !PUBLIC_KEYS.includes(k));
    if (extra.length) { leak = `fields ${extra}`; break; }
    const txt = JSON.stringify(m.state);
    const revNames = Object.values(m.state.rev?.role || {});
    const hit = [...titles, ...plotNames, NOTE, '测试'].find(s => txt.includes(s))
      || roleNames.find(n => txt.includes(n) && !revNames.includes(n));
    if (hit) { leak = `"${hit}" in ${txt.slice(0, 200)}`; break; }
    for (const c of Object.values(m.state.ch || {})) if (Object.keys(c).some(k => !['loc', 'g', 'p', 'i', 'gd', 'dead'].includes(k))) { leak = 'character fields'; break; }
    // only characters that are on the board right now
    for (const id of Object.keys(m.state.ch || {})) if (!sc.cast[id]) { leak = `unknown character ${id}`; break; }
  }
  ok(`${sc.no} public frames carry no hidden information`, !leak, leak);
  // the revealed role shows up, and only that one
  const lastState = states.at(-1).state;
  ok(`${sc.no} revealed roles appear in the public view`, [...revealed].every(id => lastState.rev.role[id] === ROLES[sc.cast[id]].name) || ![...revealed].length);

  // finished games: need the key
  const g1 = await fetch(new URL(`/api/room/${code}/games`, base), { method: 'POST', body: JSON.stringify({ key: 'x' }) });
  ok(`${sc.no} archive refuses without the key`, g1.status === 403);
  const g2 = await (await fetch(new URL(`/api/room/${code}/games`, base), { method: 'POST', body: JSON.stringify({ key }) })).json();
  ok(`${sc.no} archive keeps the game`, g2.length === 1 && g2[0].sid === sc.id && g2[0].loops.length === S.loops.length);
  [mm, view, intruder].forEach(c => c.ws.close());
}

// seeded random so a failure can be replayed
function rng(seed) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }
for (const [i, sc] of SCRIPTS.entries()) await playScript(sc, rng(1000 + i));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
