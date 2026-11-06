// A goodwill declaration the server refuses doesn't leave the page hanging: the sheet comes back with the
// choices kept and the reason. Usage: node tests/test_gw_reject.mjs <base-url>
// Local `wrangler dev` only (plays one day of 人机模式, nothing is archived).
import { chromium } from 'playwright-core';
const [base] = process.argv.slice(2);
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

// 1. the server says why
const r = await fetch(new URL('/api/room', base), { method: 'POST', body: JSON.stringify({ bot: true }) }), { code } = await r.json();
const ws = new WebSocket(new URL(`/api/room/${code}/ws`, base).href.replace(/^http/, 'ws'));
const box = []; ws.onmessage = e => { if (e.data !== 'pong') box.push(JSON.parse(e.data)); };
await new Promise(ok => ws.onopen = ok);
const wait = ms => new Promise(ok => setTimeout(ok, ms));
const send = async a => { ws.send(JSON.stringify({ action: a })); await wait(300); };
await send({ t: 'bpick', sid: 'fs01' }); await send({ t: 'bstart', np: 3 });
for (const seat of [1, 2, 3]) await send({ t: 'pcard', seat, tgt: ['loc:hospital', 'loc:shrine', 'loc:city'][seat - 1], c: 'p1' });
await send({ t: 'reveal' });
const S = box.findLast(m => m.type === 'state').state;
eq('goodwill step reached', S.pv.step, 'gw');
box.length = 0;
await send({ t: 'gw', ch: 'boyStudent', n: 0 });
const err = box.find(m => m.type === 'error');
eq('refusal carries the reason', err && { t: err.t, why: err.why }, { t: 'gw', why: '友好不够（需要 2）' });
box.length = 0;
ws.send(JSON.stringify({ auth: 'x' })); await wait(300);
eq('a message without an action gets no error', box.filter(m => m.type === 'error').length, 0);
ws.close();

// 2. the page reopens the sheet and shows it
const b = await chromium.launch({ channel: 'chrome' });
const A = await (await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
const errs = []; A.on('pageerror', e => errs.push(e.message));
await A.goto(base); await A.click('[data-act="createbot"]'); await A.waitForSelector('.bot-intro');
await A.click('.bot-intro ~ details summary'); await A.click('[data-act="bpick"][data-sid="fs01"]'); await A.waitForSelector('[data-act="bstart"]');   // FS-01: the students' abilities open at 2 goodwill
await A.click('[data-act="bstart"]'); await A.waitForSelector('.seat');
// 友好+2 on three characters, so some abilities open up
for (let k = 0; k < 3; k++) {
  await A.click('.seat:not(.set) >> nth=0'); await A.waitForSelector('.sheet');
  await A.click('.sheet [data-act="bcsel"][data-c="g2"]');
  const ts = await A.$$('.sheet [data-act="btsel"]:not([disabled])');
  for (const t of ts) if (!(await t.getAttribute('data-t')).startsWith('loc:')) { await t.click(); break; }
  await A.click('.sheet [data-act="bcok"]'); await A.waitForTimeout(300);
}
await A.click('[data-act="breveal"]'); await A.waitForSelector('[data-act="bgwdone"]');
let tested = false;
for (const btn of await A.$$('.gwb:not([disabled])')) {
  await btn.click(); await A.waitForSelector('.sheet');
  if (!(await A.$('.sheet .lbl'))) { await A.click('.sheet [data-act="close"]'); continue; }   // an ability without choices: skip
  const title = await A.textContent('.sheet h3');
  await A.click('.sheet [data-act="bgwok"]');   // declared without choosing anything
  await A.waitForSelector('.sheet .err', { timeout: 5000 }).catch(() => {});
  eq(`${title}: the sheet comes back`, (await A.$('.sheet h3')) ? await A.textContent('.sheet h3') : null, title);
  const msg = await A.$('.sheet .err');
  eq('with the reason', msg ? (await msg.textContent()).startsWith('没有生效：') : false, true);
  if (msg) console.log('     ', await msg.textContent());
  tested = true; break;
}
eq('an ability with choices was tried', tested, true);
eq('no page errors', errs, []);
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
