// Every goodwill ability, every script, many argument combinations: the engine never throws or hangs.
// Usage: node tests/fuzz_gw.mjs [games-per-script]
import { botInitial, botReduce, PRO_CARDS } from '../src/engine.js';
import { SCRIPTS, CHARS, LOCS, SETS, PLOTS } from '../public/data.js';
const games = +(process.argv[2] || 4);
let seed = 7; const r = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = l => l[Math.floor(r() * l.length)];
let tried = 0, ok = 0, bad = [];
for (const sc of SCRIPTS) for (let g = 0; g < games; g++) {
  let S = botInitial();
  const act = a => { const n = botReduce(S, a, r); if (n) S = n; return !!n; };
  act({ t: 'bpick', sid: sc.id }); act({ t: 'bstart', np: 3 });
  for (let steps = 0; S.stage !== 'over' && steps < 600; steps++) {
    if (S.stage === 'loopEnd') { act({ t: 'bnext' }); continue; }
    if (S.stage === 'final') { for (const id of S.pv.seen) act({ t: 'guess', ch: id, role: 'person' }); act({ t: 'guessDone' }); continue; }
    if (S.pv.step === 'pro') {
      for (const seat of [1, 2, 3]) for (let k = 0; k < 40; k++) if (act({ t: 'pcard', seat, c: pick(Object.keys(PRO_CARDS)), tgt: pick([...Object.keys(S.ch).filter(i => !S.ch[i].dead), ...LOCS.map(l => `loc:${l}`)]) })) break;
      act({ t: 'reveal' }); continue;
    }
    if (S.pv.step === 'gw') {
      // try each ability with plenty of goodwill, on a copy, with random arguments
      for (const id of Object.keys(S.ch)) for (let n = 0; n < CHARS[id].gw.length; n++) for (let k = 0; k < 25; k++) {
        const T = structuredClone(S); T.ch[id].g = 9;
        const ids = Object.keys(T.ch), tgts = [...ids, ...LOCS.map(l => `loc:${l}`)];
        const a = { t: 'gw', ch: id, n, tg: pick(tgts), pm: pick(['+', '-']), k: Math.floor(r() * T.sheet?.incidents?.length || 3), r: pick(SETS[sc.set].x.map(x => PLOTS[x].name)),
          from: pick(ids), to: pick(ids), tok: pick(['g', 'p', 'i']), c: pick(Object.keys(PRO_CARDS)),
          fx: { victim: pick(ids), to: pick(LOCS), p: pick(ids), i: pick(ids), from: pick(ids), target: pick(ids), tok: pick(['g', 'p', 'i']) } };
        a.k = Math.floor(r() * sc.incidents.length);
        tried++;
        const t0 = Date.now();
        try { if (botReduce(T, a, r)) ok++; } catch (e) { bad.push(`${sc.id} ${id}#${n}: ${e.stack.split('\n').slice(0, 3).join(' | ')} args ${JSON.stringify(a)}`); }
        if (Date.now() - t0 > 200) bad.push(`${sc.id} ${id}#${n}: slow ${Date.now() - t0} ms`);
      }
      act({ t: 'gwDone' }); continue;
    }
    break;
  }
}
console.log(`${tried} declarations tried, ${ok} accepted, ${bad.length} problems`);
for (const x of [...new Set(bad)].slice(0, 20)) console.log('  ', x);
process.exit(bad.length ? 1 : 0);
