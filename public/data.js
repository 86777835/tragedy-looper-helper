// Game data for 《惨剧轮回》 (Tragedy Looper, BakaFire Party), base set of the 5th edition
// (the Chinese edition by 神秘岛桌游 is a translation of it).
// Rules, roles and incidents follow BakaFire's official summary sheets for First Steps and Basic Tragedy X
// (bakafire.main.jp/rooper/sr_dl_03_set.htm). Names follow the Chinese edition's terms as collected by
// the Chinese fan wiki (tragedyrooper.fandom.com/zh). Ability texts are short rewordings, not card text.
// Script setups are structured data only (who has which role, which incident on which day); see README for sources.

export const LOCS = ['hospital', 'shrine', 'city', 'school'];   // board order: top-left, top-right, bottom-left, bottom-right
export const LOC_ZH = { hospital: '医院', shrine: '神社', city: '都市', school: '学校' };

// Character cards. limit = 不安限度; start = 初始区域 (null: chosen by the Mastermind each loop);
// forbid = 禁止区域; gw = goodwill abilities [goodwill needed, short text, flags]; trait = special trait.
// flags: once = 每轮回限1次, noRefuse = 不可拒绝 (even a role that ignores goodwill can't refuse), from = usable from loop N.
// src: where the numbers come from when it isn't a 5th-edition card ('旧速' = the older official summary sheet,
// '第三方' = community data only). The six characters new in the 5th edition rely on community data.
export const CHARS = {
  boyStudent:   { name: '男学生', tags: ['学生', '少年'], limit: 2, start: 'school', gw: [[2, '同区域自身以外 1 名学生 −1 不安']] },
  girlStudent:  { name: '女学生', tags: ['学生', '少女'], limit: 3, start: 'school', gw: [[2, '同区域自身以外 1 名学生 −1 不安']] },
  richStudent:  { name: '大小姐', tags: ['学生', '少女'], limit: 1, start: 'school', gw: [[3, '在学校或都市时：同区域 1 名角色 +1 友好']] },
  classRep:     { name: '班长', tags: ['学生', '少女'], limit: 2, start: 'school', gw: [[2, '队长取回 1 张已用过的「每轮回限1次」行动牌', { once: true }]], src: '旧速' },
  mysteryBoy:   { name: '局外人', tags: ['学生', '少年'], limit: 3, start: 'school', gw: [[3, '剧作家告知局外人自己的身份', { noRefuse: true, from: 2 }]],
                  trait: '一定拿到本剧本没选用的规则里的身份', src: '旧速' },
  shrineMaiden: { name: '巫女', tags: ['学生', '少女'], limit: 2, start: 'shrine', forbid: ['city'], gw: [[3, '在神社时：神社 −1 密谋'], [5, '告知同区域 1 名角色（可含自己）的身份', { once: true }]] },
  alien:        { name: '异界人', tags: ['少女'], limit: 2, start: 'shrine', forbid: ['hospital'], gw: [[4, '同区域自身以外 1 名角色死亡', { once: true }], [5, '同区域 1 具尸体复活', { once: true }]], src: '旧速' },
  godlyBeing:   { name: '神灵', tags: ['男性', '女性'], limit: 3, start: 'shrine', gw: [[3, '告知公开表上 1 个事件的当事人', { once: true }], [5, '同区域 1 名角色或所在版图 −1 密谋']],
                  trait: '到剧本指定的轮回才登场', src: '旧速' },
  policeOfficer:{ name: '刑警', tags: ['大人', '男性'], limit: 3, start: 'city', gw: [[4, '告知本轮回已发生的 1 个事件的当事人', { once: true }], [5, '给同区域 1 名角色放护卫指示物（将死亡时改为移除护卫）', { once: true }]] },
  officeWorker: { name: '职员', tags: ['大人', '男性'], limit: 2, start: 'city', forbid: ['school'], gw: [[3, '剧作家告知职员自己的身份']] },
  informer:     { name: '情报商', tags: ['大人', '女性'], limit: 3, start: 'city', gw: [[5, '队长说出 1 条规则X 的名称，剧作家告知剧本里另 1 条规则X', { once: true }]] },
  popIdol:      { name: '偶像', tags: ['学生', '少女'], limit: 2, start: 'city', gw: [[3, '同区域自身以外 1 名角色 −1 不安'], [4, '同区域自身以外 1 名角色 +1 友好']] },
  journalist:   { name: '媒体人', tags: ['大人', '男性'], limit: 2, start: 'city', gw: [[2, '任意区域自身以外 1 名角色 +1 不安'], [2, '同区域 1 名角色或所在版图 +1 密谋']], src: '旧速' },
  boss:         { name: '大人物', tags: ['大人', '男性'], limit: 4, start: 'city', gw: [[5, '告知领地里自身以外 1 名角色的身份', { once: true }]],
                  trait: '能力也可以对领地使用（领地由剧本指定）', src: '旧速' },
  doctor:       { name: '医生', tags: ['大人', '男性'], limit: 2, start: 'hospital', gw: [[2, '同区域自身以外 1 名角色 ±1 不安（主人公选加或减）'], [3, '本轮回住院患者没有禁止区域']],
                  trait: '身份无视友好且有 2 枚以上友好时，剧作家也能在剧作家能力阶段用它的第一个能力' },
  patient:      { name: '住院患者', tags: ['少年'], limit: 2, start: 'hospital', forbid: ['shrine', 'city', 'school'], gw: [] },
  nurse:        { name: '护士', tags: ['大人', '女性'], limit: 3, start: 'hospital', gw: [[2, '同区域自身以外 1 名不安达到限度的角色 −1 不安', { noRefuse: true }]], src: '旧速' },
  henchman:     { name: '手下', tags: ['大人', '男性'], limit: 1, start: null, gw: [[3, '本轮回以手下为当事人的事件不再发生']], trait: '初始区域每轮回由剧作家决定', src: '旧速' },
  transferStudent: { name: '转校生', tags: ['学生', '少女'], limit: 2, start: 'school', gw: [[2, '同区域自身以外 1 名角色：移除 1 枚密谋，换成 1 枚友好']], trait: '剧本指定的那天才登场', src: '第三方' },
  forensicSpecialist: { name: '鉴别员', tags: ['大人', '男性'], limit: 3, start: 'city', gw: [[2, '同区域另 2 名角色之间移动 1 枚指示物', { once: true }], [5, '告知 1 具尸体的身份', { once: true }]], src: '第三方' },
  ai:           { name: 'A.I.', tags: [], limit: 4, start: 'city', forbid: ['shrine', 'hospital', 'school'], gw: [[3, '队长选公开表上 1 个事件，以 A.I. 为当事人结算其效果', { once: true }]],
                  trait: '不能是平民；判定以 A.I. 为当事人的事件时，身上所有指示物都算作不安', allTokens: true, src: '第三方' },
  teacher:      { name: '教师', tags: ['大人', '女性'], limit: 2, start: 'school', gw: [[3, '同区域 1 名学生 ±1 不安（主人公选加或减）'], [4, '告知同区域 1 名学生的身份', { once: true }]], src: '第三方' },
  soldier:      { name: '军人', tags: ['大人', '男性'], limit: 3, start: 'hospital', gw: [[2, '同区域自身以外 1 名角色 +2 不安', { once: true }], [5, '本轮回主人公不会死亡', { once: true }]], src: '第三方' },
  blackCat:     { name: '黑猫', tags: ['动物'], limit: 0, start: 'shrine', gw: [],
                  trait: '每轮回开始时神社 +1 密谋；以黑猫为当事人的事件照常“发生”，但没有效果', loopShrine: 1, noEffect: true, src: '第三方' }
};

// Roles. refuse: 'may' = 无视友好 (may refuse goodwill abilities), 'must' = 必定无视友好 (always refuses).
// cap = 上限 (most of this role a script may have).
export const ROLES = {
  person:     { name: '平民' },
  keyPerson:  { name: '关键人物', ab: ['【强制·该角色死亡时】主人公失败，立即结束本轮回'] },
  killer:     { name: '杀手', refuse: 'may', ab: ['【任意·回合结束阶段】同区域的关键人物身上有 2 枚以上密谋 → 关键人物死亡', '【任意·回合结束阶段】自身有 4 枚以上密谋 → 主人公死亡'] },
  brain:      { name: '主谋', refuse: 'may', ab: ['【任意·剧作家能力阶段】在同区域 1 名角色或自身所在版图上放 1 枚密谋'] },
  cultist:    { name: '邪教徒', refuse: 'must', ab: ['【任意·行动结算阶段】可无视放在同区域角色或自身所在版图上的禁止密谋'] },
  conspiracyTheorist: { name: '传谣人', cap: 1, ab: ['【任意·剧作家能力阶段】给同区域 1 名角色放 1 枚不安'] },
  serialKiller: { name: '杀人狂', ab: ['【强制·回合结束阶段】同区域只有另外 1 名角色 → 那名角色死亡'] },
  curmudgeon: { name: '暴徒', refuse: 'may' },
  friend:     { name: '亲友', cap: 2, ab: ['【失败条件·轮回结束时】该角色已死亡（此时公开其身份）', '【强制·轮回开始时】身份曾被公开过 → 给该角色放 1 枚友好'] },
  timeTraveler: { name: '时间旅者', ab: ['【强制·常驻】不死', '【强制·行动结算阶段】无视放在该角色身上的禁止友好', '【任意·最后一天的回合结束阶段】该角色友好 2 枚以下 → 主人公失败，立即结束本轮回'] },
  witch:      { name: '魔女', refuse: 'must' },
  lover:      { name: '心上人', ab: ['【强制·求爱者死亡时】给该角色放 6 枚不安'] },
  lovedOne:   { name: '求爱者', ab: ['【强制·心上人死亡时】给该角色放 6 枚不安', '【任意·回合结束阶段】该角色有 1 枚以上密谋且 3 枚以上不安 → 主人公死亡'] },
  factor:     { name: '不安定因子', refuse: 'may', ab: ['【强制·常驻】学校有 2 枚以上密谋 → 获得传谣人的能力', '【强制·常驻】都市有 2 枚以上密谋 → 获得关键人物的能力（身份不变）'] }
};

// Main plots (规则Y) and subplots (规则X). roles: role → count added by this rule.
// loss: loss condition checked at loop end; ab: extra abilities.
export const PLOTS = {
  murderPlan:    { name: '谋杀计划', roles: { keyPerson: 1, killer: 1, brain: 1 } },
  lightAvenger:  { name: '复仇的火种', roles: { brain: 1 }, loss: '【失败条件·轮回结束时】主谋的初始区域有 2 枚以上密谋' },
  placeProtect:  { name: '守护此地', roles: { keyPerson: 1, cultist: 1 }, loss: '【失败条件·轮回结束时】学校有 2 枚以上密谋' },
  sealedItem:    { name: '被封印的邪灵', roles: { brain: 1, cultist: 1 }, loss: '【失败条件·轮回结束时】神社有 2 枚以上密谋' },
  signWithMe:    { name: '和我签订契约吧！', roles: { keyPerson: 1 }, setup: '【强制·剧本制作时】关键人物必须是少女', loss: '【失败条件·轮回结束时】关键人物身上有 2 枚以上密谋' },
  changeOfFuture:{ name: '改变未来', roles: { cultist: 1, timeTraveler: 1 }, loss: '【失败条件·轮回结束时】本轮回发生过蝴蝶效应' },
  giantTimeBomb: { name: '巨大定时炸弹X', roles: { witch: 1 }, loss: '【失败条件·轮回结束时】魔女的初始区域有 2 枚以上密谋' },
  shadowRipper:  { name: '开膛者的魔影', roles: { conspiracyTheorist: 1, serialKiller: 1 } },
  unsettlingRumor: { name: '流言四起', roles: { conspiracyTheorist: 1 }, ab: '【任意·剧作家能力阶段】在任意 1 块版图上放 1 枚密谋（每轮回限 1 次）' },
  hideousScript: { name: '最黑暗的剧本', roles: { conspiracyTheorist: 1, curmudgeon: 2, friend: 1 }, setup: '【任意·剧本制作时】暴徒可以只放 1 人或 0 人' },
  circleFriends: { name: '好友圈', roles: { friend: 2, conspiracyTheorist: 1 } },
  loveAffair:    { name: '恋爱风景线', roles: { lover: 1, lovedOne: 1 } },
  hiddenFreak:   { name: '潜伏的杀人狂', roles: { friend: 1, serialKiller: 1 } },
  paranoiaVirus: { name: '妄想扩大病毒', roles: { conspiracyTheorist: 1 }, ab: '【强制·常驻】平民只要有 3 枚以上不安，身份就变为杀人狂' },
  threadsFate:   { name: '因果线', roles: {}, ab: '【强制·轮回开始时】上一轮回结束时有友好的所有角色，各放 2 枚不安' },
  unknownFactor: { name: '未知因子χ', roles: { factor: 1 } }
};

export const INCIDENTS = {
  murder:          { name: '谋杀', fx: '与当事人同区域的另外 1 名角色死亡' },
  increasingUnease:{ name: '不安扩散', fx: '给任意 1 名角色放 2 枚不安，再给另 1 名角色放 1 枚密谋' },
  suicide:         { name: '自杀', fx: '当事人死亡' },
  hospitalIncident:{ name: '医院事故', fx: '医院有 1 枚以上密谋 → 在医院的所有角色死亡；医院有 2 枚以上密谋 → 主人公死亡' },
  farawayMurder:   { name: '远距离杀人', fx: '任意 1 名有 2 枚以上密谋的角色死亡' },
  missingPerson:   { name: '失踪', fx: '把当事人移到任意版图，再在当事人所在版图放 1 枚密谋' },
  spreading:       { name: '散播', fx: '从任意 1 名角色身上移除 2 枚友好，再给另 1 名角色放 2 枚友好' },
  foulEvil:        { name: '邪气污染', fx: '在神社放 2 枚密谋' },
  butterflyEffect: { name: '蝴蝶效应', fx: '给与当事人同区域的 1 名角色放 1 枚任意指示物（友好、不安或密谋）' }
};

export const SETS = {
  fs: {
    name: 'First Steps', zh: '新手模组',
    y: ['murderPlan', 'lightAvenger', 'placeProtect'], x: ['shadowRipper', 'unsettlingRumor', 'hideousScript'],
    xCount: 1, finalGuess: false,
    incidents: ['murder', 'increasingUnease', 'suicide', 'hospitalIncident', 'farawayMurder', 'missingPerson', 'spreading'],
    roles: ['keyPerson', 'killer', 'brain', 'cultist', 'conspiracyTheorist', 'serialKiller', 'curmudgeon', 'friend', 'person'],
    rules: ['剧本只有 1 条规则X', '没有最终决战']
  },
  btx: {
    name: 'Basic Tragedy X', zh: '基础惨剧模组',
    y: ['murderPlan', 'sealedItem', 'signWithMe', 'changeOfFuture', 'giantTimeBomb'],
    x: ['circleFriends', 'loveAffair', 'hiddenFreak', 'unsettlingRumor', 'paranoiaVirus', 'threadsFate', 'unknownFactor'],
    xCount: 2, finalGuess: true,
    incidents: ['murder', 'increasingUnease', 'foulEvil', 'suicide', 'hospitalIncident', 'farawayMurder', 'missingPerson', 'spreading', 'butterflyEffect'],
    roles: ['keyPerson', 'killer', 'brain', 'cultist', 'timeTraveler', 'witch', 'friend', 'conspiracyTheorist', 'lover', 'lovedOne', 'serialKiller', 'factor', 'person'],
    rules: []
  }
};

// The 10 scripts of the base set, in the book's order (FS-01, FS-02, BTX-01 … BTX-08 in the Chinese wiki's numbering;
// New Tragedies #1–#10 in English). opts: [loops, difficulty] choices printed on the script.
// cast: character → role; extra per character: enterLoop (神灵: first loop it appears), enterDay (appears from that day),
// turf (大人物's 领地). incidents: [day, incident, culprit]. remove: Mastermind cards taken out by a special rule.
export const SCRIPTS = [
  { id: 'fs01', no: 'FS-01', zh: '初学者剧本', jp: 'はじまりの脚本', en: 'The First Script', author: 'BakaFire', set: 'fs',
    days: 3, opts: [[3, 1]], y: 'murderPlan', x: ['shadowRipper'],
    cast: { boyStudent: 'person', girlStudent: 'keyPerson', shrineMaiden: 'serialKiller', officeWorker: 'killer', popIdol: 'conspiracyTheorist', doctor: 'brain' },
    incidents: [[3, 'suicide', 'girlStudent']], special: [] },
  { id: 'fs02', no: 'FS-02', zh: '没有神灵的神宫', jp: '神亡き宮にて', en: 'In the Godless Temple', author: 'がいじん', set: 'fs',
    days: 4, opts: [[3, 1]], doubt: '难度有一份资料写作 2，以剧本书为准', y: 'lightAvenger', x: ['hideousScript'],
    cast: { alien: 'brain', policeOfficer: 'conspiracyTheorist', officeWorker: 'curmudgeon', patient: 'friend', shrineMaiden: 'person', popIdol: 'person' },
    incidents: [[2, 'missingPerson', 'officeWorker'], [3, 'hospitalIncident', 'shrineMaiden']], special: [] },
  { id: 'btx01', no: 'BTX-01', zh: '魔法少女万能论', jp: '魔法少女万能論', en: "Magical Girls' Superiority", author: 'M·Hydromel', set: 'btx',
    days: 5, opts: [[4, 2], [3, 3]], y: 'signWithMe', x: ['unsettlingRumor', 'hiddenFreak'],
    cast: { popIdol: 'keyPerson', doctor: 'conspiracyTheorist', boyStudent: 'serialKiller', shrineMaiden: 'friend', patient: 'person', teacher: 'person', richStudent: 'person' },
    incidents: [[2, 'increasingUnease', 'patient'], [3, 'hospitalIncident', 'shrineMaiden'], [5, 'missingPerson', 'boyStudent']], special: [] },
  { id: 'btx02', no: 'BTX-02', zh: '猫箱', jp: '猫の箱', en: 'The Cat Box', author: 'GEnd', set: 'btx',
    days: 5, opts: [[4, 3], [3, 5]], y: 'giantTimeBomb', x: ['loveAffair', 'unknownFactor'],
    cast: { mysteryBoy: 'conspiracyTheorist', nurse: 'witch', alien: 'lover', officeWorker: 'lovedOne', blackCat: 'factor', richStudent: 'person', popIdol: 'person', soldier: 'person' },
    incidents: [[1, 'suicide', 'richStudent'], [4, 'missingPerson', 'officeWorker'], [5, 'missingPerson', 'alien']], special: [] },
  { id: 'btx03', no: 'BTX-03', zh: '来自未来的刺客', jp: '未来からの刺客', en: 'The Assassin from the Future', author: 'unun', set: 'btx',
    days: 5, opts: [[5, 3], [4, 5]], y: 'changeOfFuture', x: ['hiddenFreak', 'circleFriends'],
    cast: { girlStudent: 'person', classRep: 'friend', shrineMaiden: 'friend', alien: 'person', informer: 'conspiracyTheorist', popIdol: 'cultist', journalist: 'person', doctor: 'serialKiller', patient: 'timeTraveler' },
    incidents: [[2, 'butterflyEffect', 'classRep'], [4, 'farawayMurder', 'doctor'], [5, 'hospitalIncident', 'informer']], special: [] },
  { id: 'btx04', no: 'BTX-04', zh: '辽阳医院的遗留物', jp: '泥ノ木病棟に遺されて', en: 'Crushed by the Hospital Building in Doronoki', author: 'ロキルス', set: 'btx',
    days: 6, opts: [[5, 4], [4, 5]], y: 'murderPlan', x: ['paranoiaVirus', 'unknownFactor'],
    cast: { informer: 'keyPerson', classRep: 'killer', boss: 'brain', transferStudent: 'conspiracyTheorist', boyStudent: 'factor', shrineMaiden: 'person', alien: 'person', officeWorker: 'person', henchman: 'person' },
    extra: { boss: { turf: 'hospital' }, transferStudent: { enterDay: 5 } },
    incidents: [[2, 'suicide', 'boyStudent'], [4, 'hospitalIncident', 'henchman'], [6, 'farawayMurder', 'transferStudent']], special: [] },
  { id: 'btx05', no: 'BTX-05', zh: '拥有抗体的人', jp: '抗体を持つ者たち', en: 'Those with Antibodies', author: '泽村聪', set: 'btx',
    days: 4, opts: [[5, 4], [4, 6]], y: 'changeOfFuture', x: ['paranoiaVirus', 'threadsFate'],
    cast: { shrineMaiden: 'cultist', informer: 'timeTraveler', richStudent: 'conspiracyTheorist', classRep: 'person', officeWorker: 'person', forensicSpecialist: 'person', doctor: 'person', soldier: 'person', henchman: 'person' },
    incidents: [[1, 'butterflyEffect', 'richStudent'], [2, 'foulEvil', 'henchman'], [3, 'spreading', 'doctor'], [4, 'missingPerson', 'forensicSpecialist']], special: [] },
  { id: 'btx06', no: 'BTX-06', zh: 'unrerum', jp: 'unrerum', en: 'Un Rerum', author: 'GaRSoBaG', set: 'btx',
    days: 6, opts: [[4, 6]], y: 'sealedItem', x: ['circleFriends', 'threadsFate'],
    cast: { ai: 'brain', richStudent: 'cultist', alien: 'friend', officeWorker: 'friend', blackCat: 'conspiracyTheorist', mysteryBoy: 'lover', classRep: 'person', forensicSpecialist: 'person' },
    incidents: [[1, 'suicide', 'blackCat'], [2, 'foulEvil', 'ai'], [3, 'missingPerson', 'mysteryBoy'], [4, 'spreading', 'officeWorker'], [5, 'butterflyEffect', 'classRep'], [6, 'murder', 'alien']],
    special: ['剧作家把「移动斜向」从手牌中移除，所有轮回都不能使用'], remove: ['mmDiag'] },
  { id: 'btx07', no: 'BTX-07', zh: '序文', jp: '序文', en: 'Prologue', author: 'BakaFire', set: 'btx',
    days: 7, opts: [[5, 5], [4, 7]], y: 'murderPlan', x: ['circleFriends', 'loveAffair'],
    cast: { boyStudent: 'lover', girlStudent: 'lovedOne', richStudent: 'killer', shrineMaiden: 'keyPerson', policeOfficer: 'conspiracyTheorist', officeWorker: 'person', informer: 'friend', doctor: 'brain', patient: 'friend' },
    incidents: [[2, 'increasingUnease', 'officeWorker'], [4, 'suicide', 'girlStudent'], [5, 'hospitalIncident', 'boyStudent'], [7, 'murder', 'policeOfficer']], special: [] },
  { id: 'btx08', no: 'BTX-08', zh: 'Happy&Bad NeverEnding Story', jp: 'Happy&Bad NeverEnding Story', en: 'Neverending Happy & Sad Story', author: 'BF+3G', set: 'btx',
    days: 6, opts: [[4, 8]], y: 'giantTimeBomb', x: ['unsettlingRumor', 'loveAffair'],
    cast: { girlStudent: 'person', richStudent: 'lovedOne', classRep: 'person', mysteryBoy: 'brain', alien: 'person', godlyBeing: 'witch', officeWorker: 'person', popIdol: 'person', boss: 'conspiracyTheorist', patient: 'lover', nurse: 'person' },
    extra: { godlyBeing: { enterLoop: 4 }, boss: { turf: 'school' } },
    incidents: [[2, 'butterflyEffect', 'classRep'], [3, 'increasingUnease', 'alien'], [4, 'missingPerson', 'officeWorker'], [5, 'butterflyEffect', 'nurse'], [6, 'missingPerson', 'patient']],
    special: ['剧作家把「禁止友好」从手牌中移除，所有轮回都不能使用'], remove: ['forbidGw'] }
];
export const SCRIPT = Object.fromEntries(SCRIPTS.map(s => [s.id, s]));
