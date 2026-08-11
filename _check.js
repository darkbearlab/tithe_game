#!/usr/bin/env node
/* =====================================================================
   TITHE — headless 驗證（承襲 Homeward 守則：逐幀跑遍所有場景的 update()+draw()）

     node _check.js            全部場景
     node _check.js combat     只跑名字含 "combat" 的情境
     node _check.js -v         失敗時印完整堆疊

   作法：抽出 index.html 的 <script>，在 Node vm 裡跑，DOM/Canvas/localStorage
   全部用 stub。因為原始碼的頂層是 const/let（走語彙環境、不掛在 global 上），
   所以在原始碼尾端「附加一段 epilogue」把要驅動的東西暴露到 globalThis。

   本檔**有進版控**（見 CLAUDE.md）：index.html 正在被大規模拆解，harness 要跟著走。
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const VERBOSE = process.argv.includes('-v');
const FILTER = process.argv.slice(2).filter(a => !a.startsWith('-'))[0] || '';
const FIXED = 1 / 60;

/* ── 1. 抽出遊戲原始碼 ───────────────────────────────────────────────── */
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const open = HTML.indexOf('<script>');
const close = HTML.lastIndexOf('</script>');
if (open < 0 || close < 0) { console.error('找不到 <script> 區塊'); process.exit(1); }
const SRC = HTML.slice(open + '<script>'.length, close);
const SRC_LINE0 = HTML.slice(0, open).split('\n').length;   // 讓堆疊行號對得回 index.html

/* ── 2. DOM / Canvas / 瀏覽器 API stub ───────────────────────────────── */
const CTX_DEFAULTS = {
  globalAlpha: 1, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
  lineDashOffset: 0, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
  fillStyle: '#000', strokeStyle: '#000', shadowBlur: 0, shadowColor: 'transparent',
  shadowOffsetX: 0, shadowOffsetY: 0, globalCompositeOperation: 'source-over',
  imageSmoothingEnabled: true, filter: 'none', direction: 'ltr',
};
function makeCtx(canvas) {
  const store = Object.assign({ canvas }, CTX_DEFAULTS);
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      return (...a) => {
        if (k === 'measureText') return { width: String(a[0] == null ? '' : a[0]).length * 7 };
        if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient')
          return { addColorStop() {} };
        if (k === 'getImageData') return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
        if (k === 'createImageData') return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
        if (k === 'getLineDash') return [];
        if (k === 'isPointInPath' || k === 'isPointInStroke') return false;
        return undefined;
      };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const listeners = { window: {}, document: {}, canvas: {} };
const addTo = (bag) => (type, fn) => { (bag[type] || (bag[type] = [])).push(fn); };

function makeCanvas(w, h) {
  const c = {
    width: w, height: h, style: {}, id: 'cv',
    getContext: () => c._ctx || (c._ctx = makeCtx(c)),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0 }),
    addEventListener: addTo(listeners.canvas), removeEventListener() {},
    requestPointerLock() {}, focus() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, setAttribute() {}, dataset: {},
  };
  return c;
}
const cv = makeCanvas(1280, 720);

// 刻意「不給 document.body」：initTunerUI / initSandboxUI 的守衛會因此自行跳出，
// 我們要驗的是遊戲邏輯，不是那兩塊 DOM 面板。
const document = {
  getElementById: (id) => (id === 'cv' ? cv : null),
  createElement: (tag) => (tag === 'canvas'
    ? makeCanvas(1280, 720)
    : { style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        appendChild() {}, addEventListener() {}, setAttribute() {}, remove() {},
        textContent: '', value: '', checked: false, open: false, innerHTML: '',
        querySelector: () => null, querySelectorAll: () => [] }),
  addEventListener: addTo(listeners.document), removeEventListener() {},
  exitPointerLock() {}, pointerLockElement: null,
  querySelector: () => null, querySelectorAll: () => [],
};
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => void store.clear(),
};
let NOW = 0;
const rafQueue = [];

// 決定論：遊戲到處用 Math.random（發散、粒子、招募…），不換掉的話同一份程式碼
// 每次跑的結果都不同——失敗會變成「十次有一次」，重現不了也就查不動。
// 這裡給沙箱一份自己的 Math，random 換成可重設的 mulberry32；每個情境開始前重設種子。
let _rngState = 0x2F6E2B1 >>> 0;
function seedRng(n) { _rngState = (n >>> 0) || 1; }
function seededRandom() {
  _rngState = (_rngState + 0x6D2B79F5) >>> 0;
  let t = _rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const SEEDED_MATH = {};
for (const k of Object.getOwnPropertyNames(Math)) SEEDED_MATH[k] = Math[k];
SEEDED_MATH.random = seededRandom;
const sandboxGlobals = {
  document, localStorage, cv,
  performance: { now: () => NOW },
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame() {},
  location: { search: '', href: '' },
  navigator: { userAgent: 'node' },
  console,
  Math: SEEDED_MATH, JSON, Date, Object, Array, String, Number, Boolean, Set, Map, Error,
  isNaN, isFinite, parseInt, parseFloat,
  Uint8ClampedArray, Float32Array,
  setTimeout, clearTimeout, setInterval, clearInterval,
  alert() {}, prompt: () => null, confirm: () => false,
};
sandboxGlobals.window = sandboxGlobals;
sandboxGlobals.globalThis = sandboxGlobals;
sandboxGlobals.self = sandboxGlobals;
sandboxGlobals.window.addEventListener = addTo(listeners.window);
sandboxGlobals.window.removeEventListener = () => {};

/* ── 3. epilogue：把要驅動的東西暴露出來 ─────────────────────────────── */
const EPILOGUE = `
;globalThis.__T = {
  get scene() { return scene; },
  get players() { return players; },
  get enemies() { return enemies; },
  get roadmap() { return roadmap; },
  get roster() { return roster; },
  CONFIG, WEAPONS, ENEMY_TYPES, ARENA_MODES, MAPS, ORIGIN_IDS, ENCOUNTER_IDS,
  ARENA_WEAPON_IDS, ARENA_OFF_IDS, arenaSetWeapon, arenaSetOff,
  get drops() { return drops; }, get backpack() { return backpack; }, updateDrops,
  enterDescent, tickDescent, get descentPhase() { return descentPhase; }, get descentBag() { return descentBag; },
  get descentT() { return descentT; }, set descentT(v) { descentT = v; },
  get waveIdx() { return waveIdx; }, get waveTotal() { return waveTotal; }, get wavePending() { return wavePending; },
  get floorNo() { return floorNo; }, get roomNo() { return roomNo; }, nextRoom,
  update, draw, drawSeedTag,
  goMenu, initRun, chooseOrigin, departFromOrigin, enterOrigin, enterOathLoadout,
  selectNode, startMission, endMission, advanceNode,
  enterRest, enterArmory, enterTutor, enterBlacksmith, enterHQ, enterEvent, enterArena,
  enterArenaSelect, editorOpen, enterSandbox, enterFinaleSetup, playEnding,
  keys, mouse,
  get execCount() { return execCount; },
  get knight() { return knight(); },
  get exitPortal() { return exitPortal; },
  get descend() { return descend; },
  get floaters() { return floaters; },
  setScene(s) { scene = s; },
  forceMap(k) { forcedMap = k; },
};
`;

/* ── 4. 跑起來 ───────────────────────────────────────────────────────── */
const ctxObj = vm.createContext(sandboxGlobals);
try {
  new vm.Script(SRC + EPILOGUE, { filename: 'index.html', lineOffset: SRC_LINE0 - 1 }).runInContext(ctxObj);
} catch (e) {
  console.error('\x1b[31m✗ 載入失敗（原始碼在求值階段就丟例外）\x1b[0m');
  console.error(e && e.stack || e);
  process.exit(1);
}
const T = sandboxGlobals.__T;
if (!T) { console.error('epilogue 沒跑到——原始碼結構可能變了'); process.exit(1); }

/* ── 5. 合成輸入（走真正的事件處理器，才會涵蓋鍵盤/滑鼠的分支）────────── */
const fire = (bag, type, ev) => { for (const fn of (bag[type] || [])) fn(ev); };
const key = (type, k) => fire(listeners.window, type, {
  key: k, code: 'Key' + k.toUpperCase(), repeat: false,
  ctrlKey: false, shiftKey: k === 'Shift', altKey: false, metaKey: false,
  preventDefault() {}, stopPropagation() {},
});
// ⚠️ 滑鼠事件在 index.html 裡是分開掛的：mousedown / mousemove / wheel / contextmenu
// 掛在 **canvas** 上，mouseup 掛在 **window** 上。只丟給 window 的話，玩家永遠不會攻擊——
// 模擬跑一整場連一次 damageUnit 都不會進去，而測試看起來還是綠的。
// 所以一律兩個 bag 都丟（同一個 type 只會有一邊真的掛著 handler）。
const mouseEv = (type, button, x, y) => {
  const ev = { button, clientX: x == null ? 640 : x, clientY: y == null ? 360 : y,
               movementX: 3, movementY: -2, preventDefault() {}, stopPropagation() {} };
  fire(listeners.canvas, type, ev);
  fire(listeners.window, type, ev);
};

// 戰鬥中的滑鼠輸入全部被 `pointerLocked` 擋著（cv 的 mousedown 第一行就是
// `if (scene !== 'COMBAT' || !pointerLocked) return;`）。而 pointerLocked 只由
// document 的 pointerlockchange 設定。不模擬它，玩家就永遠不會攻擊。
function grabPointer() {
  document.pointerLockElement = cv;
  fire(listeners.document, 'pointerlockchange', {});
}

/* ── 6. 情境 ─────────────────────────────────────────────────────────── */
function bootCampaignToMap() {
  T.CONFIG.introEnabled = false;          // 序章是演出，另外一個情境測
  T.initRun();
  T.enterOrigin();
  T.chooseOrigin('warden');
  T.departFromOrigin();
}
function bootCombat() {
  bootCampaignToMap();
  const start = T.roadmap.start[0];
  T.selectNode(start);
  if (T.scene !== 'COMBAT') T.startMission();
}

const SCENARIOS = [
  { name: 'menu',            frames: 60,  enter: () => T.goMenu() },
  { name: 'menu-input',      frames: 60,  enter: () => T.goMenu(),
    poke: (i) => { if (i === 10) mouseEv('mousedown', 0, 640, 400); if (i === 12) mouseEv('mouseup', 0, 640, 400); } },
  { name: 'hq',              frames: 60,  enter: () => T.enterHQ() },
  { name: 'origin',          frames: 60,  enter: () => { T.initRun(); T.enterOrigin(); } },
  { name: 'oaths',           frames: 60,  enter: () => { T.initRun(); T.enterOrigin(); T.chooseOrigin('warden'); } },
  { name: 'roadmap',         frames: 60,  enter: bootCampaignToMap },
  // 一間房現在是**三波**（CONFIG.waves.perRoom），所以「打到開洞」需要的幀數比單波多得多。
  { name: 'combat',          frames: 3600, enter: bootCombat, poke: pokeCombat, invariants: [soloKnight, combatHappened, portalRun, descendSeqWorks, noStuckSwing, noPlayerPoise, noWeaponTurnCap, oneHandSet, noMorale, noStealth, noTacticalAI] },
  { name: 'combat-arena-melee',  frames: 900, enter: () => T.enterArena('melee'),  poke: pokeCombat, invariants: [combatHappened, floatersHappened, executionHappened, dashHappened, wrathGainHappened, noStuckSwing, noPlayerPoise, noMorale, noStealth, noTacticalAI] },
  { name: 'wrath',           frames: 240, enter: () => T.enterArena('melee'), poke: pokeWrath, invariants: [wrathRules] },
  { name: 'wrath-ult',       frames: 60,  enter: () => T.enterArena('melee'), poke: pokeUlt,   invariants: [ultimateWorks] },
  { name: 'guard-break',     frames: 300, enter: () => T.enterArena('melee'), poke: pokeGuard, invariants: [guardBreakWorks, noPlayerPoise] },
  { name: 'moveset-2h',      frames: 200, enter: () => T.enterArena('melee'), poke: pokeTwoHand, invariants: [twoHandHeavyWorks] },
  { name: 'moveset-dual',    frames: 200, enter: () => T.enterArena('melee'), poke: pokeDual,    invariants: [dualOffhandWorks] },
  { name: 'drop-enh',        frames: 30,  enter: bootCombat, poke: pokeDrop, invariants: [dropKeepsEnh, executionWindowExists] },
  { name: 'room-awake',      frames: 2,   enter: bootCombat, poke: pokeAwake, invariants: [allAwakeOnEntry] },
  { name: 'waves',           frames: 3000, enter: bootCombat, poke: pokeCombat, invariants: [wavesHappened] },
  { name: 'rooms',           frames: 6,    enter: () => { bootCombat(); }, poke: pokeRooms, invariants: [roomChainWorks] },
  { name: 'crystal',         frames: 2400,  enter: () => T.enterArena('melee'), poke: pokeCombat, invariants: [crystalStacks] },
  { name: 'free-slots',      frames: 4,    enter: () => {
      bootCombat();
      // 第 1 格放**習得**、第 2 格放**道具**——舊版剛好相反（1 只收卷軸、2 只收習得）
      T.roster[0].freeExtra = [{ kind: 'ability', id: 'firebolt' }, { kind: 'item', id: 'tonic', count: 2 }];
      T.roster[0].itemId = null; T.roster[0].abilityId = null;
      T.startMission();
    }, invariants: [freeSlotsAreGeneric] },
  { name: 'descent-timeout', frames: 40, enter: () => { bootCombat(); T.enterDescent(); }, poke: pokeTimeout, invariants: [descentTimesOut] },
  { name: 'descent',         frames: 40,  enter: () => { bootCombat(); T.enterDescent(); }, poke: pokeDescent, invariants: [descentFlowWorks] },
  { name: 'combat-arena-ranged', frames: 900, enter: () => T.enterArena('ranged'), poke: pokeCombat, invariants: [combatHappened, noMorale, noStealth, noTacticalAI] },
  { name: 'arena-select',    frames: 30,  enter: () => T.enterArenaSelect() },
  { name: 'rest',            frames: 60,  enter: () => { bootCampaignToMap(); T.enterRest(); } },
  { name: 'armory',          frames: 60,  enter: () => { bootCampaignToMap(); T.enterArmory(); } },
  { name: 'tutor',           frames: 60,  enter: () => { bootCampaignToMap(); T.enterTutor(); } },
  { name: 'blacksmith',      frames: 60,  enter: () => { bootCampaignToMap(); T.enterBlacksmith(); } },
  { name: 'event',           frames: 60,  enter: () => { bootCampaignToMap(); T.enterEvent(); } },
  { name: 'editor',          frames: 30,  enter: () => T.editorOpen() },
  { name: 'sandbox',         frames: 30,  enter: () => T.enterSandbox() },
  { name: 'finale-setup',    frames: 30,  enter: () => T.enterFinaleSetup() },
  { name: 'ending',          frames: 120, enter: () => T.playEnding(['一', '二', '三'], () => {}, '測試') },
  { name: 'runend',          frames: 30,  enter: () => T.setScene('RUNEND') },
  { name: 'runwin',          frames: 30,  enter: () => T.setScene('RUNWIN') },
  { name: 'intro',           frames: 600, invariants: [introKeepsSwinging], enter: () => { T.CONFIG.introEnabled = true; T.initRun(); T.enterOrigin(); T.chooseOrigin('reaver'); T.departFromOrigin(); },
    /* ⚠️ 按下與放開**不能同一幀**：update 在 poke 之後才跑，同幀放開等於 mouse.down 從來沒有為真過，
       序章的 shoot 節拍（要讀 mouse.down）就永遠不會觸發——整個情境會停在「按左鍵攻擊」那一格，
       看起來全綠但其實一幕都沒演完。這個坑讓「打完狼就揮不動」的回歸整整躲過了一輪。 */
    poke: (i) => { if (i % 40 === 0) mouseEv('mousedown', 0); if (i % 40 === 8) mouseEv('mouseup', 0); if (i > 120 && i % 7 === 3) key('keydown', 'w'); if (i > 120 && i % 7 === 6) key('keyup', 'w'); } },
];

// 每張戰鬥地圖各跑一遍（地圖資料本身容易出錯：waypoint 斷連、spawn 指到不存在的節點…）
for (const k of Object.keys(T.MAPS)) {
  SCENARIOS.push({
    name: 'map-' + k, frames: 240,
    enter: () => { bootCampaignToMap(); T.forceMap(k); T.startMission(); },
    poke: pokeCombat, invariants: [soloKnight, noStuckSwing, noPlayerPoise, noWeaponTurnCap, oneHandSet, noMorale, noStealth, noTacticalAI],
  });
}

// TITHE C1 的回歸守門員：教廷送一個人進地獄，場上永遠只有騎士。
function soloKnight() {
  const n = (T.players || []).length;
  return n === 1 ? null : `場上有 ${n} 個我方單位，應該只有騎士`;
}

// TITHE C2 的回歸守門員：士氣整套移除，任何單位都不該再帶著士氣欄位。
// （擋的是「因為戰鬥感覺太順」而把潰逃/崩潰偷偷加回來——見 DESIGN.md §11 的警語）
const MORALE_FIELDS = ['moraleState', 'panicType', 'moraleFxT', 'rallyT', 'breakJitter'];
function noMorale() {
  for (const u of [...(T.players || []), ...(T.enemies || [])]) {
    for (const f of MORALE_FIELDS) if (u && u[f] !== undefined) return `單位帶著已移除的士氣欄位 ${f}`;
  }
  return null;
}

// TITHE C3+C4 的回歸守門員：潛行（識別空窗、遮蔽、開火現形）與聽覺整套移除。
// 房間是亮的、門是鎖的——沒有可以潛的東西，也沒有「用聲音引怪」這種玩法。
const STEALTH_FIELDS = ['detect', 'revealT', 'stepT', '_stepR', '_stride', 'calledHelp'];
function noStealth() {
  for (const u of [...(T.players || []), ...(T.enemies || [])]) {
    for (const f of STEALTH_FIELDS) if (u && u[f] !== undefined) return `單位帶著已移除的潛行/聽覺欄位 ${f}`;
  }
  return null;
}

// 把最近的敵人拖到騎士刀口前（正面、觸及距離內）並叫醒它。
// 為什麼要這樣：合成輸入只會讓騎士對著空氣揮刀——敵人在幾百 px 外，一場模擬跑完
// 連一次 damageUnit 都不會進去。而傷害/體幹/擊殺正是拆解過程中最該被守住的路徑。
function dragFoeToBlade() {
  const k = (T.players || [])[0]; if (!k) return;
  // 優先挑**非假人**：試作場的訓練假人排在陣列前面，但牠們不會還手、也不能處決，
  // 只拖假人的話等於整場都在打稻草人（處決路徑一次都走不到）。
  const foes = (T.enemies || []).filter(e => !e.dead);
  if (!foes.length) return;
  const e = foes.find(x => !x.dummy) || foes[0];
  e.pos.x = k.pos.x + Math.cos(k.facing) * 26;
  e.pos.y = k.pos.y + Math.sin(k.facing) * 26;
  e.state = 'ENGAGED';
  e.facing = k.facing + Math.PI;   // 面向騎士＝牠也會還手（順便走到我方受傷的路徑）
}

// TITHE C5 的回歸守門員：waypoint **戰術選點**移除（尋路保留）。
// 這幾個欄位是選點/佔點/巡邏/搜索留下的痕跡，不該再出現。
const TACTICAL_FIELDS = ['targetNode', 'reservedNode', 'patrolTarget', 'patrolDwell', 'searchTarget', 'threatPos', 'patrols'];
function noTacticalAI() {
  for (const u of [...(T.players || []), ...(T.enemies || [])]) {
    for (const f of TACTICAL_FIELDS) if (u && u[f] !== undefined) return `單位帶著已移除的戰術選點欄位 ${f}`;
  }
  return null;
}

// TITHE D2/D4 的行為探針：處決與飄字都要真的發生過。
// 這兩個是新加的核心（處決是唯一的回血手段、飄字是它可讀的前提），
// 所以它們不該只是「有寫」——要有證據說它在模擬裡真的觸發得到。
let sawExec = false, sawFloater = false, sawDash = false;
function sampleNewFx() {
  if (!sawExec && (T.execCount || 0) > 0) sawExec = true;
  if (!sawFloater && (T.floaters || []).length) sawFloater = true;
  const k = T.knight;
  if (!sawDash && k && k.dash) sawDash = true;
}
function dashHappened() { return sawDash ? null : '整場沒有 dash 過——空白鍵的閃避路徑可能斷了'; }

/* 出口的洞：清場 → 開洞 → **走進去**才過關（沒有確認框了，見下）。
   這條探針顧的是「清場之後還走得完」——過關路徑不是自動發生的，很容易在後續改動中
   悄悄斷掉而測試全綠。確認框拿掉之後，它改成守「踩進去要跑吸取演出」：
   那是現在唯一會把地上剩下的東西捲走的地方，斷了就會靜靜地漏東西。 */
let sawPortal = false, sawVacuum = false;
function samplePortal() {
  if (!sawPortal && T.exitPortal && T.exitPortal.open) sawPortal = true;
  if (T.descend && T.descend.phase === 'pull') sawVacuum = true;   // 「吸取」那一拍真的跑過
}
function portalRun() {
  if (!sawPortal) return '清場之後沒有開出口的洞';
  if (!sawVacuum) return '走進洞裡沒有跑吸取演出——地上剩的東西不會被捲走（而且過關路徑可能沒接上）';
  if (T.scene === 'COMBAT') return '確認之後還停在 COMBAT——過關判定沒接上';
  return null;
}
function executionHappened() { return sawExec ? null : '整場沒有觸發過處決——F 鍵的處決路徑可能斷了'; }
function floatersHappened() { return sawFloater ? null : '整場沒有出現過傷害飄字'; }

/* D1 怒火：三條規則各自要有證據，不能只靠「有跑不炸」。
   ① 開場滿 ② 攻擊會回怒 ③ 不隨時間回、只隨時間退（且只在還有活敵人時退）
   ③ 用一個**完全不輸入**的情境直接量：把怒火壓到 40，放著不動 2 秒，
     它必須明顯掉下去、而且絕不回頭往上。這是整個資源設計的成敗點（DESIGN §2.2），
     所以值得一個專屬情境，而不是塞在打得亂七八糟的 pokeCombat 裡。 */
const wrathProbe = { start: null, max: null, mark: null, after: null, foes: false, died: false };
function pokeWrath(i) {
  const k = T.knight; if (!k) return;
  if (i === 0) { wrathProbe.start = k.wrath; wrathProbe.max = k.wrathMax; }
  if (i === 60) { k.wrath = 40; wrathProbe.mark = 40; }
  if (i > 60) {
    if (k.state === 'DEAD') wrathProbe.died = true;
    wrathProbe.after = k.wrath;
    if ((T.enemies || []).some(e => !e.dead)) wrathProbe.foes = true;
  }
}
function wrathRules() {
  const P = wrathProbe;
  if (P.start == null || !P.max) return '沒抓到騎士的怒火欄位';
  if (P.start < P.max - 0.001) return `開場怒火 ${P.start} 不是滿的（${P.max}）——DESIGN §2.2 ①`;
  if (P.died) return '騎士在探針期間陣亡，量到的是重置後的值（縮短情境或調敵人）';
  if (!P.foes) return '探針期間場上沒有活敵人，衰退本來就該凍結——這場量不到東西';
  if (P.after == null) return '沒抓到探針結束時的怒火';
  if (P.after > P.mark + 0.001) return `放著不動 2 秒怒火從 ${P.mark} 漲到 ${P.after}——怒火不該隨時間回復`;
  if (P.after > P.mark - 2) return `放著不動 2 秒怒火只從 ${P.mark} 掉到 ${P.after}——戰鬥中的衰退沒在跑`;
  return null;
}
/* **騎士沒有體幹**（使用者定案）。體幹只有一個工作：把敵人推進踉蹌開處決窗，
   它是進攻的計量器，不是防禦的計量器。這條擋的是「因為想要多一點深度」而把騎士那半加回來。 */
/* 轉向上限只准留在敵人身上（使用者定案）。武器不該有 turnSpeed，騎士不該有轉速欄位——
   這條擋的是「順手幫重武器加個笨重感」而把它整批加回去。 */
function noWeaponTurnCap() {
  if (!T.WEAPONS) return 'WEAPONS 沒有從沙箱丟出來，這條探針量不到東西';   // 別讓它靜靜地空轉過去
  for (const id in T.WEAPONS) if (T.WEAPONS[id].turnSpeed !== undefined) return `武器 ${id} 帶著 turnSpeed——轉向上限只留給敵人`;
  for (const p of (T.players || [])) if (p && (p.turnSpeed !== undefined || p.turn !== undefined)) return '騎士帶著轉速欄位——瞄準應該是 1:1';
  return null;
}

/* 手部 set 只有一組，而且戰鬥中不能換（§2.6b）。這條擋的是「順手把備用武器加回來」——
   在 push-forward 裡戰鬥中換武器是純正面效益（沒盾切盾、打不動切鎚），沒有取捨。
   順便釘住 weight 欄位不要復活：它的消費者（奔跑懲罰、抽出時間、倉庫格數）全死光了。 */
function oneHandSet() {
  for (const p of (T.players || [])) {
    if (!p || !p.slots) continue;
    const hands = p.slots.filter(sl => sl && sl.kind === 'hands');
    if (hands.length !== 1) return `騎士有 ${hands.length} 組手部 set，應該只有一組`;
    if (p.slotIdx !== undefined || p.swapT !== undefined) return '騎士帶著換手欄位（slotIdx/swapT）';
  }
  if (!T.WEAPONS) return 'WEAPONS 沒有從沙箱丟出來，這條探針量不到東西';
  for (const id in T.WEAPONS) if (T.WEAPONS[id].weight !== undefined) return `武器 ${id} 還帶著 weight——它已經沒有任何消費者了`;
  return null;
}

function noPlayerPoise() {
  for (const p of (T.players || [])) if (p && p.poiseMax) return `騎士帶著體幹上限 ${p.poiseMax}——體幹只有敵人該有`;
  return null;
}

/* 揮擊管線不能卡死。**這條是踩過坑才加的**：
   startSwing 的簽章從 (u, fireRateMult) 改成吃招式之後，序章那個腳本化的一刀沒跟著改，
   `1` 被當成招式傳進去 → windup/active/recover 全變 NaN → `s.t >= aEnd + s.recover`
   對 NaN 恆為 false → u.swing 永遠不清 → 之後每一次 startSwing 都被開頭的閘門擋掉
   ＝**打完狼之後再也揮不動**。沒有例外、沒有紅字，測試還是全綠。

   兩條一起守：
     ① noStuckSwing —— 任何單位的 swing 三段時間都必須是有限數（逐幀掃）
     ② introKeepsSwinging —— 序章裡腳本那一刀之後，玩家還要能揮出**新的**刀 */
let stuckSwing = null, swingStarts = 0, prevSwinging = false;
function sampleSwing() {
  for (const u of [...(T.players || []), ...(T.enemies || [])]) {
    const s = u && u.swing;
    if (s && !isFinite(s.windup + s.active + s.recover)) stuckSwing = stuckSwing || `${u.id != null ? '單位' + u.id : '某單位'} 的 swing 時間是 NaN`;
  }
  const k = T.knight, now = !!(k && k.swing);
  if (now && !prevSwinging) swingStarts++;
  prevSwinging = now;
}
function noStuckSwing() { return stuckSwing || null; }
function introKeepsSwinging() {
  if (stuckSwing) return stuckSwing;
  return swingStarts >= 2 ? null : `整個序章只揮出 ${swingStarts} 刀——腳本那一刀之後揮擊管線就卡住了`;
}

/* 整備限時（§5.4b）：三選一不限時、**整備 30 秒**。時間到＝沒裝上的直接丟掉、自動落地。
   （倒數不在 update() 裡跑——那支只跑 COMBAT——所以 harness 也要另外推 tickDescent，
   不然這條會永遠量不到東西。） */
const toProbe = { entered: false, ticked: false, sceneEnd: null, bagEnd: -1 };
function pokeTimeout(i) {
  if (i === 1) T.descentBag.push({ kind: 'armor', id: 'mail' });
  if (i === 2) key('keydown', '1');                     // 選獎勵 → 進整備
  if (i === 4) { toProbe.entered = T.descentPhase === 'KIT'; T.descentT = 0.05; }   // 把倒數推到快歸零
  if (i === 6) toProbe.ticked = T.descentT <= 0.05;
  if (i === 10) { toProbe.sceneEnd = T.scene; toProbe.bagEnd = T.descentBag.length; }
}
function descentTimesOut() {
  if (!toProbe.entered) return '沒有進到整備階段，這條量不到東西';
  if (toProbe.sceneEnd === 'DESCENT') return '倒數歸零之後還停在下墜畫面——限時沒生效';
  if (toProbe.bagEnd !== 0) return `倒數歸零之後袋子還有 ${toProbe.bagEnd} 件——沒裝上的應該直接丟掉`;
  return null;
}

/* 結晶：騎士唯一的護身（擊殺疊、時間掉、清場凍結、跨房保留）。
   這條顧的是「殺了人真的會疊」與「不會超過上限」——怒火的減傷已經交出去了，
   所以結晶壞掉＝騎士整場全裸，而且不會有任何紅字。 */
let maxCrystal = 0, sawCrystal = false;
function sampleCrystal() {
  const k = T.knight; if (!k) return;
  if ((k.armorTemp || 0) > 0) sawCrystal = true;
  if ((k.armorTemp || 0) > maxCrystal) maxCrystal = k.armorTemp;
}
function crystalStacks() {
  if (!sawCrystal) return '整場殺了人卻一層結晶都沒疊到——騎士會全程裸奔';
  if (maxCrystal > T.CONFIG.crystal.cap + 1e-6) return `結晶疊到 ${maxCrystal.toFixed(3)}，超過上限 ${T.CONFIG.crystal.cap}`;
  return null;
}

/* 自由位（1~N）每一格都是**通用**的：卷軸、習得、消耗品放進任何一格都可以。
   舊版把第 1 格寫死成 itemId、第 2 格寫死成 abilityId（「每種類各限一個」），
   那是 Homeward 留下的欄位形狀不是設計。這條擋的是它偷偷長回來。 */
function freeSlotsAreGeneric() {
  const k = T.knight; if (!k || !k.slots) return '沒抓到騎士的槽位';
  const free = k.slots.filter(sl => sl && sl.kind === 'free');
  if (free.length < 2) return `只有 ${free.length} 個自由位`;
  if (free[0].type !== 'ability' || free[0].id !== 'firebolt') return `第 1 個自由位是 ${free[0].type}/${free[0].id}，應該是習得 firebolt——自由位還是分種類的`;
  if (free[1].type !== 'item' || free[1].id !== 'tonic') return `第 2 個自由位是 ${free[1].type}/${free[1].id}，應該是道具 tonic——自由位還是分種類的`;
  return null;
}

/* 波次（DESIGN.md §1／§5.1）：一間房不是「殺完一批就結束」，而是好幾波，每一波從不同的門進來。
   這條顧兩件事：**下一波真的會來**（第一版少了 `!wavePending` 的閘門，門的計時器每幀被
   重置回滿格，那一波永遠不會到），以及**門有先亮起來**（無預警冒出來是廉價的偷襲）。 */
let sawWaveWarn = false, maxWaveIdx = 0;
function sampleWaves() {
  if (T.wavePending) sawWaveWarn = true;
  if ((T.waveIdx || 0) > maxWaveIdx) maxWaveIdx = T.waveIdx;
}
function wavesHappened() {
  if (T.waveTotal <= 1) return '這個情境只有一波，量不到東西';
  if (!sawWaveWarn) return '整場沒有出現過「門亮起來」的預告——援軍是無預警冒出來的？';
  if (maxWaveIdx < T.waveTotal - 1) return `只推進到第 ${maxWaveIdx + 1}/${T.waveTotal} 波——後面的波沒有來`;
  return null;
}

/* 房間串接（DESIGN.md §5.5）：一層 N 間房，打完往下一層，路線圖完全不出現。 */
const roomProbe = { f0: 0, r0: 0, f1: 0, r1: 0, fWrap: 0, rWrap: 0 };
function pokeRooms(i) {
  if (i === 0) { roomProbe.f0 = T.floorNo; roomProbe.r0 = T.roomNo; }
  if (i === 1) { T.nextRoom(); roomProbe.f1 = T.floorNo; roomProbe.r1 = T.roomNo; }
  if (i === 2) { for (let k = 0; k < T.CONFIG.floor.rooms; k++) T.nextRoom(); roomProbe.fWrap = T.floorNo; roomProbe.rWrap = T.roomNo; }
}
function roomChainWorks() {
  const P = roomProbe;
  if (P.r1 !== P.r0 + 1 || P.f1 !== P.f0) return `過一間房之後是 ${P.f1}-${P.r1}，應該是 ${P.f0}-${P.r0 + 1}`;
  if (P.fWrap <= P.f0) return `連過 ${T.CONFIG.floor.rooms} 間房之後層數還是 ${P.fWrap}——沒有換層`;
  if (P.rWrap > T.CONFIG.floor.rooms) return `換層之後房號是 ${P.rWrap}，沒有歸位`;
  if (T.scene !== 'COMBAT') return `串接之後不在 COMBAT（${T.scene}）——下一間房沒有真的開始`;
  return null;
}

/* 下墜整備（DESIGN.md §5.4b）：先三選一 → 再配裝 → 落地。
   整條路徑都用鍵盤驅動（1~9 / D / Enter），所以 harness 不需要點座標就走得完——
   這是刻意的：滑鼠 hit-test 的探針很容易在版面微調後變成假綠。
   這條顧的是「這一停真的走得完」：選了獎勵要進袋、裝上要離開袋子、落地要把袋子清空。 */
const descProbe = { phase0: null, afterPick: null, bagAfterPick: 0, bagAfterEquip: 0, sceneEnd: null, bagEnd: 0, equipping: null, rosterChanged: false };
/* 裝上去的那一件，現在應該真的掛在騎士身上的對應欄位。
   ⚠️ 術/道具要查**自由位（freeExtra）**，不是舊的 itemId/abilityId——
   自由位統一之後那兩個欄位只是初始值的入口，裝上去不會寫回去。
   照舊查的話，東西明明放進了自由位，探針卻會說「沒裝上」。 */
const onBody = (r, it) => !!(r && it && (
  it.kind === 'weapon' ? r.weaponId === it.id :
  it.kind === 'off' ? r.offId === it.id :
  it.kind === 'armor' ? r.armorId === it.id :
  it.kind === 'equip' ? r.equipId === it.id :
  (it.kind === 'ability' || it.kind === 'item') ? (r.freeExtra || []).some(e => e && e.id === it.id) : false));
function pokeDescent(i) {
  if (i === 0) descProbe.phase0 = T.descentPhase;
  // 多塞一件進袋子：不然「選一個、裝一個」剛好把袋子清空，最後那條「落地要清袋」就變成空轉
  if (i === 1) T.descentBag.push({ kind: 'armor', id: 'mail' });
  if (i === 2) key('keydown', '1');                       // 選第一個獎勵
  if (i === 4) { descProbe.afterPick = T.descentPhase; descProbe.bagAfterPick = T.descentBag.length; }
  if (i === 5) descProbe.equipping = T.descentBag[0];     // 記下等一下要裝的是哪一件
  if (i === 6) key('keydown', '1');                       // 把袋子第一件裝上
  if (i === 8) { descProbe.bagAfterEquip = T.descentBag.length; descProbe.rosterChanged = onBody(T.roster[0], descProbe.equipping); }
  if (i === 10) key('keydown', 'Enter');                  // 落地
  if (i === 12) { descProbe.sceneEnd = T.scene; descProbe.bagEnd = T.descentBag.length; }
}
/* 跳下去那一段是四拍（頓 → 吸 → 頓 → 縮），少一拍都會讓節奏塌掉而且沒有任何紅字。
   這條釘住「四拍都走過」，以及「縮到最後身體真的接近 0」。 */
const seqProbe = { seen: {}, minScale: 1 };
function sampleSeq() {
  const d = T.descend; if (d) seqProbe.seen[d.phase] = true;
  const k = T.knight;
  if (k && k.sinkScale != null && k.sinkScale < seqProbe.minScale) seqProbe.minScale = k.sinkScale;
}
function descendSeqWorks() {
  for (const ph of ['hold', 'pull', 'hold2', 'sink']) if (!seqProbe.seen[ph]) return `跳下去的序列少了「${ph}」這一拍`;
  if (seqProbe.minScale > 0.2) return `身體只縮到 ${seqProbe.minScale.toFixed(2)}，應該縮到接近 0`;
  return null;
}

function descentFlowWorks() {
  const P = descProbe;
  if (P.phase0 !== 'REWARD') return `進來的時候不是三選一階段（${P.phase0}）——順序應該是先選獎勵`;
  if (P.afterPick !== 'KIT') return `選完獎勵沒有進配裝階段（${P.afterPick}）`;
  if (!P.bagAfterPick) return '選到的獎勵沒有進袋子';
  if (P.bagAfterEquip >= P.bagAfterPick) return '按了裝上，袋子裡的東西沒有少一件';
  if (!P.rosterChanged) return `按了裝上，但「${P.equipping && P.equipping.kind}/${P.equipping && P.equipping.id}」沒有出現在騎士對應的欄位上`;
  if (P.sceneEnd === 'DESCENT') return '按了 Enter 還停在下墜畫面——落地沒接上';
  if (P.bagEnd) return '落地之後袋子還有東西——袋子不該帶過那道門（§6.2b）';
  return null;
}

/* 進房＝全員醒著（DESIGN.md §5.1）。房間是封閉的、上了鎖、已經被驚動的——
   「繞過視錐把整房走完而不開打」是潛行系統（C3 已拆）留下的殘影，和 push-forward 相反。
   ⚠️ 這條探針是踩過坑才加的：第一版寫成 `e.faction !== 'foe'`，但敵人的陣營字串是 `'enemy'`，
   於是整段迴圈一個人都沒叫醒——測試全綠、遊戲照跑、功能完全沒生效。 */
/* ⚠️ 一定要在**第一次 update 之前**取樣：C3 之後敵人「看到就交戰」，跑個兩幀
   視線內的敵人自己就 ENGAGED 了，量到的會是視線而不是這條規則（第一版就是這樣假綠的）。
   poke 在 update 之前呼叫，所以 i===0 那一幀就是 startMission 剛結束的狀態。 */
const awakeProbe = { total: 0, idle: 0, sampled: false };
function pokeAwake(i) {
  if (i !== 0) return;
  const es = (T.enemies || []).filter(e => !e.dead && e.faction === 'enemy' && !e.introFrozen);
  awakeProbe.sampled = true; awakeProbe.total = es.length; awakeProbe.idle = es.filter(e => e.state === 'IDLE').length;
}
function allAwakeOnEntry() {
  if (!awakeProbe.sampled) return '沒有取樣到，探針沒接上';
  if (!awakeProbe.total) return '這張圖沒有 enemy 陣營的敵人，量不到東西';
  return awakeProbe.idle ? `進房那一刻還有 ${awakeProbe.idle}/${awakeProbe.total} 隻敵人是 IDLE——全員 ENGAGED 沒生效` : null;
}

/* **處決窗必須開得出來**——這是整個資源迴圈的存亡條件，不是平衡的細節。
   處決是唯一的回血手段（DESIGN §2.4），而處決只能對踉蹌中的敵人做。
   所以對每一個「一刀砍不死」的武器×敵人組合，**破體幹必須嚴格早於打死**；
   否則敵人會在踉蹌之前先流血流死，窗根本不會出現，push-forward 就斷了。

   這條是靜態算的（沒有機率了，所以現在是精確值不是期望值）：
     每刀傷害 = damage × dmgMul × (1 − armor × flatResist)
     每刀體幹 = poiseDmg × (1 + armor × pierce × antiGain)
   一刀就砍死的組合（nKill===1）跳過——那不需要窗，秒殺本身就是回報。
   這是玩測前唯一能自動守住的那一條；手感仍然要玩過才知道。 */
function executionWindowExists() {
  const C = T.CONFIG;
  if (!T.ENEMY_TYPES || !T.WEAPONS) return 'ENEMY_TYPES/WEAPONS 沒有從沙箱丟出來，這條探針量不到東西';
  const bad = [];
  for (const id of Object.keys(T.ENEMY_TYPES)) {
    const E = T.ENEMY_TYPES[id];
    if (E.dummy) continue;
    const hp = E.hp, poise = E.poise || C.melee.poiseDefault, armor = E.armor || 0;
    for (const wid of Object.keys(T.WEAPONS)) {
      const W = T.WEAPONS[wid];
      if (!W.melee || !W.moves) continue;
      for (const mk of Object.keys(W.moves)) {
        const M = W.moves[mk];
        const resist = Math.min(armor * C.armor.flatResist, C.armor.resistCap);
        const dmg = W.damage * (M.dmgMul || 1) * (1 - resist);
        const pd = M.poiseDmg * (1 + armor * (W.pierce || 0) * C.armor.antiGain);
        const nKill = Math.ceil(hp / Math.max(0.01, dmg)), nBreak = Math.ceil(poise / Math.max(0.01, pd));
        if (nKill >= 2 && nBreak >= nKill) bad.push(`${id} vs ${wid}/${mk}（${nBreak} 刀破幹 ≥ ${nKill} 刀打死）`);
      }
    }
  }
  return bad.length ? `這些組合開不出處決窗：${bad.slice(0, 4).join('、')}${bad.length > 4 ? ` …共 ${bad.length} 組` : ''}` : null;
}

/* 撿起來的武器要**帶著強化**。spawnDrop 帶上了 quality/enh，撿取那一步若只抄 {kind,id,ammo}
   就會靜靜地把它們洗掉——而且看起來一切正常（武器還在，只是變白板）。
   TITHE 以掉落為成長主軸，所以這條值得一個探針而不是一句註解。 */
const dropProbe = { got: null };
function pokeDrop(i) {
  const k = T.knight; if (!k) return;
  if (i === 2) {
    T.drops.length = 0; T.backpack.length = 0;
    T.drops.push({ pos: { x: k.pos.x, y: k.pos.y }, kind: 'weapon', id: 'sword', ammo: 0, quality: 4, enh: [{ kind: 'sharp', charges: 1, value: 7 }] });
  }
  if (i === 6 && T.backpack.length) dropProbe.got = T.backpack[0];
}
function dropKeepsEnh() {
  const g = dropProbe.got;
  if (!g) return '掉落物沒有被撿起來，這條探針量不到東西';
  if (g.quality !== 4) return `撿起來之後 quality 變成 ${g.quality}，應該是 4`;
  if (!g.enh || !g.enh.length || g.enh[0].value !== 7) return '撿起來之後詞條(enh)不見了';
  return null;
}

/* 主副手＝左右鍵（DESIGN.md §2.6b）。右鍵這一路有四個分支，其中兩個是全新的，
   而且**兩個都只在特定配裝下才走得到**，所以各給一個情境把配裝擺好再按。
     · 雙手武器 → 右鍵＝重擊（招式不同於左鍵：起手更長、體幹傷更高）
     · 雙持     → 右鍵＝副手那把自己的輕擊（傷害算副手的）
   （盾＝格擋走 guard-break 情境；空手＝徒手招架走既有的 wpWindow 路徑。） */
const msProbe = { light: null, heavy: null, offHand: false, offW: null };
function setKit(mainId, offId) {
  T.arenaSetWeapon(T.ARENA_WEAPON_IDS.indexOf(mainId));
  T.arenaSetOff(T.ARENA_OFF_IDS.indexOf(offId));
}
// 雙手斧：左鍵記下 light 的名字，右鍵記下 heavy 的名字，兩者必須不同
function pokeTwoHand(i) {
  const k = T.knight; if (!k) return;
  if (i === 0) setKit('axe', null);
  if (i === 10) mouseEv('mousedown', 0);
  if (i === 14) mouseEv('mouseup', 0);
  if (i > 10 && i < 60 && k.swing && !msProbe.light) msProbe.light = k.swing.mv.name;
  if (i === 100) mouseEv('mousedown', 2);
  if (i === 104) mouseEv('mouseup', 2);
  if (i > 100 && k.swing && !msProbe.heavy) msProbe.heavy = k.swing.mv.name;
}
function twoHandHeavyWorks() {
  const k = T.knight;
  if (!k || (k.weapon.hands || 1) < 2) return '沒換成雙手武器，這條探針量不到東西';
  if (!msProbe.light) return '左鍵沒有揮出 light';
  if (!msProbe.heavy) return '右鍵沒有揮出任何招——雙手武器的重擊沒接上';
  if (msProbe.light === msProbe.heavy) return `左右鍵揮的是同一招（${msProbe.light}）——heavy 沒被選到`;
  return null;
}
// 雙持（主手劍 + 副手短劍）：右鍵揮出來的那一招，傷害來源必須是**副手那把**
function pokeDual(i) {
  const k = T.knight; if (!k) return;
  if (i === 0) setKit('sword', 'dagger');
  if (i === 40) mouseEv('mousedown', 2);
  if (i === 44) mouseEv('mouseup', 2);
  if (i > 40 && k.swing && k.swing.hand === 'off') { msProbe.offHand = true; msProbe.offW = k.swing.W && k.swing.W.name; }
}
function dualOffhandWorks() {
  const k = T.knight;
  if (!k) return '沒抓到騎士';
  if (!msProbe.offHand) return '右鍵沒有揮出副手那一招——雙持的副手攻擊沒接上';
  if (msProbe.offW !== T.WEAPONS.dagger.name) return `副手揮擊的傷害來源是「${msProbe.offW}」，應該是副手那把短劍`;
  return null;
}

/* 破防：騎士唯一會被打進硬直的途徑（舉盾但怒火付不出這一擊）。
   它從 breakPoise 拆出來變成獨立的 guardBreak()，所以需要一條自己的探針——
   把怒火按在 0、舉著盾站在敵人刀口下，硬直就一定要發生。 */
let sawGuardBreak = false;
function pokeGuard(i) {
  const k = T.knight; if (!k) return;
  dragFoeToBlade();                 // 敵人釘在刀口前＝牠會還手
  k.wrath = 0;                      // 永遠付不起這一擊的格擋費
  if (i === 5) mouseEv('mousedown', 2);   // 舉盾，之後一直按著
  if (k.guardBreakFxT > 0) sawGuardBreak = true;
}
function guardBreakWorks() {
  const k = T.knight;
  if (!k) return '沒抓到騎士';
  if (!shieldEquipped(k)) return '試作場預設副手不是盾，這條探針量到的不是格擋（改 arenaOffIdx 或換情境）';
  return sawGuardBreak ? null : '怒火 0 舉盾挨打 5 秒都沒破防——guardBreak 沒接上';
}
const shieldEquipped = (k) => !!(k.offId && k.offId !== 'dagger');

/* 大絕招「聖怒」：怒火滿 → 清空換一發全場踉蹌。這條路徑在 Homeward 空了很久
   （useOathSkill 一直 return false），現在它是怒火唯一的大額出口，值得一條探針釘住。 */
const ultProbe = { before: null, max: null, after: null, hit: false };
function pokeUlt(i) {
  const k = T.knight; if (!k) return;
  if (i === 0) { ultProbe.before = k.wrath; ultProbe.max = k.wrathMax; }   // 開場那一幀才是「滿的」，之後每幀都在衰退
  if (i < 3) dragFoeToBlade();                       // 把敵人拖進大絕招半徑，不然這一發打到空氣
  if (i === 3) { key('keydown', 'q'); key('keyup', 'q'); }
  if (i === 5) {
    ultProbe.after = k.wrath;
    ultProbe.hit = (T.enemies || []).some(e => e.dead || (e.staggerT || 0) > 0);
  }
}
function ultimateWorks() {
  const P = ultProbe;
  if (P.before == null || !P.max) return '沒抓到騎士的怒火欄位';
  if (P.before < P.max - 0.001) return '開場怒火不是滿的，這條探針量不到大絕招的門檻';
  if (P.after == null) return '沒抓到放完之後的怒火';
  if (P.after > 0.01) return `按了 Q 之後怒火還剩 ${P.after}——大絕招沒有清空怒火（或根本沒放出去）`;
  if (!P.hit) return '大絕招放出去了，但半徑內的敵人既沒踉蹌也沒死——傷害/體幹沒接上';
  return null;
}
/* ② 攻擊回怒：逐幀比對。**排除試作場的重置**——騎士倒下時 arenaResetFight() 會把
   怒火與血一起補滿，那不是「打人回來的」。所以只在血沒同時變多的幀才算數。 */
let sawWrathGain = false, prevWrath = null, prevHp = null;
function sampleWrath() {
  const k = T.knight; if (!k) return;
  if (prevWrath != null && k.wrath > prevWrath + 0.01 && k.hp <= prevHp + 0.01) sawWrathGain = true;
  prevWrath = k.wrath; prevHp = k.hp;
}
function wrathGainHappened() { return sawWrathGain ? null : '整場打下來怒火從沒往上跳——命中/招架/處決的回怒可能斷了'; }

// 行為探針：這一場模擬應該真的打過架。
// 純粹「不丟例外」不足以證明拆解沒把 AI 弄啞——這條確認敵人確實受過傷或陣亡。
// ⚠️ 逐幀累積，**不是**看結束時的快照：試作場在騎士倒下時會 arenaResetFight()，
//    把所有敵人補回滿血，快照式的檢查會漏掉明明發生過的戰鬥（踩過一次）。
let sawEnemyHurt = false;
function sampleCombat() {
  if (!sawEnemyHurt) sawEnemyHurt = (T.enemies || []).some(e => e.dead || e.hp < e.maxHp);
}
function combatHappened() {
  const es = T.enemies || [];
  if (!es.length) return null;                      // 沒敵人的情境不判
  return sawEnemyHurt ? null : '900 幀下來沒有任何敵人受傷或陣亡——AI 可能被拆啞了';
}

function pokeCombat(i) {
  if (i > 20) dragFoeToBlade();   // 每幀都把敵人釘在刀口前＝揮擊判定窗一定咬得到（不然會是十次過九次）
  if (i === 1) { key('keydown', 'w'); key('keydown', 'Shift'); }
  if (i === 90) key('keyup', 'Shift');
  if (i === 150) { key('keyup', 'w'); key('keydown', 'd'); }
  if (i === 300) { key('keyup', 'd'); key('keydown', 's'); }
  if (i === 450) key('keyup', 's');
  if (i % 25 === 5) mouseEv('mousedown', 0);          // 揮斬 / 射擊
  if (i % 25 === 12) mouseEv('mouseup', 0);
  if (i % 97 === 40) { mouseEv('mousedown', 2); }     // 格擋 / 望遠
  if (i % 97 === 70) { mouseEv('mouseup', 2); }
  if (i % 61 === 20) { key('keydown', '1'); key('keyup', '1'); }
  if (i % 71 === 30) { key('keydown', '2'); key('keyup', '2'); }
  if (i % 83 === 11) { key('keydown', 'x'); key('keyup', 'x'); }   // 換武器組
  // dash 會取消當下的揮擊（那是它刻意的代價），所以按太密會讓騎士整場都揮不完一刀，
  // 連帶讓處決窗打不出來。這裡按得比揮擊週期稀疏＝兩條路徑都走得到。
  if (i % 97 === 13) { key('keydown', ' '); key('keyup', ' '); }
  if (i % 89 === 17) { key('keydown', 'r'); key('keyup', 'r'); }   // 換彈
  if (i % 9 === 4) { key('keydown', 'f'); key('keyup', 'f'); }   // 互動
  /* 處決的探針：**直接製造踉蹌狀態**，不經傷害與體幹的數值。
     為什麼要這樣作弊：以目前的平衡，敵人往往在體幹破之前就先被血量殺死（實測 shieldman
     體幹只掉到 38/60 就死了），而且試作場的三隻非假人一分鐘內就會被清光——
     自然狀態下處決窗出不出現，完全看那一局的數值與運氣。

     那是一個**平衡問題**（已記在 HARVEST D 表），要靠玩測解決；而這個探針要回答的是
     另一個問題：「處決這條路——找目標、按鍵、動作、擊殺、回血——走不走得通」。
     兩者混在一起的話，日後每次調傷害或體幹，這條測試就會無辜地紅，然後被當成雜訊忽略。
     所以這裡直接塞 staggerT，跳過整條數值鏈。 */
  if (i > 20 && i % 40 === 0) {
    const e = (T.enemies || []).find(x => !x.dead && !x.dummy);
    if (e) e.staggerT = Math.max(e.staggerT || 0, 1.0);
  }
  if ((T.enemies || []).some(e => !e.dead && !e.dummy && e.staggerT > 0)) { key('keydown', 'f'); key('keyup', 'f'); }
  /* 洞開了就把騎士挪到洞口。為什麼用瞬移而不是走過去：合成輸入沒有尋路，
     直線走過去會不會卡牆全看地圖——而這條探針要驗的是「進洞＝過關」這個判定，
     不是走路。距離判定仍由遊戲自己在下一幀跑。 */
  const ep = T.exitPortal;
  if (ep && ep.open) { const k = T.knight; if (k) { k.pos.x = ep.x + 6; k.pos.y = ep.y + 6; } }
  // 洞口確認框：按 Enter 跳下去。**框本身也要被驗到**（見 portalRun）——
  // 它是誤觸保護，斷掉的話玩家會莫名其妙地被結束一房，而且不會有例外可抓。
  const mm = { movementX: (i % 7) - 3, movementY: (i % 5) - 2, clientX: 640, clientY: 360, preventDefault() {} };
  fire(listeners.canvas, 'mousemove', mm); fire(listeners.window, 'mousemove', mm);
}

/* ── 7. 執行 ─────────────────────────────────────────────────────────── */
function releaseKeys() { for (const k of ['w', 'a', 's', 'd', 'Shift']) key('keyup', k); mouseEv('mouseup', 0); mouseEv('mouseup', 2); }

let pass = 0, fail = 0;
const failures = [];
const list = SCENARIOS.filter(s => !FILTER || s.name.includes(FILTER));
if (!list.length) { console.error(`沒有情境符合 "${FILTER}"`); process.exit(1); }

let scenarioIdx = 0;
for (const s of list) {
  const sIdx = scenarioIdx++;
  let stage = 'enter', i = 0;
  try {
    seedRng(0x51ED + sIdx);   // 每個情境固定種子＝失敗可以原地重現
    sawEnemyHurt = false; sawExec = false; sawFloater = false; sawDash = false; sawPortal = false; sawVacuum = false;
    sawWrathGain = false; prevWrath = null; prevHp = null;
    wrathProbe.start = wrathProbe.max = wrathProbe.mark = wrathProbe.after = null; wrathProbe.foes = wrathProbe.died = false;
    ultProbe.before = ultProbe.max = ultProbe.after = null; ultProbe.hit = false;
    sawGuardBreak = false; sawWaveWarn = false; maxWaveIdx = 0;
    stuckSwing = null; swingStarts = 0; prevSwinging = false;
    maxCrystal = 0; sawCrystal = false;
    seqProbe.seen = {}; seqProbe.minScale = 1;
    toProbe.entered = toProbe.ticked = false; toProbe.sceneEnd = null; toProbe.bagEnd = -1;
    msProbe.light = msProbe.heavy = msProbe.offW = null; msProbe.offHand = false;
    dropProbe.got = null;
    awakeProbe.sampled = false; awakeProbe.total = awakeProbe.idle = 0;
    descProbe.phase0 = descProbe.afterPick = descProbe.sceneEnd = descProbe.equipping = null;
    descProbe.bagAfterPick = descProbe.bagAfterEquip = descProbe.bagEnd = 0; descProbe.rosterChanged = false;
    s.enter();
    grabPointer();
    stage = 'loop';
    for (i = 0; i < s.frames; i++) {
      NOW += FIXED * 1000;
      if (s.poke) s.poke(i);
      T.update(FIXED);
      T.tickDescent(FIXED);   // 下墜整備的倒數不在 update 裡（那只跑 COMBAT），主迴圈另外推
      T.draw();
      T.drawSeedTag();
      sampleCombat(); sampleNewFx(); samplePortal(); sampleWrath(); sampleWaves(); sampleSwing(); sampleCrystal(); sampleSeq();
    }
    releaseKeys();
    for (const inv of (s.invariants || [])) {
      const msg = inv();
      if (msg) throw new Error('不變式失敗：' + msg);
    }
    pass++;
    process.stdout.write(`\x1b[32m✓\x1b[0m ${s.name} \x1b[90m(${s.frames}f → ${T.scene})\x1b[0m\n`);
  } catch (e) {
    fail++;
    releaseKeys();
    failures.push({ name: s.name, stage, frame: i, err: e });
    process.stdout.write(`\x1b[31m✗ ${s.name}\x1b[0m \x1b[90m(${stage}, frame ${i})\x1b[0m  ${e && e.message}\n`);
  }
}

if (failures.length) {
  console.log('\n\x1b[31m失敗細節\x1b[0m');
  for (const f of failures) {
    console.log(`\n── ${f.name} (${f.stage}, frame ${f.frame}) ──`);
    const st = (f.err && f.err.stack) || String(f.err);
    console.log(VERBOSE ? st : st.split('\n').slice(0, 6).join('\n'));
  }
  if (!VERBOSE) console.log('\n\x1b[90m（-v 看完整堆疊）\x1b[0m');
}
console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass} 通過, ${fail} 失敗\x1b[0m`);
process.exit(fail ? 1 : 0);
