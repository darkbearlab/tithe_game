# CLAUDE.md — 給接手的 Claude Code

> 這份是**工作守則與現況**。設計權威在 [`DESIGN.md`](DESIGN.md)，工作清單在 [`HARVEST.md`](HARVEST.md)。
> 有衝突時：`DESIGN.md` > 這份 > 程式碼裡的舊註解（大量舊註解還是 Homeward 的，會騙你）。

---

## 這個專案現在的狀態（最重要的一段）

**TITHE 是從 [`darkbearlab/Homeward-`](https://github.com/darkbearlab/Homeward-) 分出來的新遊戲，
不是它的變體。** `index.html` 目前**還幾乎整份都是 Homeward 的程式碼**，正在被逐系統拆解。

所以：

- **你讀到的程式碼與註解，預設屬於「還沒被清掉的舊遊戲」。** 看到士氣、潛行、撤離、扈從、
  誓約這些東西，那是待拆的，不是要維護的。
- **判斷「這段該不該留」永遠去查 `HARVEST.md`**，它逐系統列了搬／改／砍與程式位置。
- Homeward 的 `README` / `PLAN.md` / `MORALE.md` 那些文件**沒有**複製過來，因為它們描述的是另一個遊戲。
  需要考古時去原 repo 看。

### 進度

拆解進度直接記在 [`HARVEST.md`](HARVEST.md) 的 §C / §D 表格裡（每列的「處置」欄會標 ✅）。
動工前先讀那兩張表，別重複別人做過的事。

---

## 鐵則

### 1. 改完一定要跑 headless 驗證

```bash
node _check.js              # 全部情境（目前 34 個）
node _check.js combat       # 只跑名字含 "combat" 的
node _check.js -v           # 失敗時印完整堆疊
```

**流程：改 → `node _check.js` 全綠 → 連跑 ×3 穩定 → 才 commit。**

這不是形式。這是個 9000 行的單檔、沒有型別、沒有單元測試，`_check.js` 是唯一的安全網。
它逐幀跑遍所有場景的 `update()` + `draw()`，並合成真實的鍵盤滑鼠事件；11 張地圖也各跑一遍。

**拆掉某個系統時，記得同步拆掉 `_check.js` 裡對應的情境或輸入合成**，
否則 harness 會呼叫已經不存在的函式而假性失敗。

> ⚠️ **綠燈不等於有覆蓋到。** 這個 harness 早期的戰鬥情境「看起來」在合成揮擊與格擋，
> 實際上一次都沒生效（滑鼠事件掛在 canvas 不是 window、`pointerLocked` 是總閘門、
> 敵人根本不在刀口上），所以整場模擬連一次 `damageUnit` 都沒進去，測試卻全綠。
> **加新情境時，斷言「結果」而不只是「沒丟例外」**——用 `invariants` 欄位放行為探針
> （現有的 `combatHappened` / `soloKnight` / `noMorale` / `noStealth` 就是範例）。

行為探針要**逐幀累積**，不要看結束時的快照：試作場在騎士倒下時會 `arenaResetFight()`
把敵人補回滿血，快照式的檢查會漏掉明明發生過的戰鬥（已經踩過一次）。

量「資源隨時間怎麼變」這種東西，要開一個**完全不輸入**的專屬情境（見 `wrath`），
不要塞進 `pokeCombat`——那裡每 25 幀就揮一刀，量到的是收支淨額，不是衰退本身。

`Math.random` 在沙箱裡被換成**可重設的 mulberry32**，每個情境開始前依序號重設種子。
所以 harness 是決定論的：**失敗一定重現得出來**。看到偶發性失敗，先懷疑是探針本身有競態，
不要用「多跑幾次就過了」帶過。

### 2. 零依賴、單檔、開檔即玩

- **永遠不要引入 npm 套件、建置步驟、框架。** 這是專案的體質，不是還沒來得及改的東西。
- `index.html` 一個檔案雙擊就能玩。`_check.js` 是唯一的例外（開發工具，不進遊戲）。
- 要拆 ES 模組請先跟人類討論——那會犧牲「開檔即玩」。

### 3. 數值集中、可即時調

所有可調內容集中在檔頂的 `CONFIG` / `WEAPONS` / `UNIT_CLASSES` / … 這些表，
並且有一個 `` ` `` 鍵叫出來的 **TUNE 面板**可以即時改。
**加新數值時要放進這些表**，不要散在函式裡寫死。

### 4. 資料驅動優先

新增敵種＝加一筆 `ENEMY_TYPES`；新增陣營＝加一筆 `FACTIONS`；新增遭遇＝加一筆 `ENCOUNTERS`。
戰鬥／AI／繪製不該為了加內容而改碼。

---

## 架構速查

單檔 `index.html`：`<style>` → `<canvas>` → 一整包 `<script>`。由上而下大致是：

| 區段 | 內容 |
|---|---|
| 檔頂 | `CONFIG` 與所有資料表（`WEAPONS` / `OFFHANDS` / `ARMORS` / `ARTS` / `AFFIXES` / `UNIT_CLASSES` / `ENEMY_TYPES` / `ENCOUNTERS` / `FACTIONS` / `ORIGINS` / `UNLOCKS`） |
| meta | `localStorage` 存檔（解鎖／榮譽）、`UNLOCKS` / `availPool` |
| 地圖 | `MAPS`（手刻，含 waypoint 圖）、幾何／射線／視線工具 |
| 單位 | `makePlayer` / `makeEnemy`、資源、體幹、揮斬、傷害結算 |
| AI | 敵人 tick、（待拆的）waypoint 戰術選點 |
| 場景 | `update(dt)` / `draw()` 依 `scene` 分派 |
| UI | 各場景的 `draw*` 函式；點擊區用「每幀重建 rect 陣列」的方式做 |
| 尾端 | TUNE 面板、沙盒、主迴圈 `frame()`、開機 |

**場景狀態機**：全域變數 `scene`，值有 `MENU / MAP / COMBAT / REST / ARMORY / TUTOR / BLACKSMITH /
ORIGIN / OATHS / EVENT / EDITOR / SANDBOX / HQ / FINALE / ENDING / RUNEND / RUNWIN / ARENASEL / DEBRIEF`。
`update()` 和 `draw()` 都用 `scene` 做分派。（其中不少場景會被拆掉，見 `HARVEST.md`。）

**主迴圈**：固定步長 `FIXED = 1/60` + accumulator，`hitstop` 會凍結模擬但繼續繪製。

---

## 踩雷筆記

發現一個記一個，別讓人重踩。

- **頂層 `const`/`let` 不掛在 global 上。** 在 Node `vm` 裡跑時抓不到 `update` / `draw`，
  所以 `_check.js` 是「在原始碼尾端附加 epilogue」把東西暴露到 `globalThis`。
  改動 epilogue 裡列的函式名時要同步改 `_check.js`。
- **`CONFIG.juice` 的 `camKick` / `shakeFire` / `shakeHit` / `shakeKill` 目前全是 0。**
  螢幕震動的管線接好了卻從沒開過——打擊感要甜頭直接從這裡拿。
- **`CONFIG.tempo` 目前是 1.2**，註解寫著「刻意拉長 20%」。那是 Homeward 的戰術節奏，
  TITHE 要往反方向走（見 `DESIGN.md` §3）。
- **既有 bug（尚未修）**：`updateDrops()` 撿取時只帶 `{kind, id, ammo}`，
  把 `spawnDrop()` 帶上的 `quality` / `enh` 丟掉，而 `enterRest()` 又在讀它們
  → 撿起來的武器精良度與詞條全部歸零。詳見 `HARVEST.md` §F。
- **`_legacyWarned` / `LEGACY_ART_ALIAS`**：術的 id 會被寫進 `localStorage`，
  改名要留別名表，否則會弄壞既有存檔。

---

## 慣例

- **commit message 用中文**，主旨一行講清楚做了什麼，內文說明**為什麼**（不是逐檔流水帳）。
- **程式註解也用中文**，跟現有風格一致：解釋「為什麼這樣做」與「為什麼不那樣做」，
  而不是複述程式碼。現有註解密度偏高，是刻意的，請維持。
- 分支：`claude/<主題>`，PR 對 `main`。
- **只 commit 該 commit 的東西**：`index.html` / `_check.js` / 文件。

---

## 決策紅線

這幾件事已經定案，要改請先跟人類確認：

1. **meta 不給數值升級。** 只有「裝備解鎖（是否進掉落池）」與「不同騎士」兩條軸。
   這是 `DESIGN.md` §2.8 難度契約的前提——加回數值 meta 等於廢掉那條契約。
2. **處決是唯一的回血手段。** 破例（回血包、回血技能）會讓 push-forward 整個塌掉。
   相關：**體幹只有敵人有**。體幹的工作是把敵人推進踉蹌開處決窗，它是進攻的計量器。
   騎士 `poiseMax` 恆為 0，被定住的唯一途徑是破防（`guardBreak()`）。
   `_check.js` 的 `noPlayerPoise` 守著這條。
3. **怒火不隨時間回復，只隨時間衰退**，而且衰退只在戰鬥中發生。
   「怒火比例 → 減傷」之所以不是死亡螺旋，完全建立在「靠打人回復」上——
   哪天改成時間回復，減傷必須同時拿掉。
4. **攻擊不花怒火。** 你永遠打得動。
   附帶兩個踩過的坑，改怒火時容易再踩一次：
   - **大絕招的門檻必須低於上限**（`CONFIG.wrath.ultCost` < `max`）。怒火隨時在衰退，
     門檻等於上限＝只有「剛好回滿的那一幀」按得下去，實際上放不出來。
   - **大絕招自己打出來的命中不回怒**（清空排在傷害結算之後）。不然人多的房間放一發回一半，
     等於可以連放。任何「一次打很多人」的新招都要想一下這件事。
5. **不引入依賴、不破壞單檔開檔即玩。**

---

## 快速上手

1. 讀 `DESIGN.md`（設計是什麼）
2. 讀 `HARVEST.md` §C/§D/§E（要做什麼、按什麼順序）
3. `node _check.js` 確認基線是綠的
4. 挑 `HARVEST.md` §E 順序裡的下一項，動手
5. 全綠 ×3 → commit → 在 `HARVEST.md` 標 ✅
