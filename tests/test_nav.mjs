// Local only: navigation must preserve rooms and fit a 390px phone.
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
const [base = 'http://localhost:8894/', out = '/tmp/claude-501/codex_tasks/shots'] = process.argv.slice(2);
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Run only against localhost');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await context.route('https://boardgame.leisurecat.cloud/**', route => route.fulfill({ json: {} }));
const page = await context.newPage();
page.on('pageerror', e => errors.push(e.message));
async function nav(p, label) {
  const button = p.locator('.nav-back:not(.rate-nav)');
  await button.waitFor({ state: 'visible' });
  assert.equal(await button.innerText(), label);
  await p.evaluate(() => window.scrollTo(0, 0));
  const problems = await button.evaluate(el => {
    const r = el.getBoundingClientRect(), issues = [];
    if (r.height < 36 || r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) issues.push('bounds');
    if (document.documentElement.scrollWidth > innerWidth) issues.push('horizontal overflow');
    for (const other of document.querySelectorAll('a,button,input,select,textarea,summary,.ttl,.who-tag,.conn,h1,.ht')) {
      if (other === el || other.contains(el)) continue;
      const b = other.getBoundingClientRect();
      if (b.width && b.height && getComputedStyle(other).visibility !== 'hidden' && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) issues.push(other.outerHTML.slice(0, 100));
    }
    return issues;
  });
  assert.deepEqual(problems, []);
  console.log('PASS navigation/layout:', label, new URL(p.url()).pathname);
}
async function homeAndRejoin(code) {
  await nav(page, '‹ 首页');
  await page.locator('.nav-back:not(.rate-nav)').click();
  await nav(page, '‹ 全部游戏');
  await page.locator(`[data-act="rejoin"][data-code="${code}"]`).click();
  await page.waitForSelector('.who-tag.mm');
}
try {
  await page.goto(base);
  await nav(page, '‹ 全部游戏');
  assert.equal(await page.locator('.nav-back:not(.rate-nav)').getAttribute('href'), 'https://boardgame.leisurecat.cloud');
  await page.screenshot({ path: `${out}/nav_tl_landing.png` });
  await page.click('[data-act="create"]');
  await page.waitForSelector('.who-tag.mm');
  const code = new URL(page.url()).searchParams.get('r');
  await homeAndRejoin(code);
  await page.click('.sc-item >> text=初学者剧本');
  await page.waitForSelector('.step input');
  await page.locator('.step').first().click();
  await page.waitForFunction(() => document.querySelector('.step input').checked);
  await homeAndRejoin(code);
  assert(await page.locator('.step input').first().isChecked(), 'setup survives leaving');
  await page.click('[data-act="start"]');
  await page.waitForSelector('.boardg');
  await page.click('[data-act="phnext"]');
  await page.waitForFunction(() => document.querySelector('.phases .on')?.textContent.includes('剧作家行动'));
  await homeAndRejoin(code);
  assert((await page.locator('.phases .on').innerText()).includes('剧作家行动'), 'phase survives leaving');
  await nav(page, '‹ 首页');
  await page.screenshot({ path: `${out}/nav_tl_room.png` });
  for (const tab of ['ref', 'game']) {
    await page.click(`[data-act="tab"][data-tab="${tab}"]`);
    await nav(page, '‹ 首页');
  }
  const pro = await context.newPage();
  await pro.goto(new URL(`/?r=${code}&v=1`, base).href);
  await pro.waitForSelector('.who-tag.view');
  await nav(pro, '‹ 首页');
  await pro.locator('.nav-back:not(.rate-nav)').click();
  await pro.fill('#joinCode', code);
  // A separate context tests a protagonist without the saved Mastermind key.
  const viewerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await viewerContext.route('https://boardgame.leisurecat.cloud/**', route => route.fulfill({ json: {} }));
  const viewer = await viewerContext.newPage();
  await viewer.goto(base);
  await viewer.fill('#joinCode', code);
  await viewer.click('[data-act="join"]');
  await viewer.waitForSelector('.who-tag.view');
  await nav(viewer, '‹ 首页');
  await viewer.locator('.nav-back:not(.rate-nav)').click();
  await viewer.fill('#joinCode', code);
  await viewer.click('[data-act="join"]');
  await viewer.waitForSelector('.vboard');
  for (let loop = 1; loop <= 3; loop++) {
    await page.click('[data-act="lose"]');
    await page.fill('#loseWhy', '导航本地测试');
    await page.click('[data-act="loseok"]');
    await page.waitForSelector('[data-act="next"]');
    await nav(page, '‹ 首页');
    await page.click('[data-act="next"]');
    await page.waitForSelector(loop < 3 ? '.boardg' : '#shot');
  }
  assert.equal(await page.locator('#shot .nav-back').count(), 0);
  await homeAndRejoin(code);
  await page.waitForSelector('#shot');
  await nav(viewer, '‹ 首页');
  console.log('PASS setup, game, results and public room preserved');
  for (const file of readdirSync(new URL('../public/', import.meta.url)).filter(f => f.endsWith('.html') && f !== 'index.html')) {
    await page.goto(new URL(file, base).href);
    await nav(page, '‹ 返回');
    assert.equal(await page.locator('.nav-back:not(.rate-nav)').getAttribute('href'), '/');
    if (file === 'guide.html') await page.screenshot({ path: `${out}/nav_tl_guide.png` });
    if (file === 'scripts.html') {
      await page.click('[data-act="spoil"]');
      await nav(page, '‹ 返回');
      await page.click('.sc-item >> text=初学者剧本');
      await nav(page, '‹ 返回');
    }
    await page.locator('.nav-back:not(.rate-nav)').click();
    await nav(page, '‹ 全部游戏');
  }
  assert.deepEqual(errors, []);
  console.log('ALL PASS');
} finally { await browser.close(); }
