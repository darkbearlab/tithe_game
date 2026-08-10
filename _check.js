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
const sandboxGlobals = {
  document, localStorage, cv,
  performance: { now: () => NOW },
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame() {},
  location: { search: '', href: '' },
  navigator: { userAgent: 'node' },
  console,
  Math, JSON, Date, Object, Array, String, Number, Boolean, Set, Map, Error,
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
const mouseEv = (type, button, x, y) => fire(listeners.window, type, {
  button, clientX: x == null ? 640 : x, clientY: y == null ? 360 : y, movementX: 3, movementY: -2,
  preventDefault() {}, stopPropagation() {},
});

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
  { name: 'combat',          frames: 900, enter: bootCombat, poke: pokeCombat, invariants: [soloKnight] },
  { name: 'combat-arena-melee',  frames: 900, enter: () => T.enterArena('melee'),  poke: pokeCombat },
  { name: 'combat-arena-ranged', frames: 900, enter: () => T.enterArena('ranged'), poke: pokeCombat },
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
    poke: pokeCombat, invariants: [soloKnight],
  });
}

// TITHE C1 的回歸守門員：教廷送一個人進地獄，場上永遠只有騎士。
function soloKnight() {
  const n = (T.players || []).length;
  return n === 1 ? null : `場上有 ${n} 個我方單位，應該只有騎士`;
}

function pokeCombat(i) {
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
  fire(listeners.window, 'mousemove', { movementX: (i % 7) - 3, movementY: (i % 5) - 2, clientX: 640, clientY: 360, preventDefault() {} });
}

/* ── 7. 執行 ─────────────────────────────────────────────────────────── */
function releaseKeys() { for (const k of ['w', 'a', 's', 'd', 'Shift']) key('keyup', k); mouseEv('mouseup', 0); mouseEv('mouseup', 2); }

let pass = 0, fail = 0;
const failures = [];
const list = SCENARIOS.filter(s => !FILTER || s.name.includes(FILTER));
if (!list.length) { console.error(`沒有情境符合 "${FILTER}"`); process.exit(1); }

for (const s of list) {
  let stage = 'enter', i = 0;
  try {
    s.enter();
    stage = 'loop';
    for (i = 0; i < s.frames; i++) {
      NOW += FIXED * 1000;
      if (s.poke) s.poke(i);
      T.update(FIXED);
      T.draw();
      T.drawSeedTag();
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
