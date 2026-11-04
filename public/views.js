// Script sheets and notes, shared by the room page (app.js) and the script library (lib.js).
import { LOC_ZH, CHARS, ROLES, PLOTS, INCIDENTS, SETS } from './data.js';
import { NOTES } from './notes.js';
const extraOf = (sc, id) => (sc.extra || {})[id] || {};
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The public script sheet (公开信息表): what goes on the table for everyone.
export function publicSheet(sh, happened) {
  return `<div class="card sheetc"><h3>公开信息卡 <em>公开</em></h3>
    <dl class="kv"><dt>惨剧模组</dt><dd>${esc(sh.set)}${sh.setRules.length ? `（${sh.setRules.map(esc).join('，')}）` : ''}</dd>
    <dt>轮回数</dt><dd><b>${sh.loops}</b> 轮回</dd><dt>天数</dt><dd>每轮回 <b>${sh.days}</b> 天</dd>
    <dt>特殊规则</dt><dd>${sh.special.length ? sh.special.map(esc).join('；') : '无'}</dd></dl>
    <table class="tb"><tr><th>日期</th><th>事件</th>${happened ? '<th>本轮回</th>' : ''}</tr>
    ${sh.incidents.map((it, k) => `<tr><td>第 ${it.day} 天</td><td>${esc(it.name)}</td>${happened ? `<td>${happened[k] === 'yes' ? '<b style="color:var(--red2)">已发生</b>' : happened[k] === 'no' ? '未发生' : '—'}</td>` : ''}</tr>`).join('')}</table></div>`;
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

