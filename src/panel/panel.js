/**
 * Side panel controller.
 *
 * The panel is the only long-lived UI surface: unlike v2.x's popup it survives
 * every navigation the sweep performs, which is what makes watching a
 * multi-minute run possible at all.
 *
 * It owns no test state -- everything is read from the service worker snapshot
 * and written back through MSG.SAVE_SETTINGS.
 */

import { MSG, RISKY_ACTIONS, RUN, SEV_ORDER, PRESETS, FALLBACK_LANGS } from '../lib/const.js';
import { SUITES, GROUPS, SUITE_BY_ID, pagesInScope } from '../suites/registry.js';
import { BUILDERS, reportFilename } from '../lib/report.js';
import { estimateRemaining, estimateRun, formatDuration } from '../lib/estimate.js';
import {
    LOCALES,
    applyTo,
    detectLocale,
    getLocale,
    groupLabel,
    isLocale,
    setLocale,
    suiteText,
    t,
} from '../lib/i18n.js';

/** Severity label in the panel's language; the report keeps English. */
const sevLabel = (severity) => t(`sev.${severity}`);

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let snap = null;
/** Local, authoritative-while-editing selection. */
const sel = { suiteIds: new Set(), pages: new Set(), langs: new Set() };
let pagesTouched = false;
let reportCache = null;
/** reportCache.results with the current known-issue list applied. */
let reportRows = [];
/** Which suite groups are folded away. Remembered across sessions. */
let collapsedGroups = new Set();

let collapseTimer = null;
function persistCollapsed() {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(async () => {
        snap = await send(MSG.SAVE_SETTINGS, { settings: { collapsedGroups: [...collapsedGroups] } });
    }, 300);
}

function send(type, extra = {}) {
    return chrome.runtime.sendMessage({ type, ...extra });
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/* ----------------------------------------------------------------- theme */

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)');

/** '' follows the OS; 'light' / 'dark' is the user's own choice. */
function effectiveTheme(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return prefersDark().matches ? 'dark' : 'light';
}

/**
 * Stamps data-theme only for an explicit choice, so the default state stays
 * "whatever the OS says" and keeps following it.
 */
function applyTheme(pref) {
    const effective = effectiveTheme(pref);
    const root = document.documentElement;
    if (pref === 'light' || pref === 'dark') root.dataset.theme = pref;
    else delete root.dataset.theme;

    // The icon is a half-filled circle rotated by CSS, so nothing to set here
    // beyond the state it reflects.
    $('#themeToggle').setAttribute('aria-checked', String(effective === 'dark'));
    return effective;
}

function initThemeToggle() {
    $('#themeToggle').addEventListener('click', async () => {
        // Flip away from what is actually on screen, whether that came from
        // the OS or from a previous choice, and make the result explicit.
        const next = effectiveTheme(snap && snap.settings.theme) === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        snap = await send(MSG.SAVE_SETTINGS, { settings: { theme: next } });
    });

    // Still following the OS? Then follow it when it changes.
    prefersDark().addEventListener('change', () => {
        if (!snap || !snap.settings.theme) applyTheme('');
    });
}

/* ---------------------------------------------------------------- locale */

/**
 * Options appear in the order LOCALES declares, which is the order asked for:
 * Traditional Chinese, Simplified Chinese, English.
 */
function initLocaleSelect() {
    const select = $('#uiLocale');
    for (const { code, label } of LOCALES) {
        const option = el('option', null, label);
        option.value = code;
        select.append(option);
    }

    select.addEventListener('change', async () => {
        applyLocale(select.value);
        snap = await send(MSG.SAVE_SETTINGS, { settings: { locale: select.value } });
        renderAll();
    });
}

/** Switch language and repaint the static chrome. Callers repaint the rest. */
function applyLocale(code) {
    const resolved = setLocale(isLocale(code) ? code : detectLocale());
    applyTo(document);
    document.documentElement.lang = resolved;
    $('#uiLocale').value = resolved;
    return resolved;
}

/* ------------------------------------------------------------------ tabs */

function showTab(name) {
    $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
    $$('.panel').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === name));
    // The estimate belongs with configuring and running, not with reading results.
    document.body.classList.toggle('on-report', name === 'report');
    if (name === 'report') loadReport();
}

function initTabs() {
    $$('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            if (tab.getAttribute('aria-disabled') === 'true') return;
            showTab(tab.dataset.tab);
        });
    });
}

/**
 * Run and Report are meaningless until there is something to run against, so
 * they are disabled rather than shown empty. A finished run keeps them open
 * even if the probe was lost with a worker restart.
 */
function setRunTabsEnabled(enabled) {
    let bounce = false;
    for (const tab of $$('.tab')) {
        if (tab.dataset.tab === 'setup') continue;
        tab.setAttribute('aria-disabled', String(!enabled));
        if (!enabled && tab.classList.contains('is-active')) bounce = true;
    }
    if (bounce) showTab('setup');
}

/* -------------------------------------------------------------- snapshot */

async function refresh() {
    snap = await send(MSG.GET_SNAPSHOT);
    if (!snap) return;
    applyLocale(snap.settings.locale);
    applyTheme(snap.settings.theme);
    collapsedGroups = new Set(snap.settings.collapsedGroups || []);
    sel.suiteIds = new Set(snap.selection.suiteIds || []);
    sel.langs = new Set(snap.selection.langs || []);
    const pages = (snap.run.env && snap.run.env.pages) || [];
    sel.pages = new Set(
        snap.selection.pages && snap.selection.pages.length
            ? snap.selection.pages
            : pages.map((p) => p.url)
    );
    pagesTouched = !!(snap.selection.pages && snap.selection.pages.length);
    renderAll();
}

function renderAll() {
    renderEnv();
    renderEstimate();
    renderSettings();
    renderSuites();
    renderPages();
    renderLangs();
    renderRun();
}

/* ------------------------------------------------------------------- env */

function renderEnv() {
    const env = (snap.run && snap.run.env) || null;
    const probed = !!(env && env.ok);
    const table = $('#envTable');
    table.textContent = '';

    document.body.classList.toggle('is-empty', !probed);
    setRunTabsEnabled(probed || (snap.run && snap.run.resultCount > 0));

    if (!probed) {
        renderEmptyState(env);
        return;
    }

    $('#dutLine').textContent = `${env.model} · ${env.firmware} · ${env.theme.toUpperCase()}`;
    $('#dutLine').title = env.origin;

    addKv(table, {
        [t('dut.origin')]: env.origin,
        [t('dut.model')]: env.model,
        [t('dut.firmware')]: env.firmware,
        [t('dut.theme')]: env.theme,
        [t('dut.territory')]: env.territory || '-',
        [t('dut.language')]: env.lang || '-',
        [t('dut.pages')]: String((env.pages || []).length),
        [t('dut.langsAvailable')]: String((env.langs || []).length || '-'),
    });
}

/** Guidance, plus why the last attempt did not get anywhere. */
function renderEmptyState(env) {
    const reason = $('#probeReason');
    const saw = $('#probeSaw');
    saw.textContent = '';

    if (env && env.reason) {
        $('#dutLine').textContent = env.reason;
        reason.textContent = env.reason;
        // flash() may have left a success/error class behind.
        reason.className = 'note warn';
        reason.hidden = false;
        // What the probe was actually looking at, so a wrong active tab is
        // visible rather than something to deduce from the message.
        if (env.probedUrl !== undefined || env.origin) {
            saw.hidden = false;
            addKv(saw, {
                [t('dut.activeTab')]: env.probedUrl || t('common.none'),
                [t('dut.loggedIn')]: env.loggedIn ? t('common.yes') : t('common.no'),
            });
        } else {
            saw.hidden = true;
        }
    } else {
        $('#dutLine').textContent = t('topbar.noDut');
        reason.hidden = true;
        saw.hidden = true;
    }
}

function addKv(dl, obj) {
    for (const [k, v] of Object.entries(obj)) {
        dl.append(el('dt', null, k), el('dd', null, v));
    }
}

/* -------------------------------------------------------------- settings */

const SETTING_FIELDS = {
    username: 'value',
    password: 'value',
    autoLogin: 'checked',
    safeMode: 'checked',
    stopOnError: 'checked',
    realKeys: 'checked',
    verboseConsole: 'checked',
    pageSettleMs: 'value',
    pageTimeoutMs: 'value',
    timeScale: 'value',
    returnPage: 'value',
};

function renderSettings() {
    for (const [id, prop] of Object.entries(SETTING_FIELDS)) {
        const node = $('#' + id);
        if (node) node[prop] = snap.settings[id];
    }
    renderRiskyList();

    // These rules are what silences findings, so say how many are in force
    // without having to open the section.
    const shipped = (snap.settings.knownIssues || []).length;
    $('#advCount').textContent = t('adv.rules', { count: shipped });
    $('#advShipped').textContent = t('adv.shipped', { count: shipped });
}

/* ------------------------------------------------------- advanced lists */

async function saveList(patch) {
    snap = await send(MSG.SAVE_SETTINGS, { settings: patch });
    renderSettings();
    renderReport();
}

/**
 * Every action_script Safe Mode knows how to hold back, grouped by what it
 * does to the DUT. Ticked means intercepted rather than sent.
 */
function renderRiskyList() {
    const host = $('#riskyList');
    host.textContent = '';
    const on = new Set(snap.settings.riskyActions || []);

    for (const [group, actions] of Object.entries(RISKY_ACTIONS)) {
        const box = el('div', 'subgroup');
        box.append(el('h3', null, t(`adv.risky.${group}`)));
        for (const action of actions) {
            const label = el('label', 'check');
            const input = el('input');
            input.type = 'checkbox';
            input.checked = on.has(action);
            input.addEventListener('change', () => {
                const next = new Set(snap.settings.riskyActions || []);
                if (input.checked) next.add(action);
                else next.delete(action);
                saveList({ riskyActions: [...next] });
            });
            label.append(input, el('span', 'grow mono', action));
            box.append(label);
        }
        host.append(box);
    }
}

function initAdvancedLists() {
    $('#riskyAll').addEventListener('click', () =>
        saveList({ riskyActions: Object.values(RISKY_ACTIONS).flat() })
    );
    $('#riskyNone').addEventListener('click', () => saveList({ riskyActions: [] }));

}

function collectSettings() {
    const out = {};
    for (const [id, prop] of Object.entries(SETTING_FIELDS)) {
        const node = $('#' + id);
        if (!node) continue;
        out[id] = prop === 'checked' ? node.checked : node.value;
    }
    out.pageSettleMs = Number(out.pageSettleMs) || 0;
    out.pageTimeoutMs = Number(out.pageTimeoutMs) || 20000;
    out.timeScale = Number(out.timeScale) || 1;
    return out;
}

function collectSelection() {
    const allPages = ((snap.run.env && snap.run.env.pages) || []).map((p) => p.url);
    const everything = allPages.length && allPages.every((u) => sel.pages.has(u));
    return {
        suiteIds: [...sel.suiteIds],
        pages: everything && !pagesTouched ? null : [...sel.pages],
        langs: [...sel.langs],
    };
}

let saveTimer = null;
function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        snap = await send(MSG.SAVE_SETTINGS, {
            settings: collectSettings(),
            selection: collectSelection(),
        });
    }, 350);
}

/* ---------------------------------------------------------------- suites */

function renderSuites() {
    const host = $('#suiteTree');
    host.textContent = '';

    for (const group of GROUPS) {
        const inGroup = SUITES.filter((s) => s.group === group);
        const box = el('div', 'subgroup');

        // The group heading is itself a checkbox: it ticks or clears the whole
        // group, and shows indeterminate while only part of it is selected.
        const head = el('div', 'grouphead');

        // Collapsing and selecting are separate controls: a single element
        // that did both would be a coin toss every time you clicked it.
        const collapsed = collapsedGroups.has(group);
        box.classList.toggle('is-collapsed', collapsed);

        const toggle = el('button', 'gtoggle');
        toggle.type = 'button';
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', groupLabel(group));
        toggle.addEventListener('click', () => {
            const nowCollapsed = !collapsedGroups.has(group);
            if (nowCollapsed) collapsedGroups.add(group);
            else collapsedGroups.delete(group);
            box.classList.toggle('is-collapsed', nowCollapsed);
            toggle.setAttribute('aria-expanded', String(!nowCollapsed));
            persistCollapsed();
        });

        const label = el('label', 'glabel');
        const groupBox = el('input');
        groupBox.type = 'checkbox';
        const count = el('span', 'gcount');

        const syncGroup = () => {
            const on = inGroup.filter((suite) => sel.suiteIds.has(suite.id)).length;
            groupBox.checked = on === inGroup.length;
            groupBox.indeterminate = on > 0 && on < inGroup.length;
            count.textContent = `${on}/${inGroup.length}`;
        };

        groupBox.addEventListener('change', () => {
            for (const suite of inGroup) {
                if (groupBox.checked) sel.suiteIds.add(suite.id);
                else sel.suiteIds.delete(suite.id);
            }
            renderSuites();
            persist();
        });

        label.append(groupBox, el('span', 'gname', groupLabel(group)));
        head.append(toggle, label, count);
        box.append(head);

        for (const suite of inGroup) {
            const label = el('label', 'check');
            const input = el('input');
            input.type = 'checkbox';
            input.checked = sel.suiteIds.has(suite.id);
            input.addEventListener('change', () => {
                if (input.checked) sel.suiteIds.add(suite.id);
                else sel.suiteIds.delete(suite.id);
                syncGroup();
                updateSuiteCount();
                persist();
            });
            const text = el('span', 'grow');
            text.append(
                el('span', 'name', suiteText(suite, 'name')),
                el('span', 'desc', suiteText(suite, 'desc'))
            );
            label.append(input, text);
            box.append(label);
        }

        syncGroup();
        host.append(box);
    }
    updateSuiteCount();
}

function updateSuiteCount() {
    $('#suiteCount').textContent = `${sel.suiteIds.size}/${SUITES.length}`;
    updatePageCount();
    renderEstimate();
}

function initPresets() {
    $$('#presets .chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            const key = chip.dataset.preset;
            if (key === 'none') sel.suiteIds = new Set();
            else if (key === 'full' || PRESETS[key] === null) sel.suiteIds = new Set(SUITES.map((s) => s.id));
            else sel.suiteIds = new Set(PRESETS[key] || []);
            renderSuites();
            persist();
        });
    });
}

/* ----------------------------------------------------------------- pages */

function renderPages() {
    const host = $('#pageList');
    const pages = (snap.run.env && snap.run.env.pages) || [];
    const needle = $('#pageSearch').value.trim().toLowerCase();
    host.textContent = '';

    if (!pages.length) {
        host.append(el('p', 'empty', t('pages.empty')));
        $('#pageCount').textContent = '0';
        return;
    }

    const shown = pages.filter(
        (p) =>
            !needle ||
            p.url.toLowerCase().includes(needle) ||
            (p.menuName || '').toLowerCase().includes(needle) ||
            (p.tabName || '').toLowerCase().includes(needle)
    );

    for (const page of shown) {
        const label = el('label', 'item');
        const input = el('input');
        input.type = 'checkbox';
        input.checked = sel.pages.has(page.url);
        input.addEventListener('change', () => {
            if (input.checked) sel.pages.add(page.url);
            else sel.pages.delete(page.url);
            pagesTouched = true;
            updatePageCount();
            persist();
        });
        const text = el('span', 'grow');
        text.append(el('span', 'msg', page.url));
        const where = [page.menuName, page.tabName].filter(Boolean).join(' › ');
        if (where) text.append(el('span', 'path', where));
        label.append(input, text);
        host.append(label);
    }

    if (!shown.length) host.append(el('p', 'empty', t('pages.noMatch')));
    updatePageCount();
}

function updatePageCount() {
    const env = snap.run.env || {};
    const total = (env.pages || []).length;
    $('#pageCount').textContent = `${sel.pages.size}/${total}`;

    /*
     * Ticking a page does not mean it gets visited: with only a page-scoped
     * item selected, the rest have nothing to run. Say so, rather than leaving
     * "76 pages" next to a one-page run.
     */
    const visited = pagesInScope([...sel.suiteIds], [...sel.pages]).length;
    const note = $('#pageScope');
    note.textContent = '';
    if (visited < sel.pages.size) {
        // Two parts, so the figure reads as a figure instead of being buried
        // mid-sentence in a wall of muted text.
        note.append(
            el('b', 'n', `${visited}/${sel.pages.size}`),
            el('span', null, t('pages.inScope'))
        );
        note.hidden = false;
    } else {
        note.hidden = true;
    }

    updateLangCount((env.langs && env.langs.length ? env.langs : FALLBACK_LANGS).length);
}

function initPageControls() {
    $('#pageSearch').addEventListener('input', renderPages);
    $('#pagesAll').addEventListener('click', () => {
        for (const p of (snap.run.env && snap.run.env.pages) || []) sel.pages.add(p.url);
        pagesTouched = false;
        renderPages();
        persist();
    });
    $('#pagesNone').addEventListener('click', () => {
        sel.pages.clear();
        pagesTouched = true;
        renderPages();
        persist();
    });
}

/* ------------------------------------------------------------- languages */

function renderLangs() {
    const host = $('#langChips');
    host.textContent = '';
    const env = snap.run.env || {};
    const langs = (env.langs && env.langs.length ? env.langs : FALLBACK_LANGS).slice().sort();

    for (const code of langs) {
        const chip = el('button', 'chip', code);
        chip.classList.toggle('is-on', sel.langs.has(code));
        chip.addEventListener('click', () => {
            if (sel.langs.has(code)) sel.langs.delete(code);
            else sel.langs.add(code);
            chip.classList.toggle('is-on', sel.langs.has(code));
            updateLangCount(langs.length);
            persist();
        });
        host.append(chip);
    }
    updateLangCount(langs.length);
}

/**
 * "All languages" repeats the entire sweep per language, so show what the
 * current selection actually costs rather than leaving it to be discovered.
 */
function updateLangCount(total) {
    $('#langCount').textContent = `${sel.langs.size}/${total}`;
    renderEstimate();

    const passes = Math.max(sel.langs.size, 1);
    const pages = sel.pages.size;
    const estimate = $('#langEstimate');
    estimate.textContent = pages
        ? t('langs.estimate', {
              langs: passes,
              pages,
              // One driver slot per pass, matching the runner's queue.
              items: passes * (pages + 1),
          })
        : '';
}

function initLangControls() {
    const allLangs = () => {
        const env = snap.run.env || {};
        return env.langs && env.langs.length ? env.langs : FALLBACK_LANGS;
    };
    $('#langsAll').addEventListener('click', () => {
        for (const code of allLangs()) sel.langs.add(code);
        renderLangs();
        persist();
    });
    $('#langsNone').addEventListener('click', () => {
        sel.langs.clear();
        renderLangs();
        persist();
    });
}

/* -------------------------------------------------------------- estimate */

/**
 * How long the current selection will take. Deliberately not a sum of the
 * ticked items: navigating and settling each page is paid once however many
 * items want that page, and the instrumentation channels ride along for free.
 * See src/lib/estimate.js.
 *
 * While a run is in flight the pace it is actually keeping replaces the
 * model, because that is strictly better information.
 */
function renderEstimate() {
    const bar = $('#estimateBar');
    const run = snap.run || {};
    const env = run.env || {};
    const probed = !!env.ok;

    bar.hidden = !probed;
    if (!probed) return;

    const estimate = estimateRun({
        suiteIds: [...sel.suiteIds],
        pages: [...sel.pages],
        langs: [...sel.langs],
        settings: snap.settings,
        timings: snap.measured || {},
    });

    const running = run.status === RUN.RUNNING || run.status === RUN.PAUSED;

    if (running) {
        const remaining = estimateRemaining({
            startedAt: run.startedAt,
            cursor: run.cursor,
            total: run.total,
            fallbackMs: run.estimateMs || estimate.totalMs,
        });
        $('#estimateLabel').textContent = t('estimate.remaining');
        $('#estimateTime').textContent = formatDuration(remaining);
        $('#estimateDetail').textContent = t('estimate.elapsed', {
            elapsed: formatDuration(Date.now() - run.startedAt),
        });
        bar.classList.remove('is-seed');
        return;
    }

    $('#estimateLabel').textContent = t('estimate.label');
    $('#estimateTime').textContent = formatDuration(estimate.totalMs);
    $('#estimateDetail').textContent = estimate.pageLoop
        ? t('estimate.detail', { pages: estimate.pages, passes: estimate.passes })
        : t('estimate.noPages');
    // A tilde until real measurements outweigh the shipped seed figures.
    bar.classList.toggle('is-seed', estimate.measuredShare < 0.5);
}

/* ------------------------------------------------------------------- run */

function renderRun() {
    const run = snap.run;
    const busy = run.status === RUN.RUNNING || run.status === RUN.STOPPING;
    const paused = run.status === RUN.PAUSED;

    // One percentage drives both the fill width and the clip on the top text
    // layer, so they cannot drift apart.
    $('#progressWrap').style.setProperty('--pct', `${run.progress || 0}%`);
    const label =
        run.status === RUN.IDLE
            ? t('run.status.idle')
            : t('run.progress', { status: statusLabel(run.status), percent: run.progress || 0 });
    $('#progressText').textContent = label;
    $('#progressTextOver').textContent = label;
    $('#btnStart').hidden = busy || paused;
    $('#btnPause').hidden = !busy;
    $('#btnResume').hidden = !paused;
    $('#btnStop').hidden = !busy && !paused;

    renderEstimate();
    renderCards($('#counters'), run.counts || {});
    // What is happening right now belongs at the top of the live list rather
    // than on a line of its own above the controls.
    renderResultList(
        $('#liveResults'),
        (run.results || []).slice(-80).reverse(),
        busy || paused ? run.current : null
    );
    $('#runLog').textContent = (run.notes || []).join('\n');
}

function statusLabel(status) {
    return t(`run.status.${status}`);
}

function renderCards(host, counts) {
    host.textContent = '';
    const present = SEV_ORDER.filter((s) => counts[s]);
    if (!present.length) {
        host.append(el('p', 'empty', t('run.noResults')));
        return;
    }
    for (const severity of present) {
        const card = el('div', `card ${severity}`);
        card.append(el('b', null, String(counts[severity])), el('span', null, sevLabel(severity)));
        host.append(card);
    }
}

function renderResultList(host, rows, current) {
    host.textContent = '';

    if (current) {
        const item = el('div', 'item is-current');
        item.append(el('span', 'pill info', statusLabel(RUN.RUNNING)));
        const body = el('span', 'grow');
        body.append(el('span', 'msg', current.page || t('run.driverSuites')));
        body.append(el('span', 'path', current.lang));
        item.append(body);
        host.append(item);
    }

    if (!rows.length) {
        if (!current) host.append(el('p', 'empty', t('run.nothingRecorded')));
        return;
    }
    for (const r of rows) {
        const item = el('div', 'item');
        item.append(el('span', `pill ${r.severity}`, sevLabel(r.severity)));
        const body = el('span', 'grow');
        body.append(el('span', 'msg', r.message));
        const meta = [suiteName(r.suite), r.page, r.lang].filter(Boolean).join(' · ');
        body.append(el('span', 'path', meta));
        item.append(body);

        // Only in the Report tab: during a run the list is a feed, and a
        // button that reflows it while results stream in is a nuisance.
        host.append(item);
    }
}

function suiteName(id) {
    return SUITE_BY_ID[id] ? suiteText(SUITE_BY_ID[id], 'name') : id;
}

/* ---------------------------------------------------------------- report */

async function loadReport() {
    const res = await send(MSG.EXPORT_REPORT);
    reportCache = (res && res.run) || null;
    renderReport();
}

function renderReport() {
    if (!reportCache) return;
    const run = reportCache;

    reportRows = run.results || [];
    const counts = {};
    for (const row of reportRows) counts[row.severity] = (counts[row.severity] || 0) + 1;

    renderCards($('#reportSummary'), counts);

    fillSelect($('#filterSev'), SEV_ORDER.filter((s) => counts[s]), (s) => [s, sevLabel(s)]);
    fillSelect($('#filterSuite'), [...new Set(reportRows.map((r) => r.suite))].sort(), (s) => [s, suiteName(s)]);

    applyReportFilter();

    renderTimings(run);

    const apis = run.apis || [];
    $('#apiCount').textContent = String(apis.length);
    const host = $('#apiRows');
    host.textContent = '';
    if (!apis.length) {
        host.append(el('p', 'empty', t('report.noApis')));
    } else {
        for (const a of apis.slice().reverse()) {
            const item = el('div', 'item');
            item.append(
                el(
                    'span',
                    `pill ${a.blocked ? 'blocked' : a.risk ? 'warn' : 'info'}`,
                    a.blocked ? t('api.held') : a.risk ? t('api.risky') : t('api.sent')
                )
            );
            const body = el('span', 'grow');
            body.append(el('span', 'msg', `${a.via} ${a.path}`));
            const bits = [a.page, a.params?.action_mode && `mode=${a.params.action_mode}`, a.params?.action_script && `script=${a.params.action_script}`]
                .filter(Boolean)
                .join(' · ');
            body.append(el('span', 'path', bits));
            item.append(body);
            host.append(item);
        }
    }
}

/**
 * What the run actually spent, per item. The shared costs are listed too --
 * navigating, settling and harvesting are usually the bulk of a sweep, and
 * seeing that is what makes it obvious why ticking a sixth passive item
 * changes nothing.
 */
function renderTimings(run) {
    const host = $('#timingRows');
    host.textContent = '';

    const timings = run.timings || {};
    const rows = Object.entries(timings)
        .filter(([, v]) => v && v.ms > 0)
        .map(([key, v]) => ({
            key,
            ms: v.ms,
            n: v.n,
            isSuite: key.startsWith('suite:'),
            label: key.startsWith('suite:') ? suiteName(key.slice(6)) : t(`cost.${key}`),
        }))
        .sort((a, b) => b.ms - a.ms);

    // The settle sleep is a setting, not a measurement, so it is not in the
    // collector -- add it here or the total looks impossibly small.
    const settleMs = (run.settings?.pageSettleMs || 0) * (timings.navigate?.n || 0);
    if (settleMs > 0) {
        rows.push({ key: 'settle', ms: settleMs, n: timings.navigate.n, isSuite: false, label: t('cost.settle') });
        rows.sort((a, b) => b.ms - a.ms);
    }

    const total = rows.reduce((sum, r) => sum + r.ms, 0);
    $('#timingTotal').textContent = total ? formatDuration(total) : '—';

    if (!rows.length) {
        host.append(el('p', 'empty', t('run.nothingRecorded')));
        return;
    }

    for (const row of rows) {
        const item = el('div', 'item');
        item.append(el('span', `pill ${row.isSuite ? 'info' : 'skip'}`, formatDuration(row.ms)));
        const body = el('span', 'grow');
        body.append(el('span', 'msg', row.label));
        body.append(
            el(
                'span',
                'path',
                t('cost.detail', {
                    share: total ? Math.round((row.ms / total) * 100) : 0,
                    each: Math.round(row.ms / Math.max(row.n, 1)),
                    n: row.n,
                })
            )
        );
        item.append(body);
        host.append(item);
    }
}

function fillSelect(node, values, map) {
    const keep = node.value;
    node.textContent = '';
    const first = el('option', null, node.id === 'filterSev' ? t('report.allSeverities') : t('report.allSuites'));
    first.value = '';
    node.append(first);
    for (const v of values) {
        const [value, label] = map(v);
        const option = el('option', null, label);
        option.value = value;
        node.append(option);
    }
    node.value = keep;
}

function applyReportFilter() {
    if (!reportCache) return;
    const sevFilter = $('#filterSev').value;
    const suiteFilter = $('#filterSuite').value;
    const needle = $('#filterQuery').value.trim().toLowerCase();

    const rows = reportRows.filter(
        (r) =>
            (!sevFilter || r.severity === sevFilter) &&
            (!suiteFilter || r.suite === suiteFilter) &&
            (!needle ||
                r.message.toLowerCase().includes(needle) ||
                (r.page || '').toLowerCase().includes(needle))
    );

    rows.sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
    $('#filterCount').textContent = `${rows.length}/${reportRows.length}`;
    renderResultList($('#reportRows'), rows.slice(0, 500));
}

function initExport() {
    $$('[data-export]').forEach((chip) => {
        chip.addEventListener('click', async () => {
            if (!reportCache) await loadReport();
            if (!reportCache || !(reportCache.results || []).length) {
                flash('#runError', t('report.nothingToExport'));
                return;
            }
            const format = chip.dataset.export;
            const builder = BUILDERS[format];
            const blob = new Blob([builder.build(reportCache)], { type: `${builder.mime};charset=utf-8` });
            const url = URL.createObjectURL(blob);
            try {
                await chrome.downloads.download({
                    url,
                    filename: reportFilename(reportCache, builder.ext),
                    saveAs: false,
                });
            } finally {
                setTimeout(() => URL.revokeObjectURL(url), 30000);
            }
        });
    });
}

/* --------------------------------------------------------------- actions */

function flash(selector, text, kind = 'error') {
    const node = $(selector);
    if (!node) return;
    node.textContent = text;
    node.className = `note ${kind}`;
    node.hidden = false;
    setTimeout(() => { node.hidden = true; }, 8000);
}

function initActions() {
    for (const id of ['#btnProbe', '#btnProbeBig']) {
        const btn = $(id);
        if (!btn) continue;
        const label = btn.textContent;
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = t('topbar.probing');
            try {
                await send(MSG.PROBE_ENV);
                await refresh();
            } finally {
                btn.disabled = false;
                btn.textContent = label;
            }
        });
    }

    $('#btnStart').addEventListener('click', async () => {
        const res = await send(MSG.START_RUN, {
            settings: collectSettings(),
            selection: collectSelection(),
        });
        if (res && res.ok === false) flash('#runError', res.reason || 'could not start');
        else $('#runError').hidden = true;
        await refresh();
    });

    $('#btnPause').addEventListener('click', () => send(MSG.PAUSE_RUN));
    $('#btnResume').addEventListener('click', () => send(MSG.RESUME_RUN));
    $('#btnStop').addEventListener('click', () => send(MSG.STOP_RUN));
    $('#btnClear').addEventListener('click', async () => {
        await send(MSG.CLEAR_RUN);
        reportCache = null;
        await refresh();
    });

    for (const id of Object.keys(SETTING_FIELDS)) {
        const node = $('#' + id);
        if (node) node.addEventListener('change', persist);
    }

    ['#filterSev', '#filterSuite'].forEach((s) => $(s).addEventListener('change', applyReportFilter));
    $('#filterQuery').addEventListener('input', applyReportFilter);
}

/* --------------------------------------------------------------- startup */

chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === MSG.SNAPSHOT && snap) {
        snap.run = msg.run;
        renderRun();
    }
});

initLocaleSelect();
initThemeToggle();
applyLocale(detectLocale()); // paint something readable before the snapshot lands
applyTheme(''); // ...in the OS's appearance, until settings say otherwise
initTabs();
initPresets();
initPageControls();
initLangControls();
initActions();
initAdvancedLists();
initExport();
refresh();
