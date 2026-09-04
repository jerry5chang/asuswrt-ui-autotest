/**
 * The run engine.
 *
 * One pass per selected language; inside a pass the driver suites run first
 * (reachability decides which pages are worth navigating to), then every
 * selected page is visited in turn and its page suites run against the loaded
 * DOM. Everything the document_start instrumentation buffered is harvested
 * immediately before the tab navigates away.
 */

import { RUN, SEV, SEV_BAD } from '../lib/const.js';
import { SUITES, SUITE_BY_ID, appliesToPage, pagesInScope } from '../suites/registry.js';
import { collapseSuiteRows, mapEvents } from '../lib/events.js';
import { estimateRun } from '../lib/estimate.js';
import { createCollector, getTimings, mergeTimings } from './timings.js';
import * as realInput from './input.js';
import { DRIVER_RUN_SUITES } from './driver-suites.js';
import * as state from './state.js';
import { probeEnv } from './probe.js';
import { loginAuthV2, isLoggedIn } from './auth.js';
import {
    configureInstrument,
    drainInstrument,
    evalInPage,
    runPageSuites,
    setLanguage,
} from './page-eval.js';

const SCRIPT_ID = 'aut-instrument';
const CURRENT_LANG = 'current';

/** Set by stop()/pause(); read at every await boundary in the loop. */
let control = { stop: false, pause: false };

/* --------------------------------------------------------------- helpers */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isStopped() {
    return control.stop;
}

/** Block while paused; returns false if the run was stopped meanwhile. */
async function gate() {
    while (control.pause && !control.stop) await sleep(250);
    return !control.stop;
}

async function registerInstrument(origin) {
    await unregisterInstrument();
    await chrome.scripting.registerContentScripts([
        {
            id: SCRIPT_ID,
            matches: [`${origin}/*`],
            js: ['src/page/instrument.js'],
            runAt: 'document_start',
            world: 'MAIN',
            allFrames: true,
            persistAcrossSessions: false,
        },
    ]);
}

export async function unregisterInstrument() {
    try {
        const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
        if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    } catch (e) {
        // Not registered; nothing to undo.
    }
}

/** Navigate and resolve once the tab reports `complete`, or on timeout. */
export function navigateAndWait(tabId, url, timeoutMs) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (outcome) => {
            if (settled) return;
            settled = true;
            chrome.tabs.onUpdated.removeListener(onUpdated);
            clearTimeout(timer);
            resolve(outcome);
        };

        const onUpdated = (id, info) => {
            if (id === tabId && info.status === 'complete') finish({ ok: true });
        };
        const timer = setTimeout(() => finish({ ok: false, reason: 'load timeout' }), timeoutMs);

        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.update(tabId, { url }).catch((e) => finish({ ok: false, reason: e.message }));
    });
}

/**
 * What the run was made against, as log lines. Deliberately one fact per line
 * and no nesting: this gets pasted into a chat window.
 */
function environmentHeader({ env, settings, selection, langs, sweptPages, estimate }) {
    const version = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '?';
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const chromeVersion = (/Chrome\/([\d.]+)/.exec(ua) || [])[1] || 'unknown';
    const platform = (/\(([^)]*)\)/.exec(ua) || [])[1] || 'unknown platform';

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    // getTimezoneOffset is minutes *behind* UTC, so the sign is inverted.
    const offset = -now.getTimezoneOffset();
    const tz = `UTC${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(
        Math.abs(offset) % 60
    )}`;

    return [
        `tool v${version} · Chrome ${chromeVersion} · ${platform}`,
        `local time ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
            `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} (${tz})`,
        `DUT ${env.origin} · ${env.model || '?'} · ${env.firmware || '?'} · ${env.theme || '?'} · ` +
            `territory ${env.territory || '?'} · UI language ${env.lang || '?'}`,
        `pages: ${sweptPages.length} of ${(env.pages || []).length} probed` +
            `; languages: ${langs.join(', ')}`,
        `items: ${(selection.suiteIds || []).length} selected`,
        `settings: safe mode ${settings.safeMode ? 'on' : 'OFF'}, settle ${settings.pageSettleMs}ms, ` +
            `page timeout ${settings.pageTimeoutMs}ms, auto re-login ${settings.autoLogin ? 'on' : 'off'}, ` +
            `detailed log ${settings.verboseConsole ? 'on' : 'off'}`,
        `estimate: ${Math.round(estimate.totalMs / 1000)}s`,
    ];
}

/* --------------------------------------------------------------- the run */

/**
 * @param {{tabId: number, selection: object, settings: object, env: object}} opts
 */
export async function startRun({ tabId, selection, settings, env }) {
    control = { stop: false, pause: false };

    /*
     * Draft items never run, however they got into the selection -- a stored
     * selection from an older build, or a hand-made message. The panel
     * disables them; this is what makes it true.
     */
    selection = {
        ...selection,
        suiteIds: (selection.suiteIds || []).filter(
            (id) => SUITE_BY_ID[id] && !SUITE_BY_ID[id].draft
        ),
    };
    const selectedIds = new Set(selection.suiteIds);
    const origin = env.origin;

    // Which pages to sweep.
    const allPages = env.pages || [];
    const pages = selection.pages && selection.pages.length
        ? allPages.filter((p) => selection.pages.includes(p.url))
        : allPages;

    const langs = selection.langs && selection.langs.length ? selection.langs : [CURRENT_LANG];

    // Instrumentation channels the user actually asked for.
    const instrumentSuites = SUITES.filter((s) => s.where === 'instrument' && selectedIds.has(s.id));
    const enabledChannels = new Set(instrumentSuites.map((s) => s.id));
    const channels = {
        jsError: selectedIds.has('core.js-error'),
        console: selectedIds.has('core.console-error'),
        resource: selectedIds.has('core.resource-error'),
        uiLog: selectedIds.has('core.ui-log'),
        api: selectedIds.has('api.recorder'),
    };

    const instrumentCfg = {
        safeMode: settings.safeMode,
        riskyActions: settings.riskyActions,
        verbose: !!settings.verboseConsole,
        channels,
    };

    const driverIds = Object.keys(DRIVER_RUN_SUITES).filter((id) => selectedIds.has(id));

    /*
     * Nothing that needs a loaded page means no page loop. Selecting only the
     * WebAPI sweep used to still walk all 75 pages doing nothing at each one.
     */
    const wantsPages = SUITES.some(
        (s) => selectedIds.has(s.id) && (s.where === 'page' || s.where === 'instrument')
    );
    /*
     * And only the pages a selected item acts on. Selecting just the client
     * dialog item used to visit all 76 pages so that one of them could run a
     * test.
     */
    const inScope = new Set(pagesInScope(selection.suiteIds, pages.map((p) => p.url)));
    const sweptPages = wantsPages ? pages.filter((p) => inScope.has(p.url)) : [];

    const clock = createCollector();
    const estimate = estimateRun({
        suiteIds: selection.suiteIds,
        pages: pages.map((p) => p.url),
        langs: selection.langs,
        settings,
        timings: await getTimings(),
    });

    // Work items drive the progress bar: one per page per language, plus one
    // slot per language for that language's driver suites.
    const queue = [];
    for (const lang of langs) {
        queue.push({ lang, page: null, kind: 'driver' });
        for (const p of sweptPages) queue.push({ lang, page: p.url, kind: 'page' });
    }

    state.patch(
        {
            runId: `run-${Date.now()}`,
            status: RUN.RUNNING,
            tabId,
            origin,
            env,
            selection,
            settings,
            queue,
            cursor: 0,
            current: null,
            startedAt: Date.now(),
            endedAt: null,
            results: [],
            apis: [],
            notes: [],
            notesDropped: 0,
            checks: 0,
            // Live object: the collector mutates it, so later persists carry
            // the accumulating figures without extra bookkeeping.
            timings: clock.totals(),
            estimateMs: estimate.totalMs,
        },
        { flush: true }
    );

    /*
     * The environment header. Debugging someone else's run means answering
     * "what was this actually running against?" first, and every one of these
     * lines has been the answer at some point: a different firmware, a browser
     * two majors behind, a DUT in another territory, a settle time someone
     * turned down. It costs six lines at the top of the log.
     */
    state.noteAll(environmentHeader({ env, settings, selection, langs, sweptPages, estimate }));

    state.note(
        `run started: ${sweptPages.length} page(s) x ${langs.length} language pass(es); ` +
            `estimated ${Math.round(estimate.totalMs / 1000)}s`
    );
    if (!wantsPages && pages.length) {
        state.note('no item needs a loaded page, so the page loop is skipped');
    } else if (sweptPages.length < pages.length) {
        state.note(
            `${pages.length - sweptPages.length} selected page(s) skipped: no selected item acts on them`
        );
    }

    const originalLang = env.lang;
    const shared = {};
    const seen = new Set();
    /** Assertions performed, which is a much bigger number than rows. */
    let checks = 0;

    /** Drop duplicate rows; a sweep repeats the same UI log on every page. */
    function record(rows) {
        const fresh = [];
        for (const r of rows) {
            const key = `${r.lang}|${r.suite}|${r.page}|${r.severity}|${r.message}`;
            if (seen.has(key)) continue;
            seen.add(key);
            fresh.push({ ts: Date.now(), ...r });
        }
        if (fresh.length) {
            state.addResults(fresh);
            state.broadcast();
        }
        return fresh;
    }

    try {
        await registerInstrument(origin);

        for (const lang of langs) {
            if (!(await gate())) break;

            if (lang !== CURRENT_LANG && lang !== originalLang) {
                state.note(`switching UI language to ${lang}`);
                const res = await clock.time('langSwitch', 1, () => setLanguage(tabId, lang));
                if (!res || !res.ok) {
                    state.note(`language switch to ${lang} failed: ${(res && res.reason) || 'unknown'}`);
                    record([{ suite: 'core.reachability', severity: SEV.ERROR, page: '', lang,
                        message: `could not switch language to ${lang}: ${(res && res.reason) || 'unknown'}` }]);
                    continue;
                }
                if (res.timedOut) {
                    state.note(
                        `language switch to ${lang}: nvramSet never called back within 8000ms; ` +
                            'continuing, the value may not have taken'
                    );
                }
                await sleep(1500);
            }

            /* --- session pre-flight ---
             * Every probe answers "redirected to login" once the session dies,
             * so checking here turns one clear error into the alternative of
             * a hundred identical ones.
             */
            if (!(await clock.time('preflight', 1, () => isLoggedIn(tabId)))) {
                if (settings.autoLogin && settings.username) {
                    state.note('session is not valid; logging in with auth v2');
                    const login = await loginAuthV2(tabId, settings.username, settings.password);
                    if (!login.ok) {
                        record([{ suite: 'core.reachability', severity: SEV.ERROR, page: '', lang,
                            message: `cannot start: auth v2 login failed (${login.reason})` }]);
                        control.stop = true;
                        break;
                    }
                } else {
                    record([{ suite: 'core.reachability', severity: SEV.ERROR, page: '', lang,
                        message: 'session is not valid; log in to the DUT or turn on Auto re-login' }]);
                    control.stop = true;
                    break;
                }
            }

            /* --- driver suites for this pass --- */
            state.patch({ current: { lang, page: '(driver suites)' } });
            const ctx = {
                tabId,
                lang,
                settings,
                pages,
                shared,
                aborted: isStopped,
                /** Driver suites write to the run log through this. */
                log: (text) => state.note(text),
            };
            for (const id of driverIds) {
                if (!(await gate())) break;
                state.note(`${lang}: ${SUITE_BY_ID[id].name}`);
                try {
                    // Normalise by the unit the coefficient is expressed in, so
                    // a figure from a 119-page sweep still fits a 5-page one.
                    const suite = SUITE_BY_ID[id];
                    const units =
                        suite.cost && suite.cost.shape === 'perPage' ? Math.max(pages.length, 1) : 1;
                    const rows =
                        (await clock.time(`suite:${id}`, units, () => DRIVER_RUN_SUITES[id](ctx))) || [];
                    record(rows.map((r) => ({ lang, ...r })));
                } catch (e) {
                    state.note(`${id} threw: ${e.message}`);
                    record([{ suite: id, severity: SEV.ERROR, page: '', lang,
                        message: `driver suite threw: ${e.message}` }]);
                }
            }
            state.patch({ cursor: state.get().cursor + 1 });

            /* --- page loop --- */
            for (const page of sweptPages) {
                if (!(await gate())) break;

                state.patch({ current: { lang, page: page.url } });
                const pageStartedAt = Date.now();
                const rowsBefore = state.get().results.length;

                const reach = shared.reach && shared.reach[page.url];
                if (reach && (reach.status === 404 || reach.status === 0)) {
                    state.note(
                        `${page.url}: not visited — reachability saw ` +
                            `${reach.status === 404 ? 'HTTP 404' : reach.error || 'no response'}`
                    );
                    state.patch({ cursor: state.get().cursor + 1 });
                    continue; // reachability already reported it; nothing to load
                }

                const pageSuites = SUITES.filter(
                    (s) => s.where === 'page' && selectedIds.has(s.id) && appliesToPage(s, page.url)
                );

                const nav = await clock.time('navigate', 1, () =>
                    navigateAndWait(tabId, `${origin}/${page.url}`, settings.pageTimeoutMs)
                );
                if (!nav.ok) {
                    state.note(
                        `${page.url}: navigation failed after ${settings.pageTimeoutMs}ms — ${nav.reason}`
                    );
                    record([{ suite: 'core.reachability', severity: SEV.ERROR, page: page.url, lang,
                        message: `navigation failed: ${nav.reason}` }]);
                    state.patch({ cursor: state.get().cursor + 1 });
                    continue;
                }

                // Timed without the settle sleep: that comes from settings, so
                // baking it into the average would fight the setting.
                await clock.time('pageFixed', 1, () => configureInstrument(tabId, instrumentCfg));
                await sleep(settings.pageSettleMs);

                // A page that bounced to the login screen means the session died.
                let landed = '';
                try {
                    landed = (await chrome.tabs.get(tabId)).url || '';
                } catch (e) { /* tab closed; the outer catch handles it */ }

                if (/Main_Login\.asp/i.test(landed)) {
                    if (settings.autoLogin && settings.username) {
                        state.note('session expired; re-authenticating with auth v2');
                        const login = await loginAuthV2(tabId, settings.username, settings.password);
                        if (login.ok) {
                            state.note('re-authenticated; retrying page');
                            const retry = await navigateAndWait(tabId, `${origin}/${page.url}`, settings.pageTimeoutMs);
                            if (retry.ok) {
                                await configureInstrument(tabId, instrumentCfg);
                                await sleep(settings.pageSettleMs);
                            }
                        } else {
                            record([{ suite: 'core.reachability', severity: SEV.ERROR, page: page.url, lang,
                                message: `session expired and re-login failed: ${login.reason}` }]);
                            control.stop = true;
                            break;
                        }
                    } else {
                        record([{ suite: 'core.reachability', severity: SEV.ERROR, page: page.url, lang,
                            message: 'session expired (bounced to Main_Login.asp); enable Auto re-login' }]);
                        control.stop = true;
                        break;
                    }
                }

                /* page suites */
                if (pageSuites.length) {
                    /*
                     * Only attach the debugger for a page whose suites asked
                     * for real keys, and detach straight after: attaching puts
                     * a "being debugged" banner on the tab.
                     */
                    const wantsRealKeys =
                        pageSuites.some((s) => s.needsRealKeys);
                    let inputService = null;

                    if (wantsRealKeys) {
                        const attached = await realInput.attach(tabId);
                        if (attached.ok) {
                            await realInput.setRealKeysAvailable(tabId, true, { evalInPage });
                            inputService = realInput.startInputService(tabId, { evalInPage });
                        } else {
                            state.note(
                                `real key presses unavailable (${attached.reason}); ` +
                                    'keyboard checks fall back to synthetic events'
                            );
                        }
                    }

                    try {
                        // The batch runs sequentially, so it needs room for
                        // whichever suite asked for the most.
                        const allowance = Math.max(
                            Math.max(settings.pageTimeoutMs / 2, 5000),
                            ...pageSuites.map((s) => s.timeoutMs || 0)
                        );
                        const { rows, timings, injectMs } = await runPageSuites(
                            tabId,
                            pageSuites.map((s) => s.file),
                            pageSuites.map((s) => s.id),
                            allowance
                        );
                        clock.add('pageSuiteInjection', injectMs, 1);
                        for (const [id, ms] of Object.entries(timings)) clock.add(`suite:${id}`, ms, 1);
                        // One row per suite, not one per assertion.
                        const collapsed = collapseSuiteRows(rows);
                        checks += collapsed.checks;
                        record(collapsed.rows.map((r) => ({ ...r, page: page.url, lang })));
                    } catch (e) {
                        state.note(`${page.url}: page suites failed to run — ${e.message}`);
                        record([{ suite: 'page', severity: SEV.ERROR, page: page.url, lang,
                            message: `page suites failed to run: ${e.message}` }]);
                    } finally {
                        if (inputService) await inputService.stop();
                        if (wantsRealKeys) {
                            await realInput.setRealKeysAvailable(tabId, false, { evalInPage });
                            await realInput.detach(tabId);
                        }
                    }
                }

                /* harvest instrumentation before we navigate away */
                const drained = await clock.time('pageFixed', 0, () => drainInstrument(tabId));
                record(mapEvents(drained.events, { page: page.url, lang, settings, enabledChannels }));
                if (drained.apis.length) state.addApis(drained.apis.map((a) => ({ ...a, lang })));
                // The page suites' own log, folded into the run log so it
                // ships with the report.
                state.noteAll(drained.trace, `${page.url} · `);
                const pageRows = state.get().results.length - rowsBefore;
                if (drained.dropped) {
                    state.note(`${page.url}: ${drained.dropped} event(s) dropped (buffer full)`);
                }
                if (drained.error) {
                    // Swallowed before this. A page whose instrumentation
                    // cannot be harvested reports nothing, which reads as a
                    // clean page rather than a missed one.
                    state.note(`${page.url}: could not harvest instrumentation — ${drained.error}`);
                }

                state.note(
                    `${page.url}: done in ${Date.now() - pageStartedAt}ms — ` +
                        `${pageRows} row(s), ${drained.events.length} event(s), ` +
                        `${drained.apis.length} API call(s)`
                );

                state.patch({ cursor: state.get().cursor + 1, checks });

                if (settings.stopOnError) {
                    const counts = state.countBySeverity(state.get().results);
                    if (SEV_BAD.some((s) => counts[s])) {
                        state.note('stopping: stop-on-error is enabled and a failure was recorded');
                        control.stop = true;
                        break;
                    }
                }
            }

            if (control.stop) break;
        }

        /* --- teardown --- */
        if (originalLang && langs.some((l) => l !== CURRENT_LANG && l !== originalLang)) {
            state.note(`restoring UI language to ${originalLang}`);
            await setLanguage(tabId, originalLang).catch(() => {});
        }

        await unregisterInstrument();

        // Back to the origin root: it is where the UI starts, so it is valid on
        // every model and needs no setting to keep in step with the firmware.
        await clock
            .time('returnNav', 1, () => navigateAndWait(tabId, `${origin}/`, 10000))
            .catch(() => {});

        // Feeds the next run's estimate.
        await mergeTimings(clock.totals()).catch(() => {});

        state.patch(
            {
                status: control.stop ? RUN.ABORTED : RUN.DONE,
                endedAt: Date.now(),
                current: null,
                cursor: state.get().queue.length,
            },
            { flush: true }
        );
        state.note(control.stop ? 'run stopped' : 'run finished');
    } catch (e) {
        await unregisterInstrument();
        state.patch({ status: RUN.ABORTED, endedAt: Date.now(), current: null }, { flush: true });
        state.note(`run aborted: ${e.message}`);
        throw e;
    } finally {
        await state.flush();
        state.broadcast();
    }
}

export function pauseRun() {
    control.pause = true;
    state.patch({ status: RUN.PAUSED });
    state.note('paused');
}

export function resumeRun() {
    control.pause = false;
    state.patch({ status: RUN.RUNNING });
    state.note('resumed');
}

export function stopRun() {
    control.stop = true;
    control.pause = false;
    state.patch({ status: RUN.STOPPING });
    state.note('stop requested');
}

/**
 * Probe the DUT in the given tab, logging in first if the tab is sitting on
 * the login page and credentials are configured.
 */
export async function probe(tabId, settings) {
    let env = await probeEnv(tabId);

    if (!env.loggedIn && settings.autoLogin && settings.username) {
        const login = await loginAuthV2(tabId, settings.username, settings.password);
        if (login.ok) {
            const tab = await chrome.tabs.get(tabId);
            const origin = new URL(tab.url).origin;
            await navigateAndWait(tabId, `${origin}/`, 20000);
            await sleep(2500);
            env = await probeEnv(tabId);
        } else {
            env.reason = `auto-login failed: ${login.reason}`;
        }
    } else if (env.loggedIn) {
        // Confirm the session is real, not just a cached page.
        env.sessionValid = await isLoggedIn(tabId);
    }
    return env;
}
