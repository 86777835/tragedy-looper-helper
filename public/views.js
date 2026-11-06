// Script sheets and notes, shared by the room page (app.js) and the script library (lib.js).
import { LOC_ZH, CHARS, ROLES, PLOTS, INCIDENTS, SETS } from './data.js';
import { NOTES } from './notes.js';
const extraOf = (sc, id) => (sc.extra || {})[id] || {};
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const fxOf = name => Object.values(INCIDENTS).find(i => i.name === name)?.fx || '';

// The public script sheet (公开信息表): what goes on the table for everyone.
export function publicSheet(sh, happened) {
  return `<div class="card sheetc"><h3>公开信息卡 <em>公开</em></h3>
    <dl class="kv"><dt>惨剧模组</dt><dd>${esc(sh.set)}${sh.setRules.length ? `（${sh.setRules.map(esc).join('，')}）` : ''}</dd>
    <dt>轮回数</dt><dd><b>${sh.loops}</b> 轮回</dd><dt>天数</dt><dd>每轮回 <b>${sh.days}</b> 天</dd>
    <dt>特殊规则</dt><dd>${sh.special.length ? sh.special.map(esc).join('；') : '无'}</dd></dl>
    <table class="tb"><tr><th>日期</th><th>事件</th>${happened ? '<th>本轮回</th>' : ''}</tr>
    ${sh.incidents.map((it, k) => `<tr><td>第 ${it.day} 天</td><td>${esc(it.name)}${fxOf(it.name) ? `<small class="fx">${esc(fxOf(it.name))}</small>` : ''}</td>${happened ? `<td>${happened[k] === 'yes' ? '<b style="color:var(--red2)">已发生</b>' : happened[k] === 'no' ? '未发生' : '—'}</td>` : ''}</tr>`).join('')}</table></div>`;
}
export const pubSheetOf = (sc, opt) => ({ set: SETS[sc.set].name, setRules: SETS[sc.set].rules, loops: sc.opts[opt][0], days: sc.days, special: sc.special, incidents: sc.incidents.map(([day, k]) => ({ day, name: INCIDENTS[k].name })) });

// The private script sheet (非公开信息表): the truth, Mastermind only.
export function privateSheet(sc) {
  return `<div class="card sheetc"><h3>非公开信息卡 <em class="sec">剧作家</em></h3>
    <dl class="kv"><dt>剧本</dt><dd><b>${sc.no}「${esc(sc.zh)}」</b><br><small style="color:var(--ink2)">${esc(sc.jp)} · ${esc(sc.en)} · 作者 ${esc(sc.author)}</small></dd>
    ${sc.doubt ? `<dt>注意</dt><dd><small>${esc(sc.doubt)}</small></dd>` : ''}<dt>规则Y</dt><dd><b>${PLOTS[sc.y].name}</b>${PLOTS[sc.y].loss ? `<br><small>${PLOTS[sc.y].loss}</small>` : ''}${PLOTS[sc.y].setup ? `<br><small>${PLOTS[sc.y].setup}</small>` : ''}</dd>
    ${sc.x.map((x, i) => `<dt>规则X${sc.x.length > 1 ? i + 1 : ''}</dt><dd><b>${PLOTS[x].name}</b>${PLOTS[x].ab ? `<br><small>${PLOTS[x].ab}</small>` : ''}</dd>`).join('')}</dl>
    <table class="tb"><tr><th>角色</th><th>身份</th><th>初始区域</th><th>特记</th></tr>
    ${Object.entries(sc.cast).map(([id, r]) => { const ex = extraOf(sc, id), ch = CHARS[id];
      return `<tr><td>${ch.name}<br><small style="color:var(--ink3)">不安限度 ${ch.limit}</small></td><td class="r">${ROLES[r].name}${ROLES[r].refuse ? `<br><small style="color:var(--ink2);font-weight:500">${ROLES[r].refuse === 'must' ? '必定无视友好' : '无视友好'}</small>` : ''}</td>
        <td>${ch.start ? LOC_ZH[ch.start] : '每轮回自选'}${ch.forbid ? `<br><small style="color:var(--ink3)">禁止：${ch.forbid.map(l => LOC_ZH[l]).join('、')}</small>` : ''}</td>
        <td>${[ex.enterLoop ? `第 ${ex.enterLoop} 轮回登场` : '', ex.enterDay ? `第 ${ex.enterDay} 天登场` : '', ex.turf ? `领地：${LOC_ZH[ex.turf]}` : ''].filter(Boolean).join('<br>') || ''}</td></tr>`; }).join('')}</table>
    <table class="tb"><tr><th>日期</th><th>事件</th><th>当事人</th></tr>
    ${sc.incidents.map(([d, k, c]) => `<tr><td>第 ${d} 天</td><td>${INCIDENTS[k].name}</td><td class="r">${CHARS[c].name}<br><small style="color:var(--ink3);font-weight:500">不安限度 ${CHARS[c].limit}</small></td></tr>`).join('')}</table>
    <p class="src">依据官方剧本 ${sc.no}「${esc(sc.zh)}」的设置数据整理，非剧本原文。</p></div>`;
}
export function notesBlock(sid) {
  const n = NOTES[sid];
  return `<div class="card route"><b>核心机制</b><p>${esc(n.core)}</p></div>
    <h2 class="h"><span>路线建议</span><small>本站整理，仅剧作家可见</small></h2>
    <div class="list">${n.routes.map(r => `<div class="card route"><b>${esc(r.t)}</b><p>${esc(r.x)}</p></div>`).join('')}</div>
    <h2 class="h"><span>守住真相</span></h2><div class="card route"><ul class="dots">${n.hide.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <h2 class="h"><span>本剧本易错点</span></h2><div class="card route"><ul class="dots">${n.watch.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
}


/* ---------- reference: character cards, roles, the tragedy set ---------- */
// A character card (public: printed on the card). role: a role name to show (only for the Mastermind, or when revealed).
// img: a small picture of the card (惨劇コモンズ 5th) beside the text.
export function charCard(id, role, img = true) {
  const c = CHARS[id];
  return `<div class="cref">${img ? `<img class="cref-img" loading="lazy" src="img/c/cs-${id}.webp" alt="">` : ''}<div class="cref-h"><b>${c.name}</b>${role ? `<em>${esc(role)}</em>` : ''}<span>不安限度 <i>${c.limit}</i></span></div>
    <dl class="kv"><dt>属性</dt><dd>${c.tags.length ? c.tags.join('、') : '无'}</dd>
    <dt>初始区域</dt><dd>${c.start ? LOC_ZH[c.start] : '每轮回由剧作家决定'}</dd>
    ${c.forbid ? `<dt>禁止区域</dt><dd>${c.forbid.map(l => LOC_ZH[l]).join('、')}</dd>` : ''}
    ${c.trait ? `<dt>特性</dt><dd>${esc(c.trait)}</dd>` : ''}</dl>
    ${c.gw.length ? `<div class="gwl">${c.gw.map(([n, x, fl]) => `<div><span class="gwn">友好 ${n}</span>${esc(x)}${fl?.once ? '<small>每轮回 1 次</small>' : ''}${fl?.noRefuse ? '<small>不可拒绝</small>' : ''}${fl?.from ? `<small>第 ${fl.from} 轮回起</small>` : ''}</div>`).join('')}</div>` : '<div class="gwl"><div class="none">没有友好能力</div></div>'}
    ${c.src ? `<p class="src">${c.src === '第三方' ? '数值来自社区整理的 5th 卡面，请以实体卡为准' : '数值来自官方旧版速查表'}</p>` : ''}</div>`;
}
const refuseTxt = r => r.refuse === 'must' ? '必定无视友好' : r.refuse === 'may' ? '无视友好' : '';
// One role with its abilities.
export function roleCard(key, who) {
  const r = ROLES[key];
  return `<div class="rref"><div class="rref-h"><b>${r.name}</b>${refuseTxt(r) ? `<em>${refuseTxt(r)}</em>` : ''}${r.cap ? `<em>上限 ${r.cap}</em>` : ''}${who ? `<span>${esc(who)}</span>` : ''}</div>
    ${(r.ab || []).length ? r.ab.map(x => `<p>${esc(x)}</p>`).join('') : `<p class="none">${key === 'person' ? '没有能力' : '没有能力（只有上面的特性）'}</p>`}</div>`;
}
// The whole tragedy set, as on its official summary sheet: public, the same for every script of the set.
export function setRef(setKey) {
  const s = SETS[setKey];
  const plot = k => { const p = PLOTS[k], roles = Object.entries(p.roles).map(([r, n]) => `${ROLES[r].name}${n > 1 ? ` ×${n}` : ''}`).join('、');
    return `<div class="pref"><b>${p.name}</b><span>${roles || '不追加身份'}</span>${[p.setup, p.loss, p.ab].filter(Boolean).map(x => `<p>${esc(x)}</p>`).join('')}</div>`; };
  return `<div class="ref-sec"><h4>规则Y<small>剧本选 1 条</small></h4>${s.y.map(plot).join('')}</div>
    <div class="ref-sec"><h4>规则X<small>剧本选 ${s.xCount} 条</small></h4>${s.x.map(plot).join('')}</div>
    <div class="ref-sec"><h4>身份</h4>${s.roles.map(r => roleCard(r)).join('')}</div>
    <div class="ref-sec"><h4>事件<small>当事人存活且不安达到不安限度时必定发生</small></h4>${s.incidents.map(k => `<div class="pref"><b>${INCIDENTS[k].name}</b><p>${esc(INCIDENTS[k].fx)}</p></div>`).join('')}</div>
    ${s.rules.length ? `<div class="ref-sec"><h4>模组规则</h4><div class="pref">${s.rules.map(x => `<p>${esc(x)}</p>`).join('')}</div></div>` : ''}
    <p class="src">依据 BakaFire 官方「${s.name}」速查表整理</p>`;
}
