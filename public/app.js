import { PHASES, TOKENS, ONCE, FLAGS, reminders, loopEndChecks, roleOf, scriptOf, maxLoops, incPara, extraOf, forbidden,
  LOCS, LOC_ZH, CHARS, ROLES, PLOTS, INCIDENTS, SETS, SCRIPT } from './logic.js';
import { SCRIPTS } from './data.js';
import { publicSheet, pubSheetOf, privateSheet, notesBlock, charCard, roleCard, setRef } from './views.js';
import { initBot, botPage, botSheet, botClick, botChange, botCardsOn, botRejected, vboard, CREDIT } from './botui.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};
const ZH = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const LV = { must: '强制', loss: '可判负', may: '任意', info: '提示' };
// Groups of the reminder list, in the order the rules resolve them.
const GROUPS = [['must', '必须结算', '条件满足，规则不让你选'], ['loss', '可以让主人公失败', '任意能力，用不用由你决定'], ['may', '可以使用', '任意能力和每轮回 1 次的牌'], ['info', '留意', '']];
// One line on what happens in each phase.
const PHASE_TIP = {
  dayStart: '有角色今天登场就放上版图，确认今天是不是最后一天',
  mmCards: '你从手牌选 3 张，背面朝上放在 3 个不同的角色或版图上',
  proCards: '队长先出，每名主人公各暗置 1 张',
  resolve: '翻开 6 张牌，先结算移动，再结算其他牌',
  mmAbility: '使用身份和规则给你的能力，每个能力各用 1 次',
  gwAbility: '主人公宣言友好能力，你决定结算还是拒绝',
  incident: '判定今天的事件是否发生，发生就结算效果',
  leader: '队长卡交给左手边的主人公',
  dayEnd: '先结算强制能力，再决定要不要用任意能力'
};

const qs = new URLSearchParams(location.search);
let code = cleanCode(qs.get('r'));
const viewOnly = qs.get('v') === '1';   // the Mastermind's own phone showing the public view (e.g. on a projector)
// A Mastermind link for another device carries the key in the fragment (#k=…), which never reaches the server logs.
{ const k = new URLSearchParams(location.hash.slice(1)).get('k'); if (code && /^[0-9a-f]{32}$/.test(k || '')) { remember(code, k); history.replaceState(null, '', location.pathname + location.search); } }

let S = null, role = null, noRoom = false, online = false, ws = null, queue = [], retry = 0;
const ui = { tab: 'game', sheet: null, err: '', busy: false, all: false, place: {}, saving: false, fx: {}, rv: null, choose: false, toTop: false };   // choose: script list shown again; toTop: scroll up after picking   // rv: rating form (reviewCard)

function cleanCode(v) { const c = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); return c.length === 4 ? c : null; }
// Rooms where this phone is the Mastermind: [{ code, key, t }], newest first.
function mine() { try { const v = JSON.parse(store.get('tl-mine')); if (Array.isArray(v)) return v.filter(r => r && cleanCode(r.code) && typeof r.key === 'string'); } catch {} return []; }
function remember(c, key) { store.set('tl-mine', JSON.stringify([{ code: c, key, t: Date.now() }, ...mine().filter(r => r.code !== c)].slice(0, 12))); }
const keyOf = c => mine().find(r => r.code === c)?.key || null;
function forget(c) { store.set('tl-mine', JSON.stringify(mine().filter(r => r.code !== c))); }

/* ---------- connection ---------- */
function connect() {
  if (!code) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/room/${code}/ws`);
  ws.onopen = () => {
    retry = 0; online = true;
    const k = keyOf(code);
    if (k && !viewOnly) ws.send(JSON.stringify({ auth: k }));
    queue.splice(0).forEach(m => ws.send(m)); render();
  };
  ws.onmessage = e => {
    if (e.data === 'pong') return;
    const m = JSON.parse(e.data);
    if (m.type === 'state') { S = m.state; role = m.role; render(); }
    else if (m.type === 'error' && m.error === 'noroom') { noRoom = true; forget(code); ws.close(); render(); }
    else if (m.type === 'error' && m.error === 'rejected') botRejected(ui, m);
    else if (m.type === 'error' && m.error === 'badkey') toast('剧作家密钥不对，现在是公开视图');
  };
  ws.onclose = () => { online = false; render(); if (!noRoom && code) setTimeout(connect, Math.min(5000, 400 * 2 ** retry++)); };
}
setInterval(() => { if (ws && ws.readyState === 1) ws.send('ping'); }, 25000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && code && !noRoom && (!ws || ws.readyState > 1)) { retry = 0; connect(); } });
function sendRaw(o) { const m = JSON.stringify(o); if (ws && ws.readyState === 1) ws.send(m); else queue.push(m); }
const send = action => sendRaw({ action });
function toast(t) { const el = $('#toast'); el.innerHTML = `<div class="toast">${esc(t)}</div>`; clearTimeout(toast.t); toast.t = setTimeout(() => el.innerHTML = '', 2400); }

/* ---------- render (DOM morph keeps focus and typed text) ---------- */
function morph(a, b) {
  const ac = [...a.childNodes], bc = [...b.childNodes];
  bc.forEach((y, i) => {
    const x = ac[i];
    if (!x) { a.appendChild(y); return; }
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName || (x.nodeType === 1 && x.getAttribute('data-k') !== y.getAttribute('data-k'))) { a.replaceChild(y, x); return; }
    if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; return; }
    const keep = n => n === 'open' && x.tagName === 'DETAILS';   // expanded or collapsed is the reader's choice
    for (const at of [...x.attributes]) if (!y.hasAttribute(at.name) && !keep(at.name)) x.removeAttribute(at.name);
    for (const at of [...y.attributes]) if (x.getAttribute(at.name) !== at.value && !keep(at.name)) x.setAttribute(at.name, at.value);
    if (x.tagName === 'INPUT' || x.tagName === 'TEXTAREA') { if (x !== document.activeElement && x.type !== 'checkbox') x.value = x.tagName === 'TEXTAREA' ? y.value : y.getAttribute('value') ?? ''; if (x.type === 'checkbox') x.checked = y.hasAttribute('checked'); return; }
    if ('disabled' in x) x.disabled = y.hasAttribute('disabled');
    morph(x, y);
  });
  while (a.childNodes.length > bc.length) a.removeChild(a.lastChild);
}
function render() {
  const t = document.createElement('div');
  t.innerHTML = view();
  morph($('#app'), t);
  const sh = document.createElement('div');
  sh.innerHTML = ui.sheet && S ? sheetView() : '';
  morph($('#sheet'), sh);   // an open sheet keeps its scroll position when the room updates
  document.body.classList.toggle('has-dock', !!$('.dock'));
  if (ui.toTop && (ui.choose || S?.sid)) { ui.toTop = false; window.scrollTo(0, 0); }
  // keep the current phase in view on the phase strip
  const strip = $('.phases'), on = strip?.querySelector('.on');
  if (on && render.ph !== `${S.loop}-${S.day}-${S.ph}`) { render.ph = `${S.loop}-${S.day}-${S.ph}`; strip.scrollLeft = on.offsetLeft - strip.clientWidth / 2 + on.offsetWidth / 2; }
  // The script Q&A in the chat panel exists only on the Mastermind's private view.
  const sid = role === 'mm' && S?.sid ? S.sid : null;
  if (window.tlChatScript !== sid) { window.tlChatScript = sid; window.dispatchEvent(new Event('tlchat')); }
}

function view() {
  if (!code) return landing();
  if (noRoom) return `${hero()}<div class="wrap"><h2 class="h"><span>房间 ${code} 不存在</span></h2><p class="note">房间码可能输错了，或者房间已失效。</p><button class="btn" data-act="leave">返回首页</button></div>`;
  if (!S) return `${hero()}<div class="wrap"><h2 class="h"><span>正在连接房间 ${code}…</span></h2></div>`;
  return bar() + `<div class="wrap" data-k="${S.pv ? 'bot' : role}-${S.stage}">` + (role === 'mm' ? mmView() : S.pv ? botPage(S, ui) : publicPage()) + '</div>';
}
const hero = () => `<div class="hero" data-k="hero"><button class="nav-back" data-act="leave" data-html2canvas-ignore>‹ 首页</button><div class="en">TRAGEDY LOOPER</div><h1>惨剧轮回剧作家助手</h1><div class="orn"></div></div><div class="band"></div>`;
const bar = () => `<div class="bar" data-k="bar"><button class="nav-back" data-act="leave" data-html2canvas-ignore>‹ 首页</button><span class="ttl">惨剧轮回</span>
  <span class="who-tag ${role === 'mm' ? 'mm' : 'view'}">${role === 'mm' ? '剧作家·私密' : S?.pv ? '人机模式' : '公开视图'}</span>
  <button class="room" data-act="share"><small>房间</small>${code}</button><span class="conn ${online ? 'on' : ''}" title="${online ? '已连接' : '重新连接中'}"></span></div>`;

function landing() {
  const my = mine();
  return `<div class="hero-art cover" data-k="hero"><a class="nav-back" href="https://boardgame.leisurecat.cloud" data-html2canvas-ignore>‹ 全部游戏</a><a class="nav-back rate-nav" href="https://boardgame.leisurecat.cloud/?rate=tl&back=${encodeURIComponent(location.href)}" data-html2canvas-ignore>★ 写评价</a><img src="img/hero.jpg" alt=""><div class="ht">
      <div class="hz">惨剧轮回剧作家助手</div><div class="hs">设好剧本 · 算清惨剧</div></div></div>
    <div class="wrap" data-k="landing">
    <div class="card start">
      <button class="btn" data-act="create" ${ui.busy ? 'disabled' : ''}>我当剧作家：创建房间</button>
      <button class="btn navy" data-act="createbot" ${ui.busy ? 'disabled' : ''}>人机模式：机器人当剧作家</button>
      <div class="or">主人公输入房间码，查看公开信息</div>
      <div class="join"><input id="joinCode" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="房间码"><button class="btn navy" data-act="join">进入</button></div>
      ${ui.err ? `<div class="err">${esc(ui.err)}</div>` : ''}
    </div>
    <a class="card teachgo" href="teach"><span class="tg-i">讲</span><span><b>第一次玩？5 分钟讲规则</b>照着念就能开局，不懂的词点一下</span><i>›</i></a>
    <div class="tiles">
      <a class="card tile" href="scripts"><span class="ti">本</span><span><b>剧本库</b>剧作家专用·有剧透</span></a>
      <a class="card tile" href="guide"><span class="ti"><img src="img/guide.jpg" alt=""></span><span><b>规则介绍</b>流程 + 常见问题</span></a>
      <a class="card tile wide" href="history"><span class="ti">录</span><span><b>往期对局</b>本机当过剧作家的对局存档</span></a>
    </div>
    <h2 class="h"><span>我的房间</span><small>本机当剧作家的房间</small></h2>
    <div class="list">${my.length ? my.map(r => `<button class="card lobby" data-act="rejoin" data-code="${r.code}" data-k="lb-${r.code}">
        <span class="lc">${r.code}</span><span class="lp">${r.key ? '剧作家' : '人机模式'}</span><span class="ls">${ago(r.t)}</span></button>`).join('') : '<div class="empty">还没有房间</div>'}</div>
    <footer>非官方玩家工具 · 规则依据《惨剧RoopeR 5th》官方资料<br>封面为官方盒封面（Z-Man Games 英文版）的高清化版本，版权归原权利人<br>${CREDIT}</footer></div>`;
}
function ago(t) { const m = Math.floor((Date.now() - t) / 60000); return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.floor(m / 60)} 小时前` : `${Math.floor(m / 1440)} 天前`; }

/* ---------- shared pieces ---------- */
const tk = (k, n, extra = '') => `<span class="tk ${k}${n ? '' : ' z'}${extra}">${n}</span>`;
const tokRow = (c, id) => `<span class="toks">${c.gd ? `<span class="tk" style="background:#cdb07a">护</span>` : ''}${tk('g', c.g)}${tk('p', c.p, id && c.p >= CHARS[id].limit && !c.dead ? ' lim' : '')}${tk('i', c.i)}</span>`;
const LOC_IMG = { hospital: 'img/loc-hospital.jpg', shrine: 'img/loc-shrine.jpg', city: 'img/loc-city.jpg', school: 'img/loc-school.jpg' };

// The four areas, like the real board. priv: show roles and make things tappable.
function board(st, priv) {
  return `<div class="boardg">${LOCS.map(l => {
    const here = Object.keys(st.ch).filter(id => st.ch[id].loc === l);
    return `<div class="loc" data-k="loc-${l}"><img class="bgi" src="${LOC_IMG[l]}" alt="">
      <div class="lh"><b>${LOC_ZH[l]}</b>${priv ? `<button data-act="bd" data-loc="${l}" aria-label="${LOC_ZH[l]}的密谋">` : ''}<span class="bdI">密谋 ${tk('i', st.bd[l])}</span>${priv ? '</button>' : ''}</div>
      <div class="cs">${here.map(id => {
        const c = st.ch[id], r = priv ? ROLES[roleOf(S, id)]?.name : st.rev?.role?.[id];
        return `<button class="cc${c.dead ? ' dead' : ''}" data-act="${priv ? 'char' : 'cinfo'}" data-id="${id}" data-k="cc-${id}">
          <span class="cn">${CHARS[id].name}${r ? `<em>${esc(r)}${priv && st.rev?.role?.[id] ? ' · 已公开' : ''}</em>` : ''}</span>${tokRow(c, id)}</button>`;
      }).join('')}</div></div>`;
  }).join('')}</div>`;
}
function statusStrip(st, loops, days) {
  const pips = Array.from({ length: loops }, (_, i) => `<i class="${i + 1 < st.loop ? 'done' : i + 1 === st.loop ? 'cur' : ''}"></i>`).join('');
  return `<div class="status"><span class="medal">${ZH[st.loop] ?? st.loop}<br>轮</span><div><div class="t">第<b>${st.loop}</b>轮回 · 第<b>${st.day}</b>/${days}天</div>
    <div class="s">${st.stage === 'play' ? `阶段：${PHASES[st.ph].n}` : st.stage === 'loopEnd' ? '本轮回已结束' : st.stage === 'final' ? '最终决战' : '游戏结束'}</div></div><span class="pips">${pips}</span></div>`;
}
function phaseStrip(ph, tappable) {
  return `<div class="phases">${PHASES.map((p, i) => `<button ${tappable ? `data-act="ph" data-to="${i}"` : 'disabled'} class="${i === ph ? 'on' : i < ph ? 'done' : ''}">${i + 1} ${p.n}</button>`).join('')}</div>`;
}
/* ---------- Mastermind ---------- */
function mmView() {
  if (S.stage === 'setup') return setupView();
  const sc = scriptOf(S);
  const tabs = [['game', S.stage === 'over' ? '结算' : '对局'], ['script', '剧本'], ['ref', '速查'], ['log', '记录']];
  const tab = tabs.some(t => t[0] === ui.tab) ? ui.tab : 'game';
  const head = `<div class="tabs">${tabs.map(([k, n]) => `<button class="tab${tab === k ? ' on' : ''}" data-act="tab" data-tab="${k}">${n}</button>`).join('')}</div>`;
  let body;
  if (tab === 'script') body = scriptTab(sc);
  else if (tab === 'ref') body = refTab(sc);
  else if (tab === 'log') body = logTab(sc);
  else body = S.stage === 'play' ? playView(sc) : S.stage === 'loopEnd' ? loopEndView(sc) : S.stage === 'final' ? finalView(sc) : overView(sc);
  return head + body;
}

function setupView() {
  const sc = S.sid ? SCRIPT[S.sid] : null;
  if (!sc || ui.choose) return `<p class="note secret">这是<b>剧作家私密视图</b>，剧本内容不要让主人公看到。主人公用房间码或二维码进入的是公开视图。</p>
    <h2 class="h"><span>选剧本</span><small>基础版 10 个官方剧本</small></h2>
    ${['fs', 'btx'].map(set => `<div class="fq-cat" style="margin-top:12px">${SETS[set].name} · ${SETS[set].zh}</div>
      <div class="list">${SCRIPTS.filter(s => s.set === set).map(s => `<button class="card sc-item big${S.sid === s.id ? ' cur' : ''}" data-act="pick" data-sid="${s.id}" data-k="pk-${s.id}">
        <span class="no">${s.no}</span><span class="nm"><b>${esc(s.zh)}</b><span>${s.days} 天 · ${s.opts.map(o => `${o[0]} 轮回`).join(' / ')}${S.sid === s.id ? ' · <i>当前选择</i>' : ''}</span></span>
        <span class="df"><b>${s.opts.map(o => o[1]).join('/')}</b>难度</span><span class="go">›</span></button>`).join('')}</div>`).join('')}
    ${sc ? '<button class="btn ghost" data-act="pick" data-sid="' + sc.id + '">不换了，回到设置</button>' : ''}
    ${inviteCard()}`;
  const hench = Object.keys(sc.cast).filter(id => CHARS[id].start === null);
  const ready = hench.every(id => ui.place[id]);
  return `<div class="card pick-hero" data-k="hero-${sc.id}"><div class="ph-top"><span class="ph-no">${sc.no}</span><span class="ph-set">${SETS[sc.set].name}</span><button class="ph-chg" data-act="choose">换剧本</button></div>
      <b>${esc(sc.zh)}</b><span class="ph-sub">${esc(sc.jp)} · ${esc(sc.en)}</span>
      <div class="ph-stats"><span><i>${sc.days}</i>天</span><span><i>${sc.opts.map(o => o[0]).join('/')}</i>轮回</span><span><i>${sc.opts.map(o => o[1]).join('/')}</i>难度</span></div></div>
    <p class="note secret">这是<b>剧作家私密视图</b>，剧本内容不要让主人公看到。</p>
    <h2 class="h"><span>1 轮回数</span></h2>
    <div class="chips">${sc.opts.map(([l, d], i) => `<button class="chip${S.opt === i ? ' on' : ''}" data-act="opt" data-i="${i}">${l} 轮回 · 难度 ${d}</button>`).join('')}</div>
    <h2 class="h"><span>2 摆放清单</span><small>照着摆，勾掉做完的</small></h2>
    ${checklist(sc)}
    <h2 class="h"><span>3 两张信息卡</span></h2>
    ${publicSheet(pubSheetOf(sc, S.opt))}
    <div style="height:8px"></div>${privateSheet(sc)}
    <details class="card" style="margin-top:10px"><summary class="route" style="cursor:pointer"><b>核心机制与路线建议（点开）</b></summary><div style="padding:0 0 10px">${notesBlock(sc.id)}</div></details>
    ${inviteCard()}
    ${hench.length ? `<h2 class="h"><span>手下的初始区域</span><small>每轮回由剧作家决定</small></h2>${hench.map(id => placePicker(id)).join('')}` : ''}
    <button class="btn" data-act="start" ${ready ? '' : 'disabled'}>开始第 1 轮回</button>
    ${ready ? '' : '<div class="err">先选手下的初始区域</div>'}`;
}
const placePicker = id => `<div class="card" style="padding:8px 10px;margin-top:6px"><div style="font-size:13px;margin-bottom:6px">${CHARS[id].name}</div>
  <div class="grid4">${LOCS.map(l => `<button class="${ui.place[id] === l ? 'on' : ''}" data-act="place" data-id="${id}" data-loc="${l}">${LOC_ZH[l]}</button>`).join('')}</div></div>`;

function checklist(sc) {
  const set = SETS[sc.set], opt = sc.opts[S.opt], done = JSON.parse(store.get(`tl-check-${code}`) || '{}');
  const cast = Object.keys(sc.cast).map(id => { const ex = extraOf(sc, id), st = CHARS[id].start;
    return `${CHARS[id].name}（${ex.enterLoop ? `第 ${ex.enterLoop} 轮回才登场，${LOC_ZH[st]}` : ex.enterDay ? `第 ${ex.enterDay} 天才登场，${LOC_ZH[st]}` : st ? LOC_ZH[st] : '初始区域自选'}）`; }).join('、');
  const items = [
    ['摆出模组速查表', `「${set.name}」速查表放在大家都看得到的地方`],
    ['写公开信息卡，交给主人公', `模组 ${set.name}、${opt[0]} 轮回、每轮回 ${sc.days} 天；事件日程：${sc.incidents.map(([d, k]) => `第${d}天${INCIDENTS[k].name}`).join('、')}${sc.special.length ? `；特殊规则：${sc.special.join('；')}` : ''}`],
    ['写非公开信息卡，自己收好', `规则Y ${PLOTS[sc.y].name}，规则X ${sc.x.map(x => PLOTS[x].name).join('、')}，各角色身份，事件当事人`],
    ['摆 4 块版图', '左上医院、右上神社、左下都市、右下学校'],
    ['放角色卡到初始区域', cast],
    ...Object.entries(sc.extra || {}).filter(([, ex]) => ex.turf).map(([id, ex]) => [`放${CHARS[id].name}的领地标志`, `领地是${LOC_ZH[ex.turf]}`]),
    ['放指示物', `轮回指示物放在 ${opt[0]}，日数指示物放在第 1 天，事件指示物放到各事件日`],
    ['剧作家手牌 10 张', `移动↑↓、移动←→、移动斜向（每轮回1次）、禁止友好、不安+1 ×2、不安−1、禁止不安、密谋+1、密谋+2（每轮回1次）${sc.special.length ? `。特殊规则：${sc.special.join('；')}` : ''}`],
    ['每名主人公 8 张手牌', '移动↑↓、移动←→、移动禁止、友好+1、友好+2、不安+1、不安−1、禁止密谋；移动禁止、友好+2、不安−1 每轮回限 1 次'],
    ['决定首任队长', '把队长卡交给他；时之缝隙里主人公可以相谈']
  ];
  const n = items.filter((x, i) => done[i]).length;
  return `<div class="card steps"><div class="steps-top"><span>已完成 ${n}/${items.length}</span><div class="steps-bar"><i style="width:${Math.round(n / items.length * 100)}%"></i></div></div>
    ${items.map(([h, x], i) => `<label class="step${done[i] ? ' done' : ''}" data-k="ck-${sc.id}-${i}"><input type="checkbox" data-act="check" data-i="${i}" ${done[i] ? 'checked' : ''}><span class="sn">${done[i] ? '✓' : i + 1}</span><span class="st"><b>${esc(h)}</b><span>${esc(x)}</span></span></label>`).join('')}</div>`;
}

function inviteCard() {
  return `<h2 class="h"><span>邀请主人公</span><small>扫码只能看公开信息</small></h2>
    <div class="card qrbox"><img alt="公开视图二维码" src="${qrData(publicUrl())}"><p><b>${code}</b>主人公扫码或在首页输入房间码，进入<b style="display:inline;font:inherit;color:var(--c-p);letter-spacing:0">公开视图</b>：只看公开信息卡、版图和指示物。<br><button class="btn ghost sm" data-act="share" style="width:auto;padding:0 12px;margin-top:6px">复制链接</button></p></div>`;
}
const publicUrl = () => `${location.origin}/?r=${code}`;
function qrData(text) {
  if (!window.qrcode) return '';
  const q = window.qrcode(0, 'M'); q.addData(text); q.make();
  return q.createDataURL(5, 2);
}

function playView(sc) {
  const rem = reminders(S), cur = PHASES[S.ph], last = S.day === sc.days;
  // 必须结算 left in this phase: the button asks first instead of moving on (easy to miss at the table)
  const must = (rem[cur.k] || []).filter(r => r.level === 'must').length, g = must ? ` data-guard="${must}"` : '';
  const next = S.ph < PHASES.length - 1 ? `<button class="btn" data-act="phnext"${g}>下一阶段：${PHASES[S.ph + 1].n}</button>`
    : last ? `<button class="btn" data-act="endloop"${g}>结束本轮回</button>` : `<button class="btn" data-act="day"${g}>进入第 ${S.day + 1} 天</button>`;
  const body = ui.all
    ? PHASES.map((p, i) => (rem[p.k] || []).length ? `<div class="pc-sub"><span>${i + 1}</span>${p.n}</div>${remList(rem[p.k])}` : '').join('')
    : remList(rem[cur.k] || []) || '<div class="pc-empty">这一阶段没有要你结算的东西，直接进入下一阶段。</div>';
  return `${statusStrip(S, maxLoops(S), sc.days)}${phaseStrip(S.ph, true)}
    <div class="card pc" data-k="pc">
      <div class="pc-head"><span class="pc-no">${S.ph + 1}<small>/9</small></span><div><b>${ui.all ? '今天的全部阶段' : cur.n}</b><em>${ui.all ? '按阶段列出今天要结算的东西' : PHASE_TIP[cur.k]}</em></div>
        <button class="pc-all" data-act="all">${ui.all ? '只看当前' : '看全天'}</button></div>
      ${last && !ui.all && cur.k === 'dayEnd' ? '<div class="pc-last">今天是本轮回最后一天：回合结束后结束本轮回，检查失败条件</div>' : ''}
      <div class="pc-body">${body}</div>
    </div>
    ${board(S, true)}
    <div class="btns more"><button class="btn ghost" data-act="lose">记录失败/死亡</button><button class="btn ghost" data-act="note">记一笔</button><button class="btn ghost" data-act="publicview">公开视图</button></div>
    <div class="dock" data-k="dock"><div class="dock-in"><button class="btn ghost" data-act="undo" ${S.canUndo ? '' : 'disabled'} aria-label="撤销上一步">撤销</button>${next}</div></div>`;
}
function remItem(r) {
  const a = r.act;
  let btn = '';
  if (a?.t === 'inc') btn = `<button data-act="incsheet" data-k="${a.k}">${a.meet ? '结算事件' : '记录：未发生'}</button>`;
  else if (a?.t === 'ch') btn = `<button data-act="kill" data-id="${a.id}" data-why="${esc(a.why)}">${r.level === 'must' ? '结算死亡' : '使用这个能力'}</button>`;
  else if (a?.t === 'lose') btn = `<button data-act="lose" data-why="${esc(a.why)}" data-death="${a.death ? 1 : ''}">使用这个能力</button>`;
  else if (a?.t === 'once') btn = `<button data-act="once" data-k="${a.k}">${S.once[a.k] ? '改回未用' : '标记已用'}</button>`;
  else if (a?.t === 'flag') btn = `<button data-act="flag" data-k="${a.k}" data-on="${a.on ? 1 : ''}">${a.on ? '标记生效' : '取消'}</button>`;
  // "主谋（医生，医院）：给同区域…" → the part before the first colon becomes the item's title
  const m = r.text.match(/^(.{2,26}?)[：:](.+)$/s);
  const body = m ? `<b>${esc(m[1])}</b><span>${esc(m[2].replace(/^——/, ''))}</span>` : `<span>${esc(r.text)}</span>`;
  return `<div class="ri ${r.level}"><div class="rt">${body}</div>${btn ? `<div class="ra">${btn}</div>` : ''}</div>`;
}
function remList(items) {
  return GROUPS.map(([lv, name, sub]) => {
    const g = items.filter(r => r.level === lv);
    return g.length ? `<div class="rg ${lv}"><div class="rh"><i></i>${name}<small>${sub}</small></div>${g.map(remItem).join('')}</div>` : '';
  }).join('');
}

function loopEndView(sc) {
  const e = S.end, lastLoop = S.loop >= maxLoops(S), set = SETS[sc.set];
  const next = S.loop + 1;
  const auto = [];
  for (const id of Object.keys(sc.cast)) if (sc.cast[id] === 'friend' && S.rev.role[id]) auto.push(`${CHARS[id].name}：身份公开过的亲友，开局 +1 友好`);
  if (sc.x.includes('threadsFate') || sc.y === 'threadsFate') for (const id of S.lastGw) auto.push(`因果线：${CHARS[id].name} 上轮回结束时有友好，开局 +2 不安`);
  for (const id of Object.keys(sc.cast)) if (CHARS[id].loopShrine) auto.push(`${CHARS[id].name}的特性：神社 +${CHARS[id].loopShrine} 密谋`);
  for (const [id, ex] of Object.entries(sc.extra || {})) if (ex.enterLoop === next) auto.push(`${CHARS[id].name}第 ${next} 轮回登场`);
  const friendsDead = Object.keys(sc.cast).filter(id => sc.cast[id] === 'friend' && S.ch[id]?.dead);
  const hench = Object.keys(sc.cast).filter(id => CHARS[id].start === null);
  const ready = hench.every(id => ui.place[id]);
  let action;
  if (!e.lost) action = `<button class="btn" data-act="next">主人公获胜：进入结算</button>`;
  else if (!lastLoop) action = `${hench.length ? `<h2 class="h"><span>第 ${next} 轮回：手下的初始区域</span></h2>${hench.map(placePicker).join('')}` : ''}
    <button class="btn" data-act="next" ${ready ? '' : 'disabled'}>开始第 ${next} 轮回</button>`;
  else action = `<button class="btn" data-act="next">${set.finalGuess ? '最后一个轮回结束：进入最终决战' : '最后一个轮回结束：剧作家获胜'}</button>`;
  return `${statusStrip(S, maxLoops(S), sc.days)}
    <div class="mvp"><div class="crown">第 ${S.loop} 轮回结束</div><div class="nm">${e.lost ? '主人公失败' : '主人公获胜'}</div>
      <div class="fg">${e.lost ? `第 ${e.day} 天：${e.why.map(esc).join('；')}` : '本轮回没有满足任何失败条件，主人公也没有死亡'}</div></div>
    <p class="note">对主人公只说“你们失败了”，不必说是哪一条。${friendsDead.length ? `<b>亲友死亡必须公开身份：${friendsDead.map(id => CHARS[id].name).join('、')}是亲友。</b>` : ''}</p>
    ${e.lost && !lastLoop ? `<h2 class="h"><span>下一轮回要重置</span></h2>
    <div class="card resets">
      ${[['人', '角色', `全部以存活状态回到初始区域${hench.length ? '，手下的初始区域重新选' : ''}`],
        ['清', '指示物', '移除所有角色和版图上的友好、不安、密谋、护卫'],
        ['日', '日数', '回到第 1 天，轮回指示物下移一格'],
        ['牌', '手牌', '所有人收回手牌，「每轮回限1次」的牌和能力恢复可用'],
        ['效', '持续效果', '「本轮回中」的效果全部结束（军人、医生、手下等）'],
        ['谈', '时之缝隙', '主人公可以相谈']].map(([ic, h, x]) => `<div class="rs"><span>${ic}</span><div><b>${h}</b>${x}</div></div>`).join('')}</div>
    ${auto.length ? `<h2 class="h"><span>轮回开始时自动放置</span><small>本站会自动记上</small></h2><div class="card resets">${auto.map(x => `<div class="rs auto"><span>+</span><div>${esc(x)}</div></div>`).join('')}</div>` : ''}` : ''}
    ${action}
    <button class="btn ghost" data-act="undo" ${S.canUndo ? '' : 'disabled'}>撤销（回到轮回结束前）</button>`;
}

function finalView(sc) {
  return `${statusStrip(S, maxLoops(S), sc.days)}
    <div class="mvp"><div class="crown">最终决战</div><div class="nm">主人公推理身份</div>
      <div class="fg">所有轮回都失败了。先重建盘面：移除全部指示物，所有角色以存活状态回到初始区域。<br>主人公一个一个说出角色的身份（可以相谈），猜错一次剧作家就赢；全部猜对主人公获胜。</div></div>
    <h2 class="h"><span>答案</span><small>只给剧作家对照</small></h2>
    <div class="card"><table class="tb" style="margin:0"><tr><th>角色</th><th>身份</th></tr>${Object.entries(sc.cast).map(([id, r]) => `<tr><td>${CHARS[id].name}</td><td class="r">${ROLES[r].name}</td></tr>`).join('')}</table></div>
    <p class="note">神灵、转校生这类不是一开始就在场的角色要不要猜，规则书没有写明，请和主人公事先说好。</p>
    <div class="btns"><button class="btn navy" data-act="final" data-ok="1">全部猜对：主人公获胜</button><button class="btn" data-act="final" data-ok="">猜错：剧作家获胜</button></div>
    <button class="btn ghost" data-act="undo" ${S.canUndo ? '' : 'disabled'}>撤销</button>`;
}

function overView(sc) {
  const pro = S.result === 'pro';
  return `<div id="shot" style="padding-top:2px">
    <div class="mvp"><div class="crown">TRAGEDY LOOPER · 惨剧轮回</div><div class="nm">${pro ? '主人公获胜' : '剧作家获胜'}</div>
      <div class="fg">${sc.no}「${esc(sc.zh)}」 · ${SETS[sc.set].name} · ${maxLoops(S)} 轮回 × ${sc.days} 天<br>${pro ? (S.finalOk ? '在最终决战中猜对了全部身份' : `在第 ${S.loops.at(-1).n} 轮回避开了惨剧`) : S.finalOk === false ? '最终决战猜错了身份' : '每个轮回都让主人公失败'}</div>
      <div class="pts">${S.loops.length}<small>个轮回</small></div></div>
    <h2 class="h"><span>轮回经过</span></h2>
    <div class="tl">${S.loops.map(l => `<div class="card lp${l.lost ? '' : ' win'}"><h4>第 ${l.n} 轮回<span>${l.lost ? `第 ${l.day} 天失败` : '主人公获胜'}</span></h4>
      <ul>${l.why.map(w => `<li><b style="color:var(--ink)">${esc(w)}</b></li>`).join('')}${l.log.filter(x => x.k === 'note' || /发生：|死亡|登场|复活/.test(x.x)).slice(0, 12).map(x => `<li>第${x.d}天 ${esc(x.x)}</li>`).join('')}</ul></div>`).join('')}
      ${S.finalOk != null ? `<div class="card lp${S.finalOk ? ' win' : ''}"><h4>最终决战<span>${S.finalOk ? '全部猜对' : '猜错'}</span></h4></div>` : ''}</div>
    <h2 class="h"><span>剧本真相</span></h2>${privateSheet(sc)}
    <footer>惨剧轮回剧作家助手 · 房间 ${code}</footer></div>
    <div class="btns" data-html2canvas-ignore><button class="btn navy" data-act="save" ${ui.saving ? 'disabled' : ''}>${ui.saving ? '正在生成…' : '保存结算长图'}</button></div>
    <p class="note" data-html2canvas-ignore>这局已存档，可以在首页「往期对局」查看。结算长图有剧本真相，发给还没玩过这个剧本的人前请注意剧透。</p>
    <div class="btns" data-html2canvas-ignore><button class="btn ghost" data-act="undo" ${S.canUndo ? '' : 'disabled'}>撤销结算</button><button class="btn ghost" data-act="reset">在这个房间再开一局</button></div>
    ${reviewCard()}`;
}

function scriptTab(sc) {
  const rv = S.rev;
  return `${publicSheet(pubSheetOf(sc, S.opt), S.stage === 'play' ? sc.incidents.map((it, k) => S.inc[k] || null) : null)}<div style="height:8px"></div>${privateSheet(sc)}
    <h2 class="h"><span>已向主人公公开</span><small>打开后公开视图会显示</small></h2>
    <p class="note">只在游戏里真的公开了（亲友死亡、巫女/职员/局外人/大人物/教师能力、刑警/神灵查当事人、情报商查规则X）时才打开。亲友死亡在轮回结束时会自动打开。</p>
    <div class="card">${Object.entries(sc.cast).map(([id, r]) => `<label class="check" data-k="rv-r-${id}"><input type="checkbox" data-act="rev" data-kind="role" data-key="${id}" ${rv.role[id] ? 'checked' : ''}><span>${CHARS[id].name}的身份（${ROLES[r].name}）</span></label>`).join('')}</div>
    <div class="card" style="margin-top:6px">${sc.incidents.map(([d, k, c], i) => `<label class="check" data-k="rv-c-${i}"><input type="checkbox" data-act="rev" data-kind="cul" data-key="${i}" ${rv.cul[i] ? 'checked' : ''}><span>第 ${d} 天${INCIDENTS[k].name}的当事人（${CHARS[c].name}）</span></label>`).join('')}</div>
    <div class="card" style="margin-top:6px">${sc.x.map((x, i) => `<label class="check" data-k="rv-x-${i}"><input type="checkbox" data-act="rev" data-kind="x" data-key="${i}" ${rv.x[i] ? 'checked' : ''}><span>规则X：${PLOTS[x].name}</span></label>`).join('')}</div>
    <h2 class="h"><span>剧本笔记</span></h2>${notesBlock(sc.id)}`;
}

// 速查: this script's roles and rules, the characters' cards, and the whole tragedy set.
function refTab(sc) {
  const byRole = {};
  for (const [id, r] of Object.entries(sc.cast)) (byRole[r] ||= []).push(CHARS[id].name);
  const roles = Object.keys(byRole).sort((a, b) => (a === 'person') - (b === 'person'));
  const plot = k => { const p = PLOTS[k]; return `<div class="pref"><b>${p.name}</b>${[p.setup, p.loss, p.ab].filter(Boolean).map(x => `<p>${esc(x)}</p>`).join('') || '<p class="none">没有追加规则</p>'}</div>`; };
  return `<p class="note">点版图上的角色也能看他的身份和能力。</p>
    <h2 class="h"><span>本剧本的规则</span></h2><div class="card ref-sec">${plot(sc.y)}${sc.x.map(plot).join('')}${sc.special.length ? `<div class="pref"><b>特殊规则</b>${sc.special.map(x => `<p>${esc(x)}</p>`).join('')}</div>` : ''}</div>
    <h2 class="h"><span>本剧本的身份</span></h2><div class="card ref-sec">${roles.map(r => roleCard(r, byRole[r].join('、'))).join('')}</div>
    <h2 class="h"><span>登场角色</span><small>卡面信息</small></h2><div class="card ref-sec">${Object.keys(sc.cast).map(id => charCard(id, ROLES[sc.cast[id]].name)).join('')}</div>
    <details class="card ref" style="margin-top:14px"><summary>「${SETS[sc.set].name}」模组速查：全部规则、身份、事件</summary>${setRef(sc.set)}</details>`;
}

function logTab(sc) {
  const cur = S.stage === 'play' ? `<h2 class="h"><span>第 ${S.loop} 轮回</span><small>${S.log.length} 条</small></h2>
    <div class="card log">${S.log.slice().reverse().map(e => `<div class="${e.k === 'note' ? 'note' : ''}"><b>第${e.d}天</b>${esc(e.x)}</div>`).join('') || '<div>还没有记录</div>'}</div>
    <button class="btn ghost" data-act="note">记一笔</button>` : '';
  return `${cur}<h2 class="h"><span>已结束的轮回</span></h2>
    ${S.loops.length ? S.loops.slice().reverse().map(l => `<details class="card fq"><summary>第 ${l.n} 轮回：${l.lost ? `第 ${l.day} 天主人公失败` : '主人公获胜'}</summary>
      <p>${l.why.map(esc).join('；')}</p><div class="log">${l.log.map(e => `<div><b>第${e.d}天</b>${esc(e.x)}</div>`).join('')}</div></details>`).join('') : '<div class="empty">还没有结束的轮回</div>'}`;
}

/* ---------- public view ---------- */
function publicPage() {
  const st = S;
  if (!st.sheet) return `<h2 class="h"><span>剧作家正在准备剧本…</span></h2><p class="note">这是公开视图，只显示桌上公开的信息。</p>`;
  if (st.stage === 'setup') return `<h2 class="h"><span>剧作家正在摆放</span></h2>${publicSheet(st.sheet)}`;
  const rv = st.rev, revItems = [
    ...Object.entries(rv.role).map(([id, r]) => `${CHARS[id].name}：${esc(r)}`),
    ...Object.entries(rv.cul).map(([k, n]) => `第 ${st.sheet.incidents[k].day} 天${esc(st.sheet.incidents[k].name)}的当事人：${esc(n)}`),
    ...rv.x.map(x => `规则X：${esc(x)}`)];
  const res = st.stage === 'over' ? `<div class="mvp"><div class="crown">游戏结束</div><div class="nm">${st.result === 'pro' ? '主人公获胜' : '剧作家获胜'}</div></div>` : '';
  const lend = st.stage === 'loopEnd' ? `<div class="banner"><div><b>第 ${st.loop} 轮回结束</b>：${st.loops.at(-1)?.lost ? '主人公失败' : '主人公获胜'}</div></div>` : st.stage === 'final' ? `<div class="banner"><div><b>最终决战</b>：推理每个角色的身份</div></div>` : '';
  return `${res}${statusStrip(st, st.sheet.loops, st.sheet.days)}${lend}${st.stage === 'play' ? phaseStrip(st.ph, false) : ''}
    ${vboard(st)}
    <h2 class="h"><span>公开信息</span></h2>${publicSheet(st.sheet, st.happened)}
    <h2 class="h"><span>速查</span><small>点版图上的角色看角色卡</small></h2>
    <details class="card ref"><summary>登场角色：不安限度、属性、友好能力</summary><div class="ref-sec">${Object.keys(st.ch).map(id => charCard(id, st.rev?.role?.[id])).join('')}</div></details>
    <details class="card ref" style="margin-top:8px"><summary>「${esc(st.sheet.set)}」模组速查：全部规则、身份、事件</summary>${setRef(Object.keys(SETS).find(k => SETS[k].name === st.sheet.set))}</details>
    <a class="btn ghost" href="guide">规则介绍与常见问题</a>
    ${revItems.length ? `<h2 class="h"><span>已公开</span></h2><div class="card route"><ul class="dots">${revItems.map(x => `<li>${x}</li>`).join('')}</ul></div>` : ''}
    ${st.loops.length ? `<h2 class="h"><span>轮回记录</span></h2><div class="card route"><ul class="dots">${st.loops.map(l => `<li>第 ${l.n} 轮回：${l.lost ? `第 ${l.day} 天主人公失败` : '主人公获胜'}</li>`).join('')}</ul></div>` : ''}
    ${st.stage === 'over' ? reviewCard() : ''}
    <footer>公开视图只显示桌上公开的信息<br>${CREDIT}</footer>`;
}

/* ---------- bottom sheets ---------- */
function sheetView() {
  const s = ui.sheet;
  let body = '';
  if (s.k === 'share') body = shareSheet();
  else if (s.k === 'bseat' || s.k === 'bgw') body = botSheet(S, ui);
  else if (s.k === 'cinfo') body = `<img class="cardbig" src="img/c/ch-${s.id}.webp" alt="${CHARS[s.id].name}的角色卡">${S.pv ? botCardsOn(S, s.id) : ''}${charCard(s.id, S.rev?.role?.[s.id], false)}<button class="btn ghost" data-act="close">关闭</button>`;
  else if (role !== 'mm') { ui.sheet = null; return ''; }
  else if (s.k === 'char') body = charSheet(s.id);
  else if (s.k === 'bd') body = `<h3>${LOC_ZH[s.loc]}的密谋</h3><div class="stp" style="margin-top:12px">${tk('i', S.bd[s.loc])}<b>版图上的密谋</b>
      <button data-act="bdadd" data-loc="${s.loc}" data-d="-1">−</button><span class="n">${S.bd[s.loc]}</span><button data-act="bdadd" data-loc="${s.loc}" data-d="1">+</button></div>
      <button class="btn ghost" data-act="close">完成</button>`;
  else if (s.k === 'inc') body = incSheet(s.i);
  else if (s.k === 'lose') body = `<h3>主人公失败 / 死亡</h3><p class="hint">本轮回立即结束。只在确实发生时记录：剧作家使用了能力，或本站没能自动判定的情况。</p>
      <div class="lbl">原因（只记在私密记录里）</div><input class="pn" id="loseWhy" maxlength="60" value="${esc(s.why || '')}" placeholder="例如：杀手自身 4 枚密谋，主人公死亡">
      <label class="check" style="padding-left:0"><input type="checkbox" id="loseDeath" ${s.death ? 'checked' : ''}><span>这是“主人公死亡”（军人能力生效时不会死）</span></label>
      <div class="btns"><button class="btn ghost" data-act="close">取消</button><button class="btn" data-act="loseok">确认</button></div>`;
  else if (s.k === 'note') body = `<h3>记一笔</h3><p class="hint">只记在剧作家的私密记录里，结算长图会列出来。</p><textarea class="pn" id="noteX" maxlength="120" placeholder="例如：主人公开始怀疑巫女"></textarea>
      <div class="btns"><button class="btn ghost" data-act="close">取消</button><button class="btn" data-act="noteok">记下</button></div>`;
  else if (s.k === 'guard') body = `<h3>还有 ${s.n} 项「必须结算」没处理</h3><p class="hint">条件满足时规则不让你选，比如杀人狂杀人、事件发生。确实已经在桌上处理过（或判断有误）再继续。</p>
      <div class="btns"><button class="btn ghost" data-act="close">回去结算</button><button class="btn" data-act="${s.act}" data-go="1">仍然继续</button></div>`;
  else if (s.k === 'reset') body = `<h3>在这个房间再开一局？</h3><p class="hint">回到选剧本。这局已经存档，不会丢。</p><div class="btns"><button class="btn ghost" data-act="close">取消</button><button class="btn" data-act="resetok">再开一局</button></div>`;
  return `<div class="mask" data-act="close"></div><div class="sheet">${body}</div>`;
}

function shareSheet() {
  const k = role === 'mm' ? keyOf(code) : null;
  return `<h3>房间 ${code}</h3>
    <div class="qrbox" style="padding:12px 0"><img alt="" src="${qrData(publicUrl())}"><p>主人公扫码进入<b style="display:inline;font:inherit;color:var(--c-p);letter-spacing:0">公开视图</b><br>${esc(publicUrl())}</p></div>
    <button class="btn navy" data-act="copy" data-text="${esc(publicUrl())}">复制公开视图链接</button>
    ${k ? `<div class="lbl">在另一台设备继续当剧作家</div><p class="hint">这条链接带剧作家密钥，<b style="color:var(--red2)">不要发给主人公</b>。</p>
      <button class="btn ghost" data-act="copy" data-text="${esc(`${publicUrl()}#k=${k}`)}">复制剧作家链接</button>` : ''}
    <button class="btn ghost" data-act="leave">返回首页</button>`;
}

function charSheet(id) {
  const c = S.ch[id], ch = CHARS[id], sc = scriptOf(S), r = roleOf(S, id), R = ROLES[r];
  if (!c) { ui.sheet = null; return ''; }
  const stepper = (k, n) => `<div class="stp" style="margin-top:8px">${tk(k === 'gd' ? '' : k, c[k], k === 'gd' ? '" style="background:#cdb07a' : '')}<b>${k === 'gd' ? '护卫' : TOKENS[k]}</b>
    <button data-act="add" data-id="${id}" data-tok="${k}" data-d="-1">−</button><span class="n">${c[k]}</span><button data-act="add" data-id="${id}" data-tok="${k}" data-d="1">+</button></div>`;
  return `<h3>${ch.name}<small>不安限度 ${ch.limit} · ${ch.tags.join(' / ') || '无属性'}${ch.forbid ? ` · 禁止 ${ch.forbid.map(l => LOC_ZH[l]).join('、')}` : ''}</small></h3>
    <p class="note secret" style="margin-top:8px">身份：<b>${R.name}</b>${r !== sc.cast[id] ? `（原身份${ROLES[sc.cast[id]].name}，妄想扩大病毒）` : ''}${R.refuse ? ` · ${R.refuse === 'must' ? '必定无视友好' : '无视友好'}` : ''}${(R.ab || []).map(x => `<br>${esc(x)}`).join('')}</p>
    <div class="lbl">所在区域</div>
    <div class="grid4">${LOCS.map(l => `<button class="${c.loc === l ? 'on' : ''}${(ch.forbid || []).includes(l) ? ' warn' : ''}" data-act="move" data-id="${id}" data-loc="${l}" ${c.dead ? 'disabled' : ''}>${LOC_ZH[l]}</button>`).join('')}</div>
    <div class="lbl">指示物</div>${['g', 'p', 'i'].map(k => stepper(k)).join('')}${stepper('gd')}
    ${(ch.gw || []).length ? `<div class="lbl">友好能力</div><div class="hint">${ch.gw.map(([n, t, fl]) => `[${n}] ${esc(t)}${fl?.once ? '（每轮回1次）' : ''}${fl?.noRefuse ? '（不可拒绝）' : ''}${fl?.from ? `（第 ${fl.from} 轮回起）` : ''}`).join('<br>')}</div>` : ''}
    ${ch.trait ? `<div class="lbl">特性</div><div class="hint">${esc(ch.trait)}</div>` : ''}
    ${ch.src ? `<div class="hint" style="color:var(--ink3)">数值来源：${ch.src === '第三方' ? '社区整理的 5th 卡面数据，请对照实体卡' : '官方旧版速查表'}</div>` : ''}
    <div class="btns" style="margin-top:12px"><button class="btn ${c.dead ? 'navy' : ''}" data-act="dead" data-id="${id}">${c.dead ? '复活（撤回死亡）' : '标记死亡'}</button><button class="btn ghost" data-act="close" style="margin-top:12px">完成</button></div>`;
}

function incSheet(i) {
  const sc = scriptOf(S), it = sc.incidents[i], [d, kind, cul] = it;
  const c = S.ch[cul], meet = c && !c.dead && incPara(S, cul) >= CHARS[cul].limit && !(cul === 'henchman' && S.flags.hench);
  const liv = Object.keys(S.ch).filter(id => !S.ch[id].dead);
  const opts = (ids, sel, name) => `<div class="grid2">${ids.map(id => `<button class="${ui.fx[name] === id ? 'on' : ''}" data-act="fx" data-n="${name}" data-v="${id}">${CHARS[id].name}</button>`).join('')}</div>`;
  let fx = '';
  if (meet && !CHARS[cul].noEffect) {
    const same = liv.filter(id => id !== cul && S.ch[id].loc === c.loc);
    if (kind === 'murder') fx = same.length ? `<div class="lbl">被杀害的角色（与当事人同区域）</div>${opts(same, 0, 'victim')}` : '<p class="hint">同区域没有其他角色：发生但没有效果。</p>';
    if (kind === 'farawayMurder') { const can = liv.filter(id => S.ch[id].i >= 2); fx = can.length ? `<div class="lbl">被杀害的角色（2 枚以上密谋）</div>${opts(can, 0, 'victim')}` : '<p class="hint">没有 2 枚以上密谋的角色：发生但没有效果。</p>'; }
    if (kind === 'increasingUnease') fx = `<div class="lbl">+2 不安给</div>${opts(liv, 0, 'p')}<div class="lbl">+1 密谋给（另一名角色）</div>${opts(liv, 0, 'i')}`;
    if (kind === 'missingPerson') fx = `<div class="lbl">把${CHARS[cul].name}移到（可以留在原地，此时不宣布移动）</div><div class="grid4">${LOCS.map(l => `<button class="${ui.fx.to === l ? 'on' : ''}" data-act="fx" data-n="to" data-v="${l}" ${forbidden(S, cul, l) ? 'disabled' : ''}>${LOC_ZH[l]}${forbidden(S, cul, l) ? '·禁止' : ''}</button>`).join('')}</div>`;
    if (kind === 'spreading') fx = `<div class="lbl">移除 2 枚友好：从</div>${opts(liv, 0, 'from')}<div class="lbl">+2 友好给（另一名角色）</div>${opts(liv, 0, 'to')}`;
    if (kind === 'butterflyEffect') fx = `<div class="lbl">与当事人同区域的角色</div>${opts(liv.filter(id => S.ch[id].loc === c.loc), 0, 'target')}<div class="lbl">放哪种指示物</div><div class="grid4">${Object.entries(TOKENS).map(([k, n]) => `<button class="${ui.fx.tok === k ? 'on' : ''}" data-act="fx" data-n="tok" data-v="${k}">${n}</button>`).join('')}</div>`;
    if (kind === 'hospitalIncident') fx = `<p class="hint">医院现在 ${S.bd.hospital} 枚密谋：${S.bd.hospital >= 1 ? '医院里的角色全部死亡' : '没有效果'}${S.bd.hospital >= 2 ? '，并且主人公死亡' : ''}。</p>`;
  }
  return `<h3>第 ${d} 天 · ${INCIDENTS[kind].name}<small>当事人 ${CHARS[cul].name}</small></h3>
    <p class="hint">${INCIDENTS[kind].fx}</p>
    <p class="note ${meet ? '' : 'secret'}">${meet ? '<b>条件满足：必须发生。</b>' : '条件不满足：不发生。'}当事人${!c ? '未登场' : c.dead ? '已死亡' : `${CHARS[cul].allTokens ? '指示物合计' : '不安'} ${incPara(S, cul)}，不安限度 ${CHARS[cul].limit}`}${CHARS[cul].noEffect ? '。当事人是黑猫：发生但没有效果' : ''}</p>
    ${fx}
    <div class="btns" style="margin-top:12px"><button class="btn ghost" data-act="close" style="margin-top:12px">取消</button>
    ${meet ? `<button class="btn" data-act="incok" data-i="${i}" data-r="yes">记录：发生</button>` : `<button class="btn navy" data-act="incok" data-i="${i}" data-r="no">记录：未发生</button>`}</div>`;
}

/* ---------- rating this game (stars + comment), shown on the hub boardgame.leisurecat.cloud ---------- */
// Nothing about the script goes into the card or the request: only who rates, the stars, the comment and the room code.
const REVIEW_API = 'https://boardgame.leisurecat.cloud/api/reviews';
const STAR_TXT = ['点星星打分', '不推荐', '一般', '还行', '好玩', '超好玩'];
// Who can rate from this phone: the Mastermind's private view rates as 剧作家; a public view as one of the Protagonists.
const rvWhos = () => role === 'mm' ? ['剧作家'] : ['主人公 1', '主人公 2', '主人公 3'];
const rvKey = () => `tl-rv-${code}-${role}`;
const savedReview = () => { try { return JSON.parse(store.get(rvKey())) || {}; } catch { return {}; } };
const rvName = rv => (role === 'mm' ? '剧作家' : (rv.name || '').trim() || rv.who || '').slice(0, 20);
function reviewCard() {
  if (ui.rv?.key !== rvKey()) ui.rv = { who: role === 'mm' ? '剧作家' : null, name: '', stars: 0, text: '', state: '', err: '', ...savedReview(), key: rvKey() };
  const rv = ui.rv;
  if (rv.state === 'sent') return `<h2 class="h" data-html2canvas-ignore><span>给这款游戏打个分</span></h2><div class="card rv" data-k="rv" data-html2canvas-ignore><div class="rv-done">${'★'.repeat(rv.stars)}${'☆'.repeat(5 - rv.stars)}</div>
    <p>谢谢 ${esc(rvName(rv))} 的评价！</p><div class="btns"><button class="btn ghost" data-act="rv-edit">修改评价</button><a class="btn navy" href="https://boardgame.leisurecat.cloud">看大家的评价</a></div></div>`;
  return `<h2 class="h" data-html2canvas-ignore><span>给这款游戏打个分</span><small>满分 5 星</small></h2><div class="card rv" data-k="rv" data-html2canvas-ignore>
    <div class="rv-l">我是</div><div class="rv-who">${rvWhos().map(w => `<button class="${rv.who === w ? 'on' : ''}" data-act="rv-who" data-who="${w}">${w}</button>`).join('')}</div>
    ${role === 'mm' ? '' : `<input class="pn rv-name" data-rv="name" maxlength="20" placeholder="你的名字（可不填，默认显示上面选的）" value="${esc(rv.name)}">`}
    <div class="rv-st">${[1, 2, 3, 4, 5].map(n => `<button class="${n <= rv.stars ? 'on' : ''}" data-act="rv-star" data-n="${n}" aria-label="${n} 星">★</button>`).join('')}<span>${STAR_TXT[rv.stars]}</span></div>
    <textarea data-rv="text" placeholder="说说这款游戏怎么样（可不填）" maxlength="300">${esc(rv.text)}</textarea>
    <button class="btn" data-act="rv-send" ${!rv.who || !rv.stars || rv.state === 'sending' ? 'disabled' : ''}>${rv.state === 'sending' ? '提交中…' : '提交评价'}</button>
    ${rv.err ? `<p class="err">${esc(rv.err)}</p>` : ''}
    <p class="note">评价和名字会显示在「桌游小助手」首页，并计入这款游戏的整体评分。请不要在评论里写剧本内容，以免剧透。同一局再次提交会覆盖之前的评价。</p></div>`;
}
async function sendReview() {
  const rv = ui.rv;
  rv.state = 'sending'; rv.err = ''; render();
  try {
    const r = await fetch(REVIEW_API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game: 'tl', stars: rv.stars, name: rvName(rv), text: rv.text, room: code }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `提交失败（${r.status}）`);
    rv.state = 'sent';
    store.set(rvKey(), JSON.stringify({ who: rv.who, name: rv.name, stars: rv.stars, text: rv.text, state: 'sent' }));
  } catch (e) {
    rv.state = ''; rv.err = ['Failed to fetch', 'Load failed', 'network error'].includes(e.message) ? '网络连接失败，请稍后再试' : e.message;
  }
  render();
}

/* ---------- long image ---------- */
function loadScript(src) { return new Promise((ok, no) => { if (window.html2canvas) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
async function saveImage() {
  ui.saving = true; render();
  try {
    await loadScript('vendor/html2canvas.min.js');
    const canvas = await window.html2canvas($('#shot'), { backgroundColor: '#110d16', scale: Math.min(2, window.devicePixelRatio || 2), useCORS: true,
      onclone: doc => { const c = doc.getElementById('shot'); c.style.padding = '12px'; c.style.width = '420px'; } });
    showImage(canvas.toDataURL('image/jpeg', 0.9));
  } catch (e) { toast('生成长图失败：' + e.message); }
  ui.saving = false; render();
}
function showImage(url) {
  const el = document.createElement('div');
  el.className = 'shotv';
  el.innerHTML = `<div class="sv-top"><span>长按图片保存到相册</span><a href="${url}" download="惨剧轮回-${code}.jpg">下载</a><button>关闭</button></div><img src="${url}" alt="结算长图">`;
  el.querySelector('button').onclick = () => el.remove();
  document.body.appendChild(el);
}

/* ---------- actions ---------- */
async function createRoom(sid, bot = false) {
  ui.busy = true; ui.err = ''; render();
  try {
    const r = await fetch('/api/room', { method: 'POST', body: JSON.stringify({ bot }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || '创建失败');
    remember(j.code, j.key || '');   // a robot room has no key
    location.href = `/?r=${j.code}${sid ? `&pick=${sid}` : ''}`;
  } catch (e) { ui.err = e.message || '网络出错，请重试'; ui.busy = false; render(); }
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const d = b.dataset, a = d.act;
  if (b.tagName === 'INPUT' && b.type === 'checkbox') return;   // handled on change
  switch (a) {
    case 'create': return createRoom();
    case 'createbot': return createRoom(null, true);
    case 'join': { const c = cleanCode($('#joinCode').value); if (!c) { ui.err = '房间码是 4 位字母或数字'; return render(); } location.href = `/?r=${c}`; return; }
    case 'rejoin': location.href = `/?r=${d.code}`; return;
    case 'leave': location.href = '/'; return;
    case 'share': ui.sheet = { k: 'share' }; return render();
    case 'copy': try { await navigator.clipboard.writeText(d.text); toast('已复制'); } catch { prompt('复制这条链接', d.text); } return;
    case 'close': ui.sheet = null; ui.fx = {}; return render();
    case 'tab': ui.tab = d.tab; return render();
    case 'publicview': window.open(`/?r=${code}&v=1`, '_blank'); return;
    case 'cinfo': ui.sheet = { k: 'cinfo', id: d.id }; return render();
    case 'rv-who': ui.rv.who = d.who; return render();
    case 'rv-star': ui.rv.stars = +d.n; return render();
    case 'rv-send': return sendReview();
    case 'rv-edit': ui.rv.state = ''; return render();
  }
  if (S?.pv && role !== 'mm' && botClick(S, ui, a, d)) return;
  if (role !== 'mm') return;
  switch (a) {
    case 'pick': if (d.sid !== S.sid) send({ t: 'pick', sid: d.sid, opt: 0 }); ui.place = {}; ui.choose = false; ui.toTop = true; return render();
    case 'choose': ui.choose = true; ui.toTop = true; return render();
    case 'opt': send({ t: 'pick', sid: S.sid, opt: +d.i }); return;
    case 'place': ui.place[d.id] = d.loc; return render();
    case 'start': send({ t: 'start', place: ui.place }); ui.place = {}; ui.tab = 'game'; return;
    case 'char': ui.sheet = { k: 'char', id: d.id }; return render();
    case 'bd': ui.sheet = { k: 'bd', loc: d.loc }; return render();
    case 'bdadd': send({ t: 'bd', loc: d.loc, add: +d.d }); return;
    case 'add': send({ t: 'ch', id: d.id, add: { [d.tok]: +d.d } }); return;
    case 'move': {
      if ((CHARS[d.id].forbid || []).includes(d.loc) && !(d.id === 'patient' && S.flags.patientFree)) toast(`${LOC_ZH[d.loc]}是${CHARS[d.id].name}的禁止区域，确定要放过去吗？（只有事件或能力能这样做）`);
      send({ t: 'ch', id: d.id, loc: d.loc }); return;
    }
    case 'dead': {
      const c = S.ch[d.id];
      if (!c.dead && roleOf(S, d.id) === 'timeTraveler') return toast('时间旅者不死，不能标记死亡');
      send({ t: 'ch', id: d.id, dead: !c.dead, why: '剧作家记录' }); ui.sheet = null; return;
    }
    case 'kill': send({ t: 'ch', id: d.id, dead: true, why: d.why }); toast(`已结算：${CHARS[d.id].name}死亡`); return;
    case 'ph': send({ t: 'ph', to: +d.to }); return;
    case 'phnext': case 'day': case 'endloop':
      if (d.guard && !d.go) { ui.sheet = { k: 'guard', act: a, n: +d.guard }; return render(); }
      ui.sheet = null;
      if (a === 'phnext') send({ t: 'ph', to: S.ph + 1 }); else if (a === 'day') send({ t: 'day', from: S.day }); else send({ t: 'endLoop' });
      return render();
    case 'all': ui.all = !ui.all; return render();
    case 'undo': sendRaw({ undo: true }); return;
    case 'lose': ui.sheet = { k: 'lose', why: d.why || '', death: !!d.death }; return render();
    case 'loseok': { const why = $('#loseWhy').value.trim(); if (!why) return toast('写一下原因'); send({ t: 'lose', why, death: $('#loseDeath').checked }); ui.sheet = null; return; }
    case 'note': ui.sheet = { k: 'note' }; return render();
    case 'noteok': { const x = $('#noteX').value.trim(); if (x) send({ t: 'note', x }); ui.sheet = null; return render(); }
    case 'once': send({ t: 'once', k: d.k, on: !S.once[d.k] }); return;
    case 'flag': send({ t: 'flag', k: d.k, on: !!d.on }); return;
    case 'incsheet': ui.fx = {}; ui.sheet = { k: 'inc', i: +d.k }; return render();
    case 'fx': ui.fx[d.n] = d.v; return render();
    case 'incok': send({ t: 'inc', k: +d.i, r: d.r, fx: { ...ui.fx } }); ui.sheet = null; ui.fx = {}; return;
    case 'next': send({ t: 'next', place: ui.place }); ui.place = {}; return;
    case 'final': send({ t: 'final', ok: !!d.ok }); return;
    case 'save': return saveImage();
    case 'reset': ui.sheet = { k: 'reset' }; return render();
    case 'resetok': send({ t: 'reset' }); ui.sheet = null; ui.tab = 'game'; return;
  }
});
document.addEventListener('input', e => {
  const d = e.target.dataset;
  if (d.rv === 'text') ui.rv.text = e.target.value;
  if (d.rv === 'name') ui.rv.name = e.target.value;
});
document.addEventListener('change', e => {
  if (S?.pv && botChange(e.target)) return;
  const b = e.target.closest('[data-act]');
  if (!b || role !== 'mm') return;
  if (b.dataset.act === 'check') {
    const k = `tl-check-${code}`, done = JSON.parse(store.get(k) || '{}');
    done[b.dataset.i] = b.checked; store.set(k, JSON.stringify(done)); render();
  }
  if (b.dataset.act === 'rev') send({ t: 'rev', kind: b.dataset.kind, key: b.dataset.kind === 'role' ? b.dataset.key : +b.dataset.key, on: b.checked });
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'joinCode') $('[data-act="join"]').click(); });

// A rejected action resyncs with the same version; tell the Mastermind why when it's likely a rule.
// (The server answers every action with fresh state; invalid ones simply don't change it.)

// Load the QR library, then start.
initBot({ esc, board, statusStrip, publicSheet, charCard, setRef, reviewCard, send, render, toast });
{ const s = document.createElement('script'); s.src = 'vendor/qrcode.js'; s.onload = () => render(); document.head.appendChild(s); }
render();
connect();
// Coming from the script library: pick that script in the new room.
{ const p = qs.get('pick'); if (p && SCRIPT[p]) { const once = () => { if (role === 'mm' && S?.stage === 'setup' && !S.sid) send({ t: 'pick', sid: p, opt: 0 }); if (role) { history.replaceState(null, '', `/?r=${code}`); return; } setTimeout(once, 300); }; once(); } }
