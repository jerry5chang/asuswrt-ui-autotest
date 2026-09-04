/**
 * The test-item registry.
 *
 * This is the single place you touch to add a test item. Everything else
 * (side-panel checkboxes, run planning, report grouping) is derived from here.
 * See docs/WRITING-TESTS.md.
 *
 *   id          stable identifier, also the storage key for the checkbox
 *   name        label shown in the side panel
 *   group       checkbox group in the side panel
 *   description one line of help text
 *   where       'driver'     runs in the service worker (HTTP, tab control)
 *               'instrument' a channel of src/page/instrument.js (document_start hooks)
 *               'page'       a script injected into the page's MAIN world
 *   scope       'run'        runs once per language pass
 *               'each-page'  runs on every swept page
 *               'pages'      runs only on the pages listed in `pages`
 *   file        for where:'page' -- extension-relative path of the injected file
 *   pages       for scope:'pages' -- page URLs this item applies to
 *   defaultOn   whether the checkbox starts ticked
 *   timeoutMs   optional; overrides the shared per-suite allowance when an
 *               item legitimately needs longer
 *   needsRealKeys  optional; the driver attaches chrome.debugger for this
 *               page so t.pressKey() sends trusted events the browser acts on
 *   cost        rough time this item adds, for the run-time estimate:
 *               shape 'none'    passive; the shared per-page work already
 *                               covers it, so ticking it changes nothing
 *               shape 'perPage' `ms` per page it runs on
 *               shape 'fixed'   `ms` once per language pass
 *               These are seeds. Once a run has measured the real figures for
 *               this DUT they take over -- see src/background/timings.js.
 */

export const SUITES = [
    /* ---------------------------------------------------------------- Core */
    {
        id: 'core.reachability',
        name: 'Page reachability',
        group: 'Core',
        description: 'Probe every page over HTTP; report 404 / 5xx / unreachable.',
        where: 'driver',
        scope: 'run',
        cost: { shape: 'perPage', ms: 35 },
        defaultOn: true,
    },
    {
        id: 'core.js-error',
        name: 'JavaScript errors',
        group: 'Core',
        description: 'Capture window.onerror and unhandled promise rejections.',
        where: 'instrument',
        scope: 'each-page',
        channel: 'jsError',
        cost: { shape: 'none' },
        defaultOn: true,
    },
    {
        id: 'core.console-error',
        name: 'console.error / warn',
        group: 'Core',
        description: 'Capture messages the page writes to the console.',
        where: 'instrument',
        scope: 'each-page',
        channel: 'console',
        cost: { shape: 'none' },
        defaultOn: true,
    },
    {
        id: 'core.resource-error',
        name: 'Missing sub-resources',
        group: 'Core',
        description: 'Capture img / script / css / iframe that fail to load.',
        where: 'instrument',
        scope: 'each-page',
        channel: 'resource',
        cost: { shape: 'none' },
        defaultOn: true,
    },
    {
        id: 'core.ui-log',
        name: 'ASUSWRT UI log',
        group: 'Core',
        description: 'Hook httpApi.log() and collect what the UI reports itself.',
        where: 'instrument',
        scope: 'each-page',
        channel: 'uiLog',
        cost: { shape: 'none' },
        defaultOn: true,
    },
    {
        id: 'core.dom-sanity',
        name: 'Page rendered something',
        group: 'Core',
        description: 'Flag pages that end up blank or stuck on a loading state.',
        where: 'page',
        scope: 'each-page',
        file: 'src/suites/page/dom-sanity.js',
        cost: { shape: 'perPage', ms: 15 },
        defaultOn: true,
    },
    {
        id: 'core.layout-overflow',
        name: 'Layout overflow',
        group: 'Core',
        description: 'Flag horizontal overflow and elements outside the viewport.',
        where: 'page',
        scope: 'each-page',
        file: 'src/suites/page/layout-overflow.js',
        cost: { shape: 'perPage', ms: 45 },
        defaultOn: false,
    },

    /* ------------------------------------------------------------- i18n */
    {
        id: 'i18n.token',
        name: 'Untranslated tokens',
        group: 'i18n',
        description: 'Find <#KEY#> placeholders left in the rendered DOM.',
        where: 'page',
        scope: 'each-page',
        file: 'src/suites/page/i18n-token.js',
        cost: { shape: 'perPage', ms: 20 },
        defaultOn: true,
    },

    /* ------------------------------------------------------------- Spec */
    {
        id: 'spec.feature-map',
        name: 'Feature SPEC check',
        group: 'SPEC',
        description: 'Derive Support / Not Support from whether a feature page exists.',
        where: 'driver',
        scope: 'run',
        cost: { shape: 'fixed', ms: 600 },
        defaultOn: true,
    },

    /* ------------------------------------------------------------ WebAPI */
    {
        id: 'api.hook-sweep',
        name: 'appGet.cgi hook sweep',
        group: 'WebAPI',
        description: 'Call every known appGet.cgi hook and report the ones with no response.',
        where: 'driver',
        scope: 'run',
        cost: { shape: 'fixed', ms: 1200 },
        defaultOn: true,
    },
    {
        id: 'api.recorder',
        name: 'Record outgoing API calls',
        group: 'WebAPI',
        description: 'Log every XHR / fetch / nvramSet the UI sends, per page.',
        where: 'instrument',
        scope: 'each-page',
        channel: 'api',
        cost: { shape: 'none' },
        defaultOn: true,
    },

    /* -------------------------------------------------------- Page tests */
    {
        id: 'pages.qis-wizard',
        name: 'QIS wizard',
        group: 'Page tests',
        description: 'Quick Internet Setup wizard sanity checks.',
        where: 'page',
        scope: 'pages',
        pages: ['QIS_wizard.htm'],
        file: 'src/suites/page/qis-wizard.js',
        cost: { shape: 'perPage', ms: 350 },
        defaultOn: true,
    },
    {
        id: 'pages.vlan-switch',
        name: 'VLAN switch',
        group: 'Page tests',
        description: 'VLAN profile table sanity checks.',
        where: 'page',
        scope: 'pages',
        pages: ['Advanced_VLAN_Switch_Content.asp'],
        file: 'src/suites/page/vlan-switch.js',
        cost: { shape: 'perPage', ms: 250 },
        defaultOn: true,
    },
    {
        id: 'pages.traffic-monitor',
        name: 'Traffic monitor',
        group: 'Page tests',
        description: 'Traffic monitor chart renders and has data.',
        where: 'page',
        scope: 'pages',
        pages: ['Main_TrafficMonitor_realtime.asp', 'index.html?page=trafficmonitor'],
        file: 'src/suites/page/traffic-monitor.js',
        cost: { shape: 'perPage', ms: 550 },
        defaultOn: true,
    },
    {
        id: 'pages.apply-button',
        name: 'Apply button (API assert)',
        group: 'Page tests',
        description:
            'Click Apply and assert the expected API was sent. Risky action_scripts are ' +
            'intercepted by Safe Mode, so the DUT never actually reboots or drops the link.',
        where: 'page',
        scope: 'pages',
        pages: ['Advanced_LAN_Content.asp', 'Advanced_Wireless_Content.asp'],
        file: 'src/suites/page/apply-button.js',
        cost: { shape: 'perPage', ms: 1200 },
        defaultOn: false,
    },

    /* -------------------------------------------------------------- EAA
     * Accessibility items, for the European Accessibility Act work. These run
     * last so their side effects -- moving focus, scrolling to the content --
     * cannot disturb the geometry the Core suites measure.
     */
    {
        id: 'eaa.skip-link',
        name: 'Skip to main content link',
        group: 'EAA',
        description:
            'Tab reveals the bypass link, and activating it moves focus past the banner ' +
            'and menus into the page content (WCAG 2.4.1).',
        where: 'page',
        scope: 'each-page',
        file: 'src/suites/page/eaa-skip-link.js',
        cost: { shape: 'perPage', ms: 180 },
        defaultOn: true,
    },
    {
        id: 'eaa.client-dialog',
        name: 'Client dialog keyboard operation',
        group: 'EAA',
        description:
            'Network Map: opening a client must move focus into the dialog, Tab must reach ' +
            'every component without escaping, and Escape must close it (WCAG 2.1.2 / 2.4.3).',
        where: 'page',
        scope: 'pages',
        pages: ['index.asp'],
        file: 'src/suites/page/eaa-client-dialog.js',
        /* The client list arrives on a poll and a router rescan, so this one
           genuinely needs longer than the shared per-page allowance. */
        timeoutMs: 35000,
        /* Wants real Tab presses, so the driver attaches the debugger for
           this page only. Falls back to synthetic keys if it cannot. */
        needsRealKeys: true,
        cost: { shape: 'perPage', ms: 4000 },
        defaultOn: true,
    },
];

export const SUITE_BY_ID = Object.fromEntries(SUITES.map((s) => [s.id, s]));

export const GROUPS = [...new Set(SUITES.map((s) => s.group))];

export const DEFAULT_SUITE_IDS = SUITES.filter((s) => s.defaultOn).map((s) => s.id);

/** Suites of a given `where`, filtered to the selected ids. */
export function selected(ids, where) {
    const set = new Set(ids);
    return SUITES.filter((s) => set.has(s.id) && s.where === where);
}

/** Does a page-scoped suite apply to `pageUrl`? */
export function appliesToPage(suite, pageUrl) {
    if (suite.scope === 'each-page') return true;
    if (suite.scope !== 'pages') return false;
    return (suite.pages || []).some((p) => pageUrl === p || pageUrl.startsWith(p));
}

/**
 * Which of `pageUrls` the selected items will actually do something on.
 *
 * Selecting only a page-scoped item -- the Network Map client dialog, say --
 * and leaving every page ticked meant visiting 76 pages so that one of them
 * could run a test, which is both slow and confusing to read: the page count
 * and the item selection did not correspond to anything.
 *
 * An each-page item or any instrumentation channel makes every page worth
 * visiting, because they genuinely observe all of them. Otherwise only the
 * pages the page-scoped items name are worth loading.
 */
export function pagesInScope(suiteIds, pageUrls = []) {
    const selected = new Set(suiteIds || []);
    const chosen = SUITES.filter((s) => selected.has(s.id));

    const everywhere = chosen.some(
        (s) => (s.where === 'page' || s.where === 'instrument') && s.scope === 'each-page'
    );
    if (everywhere) return [...pageUrls];

    const scoped = chosen.filter((s) => s.where === 'page' && s.scope === 'pages');
    if (!scoped.length) return [];
    return pageUrls.filter((url) => scoped.some((s) => appliesToPage(s, url)));
}
