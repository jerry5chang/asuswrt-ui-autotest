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
    fire('error', { target: { tagName: 'IMG', src: 'http://dut/images/missing.png' } });
    fire('error', { target: { tagName: 'SCRIPT', src: 'https://www.asus.com/tw/support/FAQ/1033393?callback=jQuery1' } });
    const resources = AUT.events.filter((e) => e.kind === 'resource');
    check('same-origin resource failure is not marked external',
        resources[0] && resources[0].detail.external === false, JSON.stringify(resources[0]));
    check('cross-origin resource failure is marked external',
        resources[1] && resources[1].detail.external === true, JSON.stringify(resources[1]));
    check('external failures say so in the message',
        resources[1] && resources[1].message.startsWith('external script failed to load:'));
    check('resource failures keep the src for known-issue matching',
        resources[1] && resources[1].detail.src.includes('www.asus.com'));

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
        { kind: 'apiBlocked', message: 'held reboot', detail: null },
        { kind: 'debug', message: 'instrumentation installed', detail: null },
    ], ctx);

    check('unrecognised kinds are dropped', rows.length === 6, `got ${rows.length}`);
    check('a JS error is an error', rows[0].severity === 'error');
    check('console.error is a warning', rows[1].severity === 'warn');
    check('console.warn is only info', rows[2].severity === 'info');
    check('a same-origin resource miss is a fail', rows[3].severity === 'fail');
    check('a cross-origin resource miss is only a warning', rows[4].severity === 'warn');
    check('a held risky call is its own severity', rows[5].severity === 'blocked');
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

if (origin) await testAgainstDut();
else console.log('\n(no DUT given; skipping live checks)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
