// Two phones play 「初学者剧本」 (FS-01) end to end. Usage: node tests/test_game.mjs <base-url> <shots-dir>
// Mastermind phone: library → new room → script → checklist → loop 1 (serial killer kills the key person)
// → loop 2 (suicide incident) → loop 3 survived → results → long image → history.
// Protagonist phone: joins by room code, sees only the public view all along.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base, out = './shots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const yes = (name, v) => eq(name, !!v, true);

const b = await chromium.launch({ channel: 'chrome' });
const phone = { viewport: { width: 375, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const mmCtx = await b.newContext(phone), proCtx = await b.newContext(phone);
const mm = await mmCtx.newPage(), pro = await proCtx.newPage();
for (const p of [mm, pro]) p.on('pageerror', e => { fails++; console.log('FAIL page error', e.message); });
const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png`, fullPage: false });
const settle = () => new Promise(r => setTimeout(r, 350));

// landing
await mm.goto(base);
await shot(mm, '01-landing');
yes('landing has create button', await mm.isVisible('text=我当剧作家：创建房间'));

// library behind a spoiler warning
await mm.click('text=剧本库');
await mm.waitForSelector('text=剧透警告');
yes('library asks before spoilers', await mm.isVisible('text=剧透警告'));
await mm.click('text=我是剧作家，继续');
eq('library lists 10 scripts', await mm.locator('.sc-item').count(), 10);
await mm.click('text=初学者剧本');
await mm.waitForSelector('text=非公开信息卡');
yes('script page shows routes', await mm.isVisible('text=路线建议'));
yes('script page shows the private sheet', await mm.isVisible('text=非公开信息卡'));
await shot(mm, '02-script');
await mm.click('text=用这个剧本开局');
await mm.waitForSelector('text=剧作家·私密');
await mm.waitForSelector('text=摆放清单');
const code = new URL(mm.url()).searchParams.get('r');
eq('room code in url', /^[A-Z0-9]{4}$/.test(code), true);
yes('script picked from library', await mm.isVisible('.sc-item[style*="red2"] >> text=初学者剧本'));
await mm.click('.step >> nth=0'); await settle();
yes('checklist item ticks', await mm.isChecked('.step input >> nth=0'));
yes('invite QR shown', await mm.locator('.qrbox img').first().getAttribute('src').then(s => s?.startsWith('data:image')));
await shot(mm, '03-setup');

// protagonist joins by code
await pro.goto(base);
await pro.fill('#joinCode', code.toLowerCase());
await pro.click('[data-act="join"]');
await pro.waitForSelector('text=公开视图');
await pro.waitForSelector('text=公开信息卡');
const proText = async () => pro.locator('#app').innerText();
let t = await proText();
eq('public view: no script name or roles during setup', ['初学者剧本', 'はじまり', '关键人物', '杀手', '主谋', '杀人狂', '传谣人', '谋杀计划', '开膛者'].filter(w => t.includes(w)), []);
yes('public view shows incident schedule', t.includes('自杀') && t.includes('第 3 天'));

// loop 1
await mm.click('text=开始第 1 轮回');
await mm.waitForSelector('.boardg');
await pro.waitForSelector('.boardg');
await shot(mm, '04-board');
await shot(pro, '05-public-board');
// move the key person (女学生) to the shrine, alone with the 巫女 (杀人狂)
await mm.click('.cc[data-id="girlStudent"]');
await mm.click('.sheet [data-act="move"][data-loc="shrine"]'); await settle();
await mm.click('.sheet [data-act="close"]');
for (let i = 0; i < 8; i++) await mm.click('[data-act="phnext"]').then(settle);
yes('turn end: serial killer must kill', await mm.isVisible('.ri.must >> text=杀人狂（巫女）'));
await shot(mm, '06-reminders');
await mm.click('.ri.must [data-act="kill"]');
await mm.waitForSelector('text=第 1 轮回结束');
yes('loop 1 lost because the key person died', await mm.isVisible('text=关键人物（女学生）死亡'));
yes('reset reminder shown', await mm.isVisible('text=下一轮回要重置'));
await pro.waitForSelector('text=第 1 轮回结束');
t = await proText();
eq('public view: loss reason not shown', ['关键人物', '杀人狂'].filter(w => t.includes(w)), []);
await shot(mm, '07-loop-end');

// loop 2: suicide on day 3
await mm.click('text=开始第 2 轮回');
await mm.waitForSelector('text=第2轮回');
for (const d of [1, 2]) { while (await mm.isVisible('[data-act="phnext"]')) await mm.click('[data-act="phnext"]').then(settle); await mm.click('[data-act="day"]'); await settle(); }
await mm.click('.cc[data-id="girlStudent"]');
for (let i = 0; i < 3; i++) { await mm.click('.sheet [data-act="add"][data-tok="p"][data-d="1"]'); await settle(); }
await mm.click('.sheet [data-act="close"]');
for (let i = 0; i < 6; i++) await mm.click('[data-act="phnext"]').then(settle);
yes('incident must happen', await mm.isVisible('.ri.must >> text=事件「自杀」'));
await mm.click('[data-act="incsheet"]');
await mm.click('[data-act="incok"]');
await mm.waitForSelector('text=第 2 轮回结束');
await pro.waitForFunction(() => document.body.innerText.includes('已发生'));
yes('public view marks the incident as happened', (await proText()).includes('已发生'));

// loop 3: nothing happens → Protagonists win
await mm.click('text=开始第 3 轮回');
await mm.waitForSelector('text=第3轮回');
for (const d of [1, 2]) { while (await mm.isVisible('[data-act="phnext"]')) await mm.click('[data-act="phnext"]').then(settle); await mm.click('[data-act="day"]'); await settle(); }
for (let i = 0; i < 6; i++) await mm.click('[data-act="phnext"]').then(settle);
yes('incident not met: recorded as not happening', await mm.isVisible('text=条件不满足，不发生'));
await mm.click('[data-act="incsheet"]'); await mm.click('[data-act="incok"]'); await settle();
while (await mm.isVisible('[data-act="phnext"]')) await mm.click('[data-act="phnext"]').then(settle);
await mm.click('[data-act="endloop"]');
await mm.waitForSelector('text=第 3 轮回结束');
await mm.click('text=主人公获胜：进入结算');
await mm.waitForSelector('#shot');
yes('results show the winner', await mm.isVisible('#shot >> text=主人公获胜'));
yes('results show the loop history', await mm.locator('.tl .lp').count() === 3);
await shot(mm, '08-results');
await pro.waitForSelector('text=游戏结束');
t = await proText();
eq('public view at the end: still no roles', ['关键人物', '杀手', '主谋', '杀人狂', '传谣人', '初学者剧本'].filter(w => t.includes(w)), []);

// long image
await mm.click('text=保存结算长图');
await mm.waitForSelector('.shotv img', { timeout: 20000 });
const w = await mm.$eval('.shotv img', i => i.naturalWidth);
yes('long image generated', w > 400);
await shot(mm, '09-long');
await mm.click('.shotv button');

// undo from the results, then finish again
await mm.click('text=撤销结算');
await mm.waitForSelector('text=第 3 轮回结束');
await mm.click('text=主人公获胜：进入结算');
await mm.waitForSelector('#shot');

// history
await mm.goto(new URL('/history', base).href);
await mm.waitForSelector('.fq');
yes('history lists the game', (await mm.locator('.fq').first().innerText()).includes('初学者剧本'));
await shot(mm, '10-history');

// rules page
await pro.goto(new URL('/guide', base).href);
yes('guide has FAQ', await pro.isVisible('text=常见问题'));
await shot(pro, '11-guide');

await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
