// Rules assistant. Usage: node tests/test_chat.mjs <base-url> <shots-dir> [--mock-upstream | --live]
//   --mock-upstream  local `wrangler dev --port 8821 --test-scheduled --var DEEPSEEK_API_KEY:fake --var DEEPSEEK_BASE:http://127.0.0.1:8822 --var CHAT_CF_MODEL:@cf/none/missing`
//                    (DeepSeek is a mock on 8822; the Cloudflare model points at a missing one so it always fails fast)
//                    checks: request validation, model fallback, stalls, the hourly check, and that the rules mode
//                    (the one Protagonists can see) carries no script data while the Mastermind's script mode does.
//   --live           the deployed site with a real key: one real question.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
const [base, out = './shots', mode = '--mock-upstream'] = process.argv.slice(2);
const api = p => new URL(p, base).href;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const post = body => fetch(api('/api/chat'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const b = await chromium.launch({ channel: 'chrome' });
const ctx = () => b.newContext({ viewport: { width: 375, height: 700 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

if (mode === '--live') {
  const page = await (await ctx()).newPage();
  await page.goto(base); await page.click('.cfab');
  await page.fill('.cin textarea', '事件什么时候一定会发生？'); await page.press('.cin textarea', 'Enter');
  await page.waitForFunction(() => !document.querySelector('.cin button').disabled, null, { timeout: 60000 });
  const a = await page.$$eval('.cm.a', l => l.at(-1).textContent);
  console.log('answer:', a);
  eq('real answer, no error', await page.$('.cm.err'), null);
  eq('answer mentions paranoia limit', /不安/.test(a), true);
  await b.close(); process.exit(fails ? 1 : 0);
}

// mock DeepSeek
let reply = {}, seen = [], systems = [];
const srv = createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    const j = JSON.parse(body); seen.push(j.model); systems.push(j.messages[0].content);
    const st = reply[j.model] ?? 200;
    if (st === 'queue' || st === 'stall') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (st === 'stall') res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `${j.model} 答了一半` } }] })}\n\n`);
      const t = setInterval(() => res.write(': keep-alive\n\n'), 1000);
      return res.on('close', () => clearInterval(t));
    }
    if (st !== 200) { res.writeHead(st, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"mock"}}'); }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: `${j.model} 的回答` } }] })}\n\ndata: [DONE]\n\n`);
  });
}).listen(8822);

// request checks (rejected before the rate limit counts nothing upstream)
eq('empty messages rejected', (await post({ messages: [] })).status, 400);
eq('unknown script rejected', (await post({ messages: [{ role: 'user', content: '你好' }], script: 'nope' })).status, 400);
eq('system role rejected', (await post({ messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'hi' }] })).status, 400);
eq('question over 500 chars rejected', (await post({ messages: [{ role: 'user', content: '长'.repeat(501) }] })).status, 400);
await wait(61000);   // the rate limit counts those too

// the Protagonists' rules mode carries no script; the Mastermind's script mode carries one
reply = {}; seen = []; systems = [];
const r1 = await post({ messages: [{ role: 'user', content: '规则问题' }] }); await r1.text();
const r2 = await post({ messages: [{ role: 'user', content: '剧本问题' }], script: 'btx07' }); await r2.text();
const hidden = ['序文', '初学者剧本', '猫箱', '当前剧本', '本站整理的要点', '巫女：关键人物', '（当事人 '];
eq('rules mode: no script data in the prompt', hidden.filter(w => systems[0].includes(w)), []);
eq('rules mode: told not to discuss scripts', systems[0].includes('只回答通用规则，不谈任何具体剧本'), true);
eq('script mode: the script is in the prompt', ['序文', '身份：', '巫女：关键人物', '路线建议'].every(w => systems[1].includes(w)), true);

// fallback order (the Cloudflare model is missing, so after Flash comes V4 Pro)
const page = await (await ctx()).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
const bodies = []; page.on('request', r => r.url().endsWith('/api/chat') && bodies.push(JSON.parse(r.postData())));
await page.goto(base); await page.click('.cfab');
eq('public pages: no script mode switch', await page.isVisible('.cmodes'), false);
const askOnce = async (q, r) => {
  reply = r; seen = [];
  await page.fill('.cin textarea', q); await page.press('.cin textarea', 'Enter');
  await page.waitForFunction(() => !document.querySelector('.cin button').disabled, null, { timeout: 40000 });
  return page.$$eval('.cm.a', l => [l.at(-1).className.includes('err'), l.at(-1).textContent]);
};
eq('flash answers', [await askOnce('一', {}), seen], [[false, 'deepseek-flash 的回答'], ['deepseek-flash']]);
eq('flash busy → v4-pro answers, no model named', [await askOnce('二', { 'deepseek-flash': 503 }), seen], [[false, 'deepseek-v4-pro 的回答'], ['deepseek-flash', 'deepseek-v4-pro']]);
eq('both busy → busy message', [await askOnce('三', { 'deepseek-flash': 503, 'deepseek-v4-pro': 503 }), seen], [[true, 'AI 服务器都在忙，请过一两分钟再问'], ['deepseek-flash', 'deepseek-v4-pro']]);
let t0 = Date.now();
eq('flash queueing → v4-pro after 9 s', [(await askOnce('四', { 'deepseek-flash': 'queue' }))[0], seen], [false, ['deepseek-flash', 'deepseek-v4-pro']]);
console.log('  took', Date.now() - t0, 'ms');
t0 = Date.now();
eq('flash stalls mid-answer → partial dropped, v4-pro answers', [await askOnce('五', { 'deepseek-flash': 'stall' }), seen], [[false, 'deepseek-v4-pro 的回答'], ['deepseek-flash', 'deepseek-v4-pro']]);
console.log('  took', Date.now() - t0, 'ms');
eq('public page never sends a script', bodies.every(x => x.script === undefined), true);
await page.screenshot({ path: out + '/chat_rules.png' });

// the Mastermind's private view: the panel offers the script mode, and only there the script id goes along
await wait(61000);
const { code, key } = await (await fetch(api('/api/room'), { method: 'POST' })).json();
const mmp = await (await ctx()).newPage();
mmp.on('pageerror', e => errs.push(e.message));
const mmBodies = []; mmp.on('request', r => r.url().endsWith('/api/chat') && mmBodies.push(JSON.parse(r.postData())));
await mmp.goto(base);
await mmp.evaluate(([c, k]) => localStorage.setItem('tl-mine', JSON.stringify([{ code: c, key: k, t: Date.now() }])), [code, key]);
await mmp.goto(api(`/?r=${code}`)); await mmp.waitForSelector('text=剧作家·私密');
await mmp.click('.sc-item >> text=猫箱'); await mmp.waitForSelector('text=摆放清单');
await mmp.click('.cfab');
eq('private view: script mode switch shown', await mmp.isVisible('.cmodes'), true);
reply = {};
await mmp.fill('.cin textarea', '规则模式的问题'); await mmp.press('.cin textarea', 'Enter');
await mmp.waitForFunction(() => !document.querySelector('.cin button').disabled);
await mmp.click('.cmodes [data-m="script"]');
await mmp.fill('.cin textarea', '剧本模式的问题'); await mmp.press('.cin textarea', 'Enter');
await mmp.waitForFunction(() => !document.querySelector('.cin button').disabled);
eq('rules mode sends no script, script mode sends this script', mmBodies.map(x => x.script ?? null), [null, 'btx02']);
await mmp.screenshot({ path: out + '/chat_script.png' });
// the public view of the same room: rules only
const pv = await (await ctx()).newPage();
await pv.goto(api(`/?r=${code}`)); await pv.waitForSelector('text=公开视图'); await pv.click('.cfab');
eq('public view of the room: no script mode', await pv.isVisible('.cmodes'), false);

// hourly check: DeepSeek down → noted in KV, the next hour asks Qwen first
reply = { 'deepseek-flash': 503 }; seen = [];
await fetch(api('/__scheduled'));
eq('hourly check asked flash', seen, ['deepseek-flash']);
reply = {}; seen = [];
const r3 = await post({ messages: [{ role: 'user', content: '检查之后' }] }); await r3.text();
eq('after a failed check the Cloudflare model goes first (missing here), then flash', seen, ['deepseek-flash']);
reply = {}; seen = [];
await fetch(api('/__scheduled'));   // DeepSeek back: normal order again
eq('errors on pages', errs, []);
await b.close(); srv.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
