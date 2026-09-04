# ASUSWRT UI Autotest v3.0 — 執行計畫

> 目標：把 v2.1 的功能完整搬過來並補齊，改成「可勾選測項 → 執行 → 產出報告」的架構，
> 同時保留擴充測項的能力，並為未來的「按鈕測試 / API 攔截」預留框架。

---

## 0. 現況盤點（v2.1）

| 檔案 | 行數 | 職責 |
|---|---|---|
| `background.js` | 500 | 全部：佇列、導頁、log 分類、報告產生 |
| `content.js` | 111 | ISOLATED world 橋接，用 `appendChild` 注入 page script |
| `popup.js` | 251 | 4 顆按鈕 + 進度條 |
| `config/config.js` | 32 | testCaseList / specCheckList / falseAlarm |
| `inject/*.js` | 5 檔 | setupTesting、setupLang、error-handler、endTesting |
| `test/*.js` | 4 檔 | 3 個空殼範例 + test-API.js |

### v2.1 已具備的功能（v3.0 必須全部保留）

1. 從 `Session.get("menuList." + ui_lang)` 讀出 DUT 的完整選單，展開成待測頁面佇列
2. UI3 / UI4(webWrapper) 兩種 theme 的 menuList 取得路徑
3. 逐頁導航（`chrome.tabs.update`），每頁先 `HEAD` 探測 → 404 歸類 `NOT FOUND`
4. 注入 error handler 收集 `window.onerror`
5. Hook `httpApi.log` 收集 `UILOG`
6. `setTimeout`/`setInterval` 減半加速
7. 多語言掃描：`nvramSet(preferred_lang)` 逐一切換 26 種語言重跑
8. SPEC check：以「頁面是否存在」推導 Support / Not Support
9. 單頁測項框架：`testCaseList` 對應 `test-XXX.js`
10. WebAPI 測試：`test-API.js` 打 74 個 `appGet.cgi` hook，回報沒回應的
11. 進度條 + 進度還原、`.txt` 報告下載
12. Dev mode（固定小頁面清單）
13. falseAlarm 白名單過濾

### v2.1 的問題

| 問題 | 影響 |
|---|---|
| 狀態全在 service worker 的 module 變數 | SW 被回收 → 整個 run 消失 |
| popup 一點外面就關閉 | 長時間測試無法盯著看 |
| 沒有測項勾選 | 只能全跑，不能只跑想跑的 |
| 新增測項要改 3 個檔案（config + manifest WAR + test/） | 擴充成本高 |
| error handler 是 `appendChild` 事後注入 | 早於注入時機的錯誤抓不到 |
| 報告只有純文字、無分級、無結構 | 難以比對 / 進 CI |
| 沒有 auth v2 登入能力 | session 過期就整個 run 壞掉 |
| 無 API 送出紀錄 / 攔截 | 無法安全地測「按鈕」 |

---

## 階段一：架構重建（Foundation）

**產出**：可執行的骨架，狀態持久化，Side Panel 取代 popup。

- [x] 目錄重整為 `src/{background,panel,page,suites,lib}`
      （不需要 `content/`：v3.0 拿掉了 ISOLATED world 橋接，改由 driver 主動
      `executeScript` 去頁面裡撈資料）
- [x] `manifest.json` → MV3 + `sidePanel` + `world:"MAIN"` 動態註冊 content script
      （取代 `web_accessible_resources` + `appendChild`，讓儀器化能在 `document_start` 就生效）
- [x] `lib/const.js`：集中訊息型別、severity、危險 action_script 清單，取代散落的字串
- [x] `background/store.js`：設定持久化到 `chrome.storage.local`
- [x] `background/state.js`：run state 持久化到 `chrome.storage.session`
      → SW 被回收後可還原進度
- [x] `panel/`：Side Panel（Setup / Run / Report 三個 tab），不會因為點擊網頁而關閉

**驗收**：載入 extension、開側欄、看到 DUT 資訊（model / FW / theme / lang）。

---

## 階段二：測項註冊表與勾選 UI（Selectable Test Items）

**產出**：所有測項變成宣告式資料，UI 可勾選。

- [x] `suites/registry.js`：單一註冊表，每個測項宣告
      ```js
      { id, name, group, description, where: 'driver'|'page',
        scope: 'run'|'each-page'|'pages', pages?: [...], file?, channel?, defaultOn }
      ```
- [x] `where:'driver'` → 在 service worker 執行（HTTP 探測、SPEC check、WebAPI sweep）
- [x] `where:'instrument'` → `page/instrument.js` 的一個 channel（document_start 就掛好）
- [x] `where:'page'` → 注入頁面 MAIN world 執行（DOM 檢查、httpApi 呼叫）
- [x] Panel 勾選樹：group 可折疊、全選/全不選、預設集（Smoke / Full / API only）
- [x] 頁面清單勾選：從 DUT menuList 自動探索，可搜尋、可全選
- [x] 語言勾選：從 `language_support_list` 取得實際支援語言
- [x] 選擇結果存 `chrome.storage.local`，下次開啟還原

**驗收**：只勾 2 個測項 + 3 個頁面，跑完只出現那幾筆結果。

---

## 階段三：核心測項移植與補強（Core Suites）

**產出**：v2.1 全部功能 + 新增測項。

移植（parity）：

- [x] `core.reachability` — HEAD/GET 探測，404 / 5xx 分類（原 NOT FOUND）
- [x] `core.js-error` — `window.onerror` + `unhandledrejection`（原 ERRORS）
- [x] `core.ui-log` — hook `httpApi.log`（原 UI LOG）
- [x] `spec.feature-map` — 頁面存在性 → Support / Not Support（原 SPEC CHECK）
- [x] `api.hook-sweep` — `appGet.cgi` hook 清單掃描（原 WEBAPI TESTING）
- [x] 多語言掃描（原 All Languages），改為勾選語言
- [x] falseAlarm 白名單 → 改成 Panel「Advanced lists」可直接編輯的 known-issues JSON
      （v2.1 要改 `config/config.js` 再重載 extension）
- [x] 計時器加速（改為可調倍率選項，預設 1.0 = 不動；避免製造假錯誤）

新增：

- [x] `core.console-error` — 攔 `console.error` / `console.warn`
- [x] `core.resource-error` — 子資源載入失敗（img/script/css 404）
- [x] `i18n.token` — 偵測 DOM 裡殘留未翻譯的 `<#KEY#>` 佔位符
- [x] `core.layout-overflow` — 偵測水平溢出 / 跑出視窗的元素
- [x] `core.dom-sanity` — 空白頁 / 卡在 loading overlay 的頁面
- [x] Dev mode 不再需要：直接在 Panel 勾 5 個頁面就等於原本的 devMode

**驗收**：對 192.168.8.1（ZenWiFi_BT8 / 3.0.0.4.388_34021 / UI3）跑完整 sweep，
結果數量與 v2.1 的 `.txt` 報告可對照。

---

## 階段四：API Hook 框架（為「按鈕測試」鋪路）

**產出**：回答第 8 項的不確定性 —「怎麼在不斷線的前提下測按鈕」。

- [x] `page/instrument.js` 在 `document_start`（MAIN world）包裝：
      `XMLHttpRequest.open/send`、`fetch`、`httpApi.nvramSet`、`httpApi.applyRule`、
      表單 `submit()`
- [x] 每一筆送出的 API 記錄：method、url、`action_mode`、`action_script`、payload、發起頁
- [x] **Safe Mode（預設開啟）**：比對危險 `action_script` 清單
      （`reboot`、`restart_all`、`restart_net`、`restart_wireless`、`upgrade`、
      `restore`、`resetdefault`…）→ **攔下不送出**，記為 `intercepted`
- [x] 測項可宣告 `expectApi: [...]`：按下按鈕後驗證「該送的 API 有送出、且參數正確」
      —— 這就是未來按鈕測試的驗證方式：**不需要真的讓 DUT 執行動作**
- [x] `page/runtime.js` 提供給測項用的 API：
      `t.click()` / `t.expectApi()` / `t.recordedApis()` / `t.pass()` / `t.fail()` /
      `t.check()` / `t.waitFor()` / `t.visible()` / `t.safeMode()`
- [x] 附一個示範測項 `suites/page/apply-button.js`（按 Apply → 驗證 API 已送出；
      risky action_script 被攔下）；reboot 按鈕的寫法見 `docs/WRITING-TESTS.md` §4

**驗收**：在 `Advanced_LAN_Content.asp` 按 Apply，Panel 的 API 紀錄要出現該筆
`applyapp.cgi`；把 Safe Mode 打開後按 Reboot，要顯示 `intercepted` 且 DUT 不重開。

---

## 階段五：報告產生器（Report）

**產出**：結構化結果 → 多格式輸出。

- [x] 結果統一資料模型
      `{ suite, page, lang, severity: error|fail|warn|blocked|info|pass|skip, message, detail, href, ts }`
      （`blocked` = Safe Mode 攔下的 risky call；`skip` = 不適用或命中 known-issue）
- [x] Panel「Report」tab：即時表格 + 依 severity / suite / page / lang 過濾
- [x] 匯出格式
  - `.html` — 單檔自帶樣式的報告（給人看 / 附在 mail、Jira）
  - `.json` — 機器可讀（未來進 CI / 版本間 diff）
  - `.md` — 貼 PR / Confluence
  - `.txt` — 沿用 v2.1 版面，方便和舊報告對照
- [x] 報告表頭：DUT model、FW 版本、theme、territory、測試範圍、耗時、通過率

**驗收**：跑完按 Export HTML，在瀏覽器打開是一份可讀的報告。

---

## 階段六：穩定性與 auth v2 登入

**產出**：長時間 sweep 不會半路死掉。

- [x] `background/auth.js`：auth v2 登入（依 `CLAUDE.md`）
      —— 網路呼叫在頁面 world（cookie 才會正確落在 DUT origin），
      SHA-256 在 service worker（`http://` 非 secure context，沒有 `crypto.subtle`）
      `get_Nonce.cgi` → `sha256(user:nonce:pass:cnonce)` → `login_v2.cgi`
      （**不可**用舊的 `login.cgi` + Base64）
- [x] Sweep 中若被踢回 `Main_Login.asp` → 自動重新登入並續跑
- [x] Pause / Resume / Stop
- [x] 單頁 timeout 保護，不會卡死整個 run
- [x] SW 被回收後從 `chrome.storage.session` 還原，Panel 重開可看到進度

**驗收**：跑到一半重載 extension 的 SW，進度不歸零。

---

## 階段七：文件與發佈

- [x] `README.md` — 安裝、使用、架構
- [x] `docs/WRITING-TESTS.md` — 怎麼加一個新測項（單一檔案即可，不必改 manifest）
- [x] `docs/ARCHITECTURE.md` — 四個 world 的邊界、注入時機、為何 probe 要在頁面內做
- [x] `docs/TESTING.md` — self-test 涵蓋範圍與必須人工驗的部分
- [x] `tools/selftest.mjs` — 43 項離線檢查 + 16 項實機檢查（對 192.168.8.1 全通）
- [x] `manifest.json` version → `3.0`
- [ ] 打包 `.zip` 上架 Chrome Web Store（人工步驟，需要開發者帳號）

---

## 相容性備註

- 參考 DUT：`192.168.8.1` = ZenWiFi_BT8、`3.0.0.4.388_34021-0f3c9437`、UI3、territory `US/01`
- UI4 / webWrapper 路徑（`index.html?page=xxx` + `settingsWindow` iframe）已保留，
  但手邊沒有 UI4 機器，需要另外驗證
- 最低 Chrome 版本：114（`sidePanel` API）；MAIN world content script 需 111+

## 尚未做 / 需人工確認

**必須人工做的**

- 上架 Chrome Web Store（要開發者帳號）：`npm run package` 產出 zip 後上傳
- 在 `chrome://extensions` 載入未封裝版本，人工走一次 smoke test
  （manifest 載入、side panel 開啟、`registerContentScripts` 的 MAIN world 注入、
  匯出下載、頁面測項的 DOM 判斷）——這些 self-test 的 chrome stub 蓋不到，
  清單見 `docs/TESTING.md`

**沒有機器可驗的**

- UI4 / webWrapper 路徑：程式碼已寫（settings iframe 的 `Session`、
  `index.html?page=xxx`），但手邊 DUT 是 UI3，未實機跑過
- ROG / TUF / BUSINESS 的 menuTree

**後續可加**

- 截圖比對（visual regression）
- CI 整合：用 `.json` 報告做兩個 firmware build 之間的 diff
- 更多單頁測項（現在只有 4 個示範）
