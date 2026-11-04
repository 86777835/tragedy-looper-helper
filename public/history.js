// Finished games of the rooms where this device is the Mastermind (each room keeps its own records; needs the room key).
import { SCRIPT, SETS } from './data.js';
import { esc } from './views.js';

let mine = [];
try { mine = (JSON.parse(localStorage.getItem('tl-mine')) || []).filter(r => r && /^[A-Z0-9]{4}$/.test(r.code) && typeof r.key === 'string'); } catch {}
const el = document.getElementById('games');
const day = t => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

(async () => {
  const all = [];
  await Promise.all(mine.map(async r => {
    try {
      const res = await fetch(`/api/room/${r.code}/games`, { method: 'POST', body: JSON.stringify({ key: r.key }) });
      if (res.ok) for (const g of await res.json()) all.push({ ...g, code: r.code });
    } catch {}
  }));
  all.sort((a, b) => b.ended - a.ended);
  el.innerHTML = all.length ? all.map(g => {
    const sc = SCRIPT[g.sid];
    return `<details class="card fq"><summary>${day(g.ended)} · ${sc.no}「${esc(sc.zh)}」<br><small style="color:var(--ink2);font-weight:500">房间 ${g.code} · ${g.result === 'pro' ? '主人公获胜' : '剧作家获胜'} · ${g.loops.length}/${g.max} 轮回${g.finalOk != null ? ` · 最终决战${g.finalOk ? '猜对' : '猜错'}` : ''}</small></summary>
      <div class="tl" style="margin:0 10px 10px">${g.loops.map(l => `<div class="card lp${l.lost ? '' : ' win'}"><h4>第 ${l.n} 轮回<span>${l.lost ? `第 ${l.day} 天失败` : '主人公获胜'}</span></h4>
      <ul>${l.why.map(w => `<li>${esc(w)}</li>`).join('')}${(l.log || []).slice(0, 15).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div></details>`;
  }).join('') : '<div class="empty">还没有结束的对局</div>';
})();
