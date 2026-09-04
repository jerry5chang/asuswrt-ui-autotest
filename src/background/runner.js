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
import { SUITES, SUITE_BY_ID, appliesToPage } from '../suites/registry.js';
import { DRIVER_RUN_SUITES } from './driver-suites.js';
import * as state from './state.js';
import { probeEnv } from './probe.js';
import { loginAuthV2, isLoggedIn } from './auth.js';
import {
    configureInstrument,
    drainInstrument,
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
function navigateAndWait(tabId, url, timeoutMs) {
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

/** Is this event a known false alarm? */
function knownIssue(settings, event) {
    return (settings.knownIssues || []).some((k) => {
        const whereOk = !k.where || (event.href || '').includes(k.where) ||
            (event.detail && event.detail.file || '').includes(k.where);
        return whereOk && k.match && event.message.includes(k.match);
    });
}

const EVENT_MAP = {
    jsError: { suite: 'core.js-error', severity: SEV.ERROR },
    rejection: { suite: 'core.js-error', severity: SEV.ERROR },
    console: { suite: 'core.console-error', severity: SEV.WARN },
    resource: { suite: 'core.resource-error', severity: SEV.FAIL },
    uiLog: { suite: 'core.ui-log', severity: SEV.INFO },
    api: { suite: 'api.recorder', severity: SEV.WARN },
    apiBlocked: { suite: 'api.recorder', severity: SEV.BLOCKED },
};

/** Turn buffered page events into report rows. */
function mapEvents(events, { page, lang, settings, enabledChannels }) {
    const out = [];
    for (const event of events) {
        const mapping = EVENT_MAP[event.kind];
        if (!mapping) continue; // 'debug' and anything unrecognised
        if (!enabledChannels.has(mapping.suite)) continue;

        const known = knownIssue(settings, event);
        out.push({
            suite: mapping.suite,
            severity: known ? SEV.SKIP : (event.kind === 'console' && event.detail?.level === 'warn' ? SEV.INFO : mapping.severity),
            message: known ? `known issue: ${event.message}` : event.message,
            detail: event.detail,
            page,
            lang,
            href: event.href,
            ts: event.ts,
        });
    }
    return out;
}

/* --------------------------------------------------------------- the run */

/**
 * @param {{tabId: number, selection: object, settings: object, env: object}} opts
 */
export async function startRun({ tabId, selection, settings, env }) {
    control = { stop: false, pause: false };

    const selectedIds = new Set(selection.suiteIds || []);
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
        timeScale: settings.timeScale,
        safeMode: settings.safeMode,
        riskyActions: settings.riskyActions,
        channels,
    };

    const driverIds = Object.keys(DRIVER_RUN_SUITES).filter((id) => selectedIds.has(id));

    // Work items drive the progress bar: one per page per language, plus one
    // slot per language for that language's driver suites.
    const queue = [];
    for (const lang of langs) {
        queue.push({ lang, page: null, kind: 'driver' });
        for (const p of pages) queue.push({ lang, page: p.url, kind: 'page' });
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
        },
        { flush: true }
    );

    state.note(`run started: ${pages.length} page(s) x ${langs.length} language pass(es)`);

    const originalLang = env.lang;
    const shared = {};
    const seen = new Set();

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
                const res = await setLanguage(tabId, lang);
                if (!res || !res.ok) {
                    record([{ suite: 'core.reachability', severity: SEV.ERROR, page: '', lang,
                        message: `could not switch language to ${lang}: ${(res && res.reason) || 'unknown'}` }]);
                    continue;
                }
                await sleep(1500);
            }

            /* --- session pre-flight ---
             * Every probe answers "redirected to login" once the session dies,
             * so checking here turns one clear error into the alternative of
             * a hundred identical ones.
             */
            if (!(await isLoggedIn(tabId))) {
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
            };
            for (const id of driverIds) {
                if (!(await gate())) break;
                state.note(`${lang}: ${SUITE_BY_ID[id].name}`);
                try {
                    const rows = (await DRIVER_RUN_SUITES[id](ctx)) || [];
                    record(rows.map((r) => ({ lang, ...r })));
                } catch (e) {
                    record([{ suite: id, severity: SEV.ERROR, page: '', lang,
                        message: `driver suite threw: ${e.message}` }]);
                }
            }
            state.patch({ cursor: state.get().cursor + 1 });

            /* --- page loop --- */
            for (const page of pages) {
                if (!(await gate())) break;

                state.patch({ current: { lang, page: page.url } });

                const reach = shared.reach && shared.reach[page.url];
                if (reach && (reach.status === 404 || reach.status === 0)) {
                    state.patch({ cursor: state.get().cursor + 1 });
                    continue; // reachability already reported it; nothing to load
                }

                const pageSuites = SUITES.filter(
                    (s) => s.where === 'page' && selectedIds.has(s.id) && appliesToPage(s, page.url)
                );

                const nav = await navigateAndWait(tabId, `${origin}/${page.url}`, settings.pageTimeoutMs);
                if (!nav.ok) {
                    record([{ suite: 'core.reachability', severity: SEV.ERROR, page: page.url, lang,
                        message: `navigation failed: ${nav.reason}` }]);
                    state.patch({ cursor: state.get().cursor + 1 });
                    continue;
                }

                await configureInstrument(tabId, instrumentCfg);
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
                    try {
                        const rows = await runPageSuites(
                            tabId,
                            pageSuites.map((s) => s.file),
                            pageSuites.map((s) => s.id),
                            Math.max(settings.pageTimeoutMs / 2, 5000)
                        );
                        record(rows.map((r) => ({ ...r, page: page.url, lang })));
                    } catch (e) {
                        record([{ suite: 'page', severity: SEV.ERROR, page: page.url, lang,
                            message: `page suites failed to run: ${e.message}` }]);
                    }
                }

                /* harvest instrumentation before we navigate away */
                const drained = await drainInstrument(tabId);
                record(mapEvents(drained.events, { page: page.url, lang, settings, enabledChannels }));
                if (drained.apis.length) state.addApis(drained.apis.map((a) => ({ ...a, lang })));
                if (drained.dropped) {
                    state.note(`${page.url}: ${drained.dropped} event(s) dropped (buffer full)`);
                }

                state.patch({ cursor: state.get().cursor + 1 });

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

        if (settings.returnPage) {
            await navigateAndWait(tabId, `${origin}/${settings.returnPage}`, 10000).catch(() => {});
        }

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
            await navigateAndWait(tabId, `${origin}/${settings.returnPage}`, 20000);
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
