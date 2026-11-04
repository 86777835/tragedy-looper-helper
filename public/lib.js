// Script library: the 10 scripts of the base set with setup, core mechanics and route suggestions.
// Spoilers: everything here is for the Mastermind, so the page asks before showing anything.
import { SCRIPTS, SCRIPT, SETS } from './data.js';
import { publicSheet, pubSheetOf, privateSheet, notesBlock, esc } from './views.js';

const el = document.getElementById('lib');
const ok = () => { try { return sessionStorage.getItem('tl-spoil') === '1'; } catch { return false; } };

// The chat panel offers Q&A about the script open here (the page is behind the spoiler warning).
function chatScript(sid) { if (window.tlChatScript !== sid) { window.tlChatScript = sid; window.dispatchEvent(new Event('tlchat')); } }

function render() {
  chatScript(ok() ? SCRIPT[location.hash.slice(1)]?.id || null : null);
  if (!ok()) {
    el.innerHTML = `<div class="card gate" style="margin-top:14px"><b>剧透警告</b><p>剧本库里有每个剧本的身份、事件当事人和剧作家路线。<br>如果你要当主人公玩这些剧本，请不要往下看。</p>
      <button class="btn" data-act="spoil">我是剧作家，继续</button><a class="btn ghost" href="./">返回首页</a></div>`;
    return;
  }
  const sc = SCRIPT[location.hash.slice(1)];
  if (!sc) {
    el.innerHTML = `<p class="note secret">基础版 10 个官方剧本，按剧本书顺序。设置数据依据官方剧本整理并和两份独立资料核对过；剧本说明和路线建议是本站自己写的。</p>
      ${['fs', 'btx'].map(set => `<h2 class="h"><span>${SETS[set].name}</span><small>${SETS[set].zh}</small></h2>
      <div class="list">${SCRIPTS.filter(s => s.set === set).map(s => `<a class="card sc-item" href="#${s.id}" style="text-decoration:none">
        <span class="no">${s.no}</span><span class="nm"><b>${esc(s.zh)}</b><span>${esc(s.jp)} · ${s.days} 天 · ${s.opts.map(o => `${o[0]} 轮回`).join(' / ')}</span></span>
        <span class="df"><b>${s.opts.map(o => o[1]).join('/')}</b>难度</span></a>`).join('')}</div>`).join('')}
      <a class="btn ghost" href="./">返回首页</a>`;
    return;
  }
  el.innerHTML = `<h2 class="h"><span>${sc.no}「${esc(sc.zh)}」</span><small>${SETS[sc.set].name}</small></h2>
    ${notesBlock(sc.id).replace('<h2 class="h"><span>路线建议</span>', '<button class="btn" data-act="new" data-sid="' + sc.id + '">用这个剧本开局</button><h2 class="h"><span>路线建议</span>')}
    <h2 class="h"><span>设置</span></h2>${publicSheet(pubSheetOf(sc, 0))}<div style="height:8px"></div>${privateSheet(sc)}
    <a class="btn ghost" href="#">返回剧本列表</a>`;
  window.scrollTo(0, 0);
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'spoil') { try { sessionStorage.setItem('tl-spoil', '1'); } catch {} render(); }
  if (b.dataset.act === 'new') {
    b.disabled = true;
    try {
      const r = await fetch('/api/room', { method: 'POST' }), j = await r.json();
      if (!r.ok) throw new Error(j.error);
      let mine = []; try { mine = JSON.parse(localStorage.getItem('tl-mine')) || []; } catch {}
      try { localStorage.setItem('tl-mine', JSON.stringify([{ code: j.code, key: j.key, t: Date.now() }, ...mine.filter(x => x.code !== j.code)].slice(0, 12))); } catch {}
      location.href = `/?r=${j.code}&pick=${b.dataset.sid}`;
    } catch (err) { b.disabled = false; document.getElementById('toast').innerHTML = `<div class="toast">${esc(err.message || '创建失败，请重试')}</div>`; }
  }
});
window.addEventListener('hashchange', render);
render();
