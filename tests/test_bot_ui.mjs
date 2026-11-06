// 人机模式 in the browser: two phones play a whole game against the robot through the page, while a third connection
// records every frame the server sends. Usage: node tests/test_bot_ui.mjs <base-url> <shots-dir> [fs|btx]
// Local `wrangler dev` only (a finished game is archived in the room). The review endpoint is mocked.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { SCRIPTS, ROLES, PLOTS } from '../public/data.js';
const [base, out = './shots', set = 'fs'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const yes = (n, v) => eq(n, !!v, true);

const b = await chromium.launch({ channel: 'chrome' });
const phone = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const A = await (await b.newContext(phone)).newPage(), B = await (await b.newContext(phone)).newPage();
const errs = [];
for (const p of [A, B]) {
  p.on('pageerror', e => errs.push(e.message));
  await p.route('https://boardgame.leisurecat.cloud/api/reviews', r => r.fulfill({ json: { ok: true, avg: 4, count: 1 }, headers: { 'access-control-allow-origin': '*' } }));
}
const settle = () => new Promise(r => setTimeout(r, 250));

await A.goto(base);
await A.click('[data-act="createbot"]'); await A.waitForSelector('.bot-intro');
const code = new URL(A.url()).searchParams.get('r');
await A.screenshot({ path: `${out}/bot-1-intro.png` });

// eavesdropper: a plain connection to the room, recording everything
const frames = [];
const ws = new WebSocket(new URL(`/api/room/${code}/ws`, base).href.replace(/^http/, 'ws'));
ws.onmessage = e => { if (e.data !== 'pong') frames.push(e.data); };
await new Promise(r => ws.onopen = r);
ws.send(JSON.stringify({ auth: '0'.repeat(32) }));   // no key exists in a robot room

await A.click(`[data-act="bpick"][data-set="${set}"]`); await A.waitForSelector('[data-act="bstart"]');
yes('random script: name kept secret', (await A.textContent('.pick-hero')).includes('剧本已经抽好'));
await A.click('[data-act="bnp"][data-n="2"]');
yes('2 Protagonists: hand explanation', (await A.textContent('.note')).includes('队长出 1 张，另一人出 2 张'));
await A.click('[data-act="bstart"]'); await A.waitForSelector('.seat');
await B.goto(base); await B.fill('#joinCode', code); await B.click('[data-act="join"]'); await B.waitForSelector('.seat');
yes('second phone joins the same game', (await B.textContent('.bot-tag')).includes('人机模式'));
await A.screenshot({ path: `${out}/bot-2-cards.png` });

let days = 0, gwTried = false;
for (let guard = 0; guard < 400; guard++) {
  if (await A.$('.seat')) {
    for (let k = 0; k < 3; k++) {
      const seat = await A.$('.seat:not(.set)'); if (!seat) break;
      await seat.click(); await A.waitForSelector('.sheet');
      await A.click('.sheet [data-act="bcsel"]:not([disabled]) >> nth=3');   // 友好+1
      await A.click('.sheet [data-act="btsel"]:not([disabled])');
      await A.click('.sheet [data-act="bcok"]'); await settle();
    }
    await A.click('[data-act="breveal"]'); await A.waitForSelector('[data-act="bgwdone"], [data-act="bnext"]'); days++;
    if (days === 1) await A.screenshot({ path: `${out}/bot-3-revealed.png`, fullPage: true });
    continue;
  }
  if (await A.$('[data-act="bgwdone"]')) {
    const gw = await A.$('.gwb:not([disabled])');
    if (gw && !gwTried) {   // try one goodwill ability through its sheet
      gwTried = true; await gw.click(); await A.waitForSelector('.sheet');
      const opt = await A.$('.sheet [data-act="ba"]'); if (opt) await opt.click();
      await A.screenshot({ path: `${out}/bot-4-goodwill.png` });
      await A.click('.sheet [data-act="bgwok"]'); await settle();
    }
    await A.click('[data-act="bgwdone"]'); await A.waitForSelector('[data-act="bcsel"], .seat, [data-act="bnext"], [data-act="bgwdone"]').catch(() => {}); await settle();
    continue;
  }
  if (await A.$('[data-act="bnext"]')) { await A.click('[data-act="bnext"]'); await settle(); continue; }
  if (await A.$('[data-bguess]')) {
    for (const s of await A.$$('[data-bguess]')) { await s.selectOption({ index: 1 }); await settle(); }
    await A.screenshot({ path: `${out}/bot-5-final.png` });
    await A.click('[data-act="bguessdone"]'); await settle(); continue;
  }
  if (await A.$('.rv')) break;
  await settle();
}
await A.waitForSelector('.rv');
yes('game over: truth shown', (await A.textContent('#app')).includes('剧本真相'));
yes('second phone sees the same ending', (await B.textContent('#app')).includes('剧本真相'));
yes('review card for a Protagonist', await A.isVisible('.rv-who >> text=主人公 1'));
await A.screenshot({ path: `${out}/bot-6-over.png`, fullPage: true });

// every frame before the end: public only, no script, roles, rules or robot cards before their reveal
const states = frames.map(f => JSON.parse(f));
eq('the wrong key is refused like any other action', states.filter(m => m.type === 'error').length, 0);
const before = states.filter(m => m.type === 'state' && m.state.stage !== 'over');
const words = [...SCRIPTS.flatMap(s => [s.zh, s.jp, s.en, s.no]), ...Object.values(PLOTS).map(p => p.name), ...Object.values(ROLES).map(r => r.name).filter(n => n !== '平民')];
let leak = null;
for (const m of before) {
  if (m.role !== 'view') { leak = `role ${m.role}`; break; }
  const s = m.state, txt = JSON.stringify(s), ok = [...Object.values(s.rev?.role || {}), ...(s.rev?.x || [])];
  const hit = words.find(w => txt.includes(w) && !ok.includes(w) && !(s.sheet?.special || []).some(x => x.includes(w)));
  if (hit) { leak = `"${hit}"`; break; }
  if (s.pv?.step === 'pro' && s.pv.revealed) { leak = 'robot cards before reveal'; break; }
  if ('bot' in s || 'sid' in s || 'starts' in s || 'log' in s) { leak = 'hidden field'; break; }
}
eq(`${before.length} frames before the end carry no hidden information`, leak, null);
yes('frames arrived', before.length > 10);
eq('no page errors', errs, []);
ws.close(); await b.close();
console.log(`days played: ${days}`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
