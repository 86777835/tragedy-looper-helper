import { DurableObject } from 'cloudflare:workers';
import { initialState, reduce, publicView, gameRecord } from '../public/logic.js';
import { botInitial, botReduce, gwProblem } from './engine.js';
import { SCRIPT, SCRIPTS, CHARS, ROLES, PLOTS, INCIDENTS, SETS, LOC_ZH } from '../public/data.js';
import { NOTES } from '../public/notes.js';
import GUIDE from '../tools/讲解稿.md';
import FAQ from '../tools/faq.json';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const newKey = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // A new room. The key makes its holder the Mastermind; everyone else with the code only gets the public view.
    // A robot room ({ bot: true }) has no key: nobody can become its Mastermind, the robot in the room plays it.
    if (url.pathname === '/api/room' && req.method === 'POST') {
      let bot = false; try { bot = (await req.json())?.bot === true; } catch {}
      for (let i = 0; i < 6; i++) {
        const code = newCode(), key = bot ? null : newKey();
        const res = await env.ROOM.get(env.ROOM.idFromName(code)).fetch('https://room/init', { method: 'POST', body: JSON.stringify({ code, key, bot }) });
        if (res.ok) return Response.json(bot ? { code, bot: true } : { code, key });
      }
      return Response.json({ error: '暂时无法创建房间，请重试' }, { status: 503 });
    }

    if (url.pathname === '/api/chat' && req.method === 'POST') return chat(req, env);
    if (url.pathname === '/api/chat-log' && req.method === 'POST') {   // a reply the page lost mid-way (see chat.js)
      console.log('chat client error', (await req.text()).slice(0, 300), req.headers.get('user-agent')?.slice(-60), req.cf?.colo);
      return new Response(null, { status: 204 });
    }

    // Finished games of one room, for the Mastermind's history page (needs the room key).
    const rec = url.pathname.match(/^\/api\/room\/([A-Z0-9]{4})\/games$/);
    if (rec && req.method === 'POST') return env.ROOM.get(env.ROOM.idFromName(rec[1])).fetch('https://room/games', { method: 'POST', body: await req.text() });

    const m = url.pathname.match(/^\/api\/room\/([A-Z0-9]{4})\/ws$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('需要 WebSocket 连接', { status: 426 });
      return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env) { await checkDeepSeek(env); }
};

// Rules assistant. Same model order and fallback as the Pittsburgh helper:
// the next model answers when the one before is overloaded, queueing, erroring, unreachable or stalls mid-answer.
const CHAT_MODELS = [
  { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' },
  { id: '@cf/qwen/qwen3.8-27b', name: 'Qwen3.8 27B (Cloudflare)' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }
];
const FIRST_DATA_MS = 9000;   // three models × 9 s stays under the page's 30 s wait
const STALL_MS = 8000;        // an answer that pauses this long mid-way is dropped and asked again of the next model
// Hourly check (cron): when DeepSeek doesn't answer, Qwen goes first until the next check.
const DEEPSEEK_DOWN = 'deepseek-down';   // KV key; expires on its own a little after the next hourly check
const ORDER = { normal: [0, 1, 2], deepseekDown: [1, 0, 2] };   // indexes into CHAT_MODELS

async function checkDeepSeek(env) {
  const fails = [];
  const o = await openModel(0, env, [{ role: 'user', content: '你好' }], fails);
  if (o) {
    o.reader.cancel().catch(() => {});
    await env.CHAT_STATE.delete(DEEPSEEK_DOWN);
    console.log('deepseek check: ok');
  } else {
    await env.CHAT_STATE.put(DEEPSEEK_DOWN, JSON.stringify({ at: new Date().toISOString(), fails }), { expirationTtl: 3900 });
    console.log('deepseek check: down, Qwen first for the next hour', fails.join('/'));
  }
}

// Web search (2026-11-12, ported from the Pittsburgh helper): when the tutorial and FAQ don't cover a rules question,
// the model replies only with WEB_MARK + English search words. The server then asks DeepSeek's search API and answers
// again from the results. Those answers are labelled by the page as web discussion the site has not checked, with sources.
// Hidden information: the search words and the second round never carry the script being played (see web() in chat()).
const WEB_MARK = '【需联网】';
const WEB_RESULTS = 6;
const WEB_NONE = '本站资料里没有这一条，网上也没找到可靠的说法。建议翻一下规则书，或者问问桌上的老玩家。';
const webSystem = results => `你是「惨剧轮回规则助手」，解答桌游《惨剧轮回》（Tragedy Looper，日文名 惨劇RoopeR，BakaFire 设计）的规则问题。本站整理的资料里没有这个问题的答案，下面是联网搜索到的网页摘要。

回答要求：
- 只依据这些摘要作答，用 [1] [2] 这样的编号注明依据哪条。
- 优先采信设计者（BakaFire）、出版社或规则书原文的说法；网友的说法要说明是网友观点；不同版本（旧版、5th、英文版）或说法冲突时直接指出来。
- 摘要里没有可靠答案就直接说没找到，不要自己推测规则。
- 只谈通用规则，不猜测、不分析任何具体剧本里谁是什么身份。
- 用简体中文，简短直接：先给结论，再补一两句理由。可以用短列表，不要用表格和标题。

${results.map((r, i) => `[${i + 1}] ${r.title}（${r.site}）\n${r.summary}`).join('\n\n')}`;

const RULES_SYSTEM = `你是「惨剧轮回规则助手」，解答桌游《惨剧轮回》（Tragedy Looper，BakaFire 设计，中文版依据日版 5th）的规则问题，也可以解释本网站「惨剧轮回剧作家助手」怎么用。

回答要求：
- 只依据下面的「规则讲解」和「常见问题」作答，它们整理自官方规则书和官方 FAQ，不要编造规则。
- 资料里找不到答案的惨剧轮回通用规则问题，不要自己回答，也不要解释为什么查不到：整个回复只有一行，以${WEB_MARK}开头，后面接一组英文搜索词，以 Tragedy Looper 开头，必要时加上日文名 惨劇RoopeR，例如：${WEB_MARK}Tragedy Looper Time Traveler goodwill refusal timing。网站会去网上查。搜索词只写通用的规则概念（身份、事件、能力、阶段的英文名），不写剧本名，也不写哪个角色是什么身份。
- 你可能正被主人公玩家使用。只回答通用规则，不谈任何具体剧本：不猜测、不透露、不分析某个剧本里谁是什么身份、规则X/Y 是什么、事件当事人是谁、剧作家怎么赢。被问到这些，就说这属于剧本的隐藏信息，规则助手不回答，也不要输出${WEB_MARK}。
- 注意区分：隐藏信息只指某一局、某个剧本里“哪个角色是什么身份、用了哪条规则、谁是事件当事人”。身份、规则X/Y、事件、模组本身是什么、有什么能力和效果，是公开的通用规则（扩展模组的也一样，都印在模组速查表上），例如「Midnight Circle 的杀人狂和基础版有什么不同」「幽灵这个身份有什么能力」，要照常回答，本站资料里没有的照上面的方法联网。
- 与本游戏无关的问题，礼貌说明你只解答惨剧轮回规则，不要输出${WEB_MARK}。
- 用简体中文，简短直接：先给结论，再补一两句理由或例子。可以用短列表，不要用表格和标题。

本网站怎么用：剧作家用手机建房间，在私密视图里选剧本、看设置清单和路线建议，对局中记录轮回、天数、阶段、各角色位置和友好/不安/密谋，按阶段看提醒，最后结算并保存长图。主人公扫码或输入房间码进入公开视图，只能看到公开信息卡、版图和指示物。

# 规则讲解
${GUIDE}

# 常见问题
${FAQ.map(f => `【${f.cat}】问：${f.q}\n答：${f.a}`).join('\n\n')}`;

// For the Mastermind's private view only: the rules plus one script's full setup and this site's notes on it.
function scriptSystem(sid) {
  const sc = SCRIPT[sid], set = SETS[sc.set], n = NOTES[sid];
  const roles = Object.entries(sc.cast).map(([c, r]) => {
    const ex = (sc.extra || {})[c] || {};
    return `${CHARS[c].name}：${ROLES[r].name}${ex.enterLoop ? `（第 ${ex.enterLoop} 轮回才登场）` : ''}${ex.enterDay ? `（第 ${ex.enterDay} 天才登场）` : ''}${ex.turf ? `（领地：${LOC_ZH[ex.turf]}）` : ''}`;
  }).join('；');
  return `${RULES_SYSTEM.replace(/- 你可能正被主人公玩家使用[^\n]*\n/, '- 现在是剧作家的私密视图，可以讨论下面这个剧本的隐藏信息和打法。\n')}

# 当前剧本（隐藏信息，只给剧作家）
${sc.no}「${sc.zh}」（${sc.jp}），模组 ${set.name}，${sc.days} 天，轮回数/难度：${sc.opts.map(([l, d]) => `${l} 轮回·难度 ${d}`).join('，')}
规则Y：${PLOTS[sc.y].name}；规则X：${sc.x.map(x => PLOTS[x].name).join('、')}
身份：${roles}
事件：${sc.incidents.map(([d, k, c]) => `第 ${d} 天 ${INCIDENTS[k].name}（当事人 ${CHARS[c].name}）`).join('；')}
特殊规则：${sc.special.join('；') || '无'}
本站整理的要点：${n.core}
路线建议：${n.routes.map(r => `${r.t}：${r.x}`).join('；')}`;
}

async function chat(req, env) {
  if (!env.DEEPSEEK_API_KEY) return Response.json({ error: '规则助手还没有配置好，请稍后再试' }, { status: 503 });
  const { success } = await env.CHAT_LIMIT.limit({ key: req.headers.get('cf-connecting-ip') || 'local' });
  if (!success) return Response.json({ error: '问得有点快，请过一分钟再问' }, { status: 429 });
  let body;
  try { body = await req.json(); } catch { body = null; }
  const msgs = body?.messages, sid = body?.script;
  const valid = Array.isArray(msgs) && msgs.length > 0 && msgs.length <= 20 && msgs.at(-1).role === 'user' && msgs.at(-1).content?.length <= 500
    && msgs.every(m => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string' && m.content.trim() && m.content.length <= 3000)
    && (sid === undefined || Object.hasOwn(SCRIPT, sid));
  if (!valid) return Response.json({ error: '问题格式不对，请刷新页面再试' }, { status: 400 });
  console.log('chat question', JSON.stringify(msgs.at(-1).content));   // what players ask, for the usage brief
  const history = msgs.slice(-10).map(m => ({ role: m.role, content: m.content }));
  let messages = [{ role: 'system', content: sid ? scriptSystem(sid) : RULES_SYSTEM }, ...history];
  const fails = [];   // HTTP status, 0 = unreachable or error, 'queue' = no answer started in time or stalled
  const order = await env.CHAT_STATE.get(DEEPSEEK_DOWN) ? ORDER.deepseekDown : ORDER.normal;
  let cur = await firstAnswer(order, 0, env, messages, fails);
  if (!cur) return Response.json({ error: chatFailed(fails) }, { status: 502 });
  const enc = new TextEncoder(), dec = new TextDecoder();
  const event = o => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
  const say = text => event({ choices: [{ delta: { content: text } }] });
  let lastData = Date.now(), searched = false, raw = '', pend = '';   // raw: the current model's stream so far, as text
  // Only whole lines go to the page, so dropping the rest of a model's stream (search, backup model) never leaves it half a line.
  // Returns whether anything went out.
  const forward = (c, text) => {
    pend += text;
    const cut = pend.lastIndexOf('\n') + 1;
    if (cut) { c.enqueue(enc.encode(pend.slice(0, cut))); pend = pend.slice(cut); }
    return cut > 0;
  };
  const headText = () => cur.head.map(v => dec.decode(v, { stream: true })).join('');
  // The model asked to search: tell the page, search, then answer again from the results. Returns false when the
  // stream is finished (nothing found, or no model answered), true when `cur` is the answer from the results.
  async function web(c, query) {
    cur.reader.cancel().catch(() => {});
    searched = true;
    c.enqueue(event({ searching: true }));
    query = scrubQuery(query);
    // the Mastermind's own question may mention the script: the search service then only gets the search words
    const found = await webSearch(env, query, sid ? query || 'Tragedy Looper rules' : history.at(-1).content);
    console.log('chat web search', JSON.stringify(query), found ? found.length : 'failed');   // for the usage brief: questions the FAQ lacks
    if (!found?.length) {
      c.enqueue(event({ web: [] }));
      c.enqueue(say(found ? WEB_NONE : '本站资料里没有这一条，联网查找也失败了，请过一会儿再问，或者翻一下规则书。'));
      c.close(); return false;
    }
    // The second round knows no script: on the Mastermind's view, earlier answers (which may discuss it) are left out.
    messages = [{ role: 'system', content: webSystem(found) }, ...(sid ? history.filter(m => m.role === 'user') : history)];
    const next = await firstAnswer(order, 0, env, messages, fails);
    if (!next) { c.enqueue(event({ error: chatFailed(fails) })); c.close(); return false; }
    cur = next; lastData = Date.now(); raw = ''; pend = '';
    c.enqueue(event({ web: found.map(r => ({ title: r.title, url: r.url, site: r.site })) }));
    return true;
  }
  // Before anything reaches the page, look at how the answer starts. The search itself runs in the first pull:
  // Workers starts pulling without waiting for an async start().
  let query = await webQuery(cur);
  const stream = new ReadableStream({
    start(c) { if (query === null) { raw = headText(); forward(c, raw); } },
    async pull(c) {
      if (query !== null) {
        const q = query; query = null;
        if (await web(c, q)) forward(c, headText());
        return;
      }
      // A pull that sends nothing is never followed by another one: read on until a whole line can go out.
      for (;;) {
      // Keep-alive comments don't count as progress: only data lines do.
      let timer, r;
      const stall = new Promise(ok => { timer = setTimeout(() => ok('stall'), Math.max(0, lastData + STALL_MS - Date.now())); });
      try { r = await Promise.race([cur.reader.read(), stall]); } catch (e) { r = 'broken'; console.log('chat model broke mid-answer', CHAT_MODELS[cur.i].id, String(e).slice(0, 200)); }
      clearTimeout(timer);
      if (r === 'stall' || r === 'broken') {
        if (r === 'stall') console.log(`chat model stalled ${STALL_MS / 1000}s mid-answer`, CHAT_MODELS[cur.i].id);
        fails.push(r === 'stall' ? 'queue' : 0);
        cur.reader.cancel().catch(() => {});
        const next = await firstAnswer(order, cur.k + 1, env, messages, fails);
        if (!next) { c.enqueue(event({ error: chatFailed(fails) })); return c.close(); }
        cur = next; lastData = Date.now(); raw = ''; pend = '';
        c.enqueue(event({ reset: CHAT_MODELS[cur.i].name }));   // the page drops the partial answer and starts over
        // the backup model may ask to search too (only from the tutorial-and-FAQ round)
        const q2 = searched ? null : await webQuery(cur);
        if (q2 !== null && !(await web(c, q2))) return;
        const head = headText();
        if (!searched) raw = head;
        forward(c, head);
        return;
      }
      if (r.done) { if (pend) c.enqueue(enc.encode(pend)); return c.close(); }
      const piece = dec.decode(r.value, { stream: true });
      if (piece.includes('data:')) lastData = Date.now();
      if (!searched) {
        // The model sometimes explains first and asks to search at the end: stop there and search instead
        // (the page clears what it showed when the search starts).
        raw += piece;
        const text = sseText(raw), at = text.indexOf(WEB_MARK);
        if (at >= 0) {
          const q = (text.slice(at + WEB_MARK.length) + await restText(cur)).trim().split('\n')[0].trim().slice(0, 120);
          console.log('chat web mark mid-answer');
          if (await web(c, q)) forward(c, headText());
          return;
        }
      }
      if (forward(c, piece)) return;
      }
    },
    cancel() { cur.reader.cancel().catch(() => {}); }
  });
  const h = { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' };
  if (cur.i) h['x-chat-fallback'] = CHAT_MODELS[cur.i].name;
  return new Response(stream, { headers: h });
}

// Text of the answer in a model's raw stream (DeepSeek and Workers AI both send OpenAI-style chunks).
function sseText(raw) {
  let text = '';
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try { const j = JSON.parse(line.slice(5)); text += j.choices?.[0]?.delta?.content ?? j.response ?? ''; } catch {}
  }
  return text;
}
const streamText = chunks => { const dec = new TextDecoder(); return sseText(chunks.map(v => dec.decode(v, { stream: true })).join('')); };

// The rest of a model's answer as text (for the search words after the marker), waiting at most STALL_MS.
async function restText(cur) {
  const dec = new TextDecoder(), until = Date.now() + STALL_MS;
  let raw = '';
  for (;;) {
    let r;
    try { r = await Promise.race([cur.reader.read(), new Promise(ok => setTimeout(() => ok({ done: true }), Math.max(0, until - Date.now())))]); } catch { r = { done: true }; }
    if (r.done) return sseText(raw);
    raw += dec.decode(r.value, { stream: true });
  }
}

// Reads ahead (into cur.head) until the answer's first characters show whether it is a search request.
// Returns the search words, or null for an ordinary answer. Stops reading after STALL_MS; the stream's own stall check takes over.
async function webQuery(cur) {
  const until = Date.now() + STALL_MS;
  for (;;) {
    const text = streamText(cur.head).trimStart();
    const marked = text.startsWith(WEB_MARK);
    if (!marked && (text.length >= WEB_MARK.length || !WEB_MARK.startsWith(text))) return null;
    let r;
    try { r = await Promise.race([cur.reader.read(), new Promise(ok => setTimeout(() => ok('late'), Math.max(0, until - Date.now())))]); } catch { r = { done: true }; }
    if (r === 'late') return marked ? text.slice(WEB_MARK.length).trim().slice(0, 120) : null;
    if (r.done) return marked ? text.slice(WEB_MARK.length).trim().slice(0, 120) : null;
    cur.head.push(r.value);
  }
}

// Search words never carry a script's name (the model on the Mastermind's view knows which one is being played).
const SCRIPT_NAMES = SCRIPTS.flatMap(x => [x.zh, x.jp, x.en, x.no]).filter(Boolean).sort((a, b) => b.length - a.length);
function scrubQuery(q) {
  for (const n of SCRIPT_NAMES) q = q.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  return q.replace(/\s+/g, ' ').trim();
}

// DeepSeek's search API. Rules questions are best answered in BoardGameGeek's forums (designers often reply there),
// so BGG goes first; with fewer than 3 results there, the whole web. Returns [{ title, url, site, summary }]
// (possibly empty), or null when the search failed.
async function webSearch(env, query, question) {
  query ||= `Tragedy Looper ${question}`;
  const bgg = await searchOnce(env, `${query} site:boardgamegeek.com`.slice(0, 128), question);
  if (bgg === null || bgg.length >= 3) return bgg;
  const all = await searchOnce(env, query.slice(0, 128), question);
  if (all === null) return bgg;
  const seen = new Set(bgg.map(r => r.url));
  return [...bgg, ...all.filter(r => !seen.has(r.url))].slice(0, WEB_RESULTS);
}
async function searchOnce(env, query, question) {
  const base = env.DEEPSEEK_BASE || 'https://api.deepseek.com';   // DEEPSEEK_BASE: set only by the local tests
  try {
    const r = await fetch(`${base}/v1/tools/search`, {
      method: 'POST', signal: AbortSignal.timeout(6000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({ query, ori_question: question.slice(0, 128), count: 10 })
    });
    if (!r.ok) { console.log('chat web search error', r.status, (await r.text()).slice(0, 300)); return null; }
    const { results = [] } = await r.json();
    return results.filter(x => x.url && (x.summary || x.snippet)).slice(0, WEB_RESULTS)
      .map(x => ({ title: x.title || x.url, url: x.url, site: x.site_name || new URL(x.url).hostname, summary: (x.summary || x.snippet).slice(0, 900) }));
  } catch (e) { console.log('chat web search failed', String(e).slice(0, 200)); return null; }
}

const chatFailed = fails => fails.some(f => f === 503 || f === 429 || f === 'queue')   // overloaded / throttled / queueing
  ? 'AI 服务器都在忙，请过一两分钟再问' : `规则助手暂时不可用（${fails.join('/')}），请稍后再试`;

// The first model from position `from` in `order` that starts answering:
// { k: position, i: index into CHAT_MODELS, reader, head (chunks read so far) }, or null.
async function firstAnswer(order, from, env, messages, fails) {
  for (let k = from; k < order.length; k++) {
    const i = order[k], o = await openModel(i, env, messages, fails);
    if (o) { if (i) console.log('chat fallback answered', CHAT_MODELS[i].id); return { k, i, ...o }; }
  }
  return null;
}

// Starts model i and waits up to FIRST_DATA_MS for its first data line. An overloaded DeepSeek may accept the request
// and then only send keep-alive comments while it waits in a queue. On failure, logs it, adds to `fails`, returns null.
async function openModel(i, env, messages, fails) {
  const { id } = CHAT_MODELS[i];
  const model = id.startsWith('@cf/') ? env.CHAT_CF_MODEL || id : id;   // CHAT_CF_MODEL: set only by the local tests
  const base = env.DEEPSEEK_BASE || 'https://api.deepseek.com';         // DEEPSEEK_BASE: set only by the local tests
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), FIRST_DATA_MS);
  const late = new Promise((_, no) => ctl.signal.addEventListener('abort', () => no(new Error('timeout'))));
  let reader;
  try {
    let stream;
    if (model.startsWith('@cf/')) {
      stream = await Promise.race([env.AI.run(model, { messages, stream: true, max_tokens: 900, temperature: 0.3, chat_template_kwargs: { enable_thinking: false } }), late]);
    } else {
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify({ model, stream: true, thinking: { type: 'disabled' }, max_tokens: 900, temperature: 0.3, messages })
      });
      if (!r.ok) { clearTimeout(timer); fails.push(r.status); console.log('chat model error', model, r.status, (await r.text()).slice(0, 500)); return null; }
      stream = r.body;
    }
    reader = stream.getReader();
    const dec = new TextDecoder(), head = [];
    let seen = '';
    while (!seen.includes('data:')) {
      const { done, value } = await Promise.race([reader.read(), late]);
      if (done) break;
      head.push(value); seen += dec.decode(value, { stream: true });
    }
    clearTimeout(timer);
    if (!seen.includes('data:')) { fails.push(502); console.log('chat model empty reply', model); return null; }
    return { reader, head };
  } catch (e) {
    clearTimeout(timer); reader?.cancel().catch(() => {});
    const queued = ctl.signal.aborted;
    fails.push(queued ? 'queue' : 0);
    console.log('chat model', queued ? `queued over ${FIRST_DATA_MS / 1000}s` : 'failed', model, String(e).slice(0, 300));
    return null;
  }
}

const MAX_UNDO = 30;

// One room = one Durable Object holding one game (and the records of the games played in it before).
// Sockets start as viewers and get the public view; a socket that sends the room key becomes the Mastermind's.
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get('s')) ?? null;
      this.key = (await ctx.storage.get('key')) ?? null;
      this.undo = (await ctx.storage.get('undo')) ?? [];
    });
  }

  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/init') {
      if (this.s) return new Response('exists', { status: 409 });
      const { code, key, bot } = await req.json();
      this.s = bot ? botInitial() : initialState(); this.key = bot ? null : key; this.undo = [];
      await this.ctx.storage.put({ s: this.s, key, code, undo: [] });
      return new Response('ok');
    }
    if (path === '/games') {
      let key; try { ({ key } = JSON.parse(await req.text())); } catch {}
      if (!this.s || !this.keyOk(key)) return Response.json({ error: '房间密钥不对' }, { status: 403 });
      const all = await this.ctx.storage.list({ prefix: 'g:' });
      return Response.json([...all.values()]);
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ mm: false });
    server.send(JSON.stringify(this.s ? { type: 'state', role: 'view', state: publicView(this.s) } : { type: 'error', error: 'noroom' }));
    return new Response(null, { status: 101, webSocket: client });
  }

  keyOk(k) {
    if (typeof k !== 'string' || !this.key || k.length !== this.key.length) return false;
    let d = 0; for (let i = 0; i < k.length; i++) d |= k.charCodeAt(i) ^ this.key.charCodeAt(i);
    return d === 0;
  }

  isMM(ws) { return !!ws.deserializeAttachment()?.mm; }
  privateMsg() { return JSON.stringify({ type: 'state', role: 'mm', state: { ...this.s, canUndo: this.undo.length > 0 } }); }

  broadcast() {
    const pub = JSON.stringify({ type: 'state', role: 'view', state: publicView(this.s) }), priv = this.privateMsg();
    for (const w of this.ctx.getWebSockets()) { try { w.send(this.isMM(w) ? priv : pub); } catch {} }
  }

  async webSocketMessage(ws, msg) {
    if (!this.s || typeof msg !== 'string' || msg.length > 4000) return;
    let m; try { m = JSON.parse(msg); } catch { return; }
    if (this.s.mode === 'bot') return this.botMessage(ws, m);
    if (m.auth !== undefined) {
      if (!this.keyOk(m.auth)) { ws.send(JSON.stringify({ type: 'error', error: 'badkey' })); return; }
      ws.serializeAttachment({ mm: true });
      ws.send(this.privateMsg());
      return;
    }
    if (!this.isMM(ws)) { ws.send(JSON.stringify({ type: 'error', error: 'viewonly' })); return; }   // viewers can't change anything
    let next;
    if (m.undo) next = this.undo.length ? { ...this.undo.pop(), v: this.s.v + 1 } : null;
    else {
      next = reduce(this.s, m.action);
      if (next) { this.undo.push(this.s); if (this.undo.length > MAX_UNDO) this.undo.shift(); }
    }
    if (!next) { ws.send(this.privateMsg()); return; }   // rejected: resync the sender
    const before = this.s;
    this.s = next;
    await this.ctx.storage.put({ s: next, undo: this.undo });
    this.broadcast();
    await this.record(before);
  }

  // Robot rooms: everyone at the table may act (place their cards, use goodwill abilities…); everyone gets the public view.
  async botMessage(ws, m) {
    const next = botReduce(this.s, m.action);
    if (!next) {   // rejected: resync the sender and say why, so the page doesn't just sit there
      const a = m.action, gw = a?.t === 'gw' && this.s.stage === 'play' && this.s.pv.step === 'gw';
      ws.send(JSON.stringify({ type: 'state', role: 'view', state: publicView(this.s) }));
      if (a && typeof a === 'object') ws.send(JSON.stringify({ type: 'error', error: 'rejected', t: typeof a.t === 'string' ? a.t : null, why: gw ? gwProblem(this.s, a.ch, a.n, a) : null }));
      return;
    }
    const before = this.s;
    this.s = next;
    await this.ctx.storage.put({ s: next });
    this.broadcast();
    await this.record(before);
  }

  async webSocketClose(ws, code) { try { ws.close(code, 'closed'); } catch {} }

  // Keep the record of a finished game; drop it again when the end is undone.
  async record(before) {
    const s = this.s;
    if (s.stage === 'over' && s.gid) {
      const old = await this.ctx.storage.get('g:' + s.gid);
      await this.ctx.storage.put('g:' + s.gid, { ...gameRecord(s), ended: old?.ended ?? Date.now() });
    } else if (before.stage === 'over' && before.gid && s.gid === before.gid) {
      await this.ctx.storage.delete('g:' + before.gid);
    }
  }
}
