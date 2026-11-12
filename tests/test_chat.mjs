// Rules assistant. Usage: node tests/test_chat.mjs <base-url> <shots-dir> [--mock-upstream | --mock-web | --live]
//   --mock-upstream  local `wrangler dev --port 8821 --test-scheduled --var DEEPSEEK_API_KEY:fake --var DEEPSEEK_BASE:http://127.0.0.1:8822 --var CHAT_CF_MODEL:@cf/none/missing`
//                    (DeepSeek is a mock on 8822; the Cloudflare model points at a missing one so it always fails fast)
//                    checks: request validation, model fallback, stalls, the hourly check, and that the rules mode
//                    (the one Protagonists can see) carries no script data while the Mastermind's script mode does.
//   --mock-web       same `wrangler dev` flags as --mock-upstream: web search when the notes lack an answer (run a minute apart).
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

if (mode === '--mock-web') {
  // Web search when the tutorial and FAQ don't cover a question. Same wrangler dev flags as --mock-upstream
  // (run the two modes at least a minute apart: the rate limit is 8 questions a minute).
  // The mock model asks to search for questions containing 「网上」; the mock search API answers per `search`.
  const { SCRIPT } = await import('../public/data.js');
  let search = 'ok', asked = [], oris = [], webRounds = [];   // search: 'ok' | 'empty' | 'fail'
  const sse = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  const srv = createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      const j = JSON.parse(body);
      if (req.url === '/v1/tools/search') {
        asked.push(j.query); oris.push(j.ori_question);
        if (search === 'fail') { res.writeHead(500); return res.end('{}'); }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ results: search === 'empty' ? [] : [
          { title: 'Time Traveler question <b>', url: 'https://boardgamegeek.com/thread/1', site_name: 'BoardGameGeek', summary: 'BakaFire: yes.' },
          { title: '惨劇RoopeR FAQ', url: 'https://example.jp/a', site_name: null, snippet: '公式FAQ：可以。' }] }));
      }
      const sys = j.messages[0].content, q = j.messages.at(-1).content;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (sys.includes('联网搜索到的网页摘要')) { webRounds.push(j.messages); return res.end(sse(`依据网上说法：可以 [1]（摘要条数 ${(sys.match(/^\[\d\] /gm) || []).length}）`)); }
      if (q.includes('先解释')) {   // the model explains first and asks to search at the end
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '资料里没有提到这一点。' } }] })}\n\n`);
        return setTimeout(() => res.end(sse('\n\n【需联网】Tragedy Looper 惨劇RoopeR loop reset')), 300);
      }
      if (q.includes('剧本名')) {   // the Mastermind's script mode: the model wrongly puts the script's names in the search words
        const sc = SCRIPT[sys.includes('猫箱') ? 'btx02' : 'fs01'];
        return res.end(sse(`【需联网】Tragedy Looper ${sc.en} ${sc.zh} ${sc.no} killer timing`));
      }
      if (q.includes('网上')) {   // the marker arrives split over two chunks, like a real stream
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '【需' } }] })}\n\n`);
        return setTimeout(() => res.end(sse('联网】Tragedy Looper Time Traveler')), 200);
      }
      res.end(sse(q.includes('无关') ? '我只解答惨剧轮回规则。' : '资料里的回答'));
    });
  }).listen(8822);
  const page = await (await ctx()).newPage();
  page.on('pageerror', e => { fails++; console.log('FAIL page error', e.message); });
  const bodies = []; page.on('request', r => r.url().endsWith('/api/chat') && bodies.push(JSON.parse(r.postData())));
  const ask = async (p, q, s) => {
    search = s; asked = []; oris = [];
    await p.fill('.cin textarea', q); await p.press('.cin textarea', 'Enter');
    await p.waitForFunction(() => !document.querySelector('.cin button').disabled, null, { timeout: 40000 });
    return p.$$eval('.cm.a', l => { const a = l.at(-1); return { err: a.className.includes('err'), label: !!a.querySelector('.cweb'),
      text: [...a.childNodes].filter(n => !n.classList?.contains('cweb') && !n.classList?.contains('csrc')).map(n => n.textContent).join(''),
      src: [...a.querySelectorAll('.csrc a')].map(x => [x.textContent, x.getAttribute('href'), x.target]) }; });
  };
  const SRC = [['[1] Time Traveler question <b>BoardGameGeek', 'https://boardgamegeek.com/thread/1', '_blank'], ['[2] 惨劇RoopeR FAQexample.jp', 'https://example.jp/a', '_blank']];
  const WEB = '依据网上说法：可以 [1]（摘要条数 2）';
  await page.goto(base); await page.click('.cfab');
  eq('panel says it searches the web when the notes lack an answer', await page.textContent('.chd em'), '依据规则书作答，查不到会联网找');
  eq('covered by the notes: answered directly, no search', [await ask(page, '事件什么时候发生？', 'ok'), asked], [{ err: false, label: false, text: '资料里的回答', src: [] }, []]);
  eq('not covered: searched with the model\'s words, labelled, sources listed', [await ask(page, '网上怎么说时间旅者？', 'ok'), asked],
    [{ err: false, label: true, text: WEB, src: SRC }, ['Tragedy Looper Time Traveler site:boardgamegeek.com', 'Tragedy Looper Time Traveler']]);
  await page.screenshot({ path: out + '/chat_web.png' });
  eq('the search request never reaches the page as text', (await page.$$eval('.cm.a', l => l.map(x => x.textContent).join(''))).includes('需联网'), false);
  eq('nothing found: says so, no label, nothing made up', [await ask(page, '网上还有啥？', 'empty'), asked.length],
    [{ err: false, label: false, text: '本站资料里没有这一条，网上也没找到可靠的说法。建议翻一下规则书，或者问问桌上的老玩家。', src: [] }, 2]);
  eq('web answer goes back as plain history (no label, no sources)', bodies.at(-1).messages.slice(-3),
    [{ role: 'user', content: '网上怎么说时间旅者？' }, { role: 'assistant', content: WEB }, { role: 'user', content: '网上还有啥？' }]);
  eq('search API down: says so', (await ask(page, '网上第三问？', 'fail')).text, '本站资料里没有这一条，联网查找也失败了，请过一会儿再问，或者翻一下规则书。');
  eq('off-topic: no search', [(await ask(page, '无关的问题', 'ok')).text, asked], ['我只解答惨剧轮回规则。', []]);
  eq('search asked for at the end of an explanation: explanation dropped, searched', [await ask(page, '先解释再查', 'ok'), asked],
    [{ err: false, label: true, text: WEB, src: SRC }, ['Tragedy Looper 惨劇RoopeR loop reset site:boardgamegeek.com', 'Tragedy Looper 惨劇RoopeR loop reset']]);
  await wait(61000);   // rate limit
  // the Mastermind's script mode: the search words lose the script's names, the search service never gets the question,
  // and the second round carries no script and none of the earlier answers
  const { code, key } = await (await fetch(api('/api/room'), { method: 'POST' })).json();
  const mmp = await (await ctx()).newPage();
  mmp.on('pageerror', e => { fails++; console.log('FAIL page error', e.message); });
  await mmp.goto(base);
  await mmp.evaluate(([c, k]) => localStorage.setItem('tl-mine', JSON.stringify([{ code: c, key: k, t: Date.now() }])), [code, key]);
  await mmp.goto(api(`/?r=${code}`)); await mmp.waitForSelector('text=剧作家·私密');
  await mmp.click('.sc-item >> text=猫箱'); await mmp.waitForSelector('text=摆放清单');
  await mmp.click('.cfab'); await mmp.click('.cmodes [data-m="script"]');
  await ask(mmp, '这个剧本里巫女是不是杀手？', 'ok');   // an ordinary script-mode answer first
  webRounds = [];
  const mmA = await ask(mmp, '剧本名里的杀手什么时候动手？', 'ok');
  eq('script mode: web answer labelled', [mmA.label, mmA.text], [true, WEB]);
  eq('script mode: search words without the script\'s names', asked, ['Tragedy Looper killer timing site:boardgamegeek.com', 'Tragedy Looper killer timing']);
  eq('script mode: the search service gets the search words, not the question', oris.every(o => !o.includes('剧本名')), true);
  const round = JSON.stringify(webRounds[0] || '');
  eq('script mode: second round has no script data', ['猫箱', '当前剧本', '身份：', '本站整理的要点', '资料里的回答'].filter(w => round.includes(w)), []);
  eq('script mode: second round keeps only the questions', webRounds[0]?.slice(1).map(m => m.role), ['user', 'user']);
  // the Protagonists' public view of the same room, and a robot room: the same web answers
  const pv = await (await ctx()).newPage();
  pv.on('pageerror', e => { fails++; console.log('FAIL page error', e.message); });
  await pv.goto(api(`/?r=${code}`)); await pv.waitForSelector('text=公开视图'); await pv.click('.cfab');
  eq('public view: web answer', await ask(pv, '网上怎么说时间旅者？', 'ok'), { err: false, label: true, text: WEB, src: SRC });
  const bot = await (await fetch(api('/api/room'), { method: 'POST', body: JSON.stringify({ bot: true }) })).json();
  await pv.goto(api(`/?r=${bot.code}`)); await pv.waitForSelector('.bot-intro'); await pv.click('.cfab');
  eq('robot room: web answer', await ask(pv, '网上怎么说时间旅者？', 'ok'), { err: false, label: true, text: WEB, src: SRC });
  await pv.screenshot({ path: out + '/chat_web_bot.png' });
  await b.close(); srv.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
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
eq('script mode: the "don\'t discuss scripts" rule is lifted', [systems[1].includes('你可能正被主人公玩家使用'), systems[1].includes('现在是剧作家的私密视图')], [false, true]);
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
