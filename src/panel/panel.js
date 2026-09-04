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

import { MSG, RUN, SEV_ORDER, SEV_LABEL, PRESETS, FALLBACK_LANGS } from '../lib/const.js';
import { SUITES, GROUPS, SUITE_BY_ID } from '../suites/registry.js';
import { BUILDERS, reportFilename } from '../lib/report.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let snap = null;
/** Local, authoritative-while-editing selection. */
const sel = { suiteIds: new Set(), pages: new Set(), langs: new Set() };
let pagesTouched = false;
let reportCache = null;

function send(type, extra = {}) {
    return chrome.runtime.sendMessage({ type, ...extra });
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/* ------------------------------------------------------------------ tabs */

function initTabs() {
    $$('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            $$('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
            $$('.panel').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === tab.dataset.tab));
            if (tab.dataset.tab === 'report') loadReport();
        });
    });
}

/* -------------------------------------------------------------- snapshot */

async function refresh() {
    snap = await send(MSG.GET_SNAPSHOT);
    if (!snap) return;
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
    renderSettings();
    renderSuites();
    renderPages();
    renderLangs();
    renderRun();
}

/* ------------------------------------------------------------------- env */

function renderEnv() {
    const env = (snap.run && snap.run.env) || null;
    const table = $('#envTable');
    table.textContent = '';

    if (!env || !env.ok) {
        $('#dutLine').textContent = env && env.reason ? env.reason : 'no DUT probed yet';
        $('#probeHint').hidden = false;
        $('#probeHint').className = 'note warn';
        $('#probeHint').innerHTML = env && env.reason
            ? `<b>Probe incomplete.</b> ${escapeHtml(env.reason)}`
            : 'Open the router UI in a tab, log in, then press <b>Probe</b>.';
        if (env) addKv(table, { Origin: env.origin || '-', 'Logged in': env.loggedIn ? 'yes' : 'no' });
        return;
    }

    $('#probeHint').hidden = true;
    $('#dutLine').textContent = `${env.model} · ${env.firmware} · ${env.theme.toUpperCase()}`;
    $('#dutLine').title = env.origin;

    addKv(table, {
        Origin: env.origin,
        Model: env.model,
        Firmware: env.firmware,
        Theme: env.theme,
        Territory: env.territory || '-',
        Language: env.lang || '-',
        Pages: String((env.pages || []).length),
        'Languages available': String((env.langs || []).length || '-'),
    });
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
    pageSettleMs: 'value',
    pageTimeoutMs: 'value',
    timeScale: 'value',
    returnPage: 'value',
};

/** Settings held as JSON in a textarea rather than a single input. */
const JSON_FIELDS = ['specMap', 'knownIssues', 'riskyActions'];

function renderSettings() {
    for (const [id, prop] of Object.entries(SETTING_FIELDS)) {
        const node = $('#' + id);
        if (node) node[prop] = snap.settings[id];
    }
    for (const id of JSON_FIELDS) {
        const node = $('#' + id);
        if (node) node.value = JSON.stringify(snap.settings[id], null, 2);
    }
}

/**
 * Parse the JSON editors. Returns null (and marks the offender) if any is
 * malformed, so a typo cannot quietly wipe the SPEC map on the next save.
 */
function collectJsonFields() {
    const out = {};
    const bad = [];
    for (const id of JSON_FIELDS) {
        const node = $('#' + id);
        if (!node) continue;
        try {
            const value = JSON.parse(node.value);
            const wantArray = id !== 'specMap';
            if (Array.isArray(value) !== wantArray) throw new Error(wantArray ? 'expected an array' : 'expected an object');
            out[id] = value;
            node.classList.remove('invalid');
        } catch (e) {
            node.classList.add('invalid');
            bad.push(`${id}: ${e.message}`);
        }
    }
    return bad.length ? { error: bad.join('; ') } : { values: out };
}

function initJsonEditors() {
    const status = $('#jsonStatus');

    $('#jsonApply').addEventListener('click', async () => {
        const parsed = collectJsonFields();
        if (parsed.error) {
            status.textContent = parsed.error;
            status.className = 'hint bad';
            return;
        }
        snap = await send(MSG.SAVE_SETTINGS, { settings: { ...collectSettings(), ...parsed.values } });
        status.textContent = 'Saved.';
        status.className = 'hint good';
    });

    $('#jsonReset').addEventListener('click', async () => {
        const { DEFAULT_SETTINGS } = await import('../lib/const.js');
        for (const id of JSON_FIELDS) {
            $('#' + id).value = JSON.stringify(DEFAULT_SETTINGS[id], null, 2);
            $('#' + id).classList.remove('invalid');
        }
        status.textContent = 'Reset to defaults — press Apply lists to save.';
        status.className = 'hint';
    });
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
        const box = el('div', 'subgroup');
        box.append(el('h3', null, group));
        for (const suite of SUITES.filter((s) => s.group === group)) {
            const label = el('label', 'check');
            const input = el('input');
            input.type = 'checkbox';
            input.checked = sel.suiteIds.has(suite.id);
            input.addEventListener('change', () => {
                if (input.checked) sel.suiteIds.add(suite.id);
                else sel.suiteIds.delete(suite.id);
                updateSuiteCount();
                persist();
            });
            const text = el('span', 'grow');
            text.append(el('span', 'name', suite.name), el('span', 'desc', suite.description));
            label.append(input, text);
            box.append(label);
        }
        host.append(box);
    }
    updateSuiteCount();
}

function updateSuiteCount() {
    $('#suiteCount').textContent = `${sel.suiteIds.size}/${SUITES.length}`;
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
        host.append(el('p', 'empty', 'Probe the DUT to list its pages.'));
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

    if (!shown.length) host.append(el('p', 'empty', 'No page matches that filter.'));
    updatePageCount();
}

function updatePageCount() {
    const total = ((snap.run.env && snap.run.env.pages) || []).length;
    $('#pageCount').textContent = `${sel.pages.size}/${total}`;
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
            $('#langCount').textContent = String(sel.langs.size);
            persist();
        });
        host.append(chip);
    }
    $('#langCount').textContent = String(sel.langs.size);
}

/* ------------------------------------------------------------------- run */

function renderRun() {
    const run = snap.run;
    const busy = run.status === RUN.RUNNING || run.status === RUN.STOPPING;
    const paused = run.status === RUN.PAUSED;

    $('#progressBar').style.width = `${run.progress || 0}%`;
    $('#progressText').textContent =
        run.status === RUN.IDLE
            ? 'idle'
            : `${statusLabel(run.status)} — ${run.progress || 0}% (${run.cursor}/${run.total})`;
    $('#currentItem').textContent = run.current
        ? `${run.current.lang} · ${run.current.page || '(driver suites)'}`
        : '—';

    $('#btnStart').hidden = busy || paused;
    $('#btnPause').hidden = !busy;
    $('#btnResume').hidden = !paused;
    $('#btnStop').hidden = !busy && !paused;

    renderCards($('#counters'), run.counts || {});
    renderResultList($('#liveResults'), (run.results || []).slice(-80).reverse());
    $('#runLog').textContent = (run.notes || []).join('\n');
}

function statusLabel(status) {
    return { idle: 'Idle', running: 'Running', paused: 'Paused', stopping: 'Stopping', done: 'Done', aborted: 'Stopped' }[status] || status;
}

function renderCards(host, counts) {
    host.textContent = '';
    const present = SEV_ORDER.filter((s) => counts[s]);
    if (!present.length) {
        host.append(el('p', 'empty', 'No results yet.'));
        return;
    }
    for (const severity of present) {
        const card = el('div', `card ${severity}`);
        card.append(el('b', null, String(counts[severity])), el('span', null, SEV_LABEL[severity]));
        host.append(card);
    }
}

function renderResultList(host, rows) {
    host.textContent = '';
    if (!rows.length) {
        host.append(el('p', 'empty', 'Nothing recorded yet.'));
        return;
    }
    for (const r of rows) {
        const item = el('div', 'item');
        item.append(el('span', `pill ${r.severity}`, r.severity));
        const body = el('span', 'grow');
        body.append(el('span', 'msg', r.message));
        const meta = [suiteName(r.suite), r.page, r.lang].filter(Boolean).join(' · ');
        body.append(el('span', 'path', meta));
        item.append(body);
        host.append(item);
    }
}

function suiteName(id) {
    return (SUITE_BY_ID[id] && SUITE_BY_ID[id].name) || id;
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

    renderCards($('#reportSummary'), run.counts || {});

    fillSelect($('#filterSev'), SEV_ORDER.filter((s) => (run.counts || {})[s]), (s) => [s, SEV_LABEL[s]]);
    fillSelect($('#filterSuite'), [...new Set((run.results || []).map((r) => r.suite))].sort(), (s) => [s, suiteName(s)]);

    applyReportFilter();

    const apis = run.apis || [];
    $('#apiCount').textContent = String(apis.length);
    const host = $('#apiRows');
    host.textContent = '';
    if (!apis.length) {
        host.append(el('p', 'empty', 'No API calls recorded.'));
    } else {
        for (const a of apis.slice().reverse()) {
            const item = el('div', 'item');
            item.append(el('span', `pill ${a.blocked ? 'blocked' : a.risk ? 'warn' : 'info'}`, a.blocked ? 'held' : a.risk ? 'risky' : 'sent'));
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

function fillSelect(node, values, map) {
    const keep = node.value;
    node.textContent = '';
    const first = el('option', null, node.id === 'filterSev' ? 'All severities' : 'All suites');
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

    const rows = (reportCache.results || []).filter(
        (r) =>
            (!sevFilter || r.severity === sevFilter) &&
            (!suiteFilter || r.suite === suiteFilter) &&
            (!needle ||
                r.message.toLowerCase().includes(needle) ||
                (r.page || '').toLowerCase().includes(needle))
    );

    rows.sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
    $('#filterCount').textContent = `${rows.length}/${(reportCache.results || []).length}`;
    renderResultList($('#reportRows'), rows.slice(0, 500));
}

function initExport() {
    $$('[data-export]').forEach((chip) => {
        chip.addEventListener('click', async () => {
            if (!reportCache) await loadReport();
            if (!reportCache || !(reportCache.results || []).length) {
                flash('#runError', 'Nothing to export yet — run a test first.');
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
    $('#btnProbe').addEventListener('click', async () => {
        const btn = $('#btnProbe');
        btn.disabled = true;
        btn.textContent = '…';
        try {
            await send(MSG.PROBE_ENV);
            await refresh();
        } finally {
            btn.disabled = false;
            btn.textContent = 'Probe';
        }
    });

    $('#btnLogin').addEventListener('click', async () => {
        await send(MSG.SAVE_SETTINGS, { settings: collectSettings() });
        const res = await send(MSG.LOGIN, {});
        if (res && res.ok) {
            flash('#probeHint', 'Logged in. Press Probe to read the page inventory.', 'ok');
            $('#probeHint').hidden = false;
        } else {
            flash('#probeHint', `Login failed: ${(res && res.reason) || 'unknown error'}`);
            $('#probeHint').hidden = false;
        }
    });

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

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* --------------------------------------------------------------- startup */

chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === MSG.SNAPSHOT && snap) {
        snap.run = msg.run;
        renderRun();
    }
});

initTabs();
initPresets();
initPageControls();
initActions();
initJsonEditors();
initExport();
refresh();
