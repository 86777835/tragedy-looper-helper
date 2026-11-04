import { DurableObject } from 'cloudflare:workers';
import { initialState, reduce, publicView, gameRecord } from '../public/logic.js';
import { SCRIPT, CHARS, ROLES, PLOTS, INCIDENTS, SETS, LOC_ZH } from '../public/data.js';
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
    if (url.pathname === '/api/room' && req.method === 'POST') {
      for (let i = 0; i < 6; i++) {
        const code = newCode(), key = newKey();
        const res = await env.ROOM.get(env.ROOM.idFromName(code)).fetch('https://room/init', { method: 'POST', body: JSON.stringify({ code, key }) });
        if (res.ok) return Response.json({ code, key });
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

const RULES_SYSTEM = `你是「惨剧轮回规则助手」，解答桌游《惨剧轮回》（Tragedy Looper，BakaFire 设计，中文版依据日版 5th）的规则问题，也可以解释本网站「惨剧轮回剧作家助手」怎么用。

回答要求：
- 只依据下面的「规则讲解」和「常见问题」作答，它们整理自官方规则书和官方 FAQ。资料里没有的内容，直接说资料里没有、建议翻规则书或问剧作家，不要编造规则。
- 你可能正被主人公玩家使用。只回答通用规则，不谈任何具体剧本：不猜测、不透露、不分析某个剧本里谁是什么身份、规则X/Y 是什么、事件当事人是谁、剧作家怎么赢。被问到这些，就说这属于剧本的隐藏信息，规则助手不回答。
- 与本游戏无关的问题，礼貌说明你只解答惨剧轮回规则。
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
  return `${RULES_SYSTEM.replace(/- 你可能正被主人公玩家使用[\s\S]*?规则助手不回答。\n/, '- 现在是剧作家的私密视图，可以讨论下面这个剧本的隐藏信息和打法。\n')}

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
  const system = sid ? scriptSystem(sid) : RULES_SYSTEM;
  const messages = [{ role: 'system', content: system }, ...msgs.slice(-10).map(m => ({ role: m.role, content: m.content }))];
  const fails = [];   // HTTP status, 0 = unreachable or error, 'queue' = no answer started in time or stalled
  const order = await env.CHAT_STATE.get(DEEPSEEK_DOWN) ? ORDER.deepseekDown : ORDER.normal;
  let cur = await firstAnswer(order, 0, env, messages, fails);
  if (!cur) return Response.json({ error: chatFailed(fails) }, { status: 502 });
  const enc = new TextEncoder(), dec = new TextDecoder();
  const event = o => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
  let lastData = Date.now();
  const stream = new ReadableStream({
    start(c) { cur.head.forEach(v => c.enqueue(v)); },
    async pull(c) {
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
        cur = next; lastData = Date.now();
        c.enqueue(event({ reset: CHAT_MODELS[cur.i].name }));   // the page drops the partial answer and starts over
        cur.head.forEach(v => c.enqueue(v));
        return;
      }
      if (r.done) return c.close();
      if (dec.decode(r.value, { stream: true }).includes('data:')) lastData = Date.now();
      c.enqueue(r.value);
    },
    cancel() { cur.reader.cancel().catch(() => {}); }
  });
  const h = { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' };
  if (cur.i) h['x-chat-fallback'] = CHAT_MODELS[cur.i].name;
  return new Response(stream, { headers: h });
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
      const { code, key } = await req.json();
      this.s = initialState(); this.key = key; this.undo = [];
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
