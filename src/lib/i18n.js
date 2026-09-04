/**
 * Panel localisation.
 *
 * Chrome's own `_locales` + `chrome.i18n` follows the *browser's* language and
 * cannot be switched from inside the extension, so the picker in the panel
 * needs its own layer. `en` is the authoritative dictionary: every key exists
 * there, and a missing translation falls back to it rather than showing a key.
 *
 * Adding a language: append it to LOCALES and add its block to MESSAGES. The
 * self-test asserts every locale covers every `en` key, so a gap fails
 * offline instead of surfacing as English text in a Chinese panel.
 */

/** Offered in this order, deliberately. */
export const LOCALES = [
    { code: 'zh-TW', label: '繁體中文' },
    { code: 'zh-CN', label: '简体中文' },
    { code: 'en', label: 'English' },
];

export const FALLBACK_LOCALE = 'en';

const MESSAGES = {
    en: {
        'common.yes': 'yes',
        'common.no': 'no',
        'common.none': '(none)',
        'common.selectAll': 'All',
        'common.selectNone': 'None',

        'topbar.short': 'UI Autotest',
        'topbar.probe': 'Probe',
        'topbar.probing': 'Probing…',
        'topbar.probeTitle': 'Re-read the page inventory from the active tab',
        'topbar.noDut': 'no DUT probed yet',
        'topbar.language': 'Panel language',
        'topbar.theme': 'Light / dark appearance',

        'estimate.label': 'Estimated run',
        'estimate.remaining': 'Remaining',
        'estimate.detail': '{pages} pages × {passes} language pass(es)',
        'estimate.elapsed': 'elapsed {elapsed}',
        'estimate.noPages': 'no page visits needed for this selection',
        'estimate.measured': 'Measured time per item',

        'tab.setup': 'Setup',
        'tab.run': 'Run',
        'tab.report': 'Report',

        'empty.title': 'No router probed yet',
        'empty.step1': 'Open the router UI in a tab — http://192.168.8.1 — and sign in.',
        'empty.step2':
            'Leave that tab in front and press Probe. It reads the router’s own menu, so the ' +
            'page list matches what this model actually ships.',
        'empty.probe': 'Probe the active tab',

        'dut.title': 'Device',
        'dut.origin': 'Origin',
        'dut.model': 'Model',
        'dut.firmware': 'Firmware',
        'dut.theme': 'Theme',
        'dut.territory': 'Territory',
        'dut.language': 'Language',
        'dut.pages': 'Pages',
        'dut.langsAvailable': 'Languages available',
        'dut.activeTab': 'Active tab',
        'dut.loggedIn': 'Logged in',

        'login.title': 'Login',
        'login.username': 'Username',
        'login.password': 'Password',
        'login.autoRelogin': 'Re-login automatically if the session expires mid-run',
        'login.hint':
            'Used to sign in on its own: when Probe finds the tab sitting on the login page, ' +
            'and when a session expires mid-run, for which the option above must be on.',

        'suites.title': 'Test items',
        'suites.draft': 'not verified',
        'preset.all': 'All',
        'preset.smoke': 'Smoke',
        'preset.api': 'API only',
        'preset.none': 'None',

        'pages.title': 'Pages',
        'pages.filter': 'Filter pages…',
        'pages.inScope': 'will be visited — no selected item acts on the rest',
        'pages.empty': 'Probe the DUT to list its pages.',
        'pages.noMatch': 'No page matches that filter.',

        'langs.title': 'Languages',
        'langs.hint':
            'Leave empty to test only the language the DUT is set to. Each extra language ' +
            'repeats the whole sweep.',
        'langs.estimate': '{langs} × {pages} pages = {items} work items',

        'opts.title': 'Options',
        'opts.safeMode': 'Safe Mode',
        'opts.safeModeDesc': 'intercept reboot / restart / restore requests instead of sending them',
        'opts.stopOnError': 'Stop at the first error',
        'opts.verbose': 'Detailed run log',
        'opts.verboseDesc':
            'record every assertion in the run log, so it ships with the report — and echo it '
            + 'to the router page’s own console, prefixed [AUT], to watch a suite live',
        'opts.devMode': 'Developer mode',
        'opts.devModeDesc':
            'list, on the report tab, the filter rules this run’s findings would need, ready '
            + 'to paste into the shipped list. Only useful to whoever maintains that list.',
        'opts.settle': 'Settle after load (ms)',
        'opts.timeout': 'Page timeout (ms)',

        'adv.risky.destructive': 'Destructive',
        'adv.risky.disconnect': 'Disconnects',
        'adv.title': 'Blocked rc services',

        'run.start': 'Start',
        'run.pause': 'Pause',
        'run.resume': 'Resume',
        'run.stop': 'Stop',
        'run.clear': 'Clear',
        'run.latest': 'Latest results',
        'run.log': 'Run log',
        'run.progress': '{status} — {percent}%',
        'run.noResults': 'No results yet.',
        'run.nothingRecorded': 'Nothing recorded yet.',
        'run.driverSuites': '(driver suites)',
        'run.status.idle': 'Idle',
        'run.status.running': 'Running',
        'run.status.paused': 'Paused',
        'run.status.stopping': 'Stopping',
        'run.status.done': 'Done',
        'run.status.aborted': 'Stopped',

        'report.exportHtml': 'Export HTML',
        'report.exportJson': 'JSON',
        'report.exportMd': 'Markdown',
        'report.exportTxt': 'TXT',
        'report.allSeverities': 'All severities',
        'report.allSuites': 'All suites',
        'report.filter': 'Filter message / page…',
        'report.filterRules': 'Filter rules for these findings',
        'report.copyRules': 'Copy',
        'report.rulesCopied': 'copied — paste into DEFAULT_KNOWN_ISSUES in src/lib/const.js',
        'report.copyFailed': 'could not reach the clipboard; select the text instead',
        'report.noRules': 'Nothing in this run needs a filter rule.',
        'report.apiCalls': 'Recorded API calls',
        'report.noApis': 'No API calls recorded.',
        'report.nothingToExport': 'Nothing to export yet — run a test first.',

        'cost.navigate': 'Navigating to pages',
        'cost.pageFixed': 'Instrumenting and harvesting pages',
        'cost.pageSuiteInjection': 'Injecting page suites',
        'cost.settle': 'Waiting for pages to settle',
        'cost.langSwitch': 'Switching UI language',
        'cost.preflight': 'Session checks',
        'cost.returnNav': 'Returning to the start page',
        'cost.detail': '{share}% · {each} ms × {n}',

        'api.held': 'held',
        'api.risky': 'risky',
        'api.sent': 'sent',

        'sev.error': 'Error',
        'sev.fail': 'Fail',
        'sev.warn': 'Warn',
        'sev.blocked': 'Blocked',
        'sev.info': 'Info',
        'sev.pass': 'Pass',
        'sev.skip': 'Skip',

        'group.Core': 'Core',
        'group.i18n': 'i18n',
        'group.SPEC': 'Product spec',
        'group.WebAPI': 'API checks',
        'group.Page tests': 'Page tests',
        'group.EAA': 'EAA',

        'suite.core.reachability.name': 'Page reachability',
        'suite.core.reachability.desc': 'Probe every page over HTTP; report 404 / 5xx / unreachable.',
        'suite.core.js-error.name': 'JavaScript errors',
        'suite.core.js-error.desc': 'Capture window.onerror and unhandled promise rejections.',
        'suite.core.console-error.name': 'console.error / warn',
        'suite.core.console-error.desc': 'Capture messages the page writes to the console.',
        'suite.core.resource-error.name': 'Missing sub-resources',
        'suite.core.resource-error.desc': 'Capture img / script / css / iframe that fail to load.',
        'suite.core.ui-log.name': 'ASUSWRT UI log',
        'suite.core.ui-log.desc': 'Hook httpApi.log() and collect what the UI reports itself.',
        'suite.core.dom-sanity.name': 'Page rendered something',
        'suite.core.dom-sanity.desc': 'Flag pages that end up blank or stuck on a loading state.',
        'suite.core.layout-overflow.name': 'Layout overflow',
        'suite.core.layout-overflow.desc': 'Flag horizontal overflow and elements outside the viewport.',
        'suite.i18n.token.name': 'Untranslated tokens',
        'suite.i18n.token.desc': 'Find <#KEY#> placeholders left in the rendered DOM.',
        'suite.spec.feature-map.name': 'Feature SPEC check',
        'suite.spec.feature-map.desc': 'Derive Support / Not Support from whether a feature page exists.',
        'suite.api.hook-sweep.name': 'appGet.cgi hook sweep',
        'suite.api.hook-sweep.desc':
            'Call every known appGet.cgi hook and report the ones with no response.',
        'suite.api.recorder.name': 'Record outgoing API calls',
        'suite.api.recorder.desc': 'Log every XHR / fetch / nvramSet the UI sends, per page.',
        'suite.pages.qis-wizard.name': 'QIS wizard',
        'suite.pages.qis-wizard.desc': 'Quick Internet Setup wizard sanity checks.',
        'suite.pages.vlan-switch.name': 'VLAN switch',
        'suite.pages.vlan-switch.desc': 'VLAN profile table sanity checks.',
        'suite.pages.traffic-monitor.name': 'Traffic monitor',
        'suite.pages.traffic-monitor.desc': 'Traffic monitor chart renders and has data.',
        'suite.pages.apply-button.name': 'Apply button (API assert)',
        'suite.pages.apply-button.desc':
            'Click Apply and assert the expected API was sent. Risky action_scripts are ' +
            'intercepted by Safe Mode, so the DUT never actually reboots or drops the link.',
        'suite.eaa.skip-link.name': 'Skip to main content link',
        'suite.eaa.skip-link.desc':
            'Tab reveals the bypass link, and activating it moves focus past the banner and ' +
            'menus into the page content (WCAG 2.4.1).',
        'suite.eaa.a11y-name.name': 'Accessible names',
        'suite.eaa.a11y-name.desc':
            'Controls and images must have a usable name — not missing, not read twice, not '
            + 'different from the visible text.',
        'suite.eaa.form-labels.name': 'Form labels',
        'suite.eaa.form-labels.desc':
            'Fields need a real label, not text beside them or a placeholder; required and '
            + 'read-only belong in attributes.',
        'suite.eaa.control-state.name': 'Control roles and states',
        'suite.eaa.control-state.desc':
            'Switches, tabs and menu items must declare their role and state — on/off cannot '
            + 'live in a CSS class.',
        'suite.eaa.keyboard.name': 'Keyboard operability',
        'suite.eaa.keyboard.desc':
            'Anything clickable must be focusable and operable by keyboard, in a sane order, '
            + 'with visible focus.',
        'suite.eaa.client-dialog.name': 'Client dialog keyboard operation',
        'suite.eaa.client-dialog.desc':
            'Network Map: opening a client must move focus into the dialog, Tab must reach ' +
            'every component without escaping, and Escape must close it (WCAG 2.1.2 / 2.4.3).',
    },

    'zh-TW': {
        'common.yes': '是',
        'common.no': '否',
        'common.none': '（無）',
        'common.selectAll': '全選',
        'common.selectNone': '全不選',

        'topbar.short': 'UI 自動測試',
        'topbar.probe': '探測',
        'topbar.probing': '探測中…',
        'topbar.probeTitle': '從目前分頁重新讀取頁面清單',
        'topbar.noDut': '尚未探測任何 DUT',
        'topbar.language': '介面語言',
        'topbar.theme': '淺色／深色外觀',

        'estimate.label': '預估耗時',
        'estimate.remaining': '剩餘',
        'estimate.detail': '{pages} 頁 × {passes} 個語言 pass',
        'estimate.elapsed': '已用 {elapsed}',
        'estimate.noPages': '這組選擇不需要逐頁瀏覽',
        'estimate.measured': '各測項實測耗時',

        'tab.setup': '設定',
        'tab.run': '執行',
        'tab.report': '報告',

        'empty.title': '尚未探測任何路由器',
        'empty.step1': '在分頁開啟路由器介面（例如 http://192.168.8.1）並登入。',
        'empty.step2':
            '讓那個分頁保持在前景，然後按「探測」。它會讀取路由器自己的選單，' +
            '所以頁面清單會與這台機器實際出貨的功能一致。',
        'empty.probe': '探測目前分頁',

        'dut.title': '設備',
        'dut.origin': '來源網址',
        'dut.model': '型號',
        'dut.firmware': '韌體版本',
        'dut.theme': '介面版本',
        'dut.territory': '地區碼',
        'dut.language': '語言',
        'dut.pages': '頁面數',
        'dut.langsAvailable': '可用語言數',
        'dut.activeTab': '目前分頁',
        'dut.loggedIn': '已登入',

        'login.title': '登入',
        'login.username': '帳號',
        'login.password': '密碼',
        'login.autoRelogin': '測試中 session 過期時自動重新登入',
        'login.hint':
            '供自動登入使用：探測時分頁停在登入頁、以及測試中 session 過期時，' +
            '需要開啟上面那個選項。',

        'suites.title': '測項',
        'suites.draft': '尚未驗證',
        'preset.all': '全選',
        'preset.smoke': '基本',
        'preset.api': '只測 API',
        'preset.none': '全不選',

        'pages.title': '頁面',
        'pages.filter': '篩選頁面…',
        'pages.inScope': '頁會被造訪 —— 其餘沒有選中的測項會作用',
        'pages.empty': '請先探測 DUT 以取得頁面清單。',
        'pages.noMatch': '沒有符合條件的頁面。',

        'langs.title': '語言',
        'langs.hint': '留空則只測 DUT 目前的語言。每多選一個語言就會把整輪掃描重跑一次。',
        'langs.estimate': '{langs} 種語言 × {pages} 頁 = {items} 個工作項',

        'opts.title': '選項',
        'opts.safeMode': '安全模式',
        'opts.safeModeDesc': '攔下 reboot / restart / restore 等請求，不真的送出',
        'opts.stopOnError': '遇到第一個錯誤就停止',
        'opts.verbose': '詳細執行紀錄',
        'opts.verboseDesc':
            '把每一條斷言寫進執行紀錄，並隨報告一起打包；同時印到路由器頁面自己的 console，' +
            '前綴 [AUT]，可以即時看測項停在哪一步',
        'opts.devMode': '開發者模式',
        'opts.devModeDesc': '在報告頁列出這次結果所需的過濾規則，可直接貼進工具原始碼的清單。',
        'opts.settle': '載入後等待（毫秒）',
        'opts.timeout': '單頁逾時（毫秒）',

        'adv.risky.destructive': '破壞性',
        'adv.risky.disconnect': '會斷線',
        'adv.title': '禁止使用的 rc service',

        'run.start': '開始',
        'run.pause': '暫停',
        'run.resume': '繼續',
        'run.stop': '停止',
        'run.clear': '清除',
        'run.latest': '最新結果',
        'run.log': '執行紀錄',
        'run.progress': '{status} — {percent}%',
        'run.noResults': '尚無結果。',
        'run.nothingRecorded': '尚未記錄到任何項目。',
        'run.driverSuites': '（driver 測項）',
        'run.status.idle': '閒置',
        'run.status.running': '執行中',
        'run.status.paused': '已暫停',
        'run.status.stopping': '正在停止',
        'run.status.done': '已完成',
        'run.status.aborted': '已中止',

        'report.exportHtml': '匯出 HTML',
        'report.exportJson': 'JSON',
        'report.exportMd': 'Markdown',
        'report.exportTxt': 'TXT',
        'report.allSeverities': '所有嚴重度',
        'report.allSuites': '所有測項',
        'report.filter': '篩選訊息／頁面…',
        'report.filterRules': '這次結果對應的過濾規則',
        'report.copyRules': '複製',
        'report.rulesCopied': '已複製，貼到 src/lib/const.js 的 DEFAULT_KNOWN_ISSUES',
        'report.copyFailed': '無法使用剪貼簿，請直接選取文字',
        'report.noRules': '這次沒有需要過濾的項目。',
        'report.apiCalls': '已記錄的 API 呼叫',
        'report.noApis': '沒有記錄到 API 呼叫。',
        'report.nothingToExport': '還沒有可匯出的內容 —— 請先跑一次測試。',

        'cost.navigate': '導向各頁面',
        'cost.pageFixed': '頁面儀器化與回收',
        'cost.pageSuiteInjection': '注入單頁測項',
        'cost.settle': '等待頁面穩定',
        'cost.langSwitch': '切換介面語言',
        'cost.preflight': 'Session 檢查',
        'cost.returnNav': '返回起始頁',
        'cost.detail': '{share}% · 每次 {each} ms × {n}',

        'api.held': '已攔下',
        'api.risky': '危險',
        'api.sent': '已送出',

        'sev.error': '錯誤',
        'sev.fail': '失敗',
        'sev.warn': '警告',
        'sev.blocked': '已攔下',
        'sev.info': '資訊',
        'sev.pass': '通過',
        'sev.skip': '略過',

        'group.Core': '核心',
        'group.i18n': '多語系',
        'group.SPEC': '產品規格',
        'group.WebAPI': 'API 檢測',
        'group.Page tests': '單頁測項',
        'group.EAA': 'EAA 無障礙',

        'suite.core.reachability.name': '頁面可達性',
        'suite.core.reachability.desc': '對每個頁面發 HTTP 請求，回報 404／5xx／無法連線。',
        'suite.core.js-error.name': 'JavaScript 錯誤',
        'suite.core.js-error.desc': '攔取 window.onerror 與未處理的 promise rejection。',
        'suite.core.console-error.name': 'console.error／warn',
        'suite.core.console-error.desc': '攔取頁面自己寫進 console 的訊息。',
        'suite.core.resource-error.name': '子資源載入失敗',
        'suite.core.resource-error.desc': '攔取載入失敗的 img／script／css／iframe。',
        'suite.core.ui-log.name': 'ASUSWRT UI log',
        'suite.core.ui-log.desc': 'Hook httpApi.log()，收集 UI 自己回報的內容。',
        'suite.core.dom-sanity.name': '頁面有渲染出內容',
        'suite.core.dom-sanity.desc': '標出最後是空白、或卡在載入狀態的頁面。',
        'suite.core.layout-overflow.name': '版面溢出',
        'suite.core.layout-overflow.desc': '標出水平溢出、以及跑到視窗外的元素。',
        'suite.i18n.token.name': '未翻譯的字串代號',
        'suite.i18n.token.desc': '找出殘留在 DOM 裡的 <#KEY#> 佔位符。',
        'suite.spec.feature-map.name': '功能 SPEC 檢查',
        'suite.spec.feature-map.desc': '以功能頁面是否存在，推導 Support／Not Support。',
        'suite.api.hook-sweep.name': 'appGet.cgi hook 掃描',
        'suite.api.hook-sweep.desc': '呼叫所有已知的 appGet.cgi hook，回報沒有回應的。',
        'suite.api.recorder.name': '記錄送出的 API',
        'suite.api.recorder.desc': '逐頁記錄 UI 送出的每一筆 XHR／fetch／nvramSet。',
        'suite.pages.qis-wizard.name': 'QIS 設定精靈',
        'suite.pages.qis-wizard.desc': '網路設定精靈的基本檢查。',
        'suite.pages.vlan-switch.name': 'VLAN 交換器',
        'suite.pages.vlan-switch.desc': 'VLAN profile 表格的基本檢查。',
        'suite.pages.traffic-monitor.name': '流量監控',
        'suite.pages.traffic-monitor.desc': '流量監控圖表有畫出來、而且有資料。',
        'suite.pages.apply-button.name': 'Apply 按鈕（驗證 API）',
        'suite.pages.apply-button.desc':
            '按下 Apply 並驗證該送的 API 有送出。危險的 action_script 會被安全模式攔下，' +
            '所以 DUT 不會真的重開機或斷線。',
        'suite.eaa.skip-link.name': '跳至主要內容連結',
        'suite.eaa.skip-link.desc':
            '按 Tab 會叫出這個略過導覽的連結，點下去要讓焦點越過橫幅與選單、' +
            '進入頁面主要內容（WCAG 2.4.1）。',
        'suite.eaa.a11y-name.name': '可存取名稱',
        'suite.eaa.a11y-name.desc': '控件與圖片要有可用的名稱：不缺、不重複朗讀、不與看到的文字不同。',
        'suite.eaa.form-labels.name': '表單標籤',
        'suite.eaa.form-labels.desc': '欄位要有真正關聯的標籤，不能只靠旁邊的文字或 placeholder；必填與唯讀要寫在屬性裡。',
        'suite.eaa.control-state.name': '控件角色與狀態',
        'suite.eaa.control-state.desc': '開關、頁籤、選單項目要宣告角色與狀態；開/關不能只存在 CSS class 裡。',
        'suite.eaa.keyboard.name': '鍵盤可操作性',
        'suite.eaa.keyboard.desc': '可點擊的都要能聚焦並用鍵盤操作，順序合理，而且看得出焦點在哪。',
        'suite.eaa.client-dialog.name': 'Client 對話框鍵盤操作',
        'suite.eaa.client-dialog.desc':
            '網路地圖：點開某個 client 後，焦點要進到對話框內，Tab 要能依序走到每個元件' +
            '且不會跑出對話框，ESC 要能關閉（WCAG 2.1.2／2.4.3）。',
    },

    'zh-CN': {
        'common.yes': '是',
        'common.no': '否',
        'common.none': '（无）',
        'common.selectAll': '全选',
        'common.selectNone': '全不选',

        'topbar.short': 'UI 自动测试',
        'topbar.probe': '探测',
        'topbar.probing': '探测中…',
        'topbar.probeTitle': '从当前标签页重新读取页面清单',
        'topbar.noDut': '尚未探测任何 DUT',
        'topbar.language': '界面语言',
        'topbar.theme': '浅色／深色外观',

        'estimate.label': '预估耗时',
        'estimate.remaining': '剩余',
        'estimate.detail': '{pages} 页 × {passes} 个语言 pass',
        'estimate.elapsed': '已用 {elapsed}',
        'estimate.noPages': '这组选择不需要逐页浏览',
        'estimate.measured': '各测试项实测耗时',

        'tab.setup': '设置',
        'tab.run': '运行',
        'tab.report': '报告',

        'empty.title': '尚未探测任何路由器',
        'empty.step1': '在标签页中打开路由器界面（例如 http://192.168.8.1）并登录。',
        'empty.step2':
            '让那个标签页保持在前台，然后点「探测」。它会读取路由器自身的菜单，' +
            '因此页面清单会与这台设备实际提供的功能一致。',
        'empty.probe': '探测当前标签页',

        'dut.title': '设备',
        'dut.origin': '源地址',
        'dut.model': '型号',
        'dut.firmware': '固件版本',
        'dut.theme': '界面版本',
        'dut.territory': '地区码',
        'dut.language': '语言',
        'dut.pages': '页面数',
        'dut.langsAvailable': '可用语言数',
        'dut.activeTab': '当前标签页',
        'dut.loggedIn': '已登录',

        'login.title': '登录',
        'login.username': '账号',
        'login.password': '密码',
        'login.autoRelogin': '测试过程中会话过期时自动重新登录',
        'login.hint':
            '供自动登录使用：探测时标签页停在登录页、以及测试过程中会话过期时，' +
            '需要开启上面那个选项。',

        'suites.title': '测试项',
        'suites.draft': '尚未验证',
        'preset.all': '全选',
        'preset.smoke': '基本',
        'preset.api': '仅测 API',
        'preset.none': '全不选',

        'pages.title': '页面',
        'pages.filter': '筛选页面…',
        'pages.inScope': '页会被访问 —— 其余没有选中的测试项会作用',
        'pages.empty': '请先探测 DUT 以获取页面清单。',
        'pages.noMatch': '没有符合条件的页面。',

        'langs.title': '语言',
        'langs.hint': '留空则只测 DUT 当前的语言。每多选一个语言就会把整轮扫描重跑一次。',
        'langs.estimate': '{langs} 种语言 × {pages} 页 = {items} 个工作项',

        'opts.title': '选项',
        'opts.safeMode': '安全模式',
        'opts.safeModeDesc': '拦截 reboot / restart / restore 等请求，不真正发出',
        'opts.stopOnError': '遇到第一个错误就停止',
        'opts.verbose': '详细执行记录',
        'opts.verboseDesc':
            '把每一条断言写进执行记录，并随报告一起打包；同时打印到路由器页面自身的 console，' +
            '前缀 [AUT]，可以实时看测试项停在哪一步',
        'opts.devMode': '开发者模式',
        'opts.devModeDesc': '在报告页列出本次结果所需的过滤规则，可直接粘贴进工具源码的清单。',
        'opts.settle': '加载后等待（毫秒）',
        'opts.timeout': '单页超时（毫秒）',

        'adv.risky.destructive': '破坏性',
        'adv.risky.disconnect': '会断线',
        'adv.title': '禁止使用的 rc service',

        'run.start': '开始',
        'run.pause': '暂停',
        'run.resume': '继续',
        'run.stop': '停止',
        'run.clear': '清除',
        'run.latest': '最新结果',
        'run.log': '运行日志',
        'run.progress': '{status} — {percent}%',
        'run.noResults': '暂无结果。',
        'run.nothingRecorded': '尚未记录到任何项目。',
        'run.driverSuites': '（driver 测试项）',
        'run.status.idle': '空闲',
        'run.status.running': '运行中',
        'run.status.paused': '已暂停',
        'run.status.stopping': '正在停止',
        'run.status.done': '已完成',
        'run.status.aborted': '已中止',

        'report.exportHtml': '导出 HTML',
        'report.exportJson': 'JSON',
        'report.exportMd': 'Markdown',
        'report.exportTxt': 'TXT',
        'report.allSeverities': '所有严重程度',
        'report.allSuites': '所有测试项',
        'report.filter': '筛选消息／页面…',
        'report.filterRules': '本次结果对应的过滤规则',
        'report.copyRules': '复制',
        'report.rulesCopied': '已复制，粘贴到 src/lib/const.js 的 DEFAULT_KNOWN_ISSUES',
        'report.copyFailed': '无法使用剪贴板，请直接选取文字',
        'report.noRules': '本次没有需要过滤的项目。',
        'report.apiCalls': '已记录的 API 调用',
        'report.noApis': '没有记录到 API 调用。',
        'report.nothingToExport': '还没有可导出的内容 —— 请先运行一次测试。',

        'cost.navigate': '导向各页面',
        'cost.pageFixed': '页面仪器化与回收',
        'cost.pageSuiteInjection': '注入单页测试项',
        'cost.settle': '等待页面稳定',
        'cost.langSwitch': '切换界面语言',
        'cost.preflight': 'Session 检查',
        'cost.returnNav': '返回起始页',
        'cost.detail': '{share}% · 每次 {each} ms × {n}',

        'api.held': '已拦截',
        'api.risky': '危险',
        'api.sent': '已发出',

        'sev.error': '错误',
        'sev.fail': '失败',
        'sev.warn': '警告',
        'sev.blocked': '已拦截',
        'sev.info': '信息',
        'sev.pass': '通过',
        'sev.skip': '跳过',

        'group.Core': '核心',
        'group.i18n': '多语言',
        'group.SPEC': '产品规格',
        'group.WebAPI': 'API 检测',
        'group.Page tests': '单页测试项',
        'group.EAA': 'EAA 无障碍',

        'suite.core.reachability.name': '页面可达性',
        'suite.core.reachability.desc': '对每个页面发 HTTP 请求，报告 404／5xx／无法连接。',
        'suite.core.js-error.name': 'JavaScript 错误',
        'suite.core.js-error.desc': '捕获 window.onerror 与未处理的 promise rejection。',
        'suite.core.console-error.name': 'console.error／warn',
        'suite.core.console-error.desc': '捕获页面自身写入 console 的消息。',
        'suite.core.resource-error.name': '子资源加载失败',
        'suite.core.resource-error.desc': '捕获加载失败的 img／script／css／iframe。',
        'suite.core.ui-log.name': 'ASUSWRT UI log',
        'suite.core.ui-log.desc': 'Hook httpApi.log()，收集 UI 自身报告的内容。',
        'suite.core.dom-sanity.name': '页面有渲染出内容',
        'suite.core.dom-sanity.desc': '标出最终为空白、或卡在加载状态的页面。',
        'suite.core.layout-overflow.name': '布局溢出',
        'suite.core.layout-overflow.desc': '标出水平溢出、以及跑到视口外的元素。',
        'suite.i18n.token.name': '未翻译的字符串标记',
        'suite.i18n.token.desc': '找出残留在 DOM 中的 <#KEY#> 占位符。',
        'suite.spec.feature-map.name': '功能 SPEC 检查',
        'suite.spec.feature-map.desc': '以功能页面是否存在，推导 Support／Not Support。',
        'suite.api.hook-sweep.name': 'appGet.cgi hook 扫描',
        'suite.api.hook-sweep.desc': '调用所有已知的 appGet.cgi hook，报告没有响应的。',
        'suite.api.recorder.name': '记录发出的 API',
        'suite.api.recorder.desc': '逐页记录 UI 发出的每一条 XHR／fetch／nvramSet。',
        'suite.pages.qis-wizard.name': 'QIS 设置向导',
        'suite.pages.qis-wizard.desc': '网络设置向导的基本检查。',
        'suite.pages.vlan-switch.name': 'VLAN 交换机',
        'suite.pages.vlan-switch.desc': 'VLAN profile 表格的基本检查。',
        'suite.pages.traffic-monitor.name': '流量监控',
        'suite.pages.traffic-monitor.desc': '流量监控图表已绘制，并且有数据。',
        'suite.pages.apply-button.name': 'Apply 按钮（验证 API）',
        'suite.pages.apply-button.desc':
            '点击 Apply 并验证应发出的 API 已发出。危险的 action_script 会被安全模式拦截，' +
            '因此 DUT 不会真的重启或断线。',
        'suite.eaa.skip-link.name': '跳至主要内容链接',
        'suite.eaa.skip-link.desc':
            '按 Tab 会唤出这个跳过导航的链接，点击后应让焦点越过横幅与菜单、' +
            '进入页面主要内容（WCAG 2.4.1）。',
        'suite.eaa.a11y-name.name': '可访问名称',
        'suite.eaa.a11y-name.desc': '控件与图片要有可用的名称：不缺、不重复朗读、不与看到的文字不同。',
        'suite.eaa.form-labels.name': '表单标签',
        'suite.eaa.form-labels.desc': '字段要有真正关联的标签，不能只靠旁边的文字或 placeholder；必填与只读要写在属性里。',
        'suite.eaa.control-state.name': '控件角色与状态',
        'suite.eaa.control-state.desc': '开关、页签、菜单项要声明角色与状态；开/关不能只存在 CSS class 里。',
        'suite.eaa.keyboard.name': '键盘可操作性',
        'suite.eaa.keyboard.desc': '可点击的都要能聚焦并用键盘操作，顺序合理，而且看得出焦点在哪。',
        'suite.eaa.client-dialog.name': 'Client 对话框键盘操作',
        'suite.eaa.client-dialog.desc':
            '网络地图：点开某个 client 后，焦点要进到对话框内，Tab 要能依序走到每个元件' +
            '且不会跑出对话框，ESC 要能关闭（WCAG 2.1.2／2.4.3）。',
    },
};

let current = FALLBACK_LOCALE;

/** Narrow whatever the browser reports to one of the three we offer. */
export function detectLocale() {
    let ui = '';
    try {
        ui = (chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || '';
    } catch (e) {
        ui = '';
    }
    const lower = ui.toLowerCase();
    if (lower.startsWith('zh')) {
        // zh-CN / zh-SG / zh-Hans are Simplified; everything else zh is Traditional.
        return /cn|sg|hans/.test(lower) ? 'zh-CN' : 'zh-TW';
    }
    return FALLBACK_LOCALE;
}

export function isLocale(code) {
    return LOCALES.some((l) => l.code === code);
}

export function setLocale(code) {
    current = isLocale(code) ? code : FALLBACK_LOCALE;
    return current;
}

export function getLocale() {
    return current;
}

/**
 * Look a key up in the active locale, falling back to English, then to the key
 * itself so a missing string is obvious rather than blank. `{name}` in the
 * string is replaced from `vars`.
 */
export function t(key, vars) {
    const text =
        (MESSAGES[current] && MESSAGES[current][key]) ??
        (MESSAGES[FALLBACK_LOCALE] && MESSAGES[FALLBACK_LOCALE][key]) ??
        key;
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
}

/** Registry text, with the registry's own English as the last resort. */
export function suiteText(suite, field) {
    const key = `suite.${suite.id}.${field}`;
    const localised = MESSAGES[current] && MESSAGES[current][key];
    if (localised) return localised;
    return field === 'name' ? suite.name : suite.description;
}

export function groupLabel(group) {
    return t(`group.${group}`);
}

/**
 * Fill in every element carrying a translation attribute.
 *   data-i18n              -> textContent
 *   data-i18n-placeholder  -> placeholder
 *   data-i18n-title        -> title
 */
export function applyTo(root = document) {
    for (const el of root.querySelectorAll('[data-i18n]')) {
        el.textContent = t(el.dataset.i18n);
    }
    for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    }
    for (const el of root.querySelectorAll('[data-i18n-title]')) {
        el.title = t(el.dataset.i18nTitle);
    }
}

/** For the self-test: every key `en` defines, per locale. */
export function _dictionaries() {
    return MESSAGES;
}
