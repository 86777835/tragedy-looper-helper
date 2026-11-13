// 5-minute teach: a script the teacher reads aloud to start a first game, written from the 5th rulebook and the official
// summary sheets (same wording as tools/讲解稿.md). General rules only: nothing about any script's truth.
// Terms in {text|id} open a note with a picture; the 「问」 buttons and each note's 「问规则助手」 ask the rules assistant
// (chat.js). Pictures: 惨劇コモンズ 5th (BakaFire's image set, CC BY-SA 2.1 JP), the same set as the board in img/c/;
// img/teach/ holds the tokens, the leader card, the chibi art and crops of a character card. Credited in the footer.
const ICON = (src, cls = '') => src ? `<img class="ico ${cls}" src="img/${src}.webp" alt="">` : '';

// id: name, where you see it on the table, what it means. icon: a picture under img/.
const TERMS = {
  mm: { name: '剧作家', icon: 'teach/mm', where: '一个人，手里拿着剧本和非公开信息卡。', what: '照剧本操纵角色和事件，目标是让主人公每个轮回都失败。剧本里的一切他都知道。' },
  pro: { name: '主人公', icon: 'teach/pro', where: '其余 1–3 名玩家，各拿一套 8 张的主人公行动牌。', what: '一起阻止惨剧。一开始什么都不知道，靠一个个轮回摸清剧本。' },
  leader: { name: '队长卡', icon: 'teach/leader', where: '印着 Leader 的卡，放在当天队长面前。', what: '队长第一个出牌，在主人公能力阶段负责宣言用哪个友好能力。每天结束交给左手边的主人公。' },
  loop: { name: '轮回', icon: 'teach/loop', where: '轮回指示物，标着现在是第几个轮回。', what: '同一段日子从头再来一遍就是一个轮回。剧本不变，角色回到初始区域、指示物清空，主人公带着经验再来。轮回数写在公开信息卡上。' },
  day: { name: '日数', icon: 'teach/day', where: '日数指示物，标着今天是第几天。', what: '每个轮回有固定的天数，写在公开信息卡上。最后一天结束，这个轮回就结束。' },
  incident: { name: '事件', icon: 'teach/incident', where: '事件指示物，放在对应的那一天。', what: '公开信息卡写着哪天有什么事件。那天当事人还活着、不安达到不安限度，事件就必定发生。当事人是谁只有剧作家知道。' },
  g: { name: '友好', icon: 'teach/g', where: '粉色心形指示物，放在角色卡上。', what: '只有主人公能放。攒够卡上要求的数量，就能用这个角色的友好能力，用了不消耗。' },
  p: { name: '不安', icon: 'teach/p', where: '紫色火焰指示物，放在角色卡上。', what: '双方都能放。事件当事人的不安达到不安限度，那天的事件就会发生。' },
  i: { name: '密谋', icon: 'teach/i', where: '金色指示物，放在角色卡或版图上。', what: '只有剧作家能放。很多失败条件看的就是某个角色或版图上有几枚密谋。' },
  hospital: { name: '医院', icon: 'teach/bd-hospital', where: '左上那块版图。', what: '竖着移动到都市，横着移动到神社，斜着移动到学校。' },
  shrine: { name: '神社', icon: 'teach/bd-shrine', where: '右上那块版图。', what: '竖着移动到学校，横着移动到医院，斜着移动到都市。' },
  city: { name: '都市', icon: 'teach/bd-city', where: '左下那块版图。', what: '竖着移动到医院，横着移动到学校，斜着移动到神社。' },
  school: { name: '学校', icon: 'teach/bd-school', where: '右下那块版图。', what: '竖着移动到神社，横着移动到都市，斜着移动到医院。' },
  card: { name: '角色卡', icon: 'c/cs-doctor', where: '版图上的一张张人物卡。', what: '卡上印着不安限度、属性、初始区域和禁止区域、友好能力。身份不印在卡上，只写在剧作家的非公开信息卡里。' },
  limit: { name: '不安限度', icon: 'teach/limit', where: '角色卡左上角的数字（日文写作「不安臨界」）。', what: '这个角色身上的不安达到这个数，以他为当事人的事件就会在那天发生。' },
  area: { name: '初始区域和禁止区域', icon: 'teach/area', where: '角色卡右上角 2×2 的小格，排法和四块版图一样。', what: '画着地点图标的格是初始区域，每个轮回从那开始；打叉的格是禁止区域，角色进不去，往那儿移动的牌无效。' },
  tags: { name: '属性', icon: 'teach/tags', where: '角色卡右侧的标签，比如学生、少女、大人、男性。', what: '有些能力只对某种属性的角色生效，比如“同区域的学生”。' },
  gwab: { name: '友好能力', icon: 'teach/gwab', where: '角色卡下方，前面的粉心数就是需要几枚友好。', what: '友好够数时，队长在主人公能力阶段宣言使用。有的每轮回只能用 1 次。身份带“无视友好”的角色，剧作家可以拒绝。' },
  mmcard: { name: '剧作家行动牌', icon: 'c/mm-back', where: '剧作家手上的 10 张牌。', what: '每天背面朝上放 3 张，放在 3 个不同的角色或版图上。' },
  procard: { name: '主人公行动牌', icon: 'c/p1-back', where: '每名主人公 8 张，三套颜色不同。', what: '每天主人公一共放 3 张，背面朝上，从队长开始。主人公之间不能放在同一个目标上，可以叠在剧作家的牌上。' },
  move: { name: '移动牌', icon: 'c/p1-V', where: '画着箭头的行动牌：↑↓ 是竖着移动，←→ 是横着移动。', what: '把角色移到相邻的版图。同一角色上的两张移动牌合成一次：竖加横就是斜着走。' },
  diag: { name: '移动斜向', icon: 'c/mm-mD', where: '剧作家才有的移动牌，每轮回 1 次。', what: '把角色直接移到对角的版图。' },
  fM: { name: '移动禁止', icon: 'c/p1-fM', where: '主人公的牌，每轮回 1 次。', what: '抵消同一角色上的移动牌，角色留在原地。' },
  g1: { name: '友好+1', icon: 'c/p1-g1', where: '主人公的牌；还有一张友好+2，每轮回 1 次。', what: '给这个角色放友好。' },
  pp: { name: '不安±1', icon: 'c/mm-p1a', where: '双方都有：剧作家有两张不安+1、一张不安−1；主人公有不安+1 和不安−1（每轮回 1 次）。', what: '给角色加或减 1 枚不安。同一角色上同时有 +1 和 −1，先加后减。' },
  i1: { name: '密谋+1', icon: 'c/mm-i1', where: '剧作家的牌；还有一张密谋+2，每轮回 1 次。', what: '给角色或版图放密谋。' },
  fI: { name: '禁止密谋', icon: 'c/p1-fI', where: '主人公的牌。', what: '抵消同一目标上的密谋牌。两名以上主人公同一天都出了它，这些禁止密谋全部失效。' },
  fG: { name: '禁止友好', icon: 'c/mm-fG', where: '剧作家的牌。', what: '抵消同一角色上的友好牌。' },
  fP: { name: '禁止不安', icon: 'c/mm-fP', where: '剧作家的牌。', what: '抵消同一角色上的不安牌。' },
  once: { name: '每轮回限 1 次', icon: 'c/p1-g2', where: '牌上印着“1ループに1回まで”。', what: '用过后正面朝上放在自己面前，本轮回不能再用，下一个轮回收回。' }
};

// The script: what to read aloud. Every important element gets one sentence; exact rulings are for the assistant.
const PARTS = [
  { title: '这是什么游戏', sec: 40, lines: [
    '这局玩《惨剧轮回》。我先讲一遍主流程，讲完再一条条过注意事项。',
    '一人当{剧作家|mm}，其余人当{主人公|pro}。剧作家手里的剧本写好了一切：每个角色的真实身份、哪天发生什么事件、主人公怎样会失败。',
    '主人公一开始什么都不知道，但能回溯时间：同一段日子会重来好几个{轮回|loop}，剧本不变，变的只有大家的经验。',
    '主人公只要有一个轮回撑到最后一天结束、没有失败，就赢；剧作家要让每个轮回都失败。'
  ], ask: ['哪些情况下轮回会提前结束？', 'First Steps 和 Basic Tragedy X 有什么不同？'] },
  { title: '桌上有什么', sec: 30, lines: [
    '4 块版图：左上{医院|hospital}、右上{神社|shrine}、左下{都市|city}、右下{学校|school}。',
    '每个人物是一张{角色卡|card}，印着{不安限度|limit}、{属性|tags}、{初始区域和禁止区域|area}，还有{友好能力|gwab}。身份不印在卡上。',
    '三种指示物：{友好|g}只有主人公能放，攒够了能用角色的友好能力；{不安|p}双方都能放，事件靠它触发；{密谋|i}只有剧作家能放，角色和版图上都能放。'
  ], ask: ['「同区域的角色」包括自己吗？', '身份无视友好的角色还能被放友好吗？'] },
  { title: '剧本和信息卡', sec: 35, lines: [
    '剧作家写一张公开信息卡交给大家：用哪个惨剧模组、几个轮回、每轮回几天，以及哪天有什么{事件|incident}。',
    '非公开信息卡只有剧作家看：规则Y、规则X、每个角色的身份、每个事件的当事人。规则决定了有哪些身份和失败条件，没分到身份的角色是平民。',
    '模组速查表大家都能看，上面列着这个模组所有可能的规则、身份和事件，主人公就靠它推理。'
  ], ask: ['事件当事人要公开吗？', '组合规则时身份会超过上限吗？'] },
  { title: '一天怎么走', sec: 50, lines: [
    '每天分 9 个阶段，最要紧的是这几步：',
    '**剧作家行动**：剧作家把 3 张{行动牌|mmcard}背面朝上，放在 3 个不同的角色或版图上。',
    '**主人公行动**：从拿{队长卡|leader}的人开始，主人公一共放 3 张{行动牌|procard}，也是背面朝上。',
    '**行动结算**：6 张一起翻开，先结算移动，再结算其他牌。',
    '**剧作家能力**：剧作家用身份和规则给的能力，比如放密谋、放不安。',
    '**主人公能力**：队长宣言要用哪个角色的友好能力，剧作家决定结算还是拒绝。',
    '然后是**事件**判定、**队长交接**（队长卡交给左手边），最后**回合结束**，结算杀手、杀人狂这类回合结束时的能力。'
  ], ask: ['一天有哪几个阶段？', '剧作家和主人公各出几张牌？能放在同一个目标上吗？'] },
  { title: '行动牌', sec: 30, lines: [
    '牌有{移动|move}、{友好+1|g1}、{不安±1|pp}、{密谋+1|i1}，还有禁止类：{禁止密谋|fI}、{禁止友好|fG}、{禁止不安|fP}、{移动禁止|fM}，它们抵消同一目标上的对应牌。',
    '剧作家有{移动斜向|diag}，主人公没有。印着{每轮回限 1 次|once}的牌，用过就要等下个轮回。',
    '同一角色身上两张移动牌合成一次移动：竖加横，就是斜着走。'
  ], ask: ['两张移动牌放在同一个角色上怎么算？', '多名主人公同一天都打出「禁止密谋」会怎样？'] },
  { title: '事件、死亡和失败', sec: 30, lines: [
    '公开信息卡写了{事件|incident}的那天，当事人还活着、{不安|p}达到{不安限度|limit}，事件就必定发生，剧作家不能说不发生。',
    '剧作家宣布时只说发生了什么，不说当事人是谁，也不说为什么。',
    '角色死了就成为尸体：不能放牌，也不再算角色。关键人物死亡或主人公死亡，轮回立刻结束，主人公失败；其他失败条件在轮回结束时检查。'
  ], ask: ['事件什么时候一定会发生？', '事件发生了但没有任何效果，要怎么宣布？'] },
  { title: '轮回和最终决战', sec: 35, lines: [
    '最后一天结束，剧作家确认失败条件：都没满足，主人公获胜；满足了，就开始下一个{轮回|loop}。',
    '轮回之间是时之缝隙，主人公可以自由商量。所有角色回到初始区域，指示物清空，用过的牌收回。',
    '所有轮回都失败了：First Steps 模组剧作家直接获胜；Basic Tragedy X 还有最终决战，主人公说出每个角色的身份，全对就赢，错一个就输。'
  ], ask: ['最终决战怎么进行？', '轮回结束后怎么复位？'] },
  { title: '剧作家要记住的', sec: 35, lines: [
    '标着强制的能力，条件一满足就必须结算，比如杀人狂；任意能力可以为了藏身份故意不用。',
    '身份带“无视友好”的角色可以拒绝友好能力，带“必定无视友好”的必须拒绝；被拒绝的每轮回 1 次的能力也算用过。',
    '剧作家可以在本站建房间，按阶段看提醒、记指示物，主人公扫码看公开的版图。流程就这些，接下来过一遍注意事项。'
  ], ask: ['强制能力和任意能力同时满足条件，先结算哪个？', '哪些角色可以拒绝友好能力？'] }
];

// 注意事项: fine points outside the main flow that are easy to get wrong. Read them one by one after the script.
// Each has a written answer (from tools/faq.json, i.e. the rulebook and the official FAQ); the rest goes to the assistant.
// [title, answer, question for the assistant]
const NOTES = [
  ['两张移动牌叠在同一个角色上', '合成一次移动：竖加横是斜，竖加斜是横，横加斜是竖；两张方向相同只移动一次。合成后的目的地是禁止区域，这次移动无效，角色留在原地。', '两张移动牌放在同一个角色上怎么算？'],
  ['不安+1 和不安−1 叠在一起', '先 +1 再 −1。原来没有不安的角色，结果还是 0。', '同一角色上同时有不安+1 和不安−1，结果是多少？'],
  ['两个人都出了禁止密谋', '两名以上主人公同一天都出了{禁止密谋|fI}，这些禁止密谋全部失效。', '多名主人公同一天都打出「禁止密谋」会怎样？'],
  ['禁止类牌挡不住能力和事件', '禁止类牌只抵消同一目标上的行动牌，结算完就回到手牌，管不到之后身份能力或事件放的指示物。', '禁止类牌能挡住身份能力或事件放的指示物吗？'],
  ['出牌的限制', '剧作家的 3 张必须放在 3 个不同的目标上；主人公之间不能放在同一个目标，但可以叠在剧作家的牌上。禁止类牌和没有效果的牌也能放在版图上，常用来虚张声势。尸体上不能放牌。', '剧作家和主人公各出几张牌？能放在同一个目标上吗？'],
  ['「每轮回限 1 次」的牌', '结算后正面朝上放在自己面前，本轮回不能再用，下一个轮回收回。', '「每轮回限1次」的牌用完怎么处理？'],
  ['「同区域」包括自己', '除非写明“自身以外”，同区域的角色包括它自己。所以传谣人可以给自己放不安，主谋可以给自己放密谋。', '「同区域的角色」包括自己吗？'],
  ['剧作家能力每天各用 1 次', '每个可用的能力各用 1 次，同一角色的两个能力可以都用。主谋、传谣人每天只能选一个对象。', '剧作家能力阶段每个能力能用几次？'],
  ['强制能力先结算', '同一时机的强制能力同时结算，并且先于所有任意能力。例如杀手和杀人狂独处、身上有 4 枚密谋：杀人狂先把它杀掉，杀手的能力就来不及用。', '强制能力和任意能力同时满足条件，先结算哪个？'],
  ['谁能拒绝友好能力', '看拥有这个能力的角色：身份带“无视友好”，剧作家可以拒绝；带“必定无视友好”，必须拒绝。卡面写“不可拒绝”的能力谁也不能拒绝。剧作家在队长宣言并指定目标之后才决定。', '哪些角色可以拒绝友好能力？'],
  ['被拒绝也算用过', '「每轮回限 1 次」的友好能力被拒绝了，5th 规则算用过。身份无视友好的角色照样可以被放友好，拒绝只发生在主人公能力阶段。', '「每轮回限1次」的友好能力被拒绝了，还算用过吗？'],
  ['剧作家一般不能用友好能力', '友好能力是主人公的。医生例外：医生的身份无视友好、且身上至少 2 枚友好时，剧作家可以在剧作家能力阶段用它的不安增减能力。', '剧作家能用角色的友好能力吗？'],
  ['事件只在那一天判定', '只在公开信息卡写的那天判定：当事人存活、{不安|p}不少于{不安限度|limit}，就必定发生，剧作家不能选择不发生。当事人死了，事件就不发生。', '事件什么时候一定会发生？'],
  ['发生了但没效果也要说', '要宣布“事件发生了，但什么也没有发生”，让主人公知道事件发生了。当事人是谁不公开。', '事件发生了但没有任何效果，要怎么宣布？'],
  ['尸体不是角色', '死亡的角色成为尸体：不能放牌、不能被能力指定，也不算人数（杀人狂“同区域只有 1 人”时也不算它）。尸体上的指示物一直留到轮回结束。', '尸体能被能力指定吗？算人数吗？'],
  ['轮回什么时候提前结束', '主人公死亡、关键人物死亡、时间旅者在最后一天判负，轮回立刻结束。其他失败条件都在轮回结束时才判定。', '哪些情况下轮回会提前结束？'],
  ['失败时说不说原因', '同时满足好几条失败条件，剧作家只说“你们失败了”，不用说是哪条。但死亡的亲友必须公开身份。', '同时满足好几条失败条件，剧作家要说是哪一条吗？'],
  ['剧作家不必让事件都发生', '不必。为了藏住规则，故意不推进某些事件，是官方推荐的做法。', '剧作家必须尽量让所有事件发生吗？'],
  ['最终决战乱猜也算', '最终决战先复位：指示物清空，所有角色存活回到初始区域。主人公一个一个说出身份，可以相谈；乱猜猜中也算，不需要理由。猜错一个，剧作家就赢。', '最终决战怎么进行？'],
  ['还没登场的角色', '角色还没登场时，它的身份能力不生效。', '角色还没登场时，它的身份能力生效吗？']
];

// Icon guide, grouped the way things sit on the table.
const GROUPS = [
  ['玩家', ['mm', 'pro', 'leader']],
  ['指示物', ['g', 'p', 'i', 'loop', 'day', 'incident']],
  ['版图', ['hospital', 'shrine', 'city', 'school']],
  ['角色卡', ['card', 'limit', 'area', 'tags', 'gwab']],
  ['行动牌', ['mmcard', 'procard', 'move', 'diag', 'fM', 'g1', 'pp', 'i1', 'fI', 'fG', 'fP', 'once']]
];

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const term = (text, id) => `<button type="button" class="term" data-t="${id}">${ICON(TERMS[id].icon)}${esc(text)}</button>`;
const line = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\{([^|}]+)\|(\w+)\}/g, (_, t, id) => term(t, id));
// inside a button the terms show their icon but are not buttons themselves
const label = s => esc(s).replace(/\{([^|}]+)\|(\w+)\}/g, (_, t, id) => `<span class="tlab">${ICON(TERMS[id].icon)}${esc(t)}</span>`);
const askBtn = (text, q) => `<button type="button" class="tq" data-q="${esc(q)}">问 <span>${label(text)}</span></button>`;

document.getElementById('teach').innerHTML = `
  <p class="tlead">讲的人先照着念主流程（约 5 分钟），再一条条过注意事项。<b>带下划线的词</b>点一下看图和解释；有疑问点「问」，规则助手马上回答。这一页只讲通用规则，不涉及任何剧本，主人公也可以看。</p>
  <nav class="tnav">${PARTS.map((p, i) => `<a href="#p${i + 1}"><i>${i + 1}</i>${p.title}</a>`).join('')}<a href="#later">注意事项</a><a href="#icons">图标速查</a></nav>
  ${PARTS.map((p, i) => `<section class="card tpart" id="p${i + 1}">
    <h2 class="h"><span><i>${i + 1}</i>${p.title}</span><small>约 ${p.sec} 秒</small></h2>
    ${p.lines.map(s => `<p class="tline">${line(s)}</p>`).join('')}
    <div class="tasks"><em>桌上常见疑问</em>${p.ask.map(q => askBtn(q, q)).join('')}</div>
  </section>`).join('')}
  <section class="card tpart" id="later">
    <h2 class="h"><span><i>✓</i>注意事项</span><small>${NOTES.length} 条</small></h2>
    <p class="tnote">流程讲完后，一条一条过一遍。都是规则书和官方 FAQ 里写了、但最容易漏掉或吵起来的地方。点开就是答案。</p>
    <div class="tnotes">${NOTES.map(([t, a, q], i) => `<details class="tni"><summary><i>${i + 1}</i>${esc(t)}</summary><p>${line(a)}</p>${askBtn('还有疑问？问规则助手', q)}</details>`).join('')}</div>
    <p class="tnote">注意事项里没有的，点右下角「规则」问 AI，本站资料查不到会联网找。</p>
  </section>
  <a class="btn tgo" href="/">讲完了，去建房间</a>
  <h2 class="h" id="icons"><span>图标速查</span><small>点图看解释</small></h2>
  ${GROUPS.map(([g, ids]) => `<div class="card tgrid"><h3>${g}</h3><div>${ids.map(id => `<button type="button" class="tic" data-t="${id}">${ICON(TERMS[id].icon)}<span>${TERMS[id].name}</span></button>`).join('')}</div></div>`).join('')}
  <footer>依据《惨剧RoopeR 5th》官方规则书和官方速查表，用自己的话整理 · 非官方玩家工具<br>图片来自<a href="https://bakafire.main.jp/rooper/sr_dl_04_sozai.htm" target="_blank" rel="noopener">惨劇コモンズ 5th</a>（惨劇コモンズ作成：BakaFire、紺ノ玲），依 CC BY-SA 2.1 JP 使用<br>原作《惨劇RoopeR》BakaFire Party</footer>`;

// The note for a term: a sheet from the bottom with the picture, where it is and what it means.
const sheet = document.createElement('div');
sheet.className = 'tsheet hidden';
document.body.appendChild(sheet);
const close = () => sheet.classList.add('hidden');
function show(id) {
  const t = TERMS[id];
  sheet.innerHTML = `<div class="tsbg"></div><div class="tsbox" role="dialog" aria-label="${esc(t.name)}">
    <div class="tshd">${ICON(t.icon, 'big')}<b>${esc(t.name)}</b><button type="button" class="tsx" aria-label="关闭">×</button></div>
    <p><em>在哪儿看到</em>${esc(t.where)}</p><p><em>什么意思</em>${esc(t.what)}</p>
    <button type="button" class="btn navy tsask" data-q="${esc(`「${t.name}」是什么，怎么用？`)}">还不懂？问规则助手</button></div>`;
  sheet.classList.remove('hidden');
}
const ask = q => { close(); window.askRules?.(q); };
document.addEventListener('click', e => {
  const t = e.target.closest('[data-t]');
  if (t) return show(t.dataset.t);
  const q = e.target.closest('[data-q]');
  if (q) return ask(q.dataset.q);
  if (e.target.closest('.tsx,.tsbg')) close();
});
addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
