/**
 * DUT environment probe.
 *
 * `probeFn` is stringified by chrome.scripting.executeScript and evaluated in
 * the page's MAIN world, so it must be entirely self-contained -- no imports,
 * no closure over module scope.
 *
 * It returns the page inventory the runner sweeps, plus enough DUT identity to
 * head the report.
 */

export async function probeEnv(tabId) {
    const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: probeFn,
    });
    return result || { ok: false, reason: 'no result from probe' };
}

/* eslint-disable */
function probeFn() {
    var BLOCK = [
        'Main_Login.asp', 'Logout.asp', 'index.html', 'index.asp',
        'AdaptiveQoS_Adaptive.asp', 'Advanced_TencentDownloadAcceleration.asp',
        'Main_IPTStatus_Content.asp', 'NULL', '',
    ];

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    /** Session in ASUSWRT is a window.name-backed store, so read it directly
     *  if the Session helper is not on this page. */
    function sessionStore() {
        var win = window.top || window;
        try {
            if (win.Session && typeof win.Session.get === 'function') return win.Session;
        } catch (e) { /* cross-origin top; fall through */ }
        try {
            var raw = JSON.parse(win.name || '{}');
            return { get: function (k) { return raw[k]; } };
        } catch (e) {
            return { get: function () { return undefined; } };
        }
    }

    function readMenu(store, lang) {
        return store.get('menuList.' + lang) || store.get('menuList') || null;
    }

    /** menuList is only published after state.js requires menuTree.js (~3s). */
    async function waitForMenu(store, lang, timeoutMs) {
        var deadline = Date.now() + timeoutMs;
        for (;;) {
            var m = readMenu(store, lang);
            if (m && m.length) return m;
            if (Date.now() > deadline) return null;
            await sleep(250);
        }
    }

    function flattenMenu(menuList, menuExclude) {
        var excludedMenus = (menuExclude && menuExclude.menus) || [];
        var excludedTabs = (menuExclude && menuExclude.tabs) || [];
        var seen = {};
        var pages = [];

        (menuList || []).forEach(function (menu) {
            if (!menu || !menu.tab) return;
            if (excludedMenus.indexOf(menu.index) !== -1) return;
            menu.tab.forEach(function (tab) {
                if (!tab || !tab.url) return;
                var url = String(tab.url).trim();
                if (BLOCK.indexOf(url) !== -1) return;
                if (url.toUpperCase() === 'NULL') return;
                if (excludedTabs.indexOf(url) !== -1) return;
                // Unresolved server-side template, e.g. "<% networkmap_page(); %>".
                if (url.indexOf('<%') !== -1) return;
                if (seen[url]) return;
                seen[url] = true;
                pages.push({
                    url: url,
                    menu: menu.index || '',
                    menuName: String(menu.menuName || '').slice(0, 60),
                    tabName: String(tab.tabName || '').slice(0, 60),
                });
            });
        });
        return pages;
    }

    async function hook(name) {
        try {
            var res = await fetch('/appGet.cgi?hook=' + name, { credentials: 'same-origin' });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            return null;
        }
    }

    return (async function () {
        var out = {
            ok: false,
            origin: location.origin,
            href: location.href,
            theme: 'ui3',
            model: '',
            firmware: '',
            territory: '',
            lang: '',
            pages: [],
            langs: [],
            loggedIn: false,
            reason: '',
        };

        if (/Main_Login\.asp/i.test(location.pathname)) {
            out.reason = 'not logged in (on Main_Login.asp)';
            return out;
        }
        if (typeof window.httpApi === 'undefined') {
            out.reason = 'httpApi is not present -- is this an ASUSWRT page?';
            return out;
        }
        out.loggedIn = true;

        try {
            var info = window.httpApi.nvramGet(
                ['productid', 'odmpid', 'firmver', 'buildno', 'extendno', 'preferred_lang', 'territory_code'],
                true
            ) || {};
            out.model = info.odmpid || info.productid || '';
            out.firmware = [info.firmver, info.buildno, info.extendno].filter(Boolean).join('_');
            out.territory = info.territory_code || '';
            out.lang = info.preferred_lang || '';
        } catch (e) {
            out.reason = 'nvramGet failed: ' + e.message;
        }

        var isUi4 = false;
        try {
            isUi4 = !!(window.top.webWrapper || (typeof isSupport === 'function' && isSupport('ui4')));
        } catch (e) { /* ignore */ }
        out.theme = isUi4 ? 'ui4' : 'ui3';

        var uiLang = '';
        try { uiLang = window.ui_lang || out.lang || ''; } catch (e) { /* ignore */ }

        var store = sessionStore();
        var menuList = null;
        var menuExclude = store.get('menuExclude') || { menus: [], tabs: [] };

        if (isUi4) {
            // UI4 keeps the real menu inside the settings iframe.
            try {
                var frame = document.getElementById('settingsWindow');
                if (frame && frame.contentWindow && frame.contentWindow.Session) {
                    var fs = frame.contentWindow.Session;
                    menuList = fs.get('menuList.' + (frame.contentWindow.ui_lang || uiLang)) || fs.get('menuList');
                    menuExclude = fs.get('menuExclude') || menuExclude;
                }
            } catch (e) { /* ignore */ }
            if (!menuList) {
                out.reason =
                    'UI4 menu not reachable. Open index.html and switch to Settings once, then probe again.';
            }
        } else {
            menuList = await waitForMenu(store, uiLang, 8000);
            if (!menuList) out.reason = 'menuList not published by the UI within 8s';
        }

        out.pages = flattenMenu(menuList, menuExclude);

        if (isUi4) {
            // UI4 dashboard pages live behind index.html?page=<name>.
            try {
                (window.menuList || []).forEach(function (m) {
                    if (m && m.url && m.url !== 'QIS_wizard.htm') {
                        out.pages.push({
                            url: 'index.html?page=' + m.url,
                            menu: 'menu_Dashboard',
                            menuName: 'Dashboard',
                            tabName: m.url,
                        });
                    }
                });
            } catch (e) { /* ignore */ }
        }

        var langs = await hook('language_support_list()');
        if (langs && langs.language_support_list) {
            out.langs = Object.keys(langs.language_support_list);
        }

        out.ok = out.pages.length > 0;
        if (out.ok) out.reason = '';
        return out;
    })();
}
/* eslint-enable */
