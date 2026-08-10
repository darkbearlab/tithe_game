# HARVEST — 從 Homeward 搬什麼、砍什麼

> `index.html` 是自 [`darkbearlab/Homeward-`](https://github.com/darkbearlab/Homeward-) @ `37b2e5e` **原樣複製**的基線（9078 行）。
> 這份是「刪到剩引擎」那一刀的作業清單：逐系統列出**搬 / 改 / 砍**，附程式位置與理由。
> 設計上為什麼這樣切，見 [`DESIGN.md`](DESIGN.md)。

**行號是基線 commit 的行號**，動過刀之後就會漂。以函式名稱為準，行號只是找路用的。

處置符號：**搬**＝原樣沿用 · **改**＝留下但要動 · **砍**＝整條拔除

---

## A. 引擎地基（搬，幾乎不動）

| 系統 | 位置 | 備註 |
|---|---|---|
| 單檔架構 / 開檔即玩 / 零依賴零資產 | 全檔 | 這是整個專案的體質，不動 |
| 固定步長主迴圈 | `frame()` ~9048 | `FIXED = 1/60` + accumulator |
| **旋轉攝影機 + pointer-lock 瞄準** | `updateCamera()` ~2275、`initCamera` ~2270、`w2s` ~2297 | **皇冠上的寶石**。正是快速俯視動作要的東西，一行都別退化 |
| 幾何 / 射線 / 碰撞 | ~1557–1640 | `segIntersect` / `rayHit` / `closestOnSeg` / `segCircle` … |
| 牆體 / 低矮牆 / 可破壞物 / 區域材質 | `DESTRUCT` ~2147、`MATERIALS` ~2159、`collideWalls` ~5673 | 房間還是要有牆 |
| 粒子 / 血霧 / 地上血漬 / 屍體 | ~5735–5790 | `mkPart` / `spawnBlood` / `pushDecal` / `corpses` |
| 螢幕震動 / 頓幀 / 後座 | `addShakeAt` ~2263、`hitstop` ~2264、`CONFIG.juice` ~173 | ⚠️ **參數目前全是 0**，甜頭一直沒領過（見 `DESIGN.md` §7） |
| 單位分離 / 推擠 | `separate()` ~5706 | |
| 武器資料模型 | `WEAPONS` ~367、`handsOf` ~517 | 內容要換，**結構照用** |
| 武器實例 + 精良度 + 詞條 | `WEAPON_QUALITY` ~443、`AFFIXES` ~448、`weaponInst` ~464、`effWeapon` ~488 | **現成的 loot 骨架** |
| **副手 / 盾** | `OFFHANDS` ~525、`shieldOf` ~3906、`blockArcOf`/`blockResistOf`/`parryWindowOf` ~3913–3915 | 格擋招架留下（`DESIGN.md` §2.6），三種盾的取捨照用 |
| **自由位 + 底部快捷列** | `SLOT_SCROLL`/`SLOT_LEARNED` ~4393、`castArt` ~3986、`drawHotkeyBar` ~7447 | `1`~`N` 整套沿用，只換成本來源 |
| 稀有度配色 | `RARITY_COLOR` ~625 | |
| Hooks 事件系統 | `Hooks` ~654 | 處決要掛在 `poiseBroken` 上 |
| meta 存檔 | `META_KEY`/`loadMeta`/`saveMeta` ~971–985 | 紀年另存一份 key（`DESIGN.md` §9.5） |
| **裝備解鎖 → 掉落池** | `UNLOCKS` ~987、`isAvailable`/`availPool` ~998、`rollLootWeapon` ~3549 | **meta 兩條軸之一，已完整實作** |
| 騎士樣板 / 出身 | `KNIGHT_TEMPLATES` ~907、`ORIGINS` ~2586 | **meta 兩條軸之二**。內容換成地獄主題，結構照用 |
| 兵種表 / 敵種表 | `UNIT_CLASSES` ~1129、`ENEMY_TYPES` ~1174 | 結構照用，內容整批換成惡魔名冊 |
| 遭遇模板 | `ENCOUNTERS` ~1211、`placeEncounter` ~1274 | 改成「房間的敵人配方」 |
| 陣營 | `FACTIONS` ~1315 | 簡化（大概只剩 player / hell） |
| 種子 RNG | `srandSeed`/`srand` ~1363 | mulberry32，可重現 |
| TUNE 即時調值面板 | ~8503–8677 | 調手感的命根子，一定要留 |
| 演出管線 | `cutscene`/`beatEnter`/`beatDone` ~3460–3525、`drawSpeechBubble` ~6449 | **禱文要用**（敘事內容換掉，管線留） |

---

## B. 戰鬥（留下，但要動刀）

| 系統 | 位置 | 處置 | 要動什麼 |
|---|---|---|---|
| **體幹 → 踉蹌** | `applyPoise` ~4088、`breakPoise` ~4100 | **改** | **這是處決的地基，已經九成寫好了。** 加：持續的踉蹌視覺標記、貼近觸發處決、處決演出、噴聖血+怒火。見 `DESIGN.md` §2.4 |
| **耐力 → 怒火** | `tickResources` ~4073、`spendStam` ~4086、`u.stam*`、`stamCost`、`drawKnightResources` ~7043 | **改（大改）** | **不是砍，是反過來**：開場為 0、命中/招架/處決累積、不隨時間回復、脫戰冷卻、攻擊不吃它。見 `DESIGN.md` §2.2–2.3 |
| **格擋 / 招架** | `blockCovers` ~4280、`raiseReactiveBlock` ~3922、`startWeaponParry` ~4287、`tickWeaponParry` ~4298 | **改** | 成本改吃怒火；**招架要給大量體幹傷害 + 回怒火**（它是通往處決的快速道路）；格擋不給體幹傷害、不給資源 |
| 揮斬管線 | `startSwing` ~4155、`tickMelee` ~4185、`meleeHitTest` ~4222 | **改** | 前後搖 × `CONFIG.tempo` 要調快；拿掉 `stamCost`（攻擊免費）；命中要回怒火 |
| 傷害結算 | `damageUnit` ~4550 | **改** | 砍掉士氣鉤子；加飄字 spawn；加「怒火比例 → 減傷」 |
| 擊退 | `applyKnock` ~4270、`tickKnock` ~4271 | 搬 | |
| 攻擊預告 | `telegraphOf` ~6719、`drawTelegraph` ~6743 | **改（加強）** | 從輔助資訊升格成戰鬥的主要語言 |
| 彈道 / 投射物 | `fireUnit` ~4326、`updateBullets` ~4875 | 搬 | 惡魔投射物要更慢、更看得見 |
| 裝甲兩層模型 | `CONFIG.armor` ~150、`damageUnit` 內 | 搬 | 盾衛/重甲直接靠這個成立 |
| 側翼 / 繞背 | `CONFIG.flank` ~159 | 搬 | 盾衛的「正確答案」就是它 |
| 術 / 卷軸 | `ARTS` ~784、`castArt` ~3986 | **改** | 保留「術」，**成本從 CD 改成怒火**（`DESIGN.md` §2.3） |
| **大絕招掛勾** | `useOathSkill()` ~4396（目前 `return false`）、`空白` 鍵 | **改** | 空殼已經留好，接上「滿怒火 → 清空換一發大的」 |
| **視錐 / 迷霧** | `CONFIG.vision` ~196、`canSee` ~2243、`visionPolygon` ~6982、`drawFog` ~6988、`drawSkeleton` ~7016 | **改（保留，預設關）** | 一般房間關掉，留給**暗房**房型。已有 `arenaNoFog` 旗標可比照。見 `DESIGN.md` §5.2 |
| 投擲物 / 煙 / 閃光 | ~4400–4515 | 改 | 煙霧是潛行道具（多半砍）；爆裂物留 |
| **奔跑 / 負重懲罰** | `sprintMult` ~5650、`carriedWeight` ~5641 | **改** | 奔跑改吃怒火；**負重懲罰整條拿掉**。另外新寫 **dash**（免費、CD、i-frame） |
| **攻擊權配額** | `attackTokens` ~4116–4136、`tryAcquireToken`、`releaseAttackToken` | **砍** | 見 `DESIGN.md` §2.7 |

---

## C. 整條砍除

按砍的順序排（先砍掉的東西會讓後面的更好砍）。

| # | 系統 | 位置 | 為什麼 |
|---|---|---|---|
| 1 | **扈從 / 指令層** | `CONFIG.command` ~257、`issueCommand` ~5175、`allyMoveTick` ~5200、`navMoveTo` ~5190、`spaceOutAllies` ~5715、`cmdWheel` ~6049、`drawCommandWheel` ~7073、`drawAllyCard` ~7399 | 教廷送**一個人**進地獄 |
| 2 | **士氣質量模型** | ~4941–5174（`quality`/`structMass`/`effMass`/`moraleLine`/`tickMorale`/`tickFactionMorale`/`fleeUnit`/`rallyUnit`/`drawFactionMorale`/`drawMoraleFlag`）、`CONFIG.morale` ~281、`BREAK_PCT` ~333、`QBASE` ~343 | 敵人會潰逃而不是死掉＝反 loot、反資源迴圈。**最大的一塊** |
| 3 | **潛行 / 警覺 / 識別** | `CONFIG.stealth` ~164、`isRevealed` ~2254、`inBush`/`inSmoke`/`concealAt` ~2238 | 房間是亮的、門是鎖的。⚠️ **只砍潛行判定，不砍視錐/迷霧本身**（那個移到 B 表） |
| 4 | **聽覺 / 聲音漣漪** | `CONFIG.hearing` ~131、`CONFIG.soundRipple` ~181、`pingSound` ~5770、`drawSoundEdges` ~6564、`drawSoundRipples` ~6698、`alertEnemiesNear` ~4365 | 潛行的配套。（視覺化的漣漪日後若要給暗房用可回收） |
| 5 | **waypoint 戰術 AI** | `scoreNode` ~5313、`watchPoint` ~5346、`reservations`/`commitReservation` ~5309、`patrolStep` ~5407、`claimPatrolPoint` ~5387、`huntStep` ~5498、`searchMoveTo` ~5485、`updateThreatKnowledge` ~5449、`bfsPath` ~5399、`buildNextHop` ~2193、`CONFIG.ai` ~234、`CONFIG.hunt` ~170、`CONFIG.patrol` ~167 | 封閉房間用不上。**換成直接操舵**，順便解鎖程序生成房間 |
| 6 | **進出點 / 撤離 / 追兵** | `ENTRY`/`EXTRACT` ~2138、`pickAccessPoints` ~2207、`CONFIG.access` ~109、`extractTick` ~5622、`toggleExtract` ~3866、`extractAll` ~3878、`CONFIG.reinforce` ~107 | 出口是房間中央的洞 |
| 7 | **休息關 / 配裝 UI** | ~3676–3900（rest 全套）、~7558–8110（`drawKnightPanel`/`drawWarehousePanel`/拖曳穿脫/`drawRest*`）、`warehouse`/`backpack` ~2343 | 掉落改成即時吃 + 洞口三選一，不需要背包畫面 |
| 8 | **事件 / 導師 / 鐵匠 / 軍械庫 / 俘虜 / 護送** | `EVENTS` ~3112、`enterTutor` ~3607、`enterBlacksmith` ~3663、`enterArmory` ~3564、`freePrisoner` ~4830、`runEscort` ~3043、`REST_SITES` ~921 | run 內經濟改由掉落承擔 |
| 9 | **meta 數值升級樹** | `UPGRADES` ~1006、`upgLevel`/`upgVal`/`buyUpgrade` ~1024–1035、`drawHQ` ~8817 | 見 `DESIGN.md` §8。HQ 畫面改成「紀年 + 解鎖」兩塊 |
| 10 | **誓約系統** | `OATHS` ~700、`applyOathLoadout` ~756、`drawOathLoadout` ~7795、`CONFIG.oath` | 與「掉落即 boon」重疊。⚠️ **`useOathSkill` 的空殼要留**（大絕招要用，見 B 表） |
| 11 | **聖物 / 遺物攜帶** | `RELICS` ~669、`fileDrop`/`hasFile`、`CONFIG.relicEnabled` ~85 | 原版機密檔案機制的殘骸，本來就關著 |
| 12 | **敗騎歸鄉敘事** | `FINALE_*` ~945–970、`ENDINGS` ~1475、`homecomingAxes` ~1470、`introBeats` ~3420–3452、`runAct`/`beginAct2` ~2731 | 換成血脈紀年。**演出管線留著**（見 A 表） |
| 13 | 試作場 / 沙盒 | ~2837–3040、~8678–9040 | **可以先留著**（調手感很好用），發佈前再處理 |
| 14 | 舊地圖 | `MAPS` ~1663–2136（11 張） | 全是為潛行/撤離設計的。留 1–2 張當臨時測試場，其餘刪 |

---

## D. 全新要寫的

砍完之後才開始加。按依賴順序：

| # | 東西 | 依賴 | 備註 |
|---|---|---|---|
| 1 | **怒火**（取代耐力的行為） | B 表的耐力改造 | 開場 0、打人累積、脫戰冷卻、比例減傷 |
| 2 | **處決** | 體幹踉蹌（已有） | 踉蹌標記 + 觸發鍵 + 演出 + 噴聖血/怒火 |
| 3 | **dash** | — | 免費、CD、i-frame |
| 4 | **傷害飄字** | — | 一般/暴擊/招架/處決 四種樣式 |
| 5 | **聖油** | 處決的資源噴發 | 極少次數、刪菁英、大演出 |
| 6 | **房間流程** | C6（撤離砍掉） | 進門鎖上 → 清場 → 中央開洞 → 三選一全揭露 → 跳下去 |
| 7 | **直接操舵 AI** | C5（waypoint AI 砍掉） | 各兵種的位移花招 |
| 8 | **惡魔名冊** | 7 | 7 隻，見 `DESIGN.md` §4 |
| 9 | **血脈紀年** | — | 存檔格式 + 死亡命名 + 禱文演出（用現有 cutscene 管線） |
| 10 | **父輩 boss** | 9 + 玩家行為可被 AI 驅動 | **用玩家的程式碼做**——他會 dash、格擋、招架、處決你。見 `DESIGN.md` §10.4 |

---

## E. 建議的動刀順序

一次砍一塊、每塊砍完都要能跑起來。沿用 Homeward 的守則：**改完一定要跑 headless 驗證**
（逐幀跑遍所有場景的 `update()` + `draw()`，不只在戰鬥跑）。

1. **C1 扈從** — 最獨立，砍完立刻少掉一堆交互
2. **C2 士氣** — 最大一塊，但邊界清楚（`hasMorale`/`moraleEligible` 是總開關）
3. **C3+C4 潛行 + 聽覺** — ⚠️ 小心別把視錐/迷霧一起帶走（那個要留）
4. **C6 進出點 / 撤離** — 場景流程要先改成「清場開洞」才好接後面
5. **C5 waypoint AI → 直接操舵**（D7）— **砍與寫同時發生**，這批裡最需要小心的一塊
6. **C7+C8 休息關 / 事件經濟**
7. **C9~C12 meta / 誓約 / 敘事** — ⚠️ 留下 `useOathSkill` 空殼與演出管線
8. **C14 地圖** — 最後，因為前面每一步都還要靠它測試

砍完再照 D 表的順序加新東西。**D1 怒火 + D2 處決 + D3 dash + D4 飄字**是第一個可玩的垂直切片——
那四個做完就能判斷手感對不對，其餘都可以等。

---

## F. 順手要修的既有 bug

搬過來的時候一併處理（Homeward 的 `BACKLOG.md` 也記著這條）：

**掉落物的精良度與詞條會在撿取時遺失。**

- `spawnDrop()` ~4740 有帶上 `quality` 與 `enh`
- `updateDrops()` ~4751 撿取時只 push `{ kind, id, ammo }` — **兩個欄位掉在地上**
- `enterRest()` ~3681 又在讀 `it.quality` / `it.enh` → 永遠 `undefined`

結果：撿起來的武器精良度與詞條全部歸零。TITHE 以掉落為成長主軸，這條必須先修。
