/**
 * Self-test harness.
 *
 *   node tools/selftest.mjs                       # offline checks only
 *   node tools/selftest.mjs http://192.168.8.1 admin '<password>'
 *
 * With a DUT it exercises the auth v2 login and the three driver suites
 * against real firmware; without one it runs the offline checks (page-world
 * instrumentation logic, the page-suite runtime, and the report builders).
 */

import vm from 'node:vm';
import fs from 'node:fs';
import { installChromeStub } from './chrome-stub.mjs';
import { connect } from './dut-session.mjs';

const [, , origin, username, password] = process.argv;

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
    if (ok) {
        passed++;
        console.log(`  ok   ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
    return ok;
}

function section(title) {
    console.log(`\n== ${title}`);
}

/** Body of one `=== NAME (n) ===` block of a TXT report. */
function txtSection(txt, name) {
    const start = txt.indexOf(`=== ${name} (`);
    if (start === -1) return '';
    const bodyStart = txt.indexOf('\n', start) + 1;
    const next = txt.indexOf('\n=== ', bodyStart);
    return txt.slice(bodyStart, next === -1 ? undefined : next);
}

/* ------------------------------------------------------ page-world sandbox */

/** Load a MAIN-world script (instrument.js / runtime.js) into a fake window. */
function pageSandbox() {
    const sent = [];
    const listeners = {};

    const sandbox = {
        console: { log() {}, error() {}, warn() {}, info() {} },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Promise,
        Date,
        JSON,
        Object,
        Array,
        String,
        Number,
        Math,
        Error,
        URL,
        URLSearchParams,
        decodeURIComponent,
        encodeURIComponent,
        location: {
            href: 'http://dut/Advanced_LAN_Content.asp',
            origin: 'http://dut',
            pathname: '/Advanced_LAN_Content.asp',
            search: '',
        },
        addEventListener(type, fn) {
            (listeners[type] = listeners[type] || []).push(fn);
        },
        removeEventListener(type, fn) {
            const list = listeners[type] || [];
            const i = list.indexOf(fn);
            if (i !== -1) list.splice(i, 1);
        },
        document: {
            createTreeWalker: () => ({ nextNode: () => null }),
            querySelector: () => null,
            querySelectorAll: () => [],
            documentElement: { clientWidth: 1000, scrollWidth: 1000 },
            body: { innerText: 'x' },
        },
        XMLHttpRequest: function () {},
        HTMLFormElement: function () {},
        // Record what a "sent" request would have been.
        __sent: sent,
    };

    sandbox.XMLHttpRequest.prototype = {
        open(method, url) {
            this._m = method;
            this._u = url;
        },
        send(body) {
            sent.push({ method: this._m, url: this._u, body });
        },
    };
    sandbox.HTMLFormElement.prototype = { submit() { sent.push({ form: true }); } };
    sandbox.window = sandbox;
    sandbox.top = sandbox;
    sandbox.self = sandbox;
    sandbox.fetch = async (url) => {
        sent.push({ fetch: String(url) });
        return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
    };

    /** Dispatch a synthetic event at the listeners instrument.js installed. */
    sandbox.__fire = (type, event) => {
        for (const fn of listeners[type] || []) fn(event);
    };

    const ctx = vm.createContext(sandbox);
    return { sandbox, ctx, sent, fire: sandbox.__fire };
}

function loadIntoSandbox(ctx, file) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
}

/* ------------------------------------------------------- offline: instrument */

function testInstrument() {
    section('page instrumentation (src/page/instrument.js)');

    const { sandbox, ctx, sent, fire } = pageSandbox();
    loadIntoSandbox(ctx, 'src/page/instrument.js');
    const AUT = sandbox.__AUT__;

    check('installs window.__AUT__', !!AUT && AUT.installed);
    check('Safe Mode defaults to on', AUT.cfg.safeMode === true);
    check('timer scale defaults to 1 (page left alone)', AUT.cfg.timeScale === 1);

    // A harmless read.
    const benign = AUT.inspect('xhr:GET', '/appGet.cgi?hook=uptime()', '');
    check('benign read is recorded but not blocked', !benign.blocked && AUT.apis.length === 1);

    // A reboot, the exact case that used to make button testing impossible.
    const reboot = AUT.inspect('xhr:POST', '/applyapp.cgi?action_mode=apply&action_script=reboot', '');
    check('reboot is intercepted by Safe Mode', reboot.blocked === true);
    check('reboot is labelled with its risk', reboot.record.risk === 'reboot');

    // action_script can be a list; every member must be inspected.
    const multi = AUT.inspect('httpApi.nvramSet', { action_mode: 'apply', action_script: 'restart_time;restart_net' }, '');
    check('risky service inside a list is caught', multi.blocked === true && multi.record.risk === 'restart_net');

    // POST body, not just the query string.
    const body = AUT.inspect('xhr:POST', '/apply.cgi', 'action_mode=apply&action_script=restart_wireless&foo=1');
    check('risky action_script in a POST body is caught', body.blocked === true);
    check('POST body params are parsed', body.record.params.foo === '1');

    // Safe Mode off: recorded, but allowed through.
    AUT.configure({ safeMode: false });
    const allowed = AUT.inspect('xhr:POST', '/applyapp.cgi?action_script=reboot', '');
    check('Safe Mode off lets the call through', allowed.blocked === false);
    check('...and still records the risk', allowed.record.risk === 'reboot');

    AUT.configure({ safeMode: true });

    // Real XHR path: a blocked send must be re-pointed, not silently dropped.
    const xhr = new sandbox.XMLHttpRequest();
    xhr.open('POST', '/applyapp.cgi?action_mode=apply&action_script=reboot');
    xhr.send('');
    check('blocked XHR is re-pointed at a harmless hook',
        sent.length === 1 && /hook=uptime/.test(sent[0].url), JSON.stringify(sent));

    // Resource failures: same-origin is the firmware's fault, cross-origin is
    // not. Real case that prompted this -- Advanced_Smart_Home_Alexa.asp probes
    // www.asus.com for a localised FAQ page.
    const asImg = (attrs, extra = {}) => ({
        target: { tagName: 'IMG', getAttribute: (n) => attrs[n] ?? null, ...extra },
    });
    fire('error', asImg({ src: '/images/missing.png' }, { src: 'http://dut/images/missing.png' }));
    fire('error', asImg(
        { src: 'https://www.asus.com/tw/support/FAQ/1033393' },
        { tagName: 'SCRIPT', src: 'https://www.asus.com/tw/support/FAQ/1033393?callback=jQuery1' }
    ));
    const resources = AUT.events.filter((e) => e.kind === 'resource');
    check('same-origin resource failure is not marked external',
        resources[0] && resources[0].detail.external === false, JSON.stringify(resources[0]));
    check('cross-origin resource failure is marked external',
        resources[1] && resources[1].detail.external === true, JSON.stringify(resources[1]));
    check('external failures say so in the message',
        resources[1] && resources[1].message.startsWith('external script failed to load:'));
    check('resource failures keep the src for known-issue matching',
        resources[1] && resources[1].detail.src.includes('www.asus.com'));

    // <img src=""> resolves to the document, so el.src reports the page's own
    // address -- "img failed to load: <this page>", identical for every such
    // element. The raw attribute is the only way to see what happened.
    fire('error', asImg({ src: '' }, { id: 'noWanDsl', src: 'http://dut/Advanced_LAN_Content.asp' }));
    fire('error', asImg({ src: '' }, { id: 'noWanUsb', src: 'http://dut/Advanced_LAN_Content.asp' }));
    const empties = AUT.events.filter((e) => e.kind === 'resource' && e.detail.emptySrc);
    check('an empty src is identified as such, not as a missing file',
        empties[0] && empties[0].detail.emptySrc === true, JSON.stringify(empties[0]));
    check('...and the message names the real cause',
        empties[0] && /has an empty src/.test(empties[0].message), empties[0] && empties[0].message);
    check('...and names the element, so two of them do not collapse into one row',
        empties.length === 2 && empties[0].message.includes('#noWanDsl') && empties[1].message.includes('#noWanUsb'),
        empties.map((e) => e.message).join(' | '));

    // drain() must hand everything over and reset.
    const drained = AUT.drain();
    check('drain returns the buffers', Array.isArray(drained.events) && Array.isArray(drained.apis));
    check('drain resets the buffers', AUT.events.length === 0 && AUT.apis.length === 0);
    check('risky calls produced report events',
        drained.events.some((e) => e.kind === 'apiBlocked'), JSON.stringify(drained.events.map((e) => e.kind)));
}

/* --------------------------------------------------------- offline: runtime */

async function testRuntime() {
    section('page-suite runtime (src/page/runtime.js)');

    const { sandbox, ctx } = pageSandbox();
    loadIntoSandbox(ctx, 'src/page/instrument.js');
    loadIntoSandbox(ctx, 'src/page/runtime.js');
    const AUT = sandbox.__AUT__;

    check('exposes __AUT__.suite()', typeof AUT.suite === 'function');

    AUT.suite('t.pass', async (t) => t.pass('all good'));
    AUT.suite('t.fail', async (t) => t.fail('broken'));
    AUT.suite('t.throw', async () => {
        throw new Error('boom');
    });
    AUT.suite('t.check', async (t) => {
        t.check(true, 'true assertion');
        t.check(false, 'false assertion');
    });
    AUT.suite('t.hang', async () => new Promise(() => {}));

    const results = await AUT.runSuites(['t.pass', 't.fail', 't.throw', 't.check', 't.missing'], 3000);
    const bySuite = (id) => results.filter((r) => r.suite === id);

    check('a passing suite yields pass', bySuite('t.pass')[0]?.severity === 'pass');
    check('a failing suite yields fail', bySuite('t.fail')[0]?.severity === 'fail');
    check('a throwing suite becomes an error, not a crash', bySuite('t.throw')[0]?.severity === 'error');
    check('check() records both outcomes',
        bySuite('t.check').map((r) => r.severity).join(',') === 'pass,fail');
    check('an unloaded suite is skipped, not silently dropped', bySuite('t.missing')[0]?.severity === 'skip');

    const hung = await AUT.runSuites(['t.hang'], 400);
    check('a hanging suite times out instead of stalling the run',
        hung[0]?.severity === 'error' && /timed out/.test(hung[0].message));

    // expectApi is the button-test primitive.
    AUT.apis = [{ via: 'xhr:POST', path: '/applyapp.cgi', params: { action_script: 'restart_net' }, risk: 'restart_net', blocked: true }];
    AUT.suite('t.expect', async (t) => {
        const hit = await t.expectApi({ path: '/applyapp.cgi', params: { action_script: 'restart_net' } }, 500);
        t.check(!!hit, 'expectApi matched');
        const miss = await t.expectApi({ path: '/nope.cgi' }, 300);
        t.check(miss === null, 'expectApi returns null when nothing matches');
    });
    const expectResults = await AUT.runSuites(['t.expect'], 3000);
    check('expectApi finds a recorded call',
        expectResults.filter((r) => r.severity === 'pass').length === 2,
        JSON.stringify(expectResults));
}

/* ---------------------------------------------------------- offline: events */

async function testEvents() {
    section('event classification (src/lib/events.js)');

    const { mapEvents, severityFor, knownIssue, EVENT_MAP } = await import('../src/lib/events.js');

    const channels = new Set(['core.js-error', 'core.console-error', 'core.resource-error', 'core.ui-log', 'api.recorder']);
    const settings = { knownIssues: [{ where: 'js/asus_notice.js', match: 'httpApi is not defined' }] };
    const ctx = { page: 'x.asp', lang: 'TW', settings, enabledChannels: channels };

    const rows = mapEvents([
        { kind: 'jsError', message: 'boom', detail: { file: 'a.js' } },
        { kind: 'console', message: 'shouted', detail: { level: 'error' } },
        { kind: 'console', message: 'muttered', detail: { level: 'warn' } },
        { kind: 'resource', message: 'img failed to load: /images/x.png', detail: { external: false } },
        { kind: 'resource', message: 'external script failed to load: https://www.asus.com/x', detail: { external: true } },
        { kind: 'resource', message: 'img#noWanDsl has an empty src', detail: { emptySrc: true } },
        { kind: 'apiBlocked', message: 'held reboot', detail: null },
        { kind: 'debug', message: 'instrumentation installed', detail: null },
    ], ctx);

    check('unrecognised kinds are dropped', rows.length === 7, `got ${rows.length}`);
    check('a JS error is an error', rows[0].severity === 'error');
    check('console.error is a warning', rows[1].severity === 'warn');
    check('console.warn is only info', rows[2].severity === 'info');
    check('a same-origin resource miss is a fail', rows[3].severity === 'fail');
    check('a cross-origin resource miss is only a warning', rows[4].severity === 'warn');
    check('an empty src is only a warning — nothing is actually broken', rows[5].severity === 'warn');
    check('a held risky call is its own severity', rows[6].severity === 'blocked');
    check('rows carry page and lang', rows[0].page === 'x.asp' && rows[0].lang === 'TW');

    // Known issues are demoted to skip, not dropped -- a suppression should be
    // visible in the report rather than invisible.
    const suppressed = mapEvents([
        { kind: 'jsError', message: 'Uncaught ReferenceError: httpApi is not defined', detail: { file: 'js/asus_notice.js' } },
    ], ctx);
    check('a known issue becomes skip, not a silent drop', suppressed[0].severity === 'skip');
    check('a known issue is labelled as such', suppressed[0].message.startsWith('known issue:'));

    check('known-issue matching can key off a resource src',
        knownIssue({ knownIssues: [{ where: 'www.asus.com', match: 'failed to load' }] },
            { kind: 'resource', message: 'external script failed to load: x', detail: { src: 'https://www.asus.com/x' } }));

    check('a channel the user unticked is not reported',
        mapEvents([{ kind: 'uiLog', message: 'noise' }], { ...ctx, enabledChannels: new Set() }).length === 0);

    check('severityFor falls back to the baseline',
        severityFor({ kind: 'jsError', detail: null }, EVENT_MAP.jsError) === 'error');
}

/* ---------------------------------------------------------- offline: report */

async function testReport() {
    section('report builders (src/lib/report.js)');

    const { BUILDERS, reportFilename } = await import('../src/lib/report.js');

    const run = {
        runId: 'run-test',
        startedAt: Date.now() - 92_000,
        endedAt: Date.now(),
        total: 3,
        env: { model: 'ZenWiFi_BT8', firmware: '3.0.0.4_388_34021', theme: 'ui3', territory: 'US/01', origin: 'http://192.168.8.1', lang: 'TW' },
        selection: { suiteIds: ['core.reachability'], langs: ['TW'] },
        settings: { password: 'secret' },
        counts: { pass: 2, fail: 1 },
        results: [
            { suite: 'core.reachability', severity: 'pass', message: 'reachable (200, 1234 bytes)', page: 'Advanced_LAN_Content.asp', lang: 'TW' },
            { suite: 'core.reachability', severity: 'fail', message: 'page not found (404)', page: 'Advanced_VLAN_Switch_Content.asp', lang: 'TW' },
            { suite: 'core.js-error', severity: 'pass', message: 'ok <script>&amp;</script>', page: 'x.asp', lang: 'TW', detail: { a: 1 } },
        ],
        apis: [{ via: 'xhr:POST', path: '/applyapp.cgi', params: { action_mode: 'apply', action_script: 'reboot' }, risk: 'reboot', blocked: true, page: 'x.asp' }],
        notes: ['run started'],
    };

    const json = BUILDERS.json.build(run);
    let parsed = null;
    try {
        parsed = JSON.parse(json);
    } catch (e) {
        /* reported below */
    }
    check('JSON report parses', !!parsed);
    check('JSON verdict reflects the failure', parsed?.summary.verdict === 'FAIL');
    check('JSON redacts the password', parsed?.settings.password === '***');
    check('JSON pass rate is computed', parsed?.summary.passRate === 67, String(parsed?.summary.passRate));

    const html = BUILDERS.html.build(run);
    check('HTML is a complete document', html.startsWith('<!doctype html>') && html.trimEnd().endsWith('</html>'));
    check('HTML escapes result text', html.includes('&lt;script&gt;') && !html.includes('<script>&amp;'));
    check('HTML lists the intercepted call', html.includes('intercepted'));
    check('HTML carries the DUT identity', html.includes('ZenWiFi_BT8') && html.includes('3.0.0.4_388_34021'));

    const md = BUILDERS.md.build(run);
    check('Markdown has a summary table', md.includes('| Firmware |') && md.includes('## Summary'));

    const txt = BUILDERS.txt.build(run);
    check('TXT keeps the v2.x section layout',
        ['=== ERRORS', '=== SPEC CHECK', '=== WEBAPI TESTING', '=== NOT FOUND', '=== PASS', '=== UI LOG'].every((s) => txt.includes(s)));
    check('TXT reports the 404 under NOT FOUND',
        txtSection(txt, 'NOT FOUND').includes('Advanced_VLAN_Switch_Content.asp'), txtSection(txt, 'NOT FOUND'));
    check('TXT does not double-report the 404 under PASS',
        !txtSection(txt, 'PASS').includes('Advanced_VLAN_Switch_Content.asp'));
    check('TXT flags the intercepted call', txt.includes('[INTERCEPTED]'));

    check('filename carries model and timestamp', /^autotest_ZenWiFi_BT8_\d{8}_\d{6}\.html$/.test(reportFilename(run, 'html')),
        reportFilename(run, 'html'));

    fs.mkdirSync('.selftest', { recursive: true });
    fs.writeFileSync('.selftest/sample-report.html', html);
    fs.writeFileSync('.selftest/sample-report.txt', txt);
    console.log('  ->   wrote .selftest/sample-report.{html,txt}');
}

/* ------------------------------------------------------------ offline: misc */

async function testRegistry() {
    section('registry and settings');

    const { SUITES, SUITE_BY_ID, appliesToPage } = await import('../src/suites/registry.js');

    check('every suite has a unique id', new Set(SUITES.map((s) => s.id)).size === SUITES.length);
    check('every page suite points at a file that exists',
        SUITES.filter((s) => s.where === 'page').every((s) => s.file && fs.existsSync(s.file)));
    check('every suite declares a where and a scope',
        SUITES.every((s) => ['driver', 'page', 'instrument'].includes(s.where) && ['run', 'each-page', 'pages'].includes(s.scope)));

    const qis = SUITE_BY_ID['pages.qis-wizard'];
    check('page-scoped suite matches its own page', appliesToPage(qis, 'QIS_wizard.htm'));
    check('page-scoped suite skips other pages', !appliesToPage(qis, 'Advanced_LAN_Content.asp'));
    check('each-page suite matches anything', appliesToPage(SUITE_BY_ID['core.dom-sanity'], 'whatever.asp'));

    // Every page suite must register under the id the registry advertises, or
    // the runner injects the file and then reports the suite as "skip".
    const mismatched = [];
    for (const suite of SUITES.filter((s) => s.where === 'page')) {
        const src = fs.readFileSync(suite.file, 'utf8');
        if (!src.includes(`__AUT__.suite('${suite.id}'`)) mismatched.push(suite.id);
    }
    check('every page suite registers under its registry id', mismatched.length === 0, mismatched.join(', '));
}

/* ------------------------------------------------------ offline: hook list */

async function testHookList() {
    section('appGet.cgi hook list (src/suites/data/api-hooks.js)');

    const { NORMALIZED_HOOKS, normalizeHook } = await import('../src/suites/data/api-hooks.js');

    const plain = normalizeHook('uptime');
    check('a plain hook becomes name()', plain.expr === 'uptime()');
    check('a plain hook is keyed by its name', plain.key === 'uptime');

    // app_call() in httpd/web.c writes `"<func>-<arg0>":` when an argument was
    // supplied. Keying these by the bare name is what made
    // check_passwd_strength look broken on a healthy DUT.
    const withArg = normalizeHook({ name: 'check_passwd_strength', arg: 'wl_key' });
    check('an argument hook becomes name(arg)', withArg.expr === 'check_passwd_strength(wl_key)');
    check('an argument hook is keyed name-arg, as app_call() writes it',
        withArg.key === 'check_passwd_strength-wl_key', withArg.key);

    check('hook names are unique', new Set(NORMALIZED_HOOKS.map((h) => h.key)).size === NORMALIZED_HOOKS.length);
    check('no entry still carries the old dash-in-the-name form',
        !NORMALIZED_HOOKS.some((h) => h.name.includes('-')),
        NORMALIZED_HOOKS.filter((h) => h.name.includes('-')).map((h) => h.name).join(', '));

    const gated = NORMALIZED_HOOKS.filter((h) => h.needs);
    check('the Broadcom-only wl_cap_* family is gated', gated.length === 5 && gated.every((h) => h.needs === 'broadcom'),
        gated.map((h) => h.name).join(', '));
}

/* --------------------------------------------------- offline: EAA suite */

/**
 * A DOM stub shaped for the skip-link suite. Only the calls that suite makes
 * are implemented, and querySelector routes by literal selector string, so
 * what is being faked stays visible rather than pretending to be a browser.
 */
function eaaDom({
    hasPlugin = true,
    hasLink = true,
    linkCount = 1,
    revealOnFocus = true,
    targetFocusable = true,
    targetContainsNav = false,
    targetId = 'eaa-main-content',
    href = '#eaa-main-content',
    positiveTabindex = false,
    firstFocusableIsLink = true,
} = {}) {
    const { sandbox, ctx } = pageSandbox();

    const mk = (tagName, props = {}) => {
        const attrs = props.attrs || {};
        const el = {
            tagName,
            id: props.id || '',
            className: props.className || '',
            disabled: false,
            children: props.children || [],
            rect: props.rect || { left: 10, top: 10, right: 210, bottom: 50, width: 200, height: 40 },
            getAttribute: (n) => (n in attrs ? attrs[n] : null),
            setAttribute: (n, v) => { attrs[n] = v; },
            hasAttribute: (n) => n in attrs,
            getBoundingClientRect: () => el.rect,
            contains: (other) => other === el || el.children.includes(other),
            focus: () => { sandbox.document.activeElement = el; if (revealOnFocus) el.rect = revealed; },
            click: () => { sandbox.document.activeElement = props.focusOnClick || el; },
            parentElement: null,
        };
        return el;
    };

    const hidden = { left: -10000, top: 0, right: -9900, bottom: 30, width: 100, height: 30 };
    const revealed = { left: 0, top: 0, right: 160, bottom: 30, width: 160, height: 30 };

    const nav = mk('DIV', { id: 'tabMenu' });
    const banner = mk('DIV', { id: 'TopBanner' });
    const mainMenu = mk('DIV', { id: 'mainMenu' });

    const target = mk('DIV', {
        id: targetId,
        attrs: targetFocusable ? { tabindex: '-1', role: 'main' } : { role: 'main' },
        children: targetContainsNav ? [nav, banner, mainMenu] : [],
    });

    const link = mk('A', {
        className: 'eaa-skip-link',
        attrs: { href },
        rect: hidden,
        focusOnClick: target,
    });

    const otherFocusable = mk('BUTTON', { id: 'logout' });
    const jumper = mk('INPUT', { id: 'jumpy', attrs: { tabindex: '3' } });

    const links = hasLink ? Array(linkCount).fill(link) : [];
    const focusOrder = firstFocusableIsLink ? [...links, otherFocusable] : [otherFocusable, ...links];

    const byId = { [targetId]: target, tabMenu: nav, TopBanner: banner, mainMenu: mainMenu };
    const bySelector = {
        'a.eaa-skip-link, a.skip-to-main': links,
        'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]': focusOrder,
        '[tabindex]': positiveTabindex ? [jumper] : [],
        '#TopBanner': [banner],
        '#mainMenu': [mainMenu],
        '#tabMenu': [nav],
    };

    sandbox.document.querySelectorAll = (sel) => {
        if (!(sel in bySelector)) throw new Error(`eaaDom: unstubbed selector ${sel}`);
        return bySelector[sel];
    };
    sandbox.document.querySelector = (sel) => sandbox.document.querySelectorAll(sel)[0] || null;
    sandbox.document.getElementById = (id) => byId[id] || null;
    sandbox.document.body = mk('BODY');
    sandbox.document.documentElement = mk('HTML');
    sandbox.document.activeElement = null;
    sandbox.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
    sandbox.innerWidth = 1280;
    sandbox.innerHeight = 800;
    if (hasPlugin) sandbox.EAAPlugin = { addSkipToContentLink() {} };

    loadIntoSandbox(ctx, 'src/page/instrument.js');
    loadIntoSandbox(ctx, 'src/page/runtime.js');
    loadIntoSandbox(ctx, 'src/suites/page/eaa-skip-link.js');
    return sandbox;
}

async function testEaaSkipLink() {
    section('EAA skip link (src/suites/page/eaa-skip-link.js)');

    const run = async (opts) => {
        const sandbox = eaaDom(opts);
        return sandbox.__AUT__.runSuites(['eaa.skip-link'], 20000);
    };
    const sevs = (rows) => rows.map((r) => r.severity);
    const failures = (rows) => rows.filter((r) => r.severity === 'fail').map((r) => r.message);

    // A build without the plugin must not report a defect on all 76 pages.
    const noPlugin = await run({ hasPlugin: false });
    check('a build without the EAA plugin is skipped, not failed',
        sevs(noPlugin).join() === 'skip', JSON.stringify(noPlugin));
    check('...and says the plugin is missing', /no EAA plugin/.test(noPlugin[0].message));

    const good = await run({});
    check('a correct skip link passes every assertion',
        failures(good).length === 0, failures(good).join(' | '));
    check('...and actually asserts something', good.length >= 8, `${good.length} results`);

    // Requirement: it must be the first thing Tab reaches.
    const notFirst = await run({ firstFocusableIsLink: false });
    check('a link that is not the first tab stop fails',
        failures(notFirst).some((m) => /first element Tab reaches/.test(m)), failures(notFirst).join(' | '));

    const jumped = await run({ positiveTabindex: true });
    check('a positive tabindex elsewhere is flagged as jumping the queue',
        failures(jumped).some((m) => /explicit tab position ahead/.test(m)), failures(jumped).join(' | '));

    // Requirement: focusing it must reveal it.
    const stayedHidden = await run({ revealOnFocus: false });
    check('a link that stays off-screen when focused fails',
        failures(stayedHidden).some((m) => /brings it on screen/.test(m)), failures(stayedHidden).join(' | '));

    // Requirement: it must land on the content, past the navigation.
    const notBypassed = await run({ targetContainsNav: true });
    check('a target that still contains the banner and menus fails',
        failures(notBypassed).some((m) => /past the banner and the menus/.test(m)),
        failures(notBypassed).join(' | '));

    const notFocusable = await run({ targetFocusable: false });
    check('a target with no tabindex fails — focus() would silently do nothing',
        failures(notFocusable).some((m) => /programmatically focusable/.test(m)),
        failures(notFocusable).join(' | '));

    const dangling = await run({ href: '#nope' });
    check('an href that resolves to nothing fails',
        failures(dangling).some((m) => /does not resolve/.test(m)), failures(dangling).join(' | '));

    const duplicated = await run({ linkCount: 2 });
    check('two skip links fail — that is an extra Tab stop',
        failures(duplicated).some((m) => /exactly one skip link/.test(m)), failures(duplicated).join(' | '));
}

/* ------------------------------------------------- offline: probe reporting */

/**
 * The DUT card renders from run state, so a probe failure that is returned but
 * never stored shows up as the generic "press Probe" hint with an empty card --
 * which is exactly what happened when the active tab was chrome://extensions.
 */
async function testProbeReporting() {
    section('probe failure reporting (src/background/service-worker.js)');

    const stub = installChromeStub(
        { origin: 'http://dut', fetch: async () => ({ ok: false, status: 0, text: async () => '' }) },
        { tabUrl: 'chrome://extensions/' }
    );
    const { handlers } = await import('../src/background/service-worker.js');
    const { MSG } = await import('../src/lib/const.js');

    const env = await handlers[MSG.PROBE_ENV]({});
    check('probing a non-http tab fails', env.ok === false);
    check('...and names the scheme rather than the raw URL',
        /chrome: page/.test(env.reason), env.reason);
    check('...and says what to do about it', /switch to the tab/.test(env.reason));
    check('...and records which tab it looked at', env.probedUrl === 'chrome://extensions/');

    // The regression: this has to be readable from run state, not only returned.
    const snap = await handlers[MSG.GET_SNAPSHOT]({});
    check('the reason reaches run state, where the panel reads it',
        snap.run.env && snap.run.env.reason === env.reason,
        JSON.stringify(snap.run.env));
    check('a failed probe still yields a usable env shape',
        Array.isArray(snap.run.env.pages) && Array.isArray(snap.run.env.langs));

    stub.setTabs([]);
    const noTab = await handlers[MSG.PROBE_ENV]({});
    check('no open tab is reported too', noTab.ok === false && /no active tab/.test(noTab.reason));
    const snap2 = await handlers[MSG.GET_SNAPSHOT]({});
    check('...and that reason is stored as well', snap2.run.env.reason === noTab.reason);

    delete globalThis.chrome;
}

/* -------------------------------------------------------------- live: DUT */

async function testAgainstDut() {
    section(`live DUT (${origin})`);

    let session;
    try {
        session = await connect(origin, username, password);
        check('auth v2 login succeeds (get_Nonce.cgi + login_v2.cgi)', true);
    } catch (e) {
        check('auth v2 login succeeds (get_Nonce.cgi + login_v2.cgi)', false, e.message);
        return;
    }

    installChromeStub(session);

    const { probeUrls, hookGet } = await import('../src/background/page-eval.js');
    const { DRIVER_RUN_SUITES } = await import('../src/background/driver-suites.js');
    const { DEFAULT_SETTINGS } = await import('../src/lib/const.js');

    // Unauthenticated probing cannot tell a missing page from a real one --
    // that is the whole reason probes run inside the page world.
    const bare = await fetch(new URL('/Nope_Missing_Page.asp', origin));
    check('an unauthenticated probe cannot detect 404 (why we probe in-page)',
        bare.status === 200, `got ${bare.status}`);

    const probed = await probeUrls(1, ['Advanced_LAN_Content.asp', 'Nope_Missing_Page.asp', 'cloud_main.asp']);
    check('authenticated probe sees a real page as 200',
        probed.find((p) => p.url === 'Advanced_LAN_Content.asp')?.status === 200);
    check('authenticated probe sees a missing page as 404',
        probed.find((p) => p.url === 'Nope_Missing_Page.asp')?.status === 404);
    check('probe reports body size', probed[0].length > 1000);

    const hooks = await hookGet(1, ['uptime()', 'get_operation_mode()', 'nvram_get(productid)']);
    check('appGet.cgi batch hook call works', hooks.ok && hooks.keys.length >= 2, JSON.stringify(hooks));

    // Build a realistic page inventory straight from the DUT's own menu module.
    const menuSrc = await (await session.fetch('/require/modules/menuTree.js')).text();
    const urls = [...new Set([...menuSrc.matchAll(/url:\s*"([A-Za-z0-9_.\-]+\.(?:asp|htm|html))"/g)].map((m) => m[1]))];
    check('menuTree.js is readable from the DUT', urls.length > 20, `${urls.length} urls`);

    const pages = urls.map((url) => ({ url }));
    const settings = { ...DEFAULT_SETTINGS };
    const ctx = { tabId: 1, lang: 'TW', settings, pages, shared: {}, aborted: () => false };

    console.log(`  ->   sweeping ${pages.length} pages from menuTree.js`);
    const reach = await DRIVER_RUN_SUITES['core.reachability'](ctx);
    const ok = reach.filter((r) => r.severity === 'pass').length;
    const missing = reach.filter((r) => r.severity === 'fail').length;
    check('reachability suite classifies every page', reach.length === pages.length, `${reach.length}/${pages.length}`);
    check('reachability finds reachable pages', ok > 10, `${ok} reachable`);
    check('reachability populates shared.reach for the runner', Object.keys(ctx.shared.reach).length === pages.length);
    console.log(`  ->   ${ok} reachable, ${missing} missing (404)`);

    const spec = await DRIVER_RUN_SUITES['spec.feature-map'](ctx);
    check('SPEC suite reports one row per feature', spec.length === Object.keys(settings.specMap).length);
    check('SPEC suite finds a supported feature', spec.some((r) => /^Support /.test(r.message)));
    check('SPEC suite finds an unsupported feature', spec.some((r) => /^Not Support /.test(r.message)));
    for (const r of spec) console.log(`  ->   ${r.message}`);

    const api = await DRIVER_RUN_SUITES['api.hook-sweep'](ctx);
    const summary = api.find((r) => r.severity === 'pass');
    const silent = api.filter((r) => r.severity === 'warn');
    const gated = api.filter((r) => r.severity === 'skip' && /not applicable/.test(r.message));
    check('WebAPI sweep produces a summary', !!summary, JSON.stringify(api.slice(0, 3)));
    check('WebAPI sweep had no transport errors', !api.some((r) => r.severity === 'error'));
    check('a silent hook is a warning, not a failure — it may be #ifdef\'d out',
        !api.some((r) => r.severity === 'fail'));
    check('Broadcom-only hooks are skipped on this MTK build', gated.length === 5, `${gated.length} gated`);

    // Regression: app_call() answers with "<func>-<arg0>" when an argument was
    // given, so keying this by the bare name reported a healthy hook as broken.
    check('an argument-taking hook is matched by its name-arg key',
        !silent.some((r) => r.message.includes('check_passwd_strength')),
        silent.map((r) => r.message).join(' | '));

    console.log(`  ->   ${summary ? summary.message : 'no summary'}; ${silent.length} silent, ${gated.length} gated`);
    for (const r of gated) console.log(`  ->   SKIP ${r.message}`);
    for (const r of silent) console.log(`  ->   WARN ${r.message}`);

    // End-to-end: feed the real results through the report builders.
    const { BUILDERS } = await import('../src/lib/report.js');
    const liveRun = {
        runId: 'live', startedAt: Date.now() - 30000, endedAt: Date.now(), total: pages.length,
        env: { model: 'live', firmware: 'live', theme: 'ui3', territory: '', origin, lang: 'TW' },
        selection: { suiteIds: Object.keys(DRIVER_RUN_SUITES), langs: ['TW'] },
        settings, counts: {}, notes: [], apis: [],
        results: [...reach, ...spec, ...api].map((r) => ({ lang: 'TW', ...r })),
    };
    for (const r of liveRun.results) liveRun.counts[r.severity] = (liveRun.counts[r.severity] || 0) + 1;

    fs.mkdirSync('.selftest', { recursive: true });
    for (const [format, builder] of Object.entries(BUILDERS)) {
        fs.writeFileSync(`.selftest/live-report.${builder.ext}`, builder.build(liveRun));
    }
    check('live results render in every format',
        Object.values(BUILDERS).every((b) => fs.statSync(`.selftest/live-report.${b.ext}`).size > 500));
    console.log('  ->   wrote .selftest/live-report.{html,json,md,txt}');
}

/* --------------------------------------------------------------------- main */

console.log('ASUSWRT UI Autotest v3.0 — self test');

testInstrument();
await testRuntime();
await testRegistry();
await testHookList();
await testEvents();
await testReport();
await testEaaSkipLink();
await testProbeReporting();

if (origin) await testAgainstDut();
else console.log('\n(no DUT given; skipping live checks)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
