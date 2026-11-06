// What a reader opened stays open while the room updates: expanded sections and an open character sheet (with
// its scroll position) survive another phone's action. Usage: node tests/test_keep_open.mjs <base-url>
// Local `wrangler dev` only: plays one day of 人机模式, nothing is archived.
import { chromium } from 'playwright-core';
const [base] = process.argv.slice(2);
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const b = await chromium.launch({ channel: 'chrome' });
const phone = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const A = await (await b.newContext(phone)).newPage(), B = await (await b.newContext(phone)).newPage();
const settle = () => new Promise(r => setTimeout(r, 600));
await A.goto(base); await A.click('[data-act="createbot"]'); await A.waitForSelector('.bot-intro');
const code = new URL(A.url()).searchParams.get('r');
await A.click('[data-act="bpick"][data-set="fs"]'); await A.waitForSelector('[data-act="bstart"]');
await A.click('[data-act="bstart"]'); await A.waitForSelector('.seat');
await B.goto(`${base}?r=${code}`); await B.waitForSelector('.seat');

// B expands the set reference and collapses today's news, then A plays a card (the server sends a new state to both)
await B.click('details.ref > summary');
const news = await B.$('.news details[open] > summary'); if (news) await news.click();
const before = await B.$$eval('#app details', l => l.map(d => d.open));
await A.click('.seat >> nth=0'); await A.waitForSelector('.sheet');
await A.click('.sheet [data-act="bcsel"][data-c="g1"]'); await A.click('.sheet [data-act="btsel"]:not([disabled])'); await A.click('.sheet [data-act="bcok"]');
await settle();
eq('a new state arrived on the other phone', (await B.$$('.seat.set')).length, 1);
eq('sections keep the state the reader chose', await B.$$eval('#app details', l => l.map(d => d.open)), before);

// B opens a character sheet and scrolls inside it; A plays another card
await B.click('.vc >> nth=0'); await B.waitForSelector('.sheet .cardbig');
const sheet = await B.$('.sheet'); await sheet.evaluate(s => { s.scrollTop = 200; });
const top = await sheet.evaluate(s => s.scrollTop);
await A.click('.seat:not(.set) >> nth=0'); await A.waitForSelector('.sheet');
await A.click('.sheet [data-act="bcsel"][data-c="p1"]'); await A.click('.sheet [data-act="btsel"]:not([disabled])'); await A.click('.sheet [data-act="bcok"]');
await settle();
eq('second card arrived', (await B.$$('.seat.set')).length, 2);
eq('the open sheet is the same element', await sheet.evaluate(s => s.isConnected), true);
eq('and keeps its scroll position', await sheet.evaluate(s => s.scrollTop), top);

await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
