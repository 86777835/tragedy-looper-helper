// 人机模式: the Protagonists' screens when the robot is the Mastermind. Everything here comes from the public view.
import { LOCS, LOC_ZH, CHARS, ROLES, PLOTS, SETS, SCRIPT, SCRIPTS } from './data.js';

// The Protagonists' cards (same as src/engine.js PRO_CARDS) and the robot's card names for the reveal.
export const PRO = { V: ['移动↑↓'], H: ['移动←→'], fM: ['移动禁止', 1], g1: ['友好+1'], g2: ['友好+2', 1], p1: ['不安+1'], pM: ['不安−1', 1], fI: ['禁止密谋'] };
const MM = { mV: '移动↑↓', mH: '移动←→', mD: '移动斜向', fG: '禁止友好', p1a: '不安+1', p1b: '不安+1', pM: '不安−1', fP: '禁止不安', i1: '密谋+1', i2: '密谋+2' };
// What each goodwill ability asks for (same as the arg kinds in src/engine.js GW; tests check they match).
export const ARGS = {
  boyStudent: ['other'], girlStudent: ['other'], richStudent: ['same'], classRep: ['card'], mysteryBoy: ['self'],
  shrineMaiden: ['self', 'same'], alien: ['other', 'corpseSame'], godlyBeing: ['inc', 'sameOrBoard'], policeOfficer: ['incDone', 'same'],
  officeWorker: ['self'], informer: ['rulex'], popIdol: ['other', 'other'], journalist: ['any', 'sameOrBoard'], boss: ['turf'],
  doctor: ['other', 'self'], patient: [], nurse: ['other'], henchman: ['self'], transferStudent: ['other'], forensicSpecialist: ['two', 'corpse'],
  ai: ['aiInc'], teacher: ['student', 'student'], soldier: ['other', 'self'], blackCat: []
};
const PM = { doctor: [0], teacher: [0] };   // abilities where the leader picks +1 or −1 paranoia
const STUDENT = id => CHARS[id].tags.includes('学生');
const tgtName = t => t.startsWith('loc:') ? LOC_ZH[t.slice(4)] : CHARS[t].name;
// Card and board images from 惨劇コモンズ 5th (public/img/c, see README for the licence).
const IMG = 'img/c/';
const cardSrc = (who, c) => `${IMG}${who === 'mm' ? 'mm' : `p${who}`}-${c}.webp`;

let X;   // helpers from app.js: { esc, board, statusStrip, publicSheet, charCard, setRef, reviewCard, send, render, toast }
export const initBot = h => { X = h; };

const living = S => Object.keys(S.ch).filter(id => !S.ch[id].dead);
const targetsOf = S => [...living(S), ...LOCS.map(l => `loc:${l}`)];
const setKey = S => Object.keys(SETS).find(k => SETS[k].name === S.sheet.set);

/* ---------- pages ---------- */
export function botPage(S, ui) {
  const pv = S.pv;
  if (S.stage === 'setup') return setupPage(S, ui);
  const head = `${X.statusStrip(S, S.sheet.loops, S.sheet.days)}
    <div class="bot-tag"><span>人机模式</span>剧作家由机器人扮演${pv.leader ? ` · 队长：主人公 ${pv.leader}` : ''}</div>`;
  let main = '';
  if (S.stage === 'play' && pv.step === 'pro') main = cardsStep(S, ui);
  else if (S.stage === 'play' && pv.step === 'gw') main = gwStep(S, ui);
  else if (S.stage === 'loopEnd') main = loopEndStep(S);
  else if (S.stage === 'final') main = finalStep(S);
  else if (S.stage === 'over') main = overStep(S);
  return `${head}${main}
    ${S.stage === 'play' || S.stage === 'loopEnd' ? `<h2 class="h"><span>版图</span><small>点角色看大图 · 实体版图照这里摆</small></h2>${vboard(S)}` : ''}
    ${newsBlock(S)}
    <h2 class="h"><span>公开信息</span></h2>${X.publicSheet(S.sheet, S.happened)}
    <details class="card ref" style="margin-top:8px"><summary>「${X.esc(S.sheet.set)}」模组速查：全部规则、身份、事件</summary>${X.setRef(setKey(S))}</details>
    <a class="btn ghost" href="guide">规则介绍与常见问题</a>
    <footer>${CREDIT}</footer>`;
}
export const CREDIT = `卡图、版图和指示物来自<a href="https://bakafire.main.jp/rooper/sr_dl_04_sozai.htm" target="_blank" rel="noopener">惨劇コモンズ 5th</a>（惨劇コモンズ作成：BakaFire、紺ノ玲），依 CC BY-SA 2.1 JP 使用<br>原作《惨劇RoopeR》BakaFire Party`;

// The cards lying on each target: face down until the reveal (the Protagonists' own cards face up, they typed them in).
function cardsOn(S) {
  const on = {}, pv = S.pv, add = (t, x) => (on[t] ||= []).push(x);
  if (S.stage !== 'play') return on;
  if (pv.revealed) for (const r of pv.revealed) add(r.tgt, { src: cardSrc(r.who, r.c), who: r.who });
  else {
    for (const t of pv.mmTargets || []) add(t, { src: cardSrc('mm', 'back'), who: 'mm' });
    for (const [k, x] of Object.entries(pv.pro || {})) add(x.tgt, { src: cardSrc(+k, x.c), who: +k });
  }
  return on;
}
const minis = list => list ? `<span class="vmini">${list.map(x => `<img src="${x.src}" alt="">`).join('')}</span>` : '';
const chip = (k, n, extra = '') => n ? `<span class="vt ${k}${extra}"><b>${n}</b></span>` : '';

// The board as on the table: the four location boards, character cards with their tokens, and the day's action cards.
function vboard(S) {
  const on = cardsOn(S);
  return `<div class="vboard">${LOCS.map(l => {
    const here = Object.keys(S.ch).filter(id => S.ch[id].loc === l);
    return `<div class="vloc" data-k="vl-${l}" style="background-image:linear-gradient(180deg,rgba(9,7,12,.35),rgba(9,7,12,.78)),url(${IMG}bd-${l}.webp)">
      <div class="vlh"><b>${LOC_ZH[l]}</b>${S.sheet.turf === l ? `<img class="vturf" src="${IMG}turf.webp" alt="领地" title="大人物的领地">` : ''}${chip('i', S.bd[l])}${minis(on[`loc:${l}`])}</div>
      <div class="vcs">${here.map(id => {
        const c = S.ch[id], role = S.rev?.role?.[id], lim = c.p >= CHARS[id].limit && !c.dead;
        return `<button class="vc${c.dead ? ' dead' : ''}" data-act="cinfo" data-id="${id}" data-k="vc-${id}">
          <span class="vimg"><img src="${IMG}cs-${id}.webp" alt="${CHARS[id].name}">${minis(on[id])}
          <span class="vtoks">${c.gd ? `<span class="vt gd"><b>护${c.gd > 1 ? c.gd : ''}</b></span>` : ''}${chip('g', c.g)}${chip('p', c.p, lim ? ' lim' : '')}${chip('i', c.i)}</span></span>
          <span class="vn">${CHARS[id].name}</span>${role ? `<em>${X.esc(role)}</em>` : ''}</button>`;
      }).join('') || '<span class="vnone">没有角色</span>'}</div></div>`;
  }).join('')}</div>
  <p class="vleg">${[['g', '友好'], ['p', '不安'], ['i', '密谋']].map(([k, n]) => `<span><i class="vt ${k}"></i>${n}</span>`).join('')}<span>白圈：不安达到限度</span></p>`;
}
// For the character sheet: the cards lying on this character right now.
export function botCardsOn(S, id) {
  const list = cardsOn(S)[id];
  return list ? `<div class="vrev on">${list.map(x => `<figure><img src="${x.src}" alt=""><figcaption>${x.who === 'mm' ? (S.pv.revealed ? '剧作家' : '剧作家（背面）') : `主人公${x.who}`}</figcaption></figure>`).join('')}</div>` : '';
}
// The six cards turned over today, big enough to read.
function revealedStrip(S) {
  const r = S.pv.revealed;
  if (!r) return '';
  return `<div class="lbl" style="margin-top:12px">今天翻开的牌</div><div class="vrev" style="margin-top:6px">${r.map(x => `<figure><img src="${cardSrc(x.who, x.c)}" alt="${x.who === 'mm' ? MM[x.c] : PRO[x.c][0]}"><figcaption>${x.who === 'mm' ? '剧作家' : `主人公${x.who}`}<b>${X.esc(tgtName(x.tgt))}</b></figcaption></figure>`).join('')}</div>`;
}

function setupPage(S, ui) {
  if (!S.sheet) return `<div class="card bot-intro"><b>人机模式</b><p>机器人当剧作家，你们当主人公。机器人按官方给剧作家的建议出牌、用能力；它的剧本、身份和手牌只在服务器上，谁的手机都看不到。</p>
      <p>每天你们在手机上输入自己出的牌，机器人揭牌并告诉你们结果。实体版图可以照着摆，也可以只看手机。</p></div>
    <h2 class="h"><span>1 选剧本</span></h2>
    <div class="list">
      <button class="card sc-item big" data-act="bpick" data-set="fs"><span class="no">随机</span><span class="nm"><b>First Steps 新手模组</b><span>第一次玩推荐 · 只有 1 条规则X，没有最终决战</span></span><span class="go">›</span></button>
      <button class="card sc-item big" data-act="bpick" data-set="btx"><span class="no">随机</span><span class="nm"><b>Basic Tragedy X 基础模组</b><span>完整规则，有最终决战</span></span><span class="go">›</span></button>
    </div>
    <details class="card ref" style="margin-top:10px"><summary>指定剧本（会看到剧本名，可能剧透）</summary><div class="list" style="padding:8px">${
      SCRIPTS.map(s => s.id).map(id => `<button class="card sc-item" data-act="bpick" data-sid="${id}"><span class="no">${SCRIPT[id].no}</span><span class="nm"><b>${X.esc(SCRIPT[id].zh)}</b>${['btx03', 'btx07', 'btx08'].includes(id) ? '<span>没有官方剧作家提示：机器人用本站整理的打法</span>' : '<span>机器人按官方剧作家提示出牌</span>'}</span></button>`).join('')
    }</div></details>`;
  return `<div class="card pick-hero"><div class="ph-top"><span class="ph-no">${S.pv.chosen === 'random' ? '随机' : '指定'}</span><span class="ph-set">${X.esc(S.sheet.set)}</span><button class="ph-chg" data-act="bundo">换一个</button></div>
      <b>${S.pv.chosen === 'random' ? '剧本已经抽好' : '剧本已选好'}</b><span class="ph-sub">剧本名和真相只在服务器上，结束时才公开</span>
      <div class="ph-stats"><span><i>${S.sheet.days}</i>天</span><span><i>${S.sheet.loops}</i>轮回</span><span><i>${S.sheet.incidents.length}</i>事件</span></div></div>
    <h2 class="h"><span>2 主人公人数</span></h2>
    <div class="chips">${[1, 2, 3].map(n => `<button class="chip${(ui.np || 3) === n ? ' on' : ''}" data-act="bnp" data-n="${n}">${n} 人</button>`).join('')}</div>
    <p class="note">每天主人公一共出 3 张牌：${(ui.np || 3) === 3 ? '每人 1 张' : (ui.np || 3) === 2 ? '队长出 1 张，另一人出 2 张' : '一个人拿 3 套手牌，出 3 张'}。手机上按“主人公 1/2/3”三套手牌输入即可。</p>
    <h2 class="h"><span>公开信息卡</span></h2>${X.publicSheet(S.sheet)}
    <button class="btn" data-act="bstart">开始第 1 轮回</button>`;
}

function cardsStep(S, ui) {
  const pv = S.pv, order = [pv.leader, pv.leader % 3 + 1, (pv.leader + 1) % 3 + 1];
  const all = [1, 2, 3].every(k => pv.pro[k]);
  return `<div class="card pc"><div class="pc-head"><span class="pc-no">3<small>/9</small></span><div><b>主人公出牌</b><em>剧作家已经暗置 3 张牌。从队长开始，每套手牌各出 1 张</em></div></div>
    <div class="pc-body">
      <div class="mm-down">${pv.mmTargets.map(t => `<span><img src="${cardSrc('mm', 'back')}" alt="">${X.esc(tgtName(t))}</span>`).join('')}</div>
      ${order.map(k => { const c = pv.pro[k]; return `<button class="seat${c ? ' set' : ''}" data-act="bseat" data-seat="${k}">${c ? `<img class="seat-c" src="${cardSrc(k, c.c)}" alt="">` : `<img class="seat-c back" src="${cardSrc(k, 'back')}" alt="">`}<span class="st"><b>主人公 ${k}${k === pv.leader ? ' · 队长' : ''}</b><span>${c ? `「${PRO[c.c][0]}」→ ${X.esc(tgtName(c.tgt))}` : '点这里出牌'}</span></span><span class="go">›</span></button>`; }).join('')}
      <p class="hint" style="margin-top:8px">主人公之间不能把牌放在同一个目标上，可以叠在剧作家的牌上。</p>
    </div></div>
    <div class="dock" data-k="dock"><div class="dock-in"><button class="btn" data-act="breveal" ${all ? '' : 'disabled'}>${all ? '翻牌！' : `还差 ${[1, 2, 3].filter(k => !pv.pro[k]).length} 张`}</button></div></div>`;
}

function gwStep(S, ui) {
  const pv = S.pv;
  const list = living(S).flatMap(id => (CHARS[id].gw || []).map(([need, text, fl], n) => ({ id, n, need, text, fl })))
    .filter(a => S.ch[a.id].g >= a.need);
  return `<div class="card pc"><div class="pc-head"><span class="pc-no">6<small>/9</small></span><div><b>主人公能力</b><em>队长宣言友好能力，剧作家决定结算还是拒绝。用完点下面的按钮</em></div></div>
    <div class="pc-body">${revealedStrip(S)}${list.length ? list.map(a => {
      const used = a.fl?.once && pv.gwUsed[`${a.id}:${a.n}`], early = a.fl?.from && S.loop < a.fl.from;
      return `<button class="gwb" data-act="bgw" data-ch="${a.id}" data-n="${a.n}" ${used || early ? 'disabled' : ''}><span class="gwn">友好 ${a.need}</span><b>${CHARS[a.id].name}</b><span>${X.esc(a.text)}${a.fl?.once ? '（每轮回 1 次）' : ''}${used ? ' · 本轮回已用' : ''}${early ? ` · 第 ${a.fl.from} 轮回起` : ''}</span></button>`;
    }).join('') : '<div class="pc-empty">现在没有角色的友好够用能力。</div>'}</div></div>
    <div class="dock" data-k="dock"><div class="dock-in"><button class="btn" data-act="bgwdone">能力用完了，继续</button></div></div>`;
}

function loopEndStep(S) {
  const last = S.loops.at(-1), more = S.loop < S.sheet.loops;
  const label = !last.lost ? '看结果' : more ? `开始第 ${S.loop + 1} 轮回` : setKey(S) === 'btx' ? '进入最终决战' : '看结果';
  return `<div class="mvp"><div class="crown">第 ${S.loop} 轮回结束</div><div class="nm">${last.lost ? '你们失败了' : '主人公获胜！'}</div>
      <div class="fg">${last.lost ? (more ? '时之缝隙：现在可以自由相谈，整理线索。下一轮回所有角色和指示物会复位。' : '最后一个轮回也失败了。') : '这个轮回撑过去了，惨剧被阻止。'}</div></div>
    <div class="dock" data-k="dock"><div class="dock-in"><button class="btn" data-act="bnext">${label}</button></div></div>`;
}

function finalStep(S) {
  const roles = SETS[setKey(S)].roles, cast = S.pv.seen;
  const filled = cast.every(id => S.pv.guess[id]);
  return `<div class="mvp"><div class="crown">最终决战</div><div class="nm">推理每个角色的身份</div><div class="fg">可以相谈。全部猜对主人公获胜，错一个剧作家获胜。</div></div>
    <div class="card" style="margin-top:10px">${cast.map(id => `<div class="guess"><b>${CHARS[id].name}</b><select class="pn" data-bguess="${id}"><option value="">选身份</option>${roles.map(r => `<option value="${r}" ${S.pv.guess[id] === r ? 'selected' : ''}>${ROLES[r].name}</option>`).join('')}</select></div>`).join('')}</div>
    <p class="note">要猜的是游戏中在版图上出现过的所有角色（包括平民）。</p>
    <div class="dock" data-k="dock"><div class="dock-in"><button class="btn" data-act="bguessdone" ${filled ? '' : 'disabled'}>${filled ? '提交答案' : '还有角色没选身份'}</button></div></div>`;
}

function overStep(S) {
  const t = S.pv.truth, pro = S.result === 'pro';
  return `<div class="mvp"><div class="crown">游戏结束</div><div class="nm">${pro ? '主人公获胜！' : '剧作家（机器人）获胜'}</div>
      <div class="fg">${t ? `剧本：${SCRIPT[t.sid].no}「${X.esc(SCRIPT[t.sid].zh)}」` : ''}</div></div>
    ${t ? `<h2 class="h"><span>剧本真相</span></h2><div class="card ref-sec">
      <div class="pref"><b>规则Y：${PLOTS[t.y].name}</b>${t.x.map(x => `<p>规则X：${PLOTS[x].name}</p>`).join('')}</div>
      ${Object.entries(t.cast).map(([id, r]) => `<div class="rref"><div class="rref-h"><b>${CHARS[id].name}</b><em>${ROLES[r].name}</em>${S.pv.guess?.[id] ? `<span>${S.pv.guess[id] === r ? '猜对 ✓' : `猜成「${ROLES[S.pv.guess[id]].name}」`}</span>` : ''}</div></div>`).join('')}
      ${t.incidents.map(([d, , cul], k) => `<div class="pref"><b>第 ${d} 天 ${X.esc(S.sheet.incidents[k].name)}</b><p>当事人：${CHARS[cul].name}</p></div>`).join('')}</div>` : ''}
    ${X.reviewCard()}
    <button class="btn ghost" data-act="breset">再来一局</button>`;
}

function newsBlock(S) {
  const news = S.pv.news || [];
  if (!news.length) return '';
  const days = [...new Set(news.map(n => n.d))];
  const cur = days.at(-1);
  return `<h2 class="h"><span>发生了什么</span><small>本轮回</small></h2><div class="card news">${days.slice().reverse().map(d => `<details ${d === cur ? 'open' : ''}><summary>${d ? `第 ${d} 天` : '轮回开始'}</summary>${news.filter(n => n.d === d).map(n => `<div class="nw ${n.k}">${X.esc(n.x)}</div>`).join('')}</details>`).join('')}</div>`;
}

/* ---------- sheets ---------- */
export function botSheet(S, ui) {
  const s = ui.sheet;
  if (s.k === 'bseat') {
    const pv = S.pv, used = pv.proUsed[s.seat] || {}, mine = pv.pro[s.seat];
    const taken = Object.entries(pv.pro).filter(([k]) => +k !== s.seat).map(([, x]) => x.tgt);
    const c = ui.bc ?? mine?.c;
    return `<h3>主人公 ${s.seat} 出牌<small>${s.seat === pv.leader ? '队长' : ''}</small></h3>
      <div class="lbl">1 选牌</div><div class="cardg">${Object.entries(PRO).map(([k, [n, once]]) => `<button class="${c === k ? 'on' : ''}" data-act="bcsel" data-c="${k}" ${once && used[k] ? 'disabled' : ''}><img src="${cardSrc(s.seat, k)}" alt=""><span>${n}${once ? `<small>${used[k] ? '本轮回已用' : '每轮回1次'}</small>` : ''}</span></button>`).join('')}</div>
      <div class="lbl">2 放在哪里</div><div class="grid2">${targetsOf(S).map(t => `<button class="${(ui.bt ?? mine?.tgt) === t ? 'on' : ''}" data-act="btsel" data-t="${t}" ${taken.includes(t) ? 'disabled' : ''}>${X.esc(tgtName(t))}${pv.mmTargets.includes(t) ? ' ·剧' : ''}</button>`).join('')}</div>
      <p class="hint">「·剧」表示剧作家在那里放了牌。</p>
      <div class="btns" style="margin-top:12px">${mine ? '<button class="btn ghost" data-act="bctake" style="margin-top:0">收回这张</button>' : '<button class="btn ghost" data-act="close" style="margin-top:0">取消</button>'}<button class="btn" data-act="bcok" style="margin-top:0" ${(c && (ui.bt ?? mine?.tgt)) ? '' : 'disabled'}>放下</button></div>`;
  }
  if (s.k === 'bgw') return gwSheet(S, ui, s.ch, s.n);
  return '';
}

function gwSheet(S, ui, id, n) {
  const kind = ARGS[id][n], a = ui.ba, here = S.ch[id].loc, live = living(S);
  const same = live.filter(o => S.ch[o].loc === here);
  const pick = (ids, key = 'tg') => `<div class="grid2">${ids.map(t => `<button class="${a[key] === t ? 'on' : ''}" data-act="ba" data-key="${key}" data-v="${t}">${X.esc(tgtName(t))}</button>`).join('') || '<p class="hint">没有可选的目标</p>'}</div>`;
  let body = '';
  const others = same.filter(o => o !== id);
  if (kind === 'other') body = pick(id === 'boyStudent' || id === 'girlStudent' ? others.filter(STUDENT) : id === 'nurse' ? others.filter(o => S.ch[o].p >= CHARS[o].limit) : others);
  if (kind === 'student') body = pick(same.filter(STUDENT));
  if (kind === 'same') body = pick(same);
  if (kind === 'sameOrBoard') body = pick([...same, `loc:${here}`]);
  if (kind === 'any') body = pick(live.filter(o => o !== id));
  if (kind === 'turf') body = pick(live.filter(o => o !== id && (!S.sheet.turf || S.ch[o].loc === S.sheet.turf)));
  if (kind === 'corpseSame') body = pick(Object.keys(S.ch).filter(o => S.ch[o].dead && S.ch[o].loc === here));
  if (kind === 'corpse') body = pick(Object.keys(S.ch).filter(o => S.ch[o].dead));
  if (kind === 'inc' || kind === 'incDone' || kind === 'aiInc') body = `<div class="grid2">${S.sheet.incidents.map((it, k) => `<button class="${a.k === k ? 'on' : ''}" data-act="ba" data-key="k" data-v="${k}" data-num="1" ${kind === 'incDone' && S.happened[k] !== 'yes' ? 'disabled' : ''}>第 ${it.day} 天 ${X.esc(it.name)}</button>`).join('')}</div>`;
  if (kind === 'rulex') body = `<div class="grid2">${SETS[setKey(S)].x.map(x => `<button class="${a.r === PLOTS[x].name ? 'on' : ''}" data-act="ba" data-key="r" data-v="${PLOTS[x].name}">${PLOTS[x].name}</button>`).join('')}</div>`;
  if (kind === 'two') body = `<div class="lbl">从</div>${pick(others, 'from')}<div class="lbl">移到</div>${pick(others, 'to')}<div class="lbl">指示物</div><div class="grid4">${[['g', '友好'], ['p', '不安'], ['i', '密谋']].map(([k, nm]) => `<button class="${a.tok === k ? 'on' : ''}" data-act="ba" data-key="tok" data-v="${k}">${nm}</button>`).join('')}</div>`;
  if (kind === 'card') { const used = Object.keys(S.pv.proUsed[S.pv.leader] || {}); body = used.length ? `<div class="grid2">${used.map(c => `<button class="${a.c === c ? 'on' : ''}" data-act="ba" data-key="c" data-v="${c}">${PRO[c][0]}</button>`).join('')}</div>` : '<p class="hint">队长还没有用过「每轮回1次」的牌</p>'; }
  if (PM[id]?.includes(n)) body += `<div class="lbl">加还是减</div><div class="grid2">${['+', '-'].map(x => `<button class="${a.pm === x ? 'on' : ''}" data-act="ba" data-key="pm" data-v="${x}">${x === '+' ? '+1 不安' : '−1 不安'}</button>`).join('')}</div>`;
  if (kind === 'aiInc' && a.k !== undefined) body += aiFx(S, a);
  const [need, text] = CHARS[id].gw[n];
  return `<h3>${CHARS[id].name}的能力<small>友好 ${need}</small></h3><p class="hint">${X.esc(text)}</p>
    ${kind === 'self' ? '' : `<div class="lbl">选择</div>${body}`}
    <div class="btns" style="margin-top:12px"><button class="btn ghost" data-act="close" style="margin-top:0">取消</button><button class="btn" data-act="bgwok" style="margin-top:0">宣言</button></div>`;
}
// A.I.'s ability: the leader also makes the choices inside the chosen incident's effect.
function aiFx(S, a) {
  const kind = S.sheet.incidents[a.k].name, live = living(S), here = S.ch.ai.loc, fx = a.fx || {};
  const pick = (ids, key, nm = tgtName) => `<div class="grid2">${ids.map(t => `<button class="${fx[key] === t ? 'on' : ''}" data-act="bfx" data-key="${key}" data-v="${t}">${X.esc(nm(t))}</button>`).join('') || '<p class="hint">没有可选的目标（效果落空）</p>'}</div>`;
  if (kind === '谋杀') return `<div class="lbl">被杀害的角色</div>${pick(live.filter(o => o !== 'ai' && S.ch[o].loc === here), 'victim')}`;
  if (kind === '远距离杀人') return `<div class="lbl">被杀害的角色（2 枚以上密谋）</div>${pick(live.filter(o => S.ch[o].i >= 2), 'victim')}`;
  if (kind === '失踪') return `<div class="lbl">把 A.I. 移到</div>${pick(LOCS.filter(l => !(CHARS.ai.forbid || []).includes(l)), 'to', l => LOC_ZH[l])}`;
  if (kind === '不安扩散') return `<div class="lbl">+2 不安给</div>${pick(live, 'p')}<div class="lbl">+1 密谋给（另一名）</div>${pick(live, 'i')}`;
  if (kind === '散播') return `<div class="lbl">移除 2 友好：从</div>${pick(live, 'from')}<div class="lbl">+2 友好给</div>${pick(live, 'to')}`;
  if (kind === '蝴蝶效应') return `<div class="lbl">同区域的角色</div>${pick(live.filter(o => S.ch[o].loc === here), 'target')}<div class="lbl">指示物</div>${pick(['g', 'p', 'i'], 'tok', k => ({ g: '友好', p: '不安', i: '密谋' })[k])}`;
  return '';
}

/* ---------- clicks ---------- */
export function botClick(S, ui, act, d) {
  const send = X.send, open = sheet => { ui.sheet = sheet; X.render(); };
  switch (act) {
    case 'bpick': send(d.sid ? { t: 'bpick', sid: d.sid } : { t: 'bpick', set: d.set }); return true;
    case 'bundo': send({ t: 'breset' }); return true;
    case 'bopt': send({ t: 'bopt', opt: +d.i }); return true;
    case 'bnp': ui.np = +d.n; X.render(); return true;
    case 'bstart': send({ t: 'bstart', np: ui.np || 3 }); return true;
    case 'bseat': ui.bc = undefined; ui.bt = undefined; open({ k: 'bseat', seat: +d.seat }); return true;
    case 'bcsel': ui.bc = d.c; X.render(); return true;
    case 'btsel': ui.bt = d.t; X.render(); return true;
    case 'bcok': { const mine = S.pv.pro[ui.sheet.seat]; send({ t: 'pcard', seat: ui.sheet.seat, c: ui.bc ?? mine?.c, tgt: ui.bt ?? mine?.tgt }); ui.sheet = null; X.render(); return true; }
    case 'bctake': send({ t: 'pcard', seat: ui.sheet.seat, c: null }); ui.sheet = null; X.render(); return true;
    case 'breveal': send({ t: 'reveal' }); window.scrollTo(0, 0); return true;
    case 'bgw': ui.ba = {}; open({ k: 'bgw', ch: d.ch, n: +d.n }); return true;
    case 'ba': ui.ba[d.key] = d.num ? +d.v : d.v; if (d.key === 'k') ui.ba.fx = {}; X.render(); return true;
    case 'bfx': (ui.ba.fx ||= {})[d.key] = d.v; X.render(); return true;
    case 'bgwok': send({ t: 'gw', ch: ui.sheet.ch, n: ui.sheet.n, ...ui.ba }); ui.sheet = null; X.render(); return true;
    case 'bgwdone': send({ t: 'gwDone' }); window.scrollTo(0, 0); return true;
    case 'bnext': send({ t: 'bnext' }); window.scrollTo(0, 0); return true;
    case 'bguessdone': send({ t: 'guessDone' }); return true;
    case 'breset': send({ t: 'breset' }); return true;
  }
  return false;
}
export function botChange(el) {
  if (el.dataset.bguess) { X.send({ t: 'guess', ch: el.dataset.bguess, role: el.value || null }); return true; }
  return false;
}
