// Rules assistant: a floating button (bottom right) that opens a chat panel. Answers stream from /api/chat.
// Everyone gets the rules mode, which knows no script. On the Mastermind's private view (app.js sets
// window.tlChatScript), a second mode answers questions about the script being played.
const MODES = {
  rules: { title: '惨剧轮回规则助手', sub: '依据规则书作答，查不到会联网找', av: '规', gold: false,
    sug: ['友好无视和必定无视友好有什么区别？', '事件什么时候一定会发生？', '轮回结束时要重置哪些东西？', '杀人狂的能力怎么结算？'],
    welcome: ['有规则问题，尽管问', '出牌、能力、事件、轮回结算……桌上起了争议也可以问我'], ph: '问规则，比如：时间旅者怎么判负？' },
  script: { title: '本剧本问答', sub: '仅剧作家可见 · 会谈到剧本真相', av: '本', gold: true,
    sug: ['这个剧本第一轮回怎么打？', '主人公开始怀疑关键人物了，怎么办？', '哪些事件最容易被主人公挡住？'],
    welcome: ['剧本问答（仅剧作家）', '可以问路线、身份怎么藏、下一轮回怎么打。别让主人公看到这块屏幕'], ph: '问这个剧本，比如：第二轮回换什么路线？' }
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

// Browser messages for a dropped connection (request or mid-answer): Chrome, Safari, Firefox.
const NET_ERRS = ['Failed to fetch', 'network error', 'Load failed', 'NetworkError when attempting to fetch resource.'];

const convo = { rules: [], script: [] };   // conversation sent to the server per mode: {role, content}
let mode = 'rules', scriptId = null, busy = false;

document.body.classList.add('has-chat');
document.body.insertAdjacentHTML('beforeend', `
<button class="cfab" type="button" aria-label="打开规则助手"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 2.4 1.3 4.6 3.4 6.1L4.6 21l4.3-2.4c1 .3 2 .4 3.1.4 5.5 0 10-3.6 10-8s-4.5-8-10-8zm-4 9.3a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6z"/></svg><span>规则</span></button>
<div class="cpanel hidden" role="dialog" aria-label="规则助手">
  <div class="chd"><span class="cav">规</span><div><b></b><span><i class="con"></i><em style="font-style:normal"></em></span></div><button class="cx" type="button" aria-label="关闭">×</button></div>
  <div class="cmodes hidden" style="display:flex;gap:6px;padding:8px 10px 0"><button type="button" class="chip" data-m="rules" style="height:32px">规则问答</button><button type="button" class="chip" data-m="script" style="height:32px">本剧本问答</button></div>
  <div class="clog"></div>
  <form class="cin"><textarea rows="1" maxlength="500" enterkeyhint="send"></textarea><button type="submit" aria-label="发送"><svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.1 2-12.1 2z"/></svg></button></form>
  <div class="cfoot">AI 回答仅供参考，以官方规则书为准</div>
</div>`);

const $c = s => document.querySelector(s);
const fab = $c('.cfab'), panel = $c('.cpanel'), log = $c('.clog'), form = $c('.cin'), box = form.querySelector('textarea'), sendBtn = form.querySelector('button');
const open = on => { panel.classList.toggle('hidden', !on); fab.classList.toggle('hidden', on); if (on) box.focus(); };
fab.onclick = () => open(true);
// The teach page opens the panel and asks a question in one tap (always the rules mode, which knows no script).
window.askRules = q => { if (mode !== 'rules') { mode = 'rules'; paint(); } open(true); ask(q); };
$c('.cx').onclick = () => open(false);
$c('.cmodes').onclick = e => { const b = e.target.closest('[data-m]'); if (b && !busy) { mode = b.dataset.m; paint(); } };
form.onsubmit = e => { e.preventDefault(); ask(box.value); };
box.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(box.value); } };
log.onclick = e => { const b = e.target.closest('.csug button'); if (b) ask(b.textContent); };

// Redraw the panel for the current mode (the conversation of each mode is kept).
function paint() {
  const m = MODES[mode];
  $c('.chd b').textContent = m.title; $c('.chd em').textContent = m.sub;
  const av = $c('.chd .cav'); av.textContent = m.av; av.classList.toggle('gold', m.gold);
  fab.classList.toggle('mmchat', !!scriptId);
  fab.querySelector('span').textContent = scriptId ? '问答' : '规则';
  $c('.cmodes').classList.toggle('hidden', !scriptId);
  for (const b of $c('.cmodes').children) b.classList.toggle('on', b.dataset.m === mode);
  box.placeholder = m.ph;
  log.innerHTML = `<div class="cwel"><img src="img/${mode === 'script' ? 'chat-script' : 'chat'}.jpg" alt=""><div><b>${m.welcome[0]}</b><span>${m.welcome[1]}</span></div></div>`
    + (convo[mode].length ? '' : `<div class="csug"><em>大家常问</em>${m.sug.map(q => `<button type="button">${q}</button>`).join('')}</div>`)
    + convo[mode].map(x => row(x.role === 'user' ? 'u' : 'a', x.role === 'user' ? fmt(x.content) : answer(x.content, x.web))).join('');
  log.scrollTop = log.scrollHeight;
}
// An answer from the web is labelled as unchecked by this site, with its sources under it.
const answer = (text, web) => web?.length
  ? `<div class="cweb">本站资料没有这一条，以下来自网上讨论，<b>本站未核对</b>，请自行判断</div>${fmt(text)}<div class="csrc">来源：${web.map((w, i) => `<a href="${esc(w.url)}" target="_blank" rel="noopener">[${i + 1}] ${esc(w.title)}<i>${esc(w.site)}</i></a>`).join('')}</div>`
  : fmt(text);
const row = (cls, html) => `<div class="cr ${cls}">${cls === 'a' ? `<span class="cav sm${MODES[mode].gold ? ' gold' : ''}">${MODES[mode].av}</span>` : ''}<div class="cm ${cls}">${html}</div></div>`;
function bubble(cls, html) {
  log.insertAdjacentHTML('beforeend', row(cls, html));
  log.scrollTop = log.scrollHeight;
  return log.lastElementChild.lastElementChild;
}

// app.js tells us when the private view has a script (and when it doesn't any more).
function syncScript() {
  const sid = window.tlChatScript || null;
  if (sid === scriptId) return;
  if (scriptId !== sid) convo.script = [];
  scriptId = sid;
  if (!scriptId) mode = 'rules';
  paint();
}
window.addEventListener('tlchat', syncScript);
syncScript(); paint();

async function ask(q) {
  q = q.trim();
  if (!q || busy) return;
  const m = mode, msgs = convo[m];
  busy = true; sendBtn.disabled = true; box.value = '';
  log.querySelector('.csug')?.remove();
  bubble('u', fmt(q));
  msgs.push({ role: 'user', content: q });
  const out = bubble('a', '<i class="cdots"><b></b><b></b><b></b></i>');
  let text = '', fb = null, web = null;   // web: sources when the answer comes from a web search
  const t0 = Date.now();
  // When DeepSeek is overloaded it queues the request and sends nothing; stop waiting if no text in 30 s.
  const ctl = new AbortController();
  let timer = setTimeout(() => ctl.abort(), 30000);
  try {
    // the server keeps only the last 10 and rejects over 20; only the answers' text goes back, not labels or sources
    const body = { messages: msgs.slice(-10).map(x => ({ role: x.role, content: x.content })) };
    if (m === 'script' && scriptId) body.script = scriptId;
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `出错了（${r.status}）`);
    fb = r.headers.get('x-chat-fallback');   // a backup model answered (only for the error report below)
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        const j = JSON.parse(data);
        if (j.error) throw new Error(j.error);
        if (j.reset) { text = ''; fb = j.reset; out.innerHTML = '<i class="cdots"><b></b><b></b><b></b></i>'; continue; }   // the model stalled; the next one starts over
        if (j.searching) {   // not in this site's notes: the server is searching the web, which takes a few more seconds
          clearTimeout(timer); timer = setTimeout(() => ctl.abort(), 30000); text = '';   // drop anything shown before the search
          out.innerHTML = '<span class="cwait">本站资料里没有，正在联网查找…</span><i class="cdots"><b></b><b></b><b></b></i>'; continue;
        }
        if (j.web) { web = j.web; continue; }
        const piece = j.choices?.[0]?.delta?.content;
        if (piece) { clearTimeout(timer); text += piece; out.innerHTML = answer(text, web); log.scrollTop = log.scrollHeight; }
      }
    }
    if (!text) throw new Error('没有收到回答，请再问一次');
    msgs.push(web?.length ? { role: 'assistant', content: text, web } : { role: 'assistant', content: text });
  } catch (e) {
    msgs.pop();   // drop the unanswered question so the next request stays well formed
    out.classList.add('err');
    const net = NET_ERRS.includes(e.message);
    out.innerHTML = (text ? fmt(text) + '<br>' : '') + esc(ctl.signal.aborted ? 'AI 服务器正忙，30 秒还没开始回答，请过一两分钟再问'
      : net ? `网络连接失败，请检查网络后再试（${e.name}: ${e.message}）` : e.message);
    // Dropped connections are hard to see from the server: report what the page saw to the server log.
    if (net) navigator.sendBeacon?.('/api/chat-log', JSON.stringify({ err: `${e.name}: ${e.message}`, got: text.length, ms: Date.now() - t0, fb }));
  }
  clearTimeout(timer);
  busy = false; sendBtn.disabled = false;
}
