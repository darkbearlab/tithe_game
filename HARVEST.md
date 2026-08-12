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
| **耐力 → 怒火** | `tickResources` ~4073、`spendStam` ~4086、`u.stam*`、`stamCost`、`drawKnightResources` ~7043 | **改（大改）** | 開場滿、命中/招架/處決累積、**不隨時間回復但隨時間衰退**、衰退只在戰鬥中發生（清場凍結、換房不扣）、攻擊不吃它。見 `DESIGN.md` §2.2–2.3 |
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
| **視錐 / 迷霧** | `CONFIG.fog.enabled`、`fogOn()`、`canSee`、`visionPolygon`、`drawFog`、`drawSkeleton` | ✅ **改（保留，已預設關）** | 機制完整保留，`CONFIG.fog.enabled` 預設 `false`＝一般房間看得見全場。打開就回到「只看得見視錐內」＝**暗房**房型（試作場 `N` 鍵可即時預覽）。見 `DESIGN.md` §5.2 |
| 投擲物 / 煙 / 閃光 | ~4400–4515 | 改 | 煙霧是潛行道具（多半砍）；爆裂物留 |
| **奔跑 / 負重懲罰** | `sprintMult` ~5650、`carriedWeight` ~5641 | **改** | 奔跑改吃怒火；**負重懲罰整條拿掉**。另外新寫 **dash**（免費、CD、i-frame） |
| **攻擊權配額** | `attackTokens` ~4116–4136、`tryAcquireToken`、`releaseAttackToken` | **砍** | 見 `DESIGN.md` §2.7 |

---

## C. 整條砍除

按砍的順序排（先砍掉的東西會讓後面的更好砍）。

> **§C5 的範圍修訂（重要）**：原訂「waypoint AI 整套砍掉換直接操舵」。實際動工前拆成四層重新評估，
> 結論是**尋路（`navMoveTo`／`bfsPath`／`nearestNode`／waypoint 圖）要留**——它不是戰術 AI，是「不撞牆」的工具，
> 直線可達就直走、被牆擋才走圖，拿掉的代價是敵人卡在轉角磨蹭。真正該砍的只有**戰術選點**那一層
> （躲掩體是反 push-forward 的）。這個修訂讓 C5 從「砍與寫同時發生」變成幾乎純刪除，
> 而 D7 的兵種花招也就能真的等到有惡魔名冊時再做。
> **相依**：留下尋路 ⇒ 每張地圖都要有 waypoint 圖。程序生成房間需要把編輯器的
> 「鋪滿網格點 + 自動整理連線」搬進遊戲端（見 D 表 D6/D7 前置）。

| # | 系統 | 位置 | 為什麼 |
|---|---|---|---|
| 1 | ✅ **扈從 / 指令層** | ~~`CONFIG.command`／`CMD_LIST`／`CMD_META`／`RETAINER_BEHAVIOR`／`anchorOf`／`issueCommand`／`allyMoveTick`／`spaceOutAllies`／`cmdWheel`＋`wheelAimTarget`＋`commitWheelCommand`／`drawCommandWheel`／`drawAllyCard`／`extractAll`／`arenaAllies`~~ | 教廷送**一個人**進地獄。**已完成**：`startMission` 現在只生成騎士一人，Q/G/Shift+H/B 熱鍵移除，`idleTick` 縮成「自走撤離時的自動還擊」，`scoreNode` 的繩長懲罰移除。`navMoveTo` **保留**（敵人的有序後撤 `retreat` 還在用）。harness 加了 `soloKnight` 不變式當回歸守門員。 |
| 2 | ✅ **士氣質量模型** | ~~`CONFIG.morale`／`BREAK_PCT`／`QBASE`／`MORALE_STATE`／28 個函式（`quality`／`structMass`／`knightAnchor`／`ralliedMass`／`effMass`／`moraleLine`／`refreshMoraleState`／`tickMorale`／`tickFactionMorale`／`fleeUnit`／`rallyUnit`／`drawFactionMorale`／`drawMoraleFlag`／momentum 全套）～~ | 敵人會潰逃而不是死掉＝反 loot、反資源迴圈。**已完成**：拉鋸線、崩潰門檻、震盪、騎士錨點、聚攏度、`panicType`（潰逃／捨身／呆立／轉進）全數移除；敵人現在戰到死。連帶處理跨戰鬥氣勢層（S1 `runMomentumMods`）與它在護送／女巫／事件的四個消費點。harness 加了 `noMorale` 不變式。 |
| 3 | ✅ **潛行 / 警覺 / 識別** | ~~`CONFIG.stealth`／識別空窗 `detect`／開火現形 `revealT`／`concealAt`＋`inConceal`＋`inSmoke`（遮蔽）／全隊靜默 `squadRevealed`／煙罐 `smokepot`~~ | 房間是亮的、門是鎖的。**已完成**：敵人改成「看到就交戰」；`canSee` 拿掉遮蔽判定與 IDLE 視錐縮減，**視錐/迷霧本身完整保留**（B 表）。草叢只剩移動減速。煙罐因遮蔽消失而失去作用，整個術移除、舊存檔別名指向火油罐。⚠️ **過渡狀態**：牠們現在只靠看見醒來，繞過視錐仍過得去——D6 房間流程會讓進房即鎖門、全員 ENGAGED。 |
| 4 | ✅ **聽覺 / 聲音漣漪** | ~~`CONFIG.hearing`／`CONFIG.enemyHearRadius`／`CONFIG.soundEdge`／`CONFIG.soundRipple`／`alertEnemiesNear`／`pingSound`＋`SOUND_PINGS`＋`swingPingR`／`visStep`／`drawSoundEdges`／`drawSoundRipples`／`bushRustleMult`~~ | 潛行的配套，一起走。**已完成**：腳步聲、求援連鎖、命中/陣亡驚動全部移除；`Sfx.play` 留著當未來接 WebAudio 的接縫（pos/r 參數保留給空間化）。⚠️ 喪鐘的 `loud` 旗標因此失效，待內容階段處理。 |
| 5 | ✅ **waypoint 戰術「選點」**（尋路保留！） | ~~`scoreNode`／`watchPoint`／`CONFIG.ai` 權重表／`nodeVis`／`reservations`＋`commitReservation`＋`hysteresisBonus`／`SPECIAL_TAGS`＋`isSpecial`／巡邏全套（`patrolStep`／`claimPatrolPoint`／`computePatrolPool`／`enemyIdleTick`）／搜索全套（`huntStep`／`searchMoveTo`／`bfsWithin`／`updateThreatKnowledge`／`registerHitThreat`／`nearestKnownPlayer`）~~ | **⚠️ 這一列的範圍在動工前改過**（見下方註）。**已完成**：拿掉「挑哪個點站」那一層，敵人改成 `navMoveTo` 直接朝目標尋路、停在自己武器打得到的距離上。目標記憶改成**逐隻自己記**（`lastSeenPos`／`CONFIG.enemy.memory` 秒），不再有全體共享的情報網；背後挨刀會把來向記成最後已知位置（所以還是會回頭）。`personalityName` 保留成**純資料標籤**，等 D7 掛操舵參數。 |
| 6 | ✅ **進出點 / 撤離 / 追兵** | ~~`EXTRACT`／`CONFIG.access`＋`pickAccessPoints`／`spawnPoints`／`extractTick`／`toggleExtract`＋H 熱鍵／`EXTRACTING`＋`EXTRACTED` 兩個狀態／`seizeIfEscorting`／`extractNodeId`＋`nextHop`＋`buildNextHop`／`CONFIG.reinforce`＋追兵／`curTimeBudget`＋計時 HUD／`idleTick`＋`KNIGHT_IDLE`~~ | 出口是房間中央的洞。**已完成**：新增 `roomCleared`，**清場＝過關**（`enemies.every(dead)`）。`ENTRY` 保留當騎士的出生點；隊形軸與開場朝向改成「朝地圖中央」。連帶：`idleTick` 失去唯一呼叫者（`extractTick`）而一併移除，C1 留下的 `KNIGHT_IDLE` 也跟著退役。序章的 `gate: 'extract'` 改成 `'clearRoom'`。⚠️ 地圖資料的 `extractionPoints` 與編輯器的「撤」工具**尚未清理**——編輯器要等 D6 決定「洞」怎麼表示時一起改。 |
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

> **順序改過**：原訂「砍完 C7–C14 才開始加」。實際上 C7–C14 全是 UI 與內容、完全不碰戰鬥核心，
> 先刪它們不會回答「這個遊戲好不好玩」——而那是現在最該問的。所以改成
> **先做垂直切片（D1–D4）驗手感**，C7–C14 等做房間流程（D6）時一起清（那時它們才有替代品）。

> ✅ **調值待辦（D2/D3 期間反覆撞到）已處理**：敵人常常在體幹破之前就先被血量殺死。
> 後來**用算的而不是用猜的**：靜態算出每個「武器×招式×敵人」的 `破幹刀數` vs `擊殺刀數`，
> 發現舊數值下 48 個組合裡有 34 個開不出處決窗（雜兵的 HP ≈ 每刀傷害 ×2，體幹卻要兩三刀，
> 死亡和破幹落在同一刀）。照 §2.8 推論 3 **降體幹、不加血**：農兵/戰狼 25→18、徒步兵 45→30、
> 槍兵 55→32、盾兵 60→34、弓手 35→18、弩手 50→32、平民 20→12、披甲士/軍士 110→44
> （重裝真正的體幹是 `armorPoiseMul` ×1.7；而完全破甲的石中劍換到傷害就換不到震盪，
> 體幹上限得低到讓它仍然開得出窗）。
> 規則已經變成 harness 的不變式 `executionWindowExists`，不會再默默倒退。
> **手感仍然要玩測**——算式只保證窗「開得出來」，不保證好玩。
> harness 的處決探針仍然**直接塞 `staggerT`** 跳過整條數值鏈——它驗的是機制，不是平衡。

砍完之後才開始加。按依賴順序：

| # | 東西 | 依賴 | 備註 |
|---|---|---|---|
| 1 | ✅ **怒火**（＋騎士體幹拿掉） | B 表的耐力改造 | **已完成**：耐力整條換掉。`CONFIG.wrath` 一處集中所有數字（面板 ` 可即時調）。開場滿 → 命中 +5／招架 +18／處決 +36 → 戰鬥中每秒 −4.5（**清場那一刻凍結、換房不扣**）。**攻擊完全免費**；花費只有格擋（依來襲體幹傷害計價 ×盾倍率）、奔跑 16/s、術（CD 整套拆掉改吃怒火）、大絕招。怒火比例 35%→100% 線性給 0→28% 減傷（乘算，不進 `resistCap`，所以板甲也感覺得到）。武器詞條「平衡」改義＝命中多回怒；甲的 `stamRegenMul` → `wrathGainMul`（板甲積得慢）。<br>**騎士的體幹整條拿掉**（實測看不出差異）：`makePlayer` 一律 `poiseMax:0`＝所有體幹閘門短路，HUD 只剩怒火一條。破防從 `breakPoise` 拆成獨立的 `guardBreak()`＝騎士唯一會被打進硬直的途徑。meta 的「鎮定/穩固」與誓約「不退」跟著改口徑 |
| 2 | ✅ **處決** | 體幹踉蹌（已有） | **已完成**：踉蹌環＋「F 處決」提示、F 觸發（處決優先於開門）、鏡頭拉近＋震動＋頓幀、回血＝目標 maxHp×16%、回怒 +36（D1 已接上）。⚠️ **平衡問題**：以現在的數值敵人常在體幹破之前就先被血量殺死＝處決窗很少出現，見下方註 |
| 3 | ✅ **dash** | — | **已完成**：空白鍵、`CONFIG.dash`（200px / 0.15s / CD 0.8s / i-frame 佔前 75%）、殘影 + i-frame 白環 + 左上冷卻條。方向吃移動輸入（沒輸入就往面向突進）。**會取消當下的揮擊**＝那是它的代價。大絕招因此讓位到 **Q**（C1 拿掉隨從姿態後空出來的鍵） |
| 4 | ✅ **傷害飄字** | — | **已完成**：一般／暴擊／擋／招架／體幹破／處決／回血 七種樣式。世界座標存、螢幕座標畫（攝影機會轉，字要永遠正立） |
| **0** | ✅ **主副手＝左右鍵**（moveset 改造） | — | **已完成**。武器從「一組揮擊參數」變成「一袋招式」；`startSwing(u)` → `startSwing(u, move)`。招架掛到副手槽，副手四選一變成真取捨表。連帶刪 `X` 換武器組／`CONFIG.weaponSwap`／`slotsOf` 2 格規則／`weight` 欄位。見 `DESIGN.md` §2.6b。新招式：斧「劈落」、長槍「橫掃」、喪鐘「鳴響」。長槍左鍵仍是突刺（敵人 AI 只用 light，翻過來槍兵會變成完全不同的敵人）。探針 `moveset-2h`／`moveset-dual`／`oneHandSet` |
| 5 | **聖油** | 處決的資源噴發 | 極少次數、刪菁英、大演出 |
| — | ✅ **大絕招「聖怒」** | 1 | **已完成**（D1 附帶）：`useOathSkill()` 從 `return false` 接上。**Q** 鍵、門檻 `CONFIG.wrath.ultCost`（90，**刻意低於上限**——怒火一直在衰退，門檻等於上限就只有回滿的那一幀按得下去）、放出去清空整條。效果是半徑 200 內全體 90 傷（滿穿甲）+ 體幹全破 + 大擊退＝**把整個房間變成處決窗**，但不替你收人頭。這一發自己打出來的命中**不回怒**（清空排在傷害結算之後），否則人多時放一發回一半＝可以連放 |
| 6 | ✅ **房間流程** | C6 ✅ | ~~清場 → 中央開洞 → 跳下去~~ **已完成**：`CONFIG.exit`、`openExitPortal()`（開在離房間中央最近的 waypoint＝保證站得到）、碎裂石環 + 黑洞 + 光柱、邊緣指標、清場提示；**走進洞才過關**。<br>**已完成（第二塊）**：**進房＝全員 ENGAGED**（房間是封閉、上鎖、已被驚動的；「繞過視錐把整房走完而不開打」是潛行拆掉後留下的殘影）。探針 `room-awake` 在**第一次 update 之前**取樣——跑兩幀敵人自己就看到你了，量到的會是視線不是這條規則。<br>**已完成（第三塊）**：**下墜整備**（新場景 `DESCENT`）——跳進洞之後、落地之前的那一停，先三選一（全揭露，沿用 `rollArmory`）再配裝，然後落地接回路線圖。袋子＝這一房撿到的＋剛選的獎勵，只能裝到身上或丟掉，落地就清空（§6.2b）。全部操作都有鍵盤路徑（1~9／D／Enter），滑鼠只是另一條路——這樣探針才不用點座標。探針 `descent`。<br>**已完成（第四塊）**：**波次**（`CONFIG.waves`：一房三波，清光一波才來下一波，門先亮 1.8s 再湧出，位置取離騎士最遠的錨點）與**房間串接**（`CONFIG.floor`：一層 6 房的手刻輪播，落地直接進下一房，路線圖不再出現）。探針 `waves`／`rooms`。<br>**還沒做**：層王、程序生成房間（要先把編輯器的自動鋪點搬進遊戲端）、進門真的鎖門（門的資料層）。<br>**前置**：程序生成房間要能自動產 waypoint 圖（把編輯器的「鋪滿網格點 + 自動整理連線」搬進遊戲端） |
| 7 | **兵種位移花招** | C5 ✅ | 各兵種自己的接近方式（撲咬者衝刺、投火者保持距離…）。掛在 `personalityName` 上。**尋路已經有了**，這層只加「怎麼靠近」的個性 |
| 8 | **惡魔名冊** | 7 | 7 隻，見 `DESIGN.md` §4 |
| 9 | **血脈紀年** | — | 存檔格式 + 死亡命名 + 禱文演出（用現有 cutscene 管線） |
| 10 | **父輩 boss** | 9 + 玩家行為可被 AI 驅動 | **用玩家的程式碼做**——他會 dash、格擋、招架、處決你。見 `DESIGN.md` §10.4 |

---

## E. 建議的動刀順序

### 建議順序（2026-08 更新，使用者確認）

垂直切片（D1–D4）已經完成，接下來的排序理由是**每一步都要讓下一步變得好做**：

| 步 | 做什麼 | 大小 | 為什麼排在這 |
|---|---|---|---|
| **1** | ✅ **主副手 moveset 改造**（D 表 #0） | 大 | 它改的是**動詞集**。整備畫面（§5.4b）要先知道「一套配裝是什麼」才畫得出來；敵人名冊要先知道玩家有什麼招才寫得下去。建議拆兩個 commit：①資料模型＋騎士 ②敵人／預告／試作場面板 |
| **2** | ✅ **掉落 bug + 體幹/處決平衡** | 小 | **已完成**：`updateDrops()` 撿取時補回 `quality`/`enh`（探針 `drop-enh`）；體幹整批下修到「破幹嚴格早於打死」，規則寫成不變式 `executionWindowExists`（見上方註）|
| **3** | ✅ **D6 房間流程完成** | 大 | **已完成**：全員 ENGAGED、洞口三選一、下墜整備（限時 30s）、波次、房間串接。**它現在第一次是「一個遊戲」而不是試作場**。剩：層王、程序生成房間、進門真的鎖門 |
| **3.5** | ✅ **裝甲重寫 + 結晶 + 擊殺噴發** | 大 | **已完成**（玩測回饋長出來的）：見下方「玩測輪次」 |
| **3.6** | ✅ **武器詞條** | 中 | **已完成**：兩池（數值型無上限／效果型每把 1~2）、效果型掛在「你打對了」的四個事件、`quality` 改義成機率倍率。見下方專節 |
| **4** | **C7～C11 拆除** | 中（純刪） | 休息關／事件／倉庫／meta 升級樹／誓約。要等步驟 3，那時它們才有替代品；先刪會讓遊戲中間有一段不能玩 |
| **5** | **D9 血脈紀年** | 中 | 禱文是這個遊戲的身分，而且很便宜（沿用 cutscene 管線）。死亡遺物回收（§9.2b）也要它 |
| **6** | **D8 惡魔名冊** | 大（內容） | 現有八種兵種是堪用的替身，所以可以等。等平衡與動詞都定了再做才不會白做 |
| **7** | D5 聖油 · D7 兵種位移花招 · D10 父輩 boss | — | D10 要 D9 + 玩家程式碼驅動 AI |

### ✅ 武器詞條（已完成，2026-08）

使用者定案的形狀全部落地，設計正文搬進 `DESIGN.md` §6.4：

- **數量用機率限制，不設硬上限**：滾成一條就再擲一次，機率逐條衰減（`CONFIG.affix.statFalloff`）。
  `statRunaway: 12` 是**失控保險，不是設計上的上限**。
- **兩池**：數值型（鋒棱／破甲／燼紋／順手／沉錘，**允許重複、無上限**）
  vs 效果型（燼落 AOE／曜釘 投射物／逐火 投射物／裂光 雷射／崩牙 衝擊波，**每把 1~2、去重**）。
- 效果型掛在四個「你打對了」的事件上：`execute` / `parry` / `poiseBroken` / **`heavyHit`**。
  `heavyHit` 是這次新 fire 的事件，**刻意不是 `attackHit`**——後者每一刀都在跳。
- **效果型打出來的傷害不回怒**（`damageUnit` 的 `noWrathGain`）。一次打很多人的招照常回怒
  ＝詞條變成怒火發電機（實測一發 AOE 打三隻就 +24），那是大絕招那個坑的同一版。
- **`quality` 已改義成機率倍率**（`CONFIG.affix.qMul`）。鐵匠／導師改吃
  `CONFIG.enhance.craftSlots`（2 次，與精良度無關）；`chargesUsed`/`chargesFree` 兩個舊名留著
  （UI 有六處在讀），但語意是「craft 預算」，只算 `by:'craft'` 的條目。
- 效果型與結晶**共用 Hooks**；三個原型做成通用函式（`affixBurst`／`affixBolts`／`affixBeam`），
  加一條新詞條＝加一筆 `AFFIXES` 資料，不必動引擎。
- 擲點在**取得的那一刻**：`lootWeaponEntry`（撿到／事件獎勵）、`rollArmory`（三選一，
  **卡片上就擲好**＝§5.4 全揭露：寫著什麼拿到就是什麼）、`spawnDrop`（敵人手上是白板，
  掉在地上才擲——詞條是給騎士的動詞，不是給 AI 的數值）。
- **限制**：`needs:'heavy'` 的效果型只長在有右鍵招式的武器上（否則是一條永遠不會觸發的死詞條）。

**探針**（十一種破壞方式各驗過一次會紅）：

| 探針 | 守什麼 |
|---|---|
| `affix-roll` | 兩池的形狀（效果型 ≤2、數值型長尾還在）、精良度真的是機率倍率、掉落那一站真的在擲 |
| `affix-offer` | 卡片上寫的詞條要進袋、而且要跟著武器走過那道門 |
| `affix-proc` | 效果真的觸發、**雷射真的畫得出來**、而且**不回怒** |
| `affix-everyhit` | **體幹按在滿格砍一整場，proc 必須是 0**——這條是整個近戰讀招的存亡條件 |

> ⚠️「不回怒」那條第一版是**假綠**：量的時候怒火是滿的，`gainWrath` 被上限夾住，
> 「回了」和「沒回」看起來一模一樣。要先把怒火壓到 40% 再量。又一次驗證那條守則：
> **每加一條探針，動手把它守的東西弄壞一次。**

**留下來的缺口**：詞條只長在**主手**。副手槽存的是一個 id（`s.off`），沒有實例可以掛身分——
要讓副手也帶詞條，得把 `offInst` 串進 `mkSet`／roster／整備／`rosterFromPlayer`。
現在換到副手時會**明講**「副手不吃詞條」，不靜靜地吃掉玩家剛選到的東西。

**順手修掉的**：`startMission` 沒有清 `descend`——上一房沒播完的下墜四拍會在新房第一幀
跑完並呼叫 `endMission()`＝**剛進門就被判敗**。它本來只是「剛好沒發生」，
詞條改動讓 loot 的 RNG 位移之後就穩定重現了。

### 下一項

E 表步驟 **4（C7～C11 拆除）**：休息關／事件／倉庫／meta 升級樹／誓約。幾乎純刪除，
要等房間流程給出替代品——現在有了。拆倉庫 UI 時順手把 `ARMORS` 整張表退休（見下方擱置清單）。

### 美術：要不要接 gpt-image（**待使用者決定，紅線題**）

使用者想試「讓 Claude Code 把美術也一起接起來」（本機 CLI 有掛 gpt-image 的 MCP；
雲端 session 抓不到那個 server，所以這件事只能在本機做）。

動手前要先回答一個問題，因為它撞到**決策紅線 #5**（不引入依賴、不破壞單檔開檔即玩）
與 §A 那句「零依賴**零資產**＝這是整個專案的體質」。TITHE 現在畫面上每一個像素
都是 canvas 畫出來的，一張圖檔都沒有。圖要怎麼進遊戲有三條路：

| 做法 | 保住單檔？ | 代價 |
|---|---|---|
| **A. 產圖只當參考**，照著手寫程序化繪製碼 | ✅ 完全保住 | 圖不進 repo，只在開發時看。風格仍是「程式感」——但那本來就是現在的樣子 |
| **B. PNG → data URI 內嵌 `index.html`** | ✅ 檔案仍是一個 | 一張 512×512 約 +150~400KB；`index.html` 現在 9000 行還讀得動，塞幾坨 base64 就不行了 |
| **C. 獨立 `assets/` 資料夾** | ❌ 破功 | 「雙擊即玩」變成「要一整包」，而且 `file://` 下 canvas 讀圖還有污染問題 |

**建議 A**，而且建議把它接到 **D8 惡魔名冊**上：那七隻現在缺的不是圖檔，是
「牠該長什麼樣、要用什麼形狀畫得出來」。產概念圖 → 照著寫 `drawEnemy` 的形狀，
紅線一條都不用動，而且產出物（程式）本來就是要寫的。

要走 B 的話那是**在改紅線**，請先定上限（例如只有層王立繪與標題畫面用內嵌圖，
戰鬥中一律程序化），否則單檔會在三張圖之內失控。

> 附帶：gpt-image 的輸出多半要後製（去背／對齊調色盤／切格），那需要
> Python + Pillow 之類的工具。**那不算破壞零依賴**——它是開發工具，和 `_check.js` 同一個位階，不進遊戲。

### 玩測輪次（2026-08，使用者實際玩過之後長出來的）

按時間順序，每一條都已經落地：

1. **怒火**加 `decayDelay`（最後一次回怒後 1.3s 才開始扣）——沒有緩衝的話「不是純 aggro
   就根本累積不起來」。衰退 4.5→2.2/s。
2. **遠程本來完全不打體幹**（子彈那條路徑沒傳 `poiseDmg`）＝弓弩投槍永遠開不出處決窗。已修。
3. **投槍**改成「出手慢但每一發都有宰制力」。**鏡頭** 1.0→1.25。**處決窗** 1.8→2.6s。
4. **裝甲整套重寫**（§2.6c）：拿掉機率彈開，改純比例減傷；`pierce` 改義成「反裝甲程度」，
   加的是**體幹傷害**不是傷害；不足時跳「反彈」。**怒火的減傷交給結晶**。
5. **結晶**（§2.6c）：三類、通用 N 格、每層 +1、掉落加權；人間的甲退出掉落池。
6. **擊殺噴發**：一般擊殺只噴怒火、處決噴聖血+大量怒火（DOOM 的分法）。命中回怒 8→4。
7. **跨房不回血**（`interMissionHealFrac` = 0）——這條影響最大：它讓前面所有關於處決的
   設計第一次真的重要起來。
8. **敵人**：體幹與 HP 整批往上（「砍一刀→處決」沒有份量）、散開半徑 44→110、
   開場拆到三個錨點、砍掉一隻。**增援不必等全殲**（gap 11s 或剩 ≤2 就來，兩個門同時湧出）。
9. **整備**：拖曳指定槽位、換下的回袋子、兩邊都顯示數值摘要；自由位固定 4 格。
10. **下墜**：四拍（頓→吸→頓→縮到 1px）、上升火星、限時 30s 的順時針外框、洞口確認框拿掉。

### 使用者擱置中的待辦（他自己說「先放著」）

- **敵人攻擊頻率**要跟著新的耐打度調整。真正的旋鈕是 `CONFIG.melee` 的
  `maxAttackers` / `tokenRest` / `tokenKeepBase`（決定被圍毆有多密），比改武器前後搖有效。
  （順帶：敵人連擊的遞減機率**還在**，`tickMelee` 裡的 `tokenKeepBase − tokenChain × tokenKeepDecay`。）
- **`ARMORS` 整張表的最終退休**：已經退出掉落池、`armorBase` 恆為 0，但表本身與 `armorId`
  欄位還在（只剩名字）。等 C7 拆倉庫 UI 時一起清。
- **`CONFIG.crystalSlots` 的節奏**（3 / +1 每層 / 上限 6）還沒玩測過。
- **詞條的擲骰數值**（`CONFIG.affix`）還沒玩測過：精良1 平均約 0.6 條、精良5 約 2.1 條，
  約三分之一的武器帶一條效果型。效果型的傷害／半徑全是第一版的猜測——它們是**爽點不是輸出**，
  太強會把讀招蓋掉，太弱則看不出身分。

> **進度**：✅ = 已完成。動工前先看這裡，別重做。
> 目前完成到 **5（waypoint 戰術選點）**；C1–C6 全部完成。下一項是 **7（休息關／配裝 UI）**。
> D 表：D1 ✅ D2 ✅ D3 ✅ D4 ✅、D6 做了第一塊。垂直切片已經完整，接下來該**實際玩**再決定調值。

一次砍一塊、每塊砍完都要能跑起來。沿用 Homeward 的守則：**改完一定要跑 headless 驗證**
（逐幀跑遍所有場景的 `update()` + `draw()`，不只在戰鬥跑）。

1. ✅ **C1 扈從** — 最獨立，砍完立刻少掉一堆交互
2. ✅ **C2 士氣** — 最大一塊，但邊界清楚（`hasMorale`/`moraleEligible` 是總開關）
3. ✅ **C3+C4 潛行 + 聽覺** — 視錐/迷霧已確認保留
4. ✅ **C6 進出點 / 撤離** — 場景流程已改成「清場＝過關」
5. ✅ **C5 waypoint 戰術選點** — 尋路保留，所以幾乎是純刪除
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
