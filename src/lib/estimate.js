/**
 * How long a run will take.
 *
 * The naive answer -- add up every selected item -- is wrong, because most of
 * the cost is *shared*. Mirroring the loop in background/runner.js:
 *
 *   per language pass:
 *     switch the UI language        (only when it differs from the DUT's)
 *     check the session is alive
 *     each selected driver suite    (reachability scales with page count)
 *     per page:
 *       navigate + wait for load    <-- paid once, however many items want it
 *       settle
 *       inject and run page suites  <-- one injection, then each suite
 *       harvest the instrumentation <-- paid once
 *
 * So:
 *   - Instrumentation items (JS errors, console, UI log, API recorder) add
 *     essentially nothing. They are passive hooks, and the single drain that
 *     collects them happens on every page anyway. Ticking all five costs the
 *     same as ticking one.
 *   - Page-suite items share the navigate + settle + drain cost with each
 *     other and with the instrumentation, and add only their own execution.
 *   - Selecting nothing that needs a loaded page skips the page loop entirely.
 *
 * Every coefficient starts from a seed measured on the reference DUT and is
 * then replaced by what this browser actually observed -- see
 * `background/timings.js`. The result is an estimate, and says so.
 */

import { SUITES, appliesToPage, pagesInScope } from '../suites/registry.js';

/**
 * Seeds, in ms, measured against ZenWiFi_BT8 / 3.0.0.4.388_34021.
 * `settle` is deliberately absent: it comes from settings, so changing it
 * moves the estimate immediately instead of waiting for new measurements.
 */
export const SEED = {
    /** chrome.tabs.update plus waiting for the tab to report `complete`. */
    navigate: 150,
    /** configureInstrument + tabs.get + drainInstrument, per page. */
    pageFixed: 80,
    /** Injecting runtime.js and the suite files, once per page. */
    pageSuiteInjection: 60,
    /** nvramSet(preferred_lang) plus the runner's post-switch settle. */
    langSwitch: 1700,
    /** The isLoggedIn round trip before each pass. */
    preflight: 160,
    /** Navigating back to the return page when the run ends. */
    returnNav: 1100,
};

/** Which of the shared costs a run pays at all. */
function needsPageLoop(selected) {
    return SUITES.some((s) => selected.has(s.id) && (s.where === 'page' || s.where === 'instrument'));
}

/** Measured coefficient if we have one, else the registry's seed. */
function coefficient(suite, timings) {
    const measured = timings && timings[`suite:${suite.id}`];
    if (measured && measured.n > 0) return { ms: measured.ms, measured: true };
    return { ms: (suite.cost && suite.cost.ms) || 0, measured: false };
}

function sharedCoefficient(key, timings) {
    const measured = timings && timings[key];
    if (measured && measured.n > 0) return { ms: measured.ms, measured: true };
    return { ms: SEED[key], measured: false };
}

/**
 * @param {object} opts
 * @param {Set<string>|Array<string>} opts.suiteIds  selected items
 * @param {Array<string>} opts.pages                 selected page URLs
 * @param {Array<string>} opts.langs                 selected languages ([] = current only)
 * @param {object} opts.settings                     pageSettleMs etc.
 * @param {object} [opts.timings]                    measured coefficients
 * @returns {{totalMs: number, lines: Array, pages: number, passes: number,
 *            workItems: number, pageLoop: boolean, measuredShare: number}}
 */
export function estimateRun({ suiteIds, pages = [], langs = [], settings = {}, timings = {} }) {
    const selected = new Set(suiteIds || []);
    const passes = Math.max((langs || []).length, 1);
    // Only the pages a selected item will act on are visited, so only those
    // are charged for.
    const inScope = pagesInScope(suiteIds, pages);
    const pageCount = inScope.length;
    const pageLoop = needsPageLoop(selected) && pageCount > 0;

    const lines = [];
    let total = 0;
    let measuredMs = 0;

    const add = (key, ms, { measured = false, count = 1 } = {}) => {
        if (ms <= 0) return;
        total += ms;
        if (measured) measuredMs += ms;
        lines.push({ key, ms, count });
    };

    /* --- once per language pass ------------------------------------------ */

    // The DUT is already on one of them, so one pass needs no switch.
    const switches = Math.max((langs || []).length - 1, 0);
    if (switches) {
        const c = sharedCoefficient('langSwitch', timings);
        add('langSwitch', c.ms * switches, { measured: c.measured, count: switches });
    }

    const pre = sharedCoefficient('preflight', timings);
    add('preflight', pre.ms * passes, { measured: pre.measured, count: passes });

    for (const suite of SUITES) {
        if (!selected.has(suite.id) || suite.where !== 'driver') continue;
        const c = coefficient(suite, timings);
        const shape = (suite.cost && suite.cost.shape) || 'fixed';
        const units = shape === 'perPage' ? pageCount : 1;
        add(`suite:${suite.id}`, c.ms * units * passes, { measured: c.measured, count: units * passes });
    }

    /* --- the page loop --------------------------------------------------- */

    if (pageLoop) {
        const nav = sharedCoefficient('navigate', timings);
        const fixed = sharedCoefficient('pageFixed', timings);
        const visits = pageCount * passes;

        add('navigate', nav.ms * visits, { measured: nav.measured, count: visits });
        add('pageFixed', fixed.ms * visits, { measured: fixed.measured, count: visits });
        add('settle', (Number(settings.pageSettleMs) || 0) * visits, { count: visits });

        const pageSuites = SUITES.filter((s) => selected.has(s.id) && s.where === 'page');
        if (pageSuites.length) {
            const inject = sharedCoefficient('pageSuiteInjection', timings);
            // Injection is per page, but only on pages where a suite applies.
            const injected = inScope.filter((url) =>
                pageSuites.some((s) => appliesToPage(s, url))
            ).length;
            add('pageSuiteInjection', inject.ms * injected * passes, {
                measured: inject.measured,
                count: injected * passes,
            });

            for (const suite of pageSuites) {
                const runsOn = inScope.filter((url) => appliesToPage(suite, url)).length;
                if (!runsOn) continue;
                const c = coefficient(suite, timings);
                add(`suite:${suite.id}`, c.ms * runsOn * passes, {
                    measured: c.measured,
                    count: runsOn * passes,
                });
            }
        }
    }

    /* --- teardown -------------------------------------------------------- */

    const back = sharedCoefficient('returnNav', timings);
    add('returnNav', back.ms, { measured: back.measured });

    return {
        totalMs: Math.round(total),
        lines: lines.sort((a, b) => b.ms - a.ms),
        pages: pageCount,
        /** Ticked but not worth visiting, given the items selected. */
        pagesSkipped: pages.length - pageCount,
        passes,
        // Matches the runner's queue: one driver slot per pass, plus each page.
        workItems: passes * (pageLoop ? pageCount + 1 : 1),
        pageLoop,
        measuredShare: total > 0 ? measuredMs / total : 0,
    };
}

/** "1h 12m", "3m 20s", "45s" — never "0h 3m 20s". */
export function formatDuration(ms) {
    const secs = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
}

/**
 * Remaining time for a run in flight. The pace it is actually keeping beats
 * any a-priori model, so use that once there is enough of it to mean anything.
 */
export function estimateRemaining({ startedAt, cursor, total, fallbackMs }) {
    if (!startedAt || !total || cursor >= total) return 0;
    if (cursor >= 3) {
        const perItem = (Date.now() - startedAt) / cursor;
        return Math.round(perItem * (total - cursor));
    }
    const done = total ? cursor / total : 0;
    return Math.round((Number(fallbackMs) || 0) * (1 - done));
}
