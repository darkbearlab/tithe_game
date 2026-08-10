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
  CONFIG, ARENA_MODES, MAPS, ORIGIN_IDS, ENCOUNTER_IDS,
  update, draw, drawSeedTag,
  goMenu, initRun, chooseOrigin, departFromOrigin, enterOrigin, enterOathLoadout,
  selectNode, startMission, endMission, advanceNode,
  enterRest, enterArmory, enterTutor, enterBlacksmith, enterHQ, enterEvent, enterArena,
  enterArenaSelect, editorOpen, enterSandbox, enterFinaleSetup, playEnding,
  keys, mouse,
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
  { name: 'combat',          frames: 900, enter: bootCombat, poke: pokeCombat, invariants: [soloKnight, combatHappened, noMorale, noStealth] },
  { name: 'combat-arena-melee',  frames: 900, enter: () => T.enterArena('melee'),  poke: pokeCombat, invariants: [combatHappened, noMorale, noStealth] },
  { name: 'combat-arena-ranged', frames: 900, enter: () => T.enterArena('ranged'), poke: pokeCombat, invariants: [combatHappened, noMorale, noStealth] },
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
  { name: 'intro',           frames: 600, enter: () => { T.CONFIG.introEnabled = true; T.initRun(); T.enterOrigin(); T.chooseOrigin('reaver'); T.departFromOrigin(); },
    poke: (i) => { if (i % 40 === 0) { mouseEv('mousedown', 0); mouseEv('mouseup', 0); } } },
];

// 每張戰鬥地圖各跑一遍（地圖資料本身容易出錯：waypoint 斷連、spawn 指到不存在的節點…）
for (const k of Object.keys(T.MAPS)) {
  SCENARIOS.push({
    name: 'map-' + k, frames: 240,
    enter: () => { bootCampaignToMap(); T.forceMap(k); T.startMission(); },
    poke: pokeCombat, invariants: [soloKnight, noMorale, noStealth],
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
  const foes = (T.enemies || []).filter(e => !e.dead); if (!foes.length) return;
  const e = foes[0];
  e.pos.x = k.pos.x + Math.cos(k.facing) * 26;
  e.pos.y = k.pos.y + Math.sin(k.facing) * 26;
  e.state = 'ENGAGED';
  e.facing = k.facing + Math.PI;   // 面向騎士＝牠也會還手（順便走到我方受傷的路徑）
}

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
  if (i % 89 === 17) { key('keydown', 'r'); key('keyup', 'r'); }   // 換彈
  if (i % 53 === 23) { key('keydown', 'f'); key('keyup', 'f'); }   // 互動
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
    sawEnemyHurt = false;
    s.enter();
    grabPointer();
    stage = 'loop';
    for (i = 0; i < s.frames; i++) {
      NOW += FIXED * 1000;
      if (s.poke) s.poke(i);
      T.update(FIXED);
      T.draw();
      T.drawSeedTag();
      sampleCombat();
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
