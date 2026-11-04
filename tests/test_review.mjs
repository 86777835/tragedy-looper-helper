// Rating card on the results screen, for the Mastermind and for a Protagonist's public view.
// Usage: node tests/test_review.mjs <base-url> <shots-dir>   (local `wrangler dev`; the hub endpoint is mocked, nothing is posted for real)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base, out = './shots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const api = p => new URL(p, base).href;
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`); };

// a finished game of 「初学者剧本」: the Mastermind wins all three loops
const { code, key } = await (await fetch(api('/api/room'), { method: 'POST' })).json();
const ws = new WebSocket(api(`/api/room/${code}/ws`).replace(/^http/, 'ws'));
let S = null; ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'state') S = m.state; };
await new Promise(r => ws.onopen = r);
const send = async o => { const v = S?.v ?? -1; ws.send(JSON.stringify(o)); for (let i = 0; i < 100 && !(S && S.v > v); i++) await wait(30); };
await wait(300);
ws.send(JSON.stringify({ auth: key })); await wait(300);
await send({ action: { t: 'pick', sid: 'fs01', opt: 0 } });
await send({ action: { t: 'start' } });
for (let l = 0; l < 3; l++) { await send({ action: { t: 'lose', why: '测试' } }); await send({ action: { t: 'next' } }); }
eq('game over', [S.stage, S.result], ['over', 'mm']);

const b = await chromium.launch({ channel: 'chrome' });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const errs = [], posted = [];
const mock = async page => {
  page.on('pageerror', e => errs.push(e.message));
  await page.route('https://boardgame.leisurecat.cloud/api/reviews', async r => {
    posted.push(JSON.parse(r.request().postData()));
    await r.fulfill({ json: { ok: true, avg: 4, count: posted.length, dist: [0, 0, 0, 1, 0] }, headers: { 'access-control-allow-origin': '*' } });
  });
};
const hidden = ['初学者剧本', 'はじまり', 'FS-01', '关键人物', '杀手', '主谋', '杀人狂', '传谣人', '谋杀计划', '开膛者'];

// Mastermind
const mm = await (await b.newContext(phone)).newPage();
await mock(mm);
await mm.goto(base);
await mm.evaluate(([c, k]) => localStorage.setItem('tl-mine', JSON.stringify([{ code: c, key: k, t: Date.now() }])), [code, key]);
await mm.goto(api(`/?r=${code}`)); await mm.waitForSelector('.rv');
eq('Mastermind: card outside the long-image area', await mm.$('#shot .rv'), null);
eq('Mastermind: "我是" is 剧作家, already chosen', await mm.$$eval('.rv-who button', l => l.map(x => [x.textContent, x.classList.contains('on')])), [['剧作家', true]]);
eq('send disabled until stars', await mm.isDisabled('[data-act="rv-send"]'), true);
await mm.click('[data-act="rv-star"][data-n="4"]');
eq('4 stars lit, label', [await mm.$$eval('.rv-st button.on', l => l.length), await mm.textContent('.rv-st span')], [4, '好玩']);
await mm.fill('[data-rv="text"]', '推理很烧脑');
await mm.click('[data-act="rv-star"][data-n="5"]');   // a re-render must keep the typed text
eq('text kept across re-render', await mm.inputValue('[data-rv="text"]'), '推理很烧脑');
const cardText = await mm.textContent('.rv');
eq('card text has no script name or roles', hidden.filter(w => cardText.includes(w)), []);
await mm.screenshot({ path: `${out}/review_mm.png`, fullPage: true });
await mm.click('[data-act="rv-send"]'); await mm.waitForSelector('.rv-done');
eq('posted to the hub', [posted.length, posted[0].game, posted[0].stars, posted[0].name, posted[0].text, posted[0].room], [1, 'tl', 5, '剧作家', '推理很烧脑', code]);
eq('request carries no hidden information', hidden.filter(w => JSON.stringify(posted[0]).includes(w)), []);
eq('request fields', Object.keys(posted[0]).sort(), ['game', 'name', 'room', 'stars', 'text']);
eq('thanks shown', (await mm.textContent('.rv p')).includes('谢谢 剧作家'), true);
eq('link to everyone\'s reviews', await mm.getAttribute('.rv a', 'href'), 'https://boardgame.leisurecat.cloud');
await mm.reload(); await mm.waitForSelector('.rv');
eq('sent state remembered after reload', !!(await mm.$('.rv-done')), true);
await mm.click('[data-act="rv-edit"]');
eq('edit restores the form', [await mm.$$eval('.rv-st button.on', l => l.length), await mm.inputValue('[data-rv="text"]')], [5, '推理很烧脑']);

// a Protagonist's public view
const pro = await (await b.newContext(phone)).newPage();
await mock(pro);
await pro.goto(api(`/?r=${code}`)); await pro.waitForSelector('.rv');
eq('public view: choose a Protagonist', await pro.$$eval('.rv-who button', l => l.map(x => x.textContent)), ['主人公 1', '主人公 2', '主人公 3']);
await pro.click('[data-act="rv-star"][data-n="3"]');
eq('public view: send disabled until "我是"', await pro.isDisabled('[data-act="rv-send"]'), true);
await pro.click('[data-act="rv-who"][data-who="主人公 2"]');
await pro.fill('[data-rv="name"]', '小明');
await pro.click('[data-act="rv-star"][data-n="3"]');
eq('name kept across re-render', await pro.inputValue('[data-rv="name"]'), '小明');
await pro.click('[data-act="rv-send"]'); await pro.waitForSelector('.rv-done');
eq('Protagonist posted with the typed name', [posted.at(-1).game, posted.at(-1).stars, posted.at(-1).name, posted.at(-1).room], ['tl', 3, '小明', code]);
const pubText = await pro.textContent('#app');
eq('public page has no script name or roles', hidden.filter(w => pubText.includes(w)), []);
await pro.screenshot({ path: `${out}/review_public.png`, fullPage: true });
// a Protagonist who doesn't type a name is posted as the chosen seat
await pro.click('[data-act="rv-edit"]'); await pro.fill('[data-rv="name"]', ''); await pro.click('[data-act="rv-send"]'); await pro.waitForSelector('.rv-done');
eq('no name typed → the seat', posted.at(-1).name, '主人公 2');

// hub refuses → the reason is shown
await pro.unroute('https://boardgame.leisurecat.cloud/api/reviews');
await pro.route('https://boardgame.leisurecat.cloud/api/reviews', r => r.fulfill({ status: 429, json: { error: '评价太频繁，请稍后再试' }, headers: { 'access-control-allow-origin': '*' } }));
await pro.click('[data-act="rv-edit"]'); await pro.click('[data-act="rv-send"]'); await pro.waitForSelector('.rv .err');
eq('hub error shown', await pro.textContent('.rv .err'), '评价太频繁，请稍后再试');

eq('no page errors', errs, []);
ws.close(); await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
