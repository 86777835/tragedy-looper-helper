// 5-minute teach page: entry on the landing page, every term opens its note, the 「问」 buttons ask the rules
// assistant that exact question, 注意事项, the icon guide, phone width, and no script named anywhere.
// /api/chat is mocked, so this never asks a real model.
// Usage: node tests/test_teach.mjs <base-url> <shots-dir>   (safe against the live site too: it writes nothing)
import { chromium } from 'playwright-core';
import { SCRIPTS } from '../public/data.js';
const [base, out] = process.argv.slice(2);
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const b = await chromium.launch({ channel: 'chrome' });
const page = await (await b.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
const asked = [], bodies = [];
await page.route('**/api/chat', async r => {
  const body = JSON.parse(r.request().postData()); bodies.push(body);
  const q = body.messages.at(-1).content; asked.push(q);
  await r.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: `答：${q}` } }] })}\n\ndata: [DONE]\n\n` });
});

await page.goto(base); await page.waitForSelector('.teachgo');
eq('landing shows the teach entry', await page.textContent('.teachgo b'), '第一次玩？5 分钟讲规则');
await page.click('.teachgo'); await page.waitForSelector('.tpart');
eq('teach page opened', new URL(page.url()).pathname, '/teach');
eq('eight parts plus 注意事项', await page.$$eval('.tpart h2', l => l.map(h => h.querySelector('span').textContent.replace(/^\S+?(?=[一-龥])/, ''))),
  ['这是什么游戏', '桌上有什么', '剧本和信息卡', '一天怎么走', '行动牌', '事件、死亡和失败', '轮回和最终决战', '剧作家要记住的', '注意事项']);
const read = await page.$$eval('.tline', l => l.map(p => p.textContent).join(''));
const secs = await page.$$eval('.tpart h2 small', l => l.map(s => +(s.textContent.match(/约 (\d+) 秒/) || [0, 0])[1]).reduce((a, b) => a + b, 0));
console.log(`  script: ${read.length} characters to read aloud, parts add up to ${secs} s`);
eq('script about five minutes (1100–1900 characters, parts add up to 4–5.5 min)', read.length >= 1100 && read.length <= 1900 && secs >= 240 && secs <= 330, true);
// every important element is at least named, for both sides of the table
for (const w of ['剧作家', '主人公', '轮回', '公开信息卡', '非公开信息卡', '模组速查表', '规则Y', '规则X', '身份', '角色卡', '不安限度', '友好能力', '友好', '不安', '密谋',
  '事件', '队长卡', '行动牌', '移动', '禁止密谋', '每轮回限 1 次', '尸体', '关键人物', '时之缝隙', '最终决战', '强制', '任意能力', '无视友好'])
  if (!read.includes(w)) { fails++; console.log('FAIL script mentions', w); }
// general rules only: no script is named anywhere on the page
const all = await page.textContent('body');
eq('no script named on the page', SCRIPTS.flatMap(s => [s.zh, s.jp, s.en, s.no]).filter(n => n && all.includes(n)), []);
await page.screenshot({ path: out + '/teach_top.png' });

// every term in the script and every icon in the guide opens a note with a name, a picture and both texts
const ids = await page.$$eval('[data-t]', l => [...new Set(l.map(x => x.dataset.t))]);
const bad = [];
for (const id of ids) {
  await page.evaluate(id => document.querySelector(`[data-t="${id}"]`).click(), id);
  await page.evaluate(() => Promise.all([...document.querySelectorAll('.tshd img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))));
  const n = await page.$eval('.tsheet', s => ({ open: !s.classList.contains('hidden'), name: s.querySelector('.tshd b')?.textContent, icon: s.querySelector('.tshd img')?.naturalWidth > 0, ps: [...s.querySelectorAll('p')].map(p => p.textContent.length) }));
  if (!n.open || !n.name || !n.icon || n.ps.length !== 2 || n.ps.some(x => x < 8)) bad.push([id, n]);
  await page.click('.tsx');
}
console.log(`  ${ids.length} terms checked`);
eq('every term opens a note with its picture and text', bad, []);
eq('the note closes', await page.$eval('.tsheet', s => s.classList.contains('hidden')), true);
const term = page.locator('.tpart .term').nth(4);
await term.scrollIntoViewIfNeeded(); await term.click();
await page.screenshot({ path: out + '/teach_note.png' });

// asking from a note: closes the note, opens the assistant (rules mode: no script sent), sends the question
const nm = await page.textContent('.tshd b');
await page.click('.tsask'); await page.waitForSelector('.cm.a:not(:has(.cdots))');
eq('note → assistant asked about that term', [asked.at(-1), await page.isVisible('.cpanel'), await page.$eval('.tsheet', s => s.classList.contains('hidden'))],
  [`「${nm}」是什么，怎么用？`, true, true]);
eq('the teach page never sends a script', bodies.every(x => x.script === undefined), true);
await page.screenshot({ path: out + '/teach_ask.png' });
await page.click('.cx');

// a 「问」 button sends exactly its question and the answer shows
const q = await page.$eval('#p4 .tq', x => x.dataset.q);
await page.locator('#p4 .tq').first().click(); await page.waitForFunction(n => document.querySelectorAll('.cm.a').length > n && !document.querySelector('.cm.a:last-child .cdots'), 1);
eq('「问」 sends its question', [asked.at(-1), await page.$$eval('.cm.a', l => l.at(-1).textContent)], [q, `答：${q}`]);
await page.click('.cx');
eq('no button inside a button', await page.$$eval('button button', l => l.length), 0);

// 注意事项: every note has a title and a written answer, opens on tap, and its button asks about it
const notes = await page.$$eval('.tni', l => l.map(d => ({ t: d.querySelector('summary').textContent, a: d.querySelector('p').textContent.length, q: d.querySelector('.tq').dataset.q, open: d.open })));
console.log(`  ${notes.length} notes`);
eq('15–20 notes, each with an answer, all closed at first', [notes.length >= 15 && notes.length <= 20, notes.filter(n => n.a < 12 || !n.q || n.open)], [true, []]);
const n1 = page.locator('.tni').first();
await n1.locator('summary').click();
eq('a note opens on tap', await n1.evaluate(d => d.open && d.querySelector('p').offsetHeight > 0), true);
await page.screenshot({ path: out + '/teach_notes.png' });
await n1.locator('.tq').click(); await page.waitForFunction(() => !document.querySelector('.cm.a:last-child .cdots'));
eq('a note\'s button asks its question', asked.at(-1), notes[0].q);
await page.click('.cx');

// icon guide: every picture loads and has a name
await page.evaluate(() => Promise.all([...document.querySelectorAll('.tic img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))));
const tiles = await page.$$eval('.tic', l => l.map(t => [t.dataset.t, t.querySelector('img')?.naturalWidth > 0, t.textContent.trim().length > 0]));
eq('icon guide: every picture loads', tiles.filter(t => !t[1] || !t[2]), []);
console.log(`  icon guide: ${tiles.length} pictures`);
await page.locator('#icons').scrollIntoViewIfNeeded(); await page.screenshot({ path: out + '/teach_icons.png' });

eq('footer credits the image set', (await page.textContent('footer')).includes('惨劇コモンズ作成：BakaFire、紺ノ玲'), true);
eq('no sideways scrolling at 375 px', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
eq('「去建房间」 goes to the landing page', await page.getAttribute('.tgo', 'href'), '/');
eq('no page errors', errs, []);
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
