/**
 * Driver-side test items: the ones that need HTTP or tab control rather than
 * the DOM. They run once per language pass, before the page loop, and may
 * publish data into `ctx.shared` for the runner to use (reachability decides
 * which pages are worth navigating to at all).
 */

import { SEV } from '../lib/const.js';
import { NORMALIZED_HOOKS, API_HOOKS_NEEDING_ARGS, bandsFrom } from '../suites/data/api-hooks.js';
import { probeUrls, hookGet, hookGetOne } from './page-eval.js';

const PROBE_BATCH = 12;
const HOOK_BATCH = 15;

function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

/* ------------------------------------------------------- reachability */

async function reachability(ctx) {
    const results = [];
    const reach = (ctx.shared.reach = ctx.shared.reach || {});

    for (const batch of chunk(ctx.pages.map((p) => p.url), PROBE_BATCH)) {
        if (ctx.aborted()) break;
        const probed = (await probeUrls(ctx.tabId, batch)) || [];
        for (const r of probed) {
            reach[r.url] = r;
            if (r.status === 404) {
                results.push({ suite: 'core.reachability', page: r.url, severity: SEV.FAIL, message: 'page not found (404)' });
            } else if (r.status >= 500) {
                results.push({ suite: 'core.reachability', page: r.url, severity: SEV.ERROR, message: `server error (${r.status})` });
            } else if (r.status === 0) {
                results.push({ suite: 'core.reachability', page: r.url, severity: SEV.ERROR, message: `unreachable: ${r.error || 'network error'}` });
            } else if (r.login) {
                results.push({ suite: 'core.reachability', page: r.url, severity: SEV.ERROR, message: 'session expired (redirected to login)' });
            } else if (!r.ok) {
                results.push({ suite: 'core.reachability', page: r.url, severity: SEV.WARN, message: `unexpected status ${r.status}` });
            } else {
                results.push({ suite: 'core.reachability', page: r.url, severity: SEV.PASS, message: `reachable (${r.status}, ${r.length} bytes)` });
            }
        }
    }
    return results;
}

/* -------------------------------------------------------- SPEC check */

async function specCheck(ctx) {
    const results = [];
    const specMap = ctx.settings.specMap || {};
    const reach = ctx.shared.reach || {};

    // Anything not already probed by the reachability pass needs its own probe.
    const unknown = [];
    for (const pages of Object.values(specMap)) {
        for (const url of pages) if (!reach[url]) unknown.push(url);
    }
    for (const batch of chunk([...new Set(unknown)], PROBE_BATCH)) {
        if (ctx.aborted()) break;
        for (const r of (await probeUrls(ctx.tabId, batch)) || []) reach[r.url] = r;
    }

    for (const [feature, pages] of Object.entries(specMap)) {
        const hits = pages.filter((url) => reach[url] && reach[url].ok && !reach[url].login);
        results.push({
            suite: 'spec.feature-map',
            page: pages[0] || '',
            severity: SEV.INFO,
            message: `${hits.length ? 'Support' : 'Not Support'} ${feature}`,
            detail: { pages, present: hits },
        });
    }
    return results;
}

/* ------------------------------------------------------ WebAPI sweep */

/**
 * Which platform-specific hooks this build can even contain.
 *
 * An unregistered hook is simply absent from an appGet.cgi response, exactly
 * like a registered one that answered nothing -- so without asking the DUT
 * what it is, the sweep cannot tell "broken" from "not built here".
 */
async function detectPlatform(tabId) {
    const support = await hookGetOne(tabId, 'get_ui_support()', 'get_ui_support');

    /*
     * Which radios exist, from the same nvram the UI reads to build its own
     * band list (state.js wl_nband_title). get_ui_support() is not usable for
     * this: it reports "5G-2": 1 on a router whose wlnband_list is
     * 2g1<5g1<6g1, so gating on it would sweep a radio that is not there --
     * which is how channel_list_5g_2 came to be reported as a defect.
     */
    const wlnbandList = await hookGetOne(tabId, 'nvram_get(wlnband_list)', 'wlnband_list');
    const bands = bandsFrom(wlnbandList);

    if (!support || typeof support !== 'object') {
        return { known: false, support: {}, bands };
    }
    return { known: true, support, broadcom: !support.mtk, bands };
}

/** The first requirement this build does not meet, or null. */
function unmetNeed(hook, platform) {
    // A band is knowable on its own, even when get_ui_support() was not.
    if (hook.band && platform.bands && platform.bands.size && !platform.bands.has(hook.band)) {
        return `this router has no ${hook.band.replace('_', '-')} radio`;
    }

    if (!platform.known) return null;

    for (const need of hook.needs) {
        if (need === 'broadcom' && !platform.broadcom) return 'this is not a Broadcom build';
        if (need.startsWith('support:')) {
            const key = need.slice('support:'.length);
            if (!platform.support[key]) return `get_ui_support() does not report ${key}`;
        }
    }
    return null;
}

async function apiHookSweep(ctx) {
    const results = [];
    const platform = await detectPlatform(ctx.tabId);

    const toSweep = [];
    for (const hook of NORMALIZED_HOOKS) {
        const reason = unmetNeed(hook, platform);
        if (reason) {
            results.push({
                suite: 'api.hook-sweep',
                page: 'appGet.cgi',
                severity: SEV.SKIP,
                message: `not applicable to this build: ${hook.expr} (${reason})`,
            });
        } else {
            toSweep.push(hook);
        }
    }

    const missing = [];
    let checked = 0;

    for (const batch of chunk(toSweep, HOOK_BATCH)) {
        if (ctx.aborted()) break;
        const res = await hookGet(ctx.tabId, batch.map((h) => h.expr));
        if (!res || !res.ok) {
            // A dead session fails every remaining batch the same way, so say
            // so once and stop rather than emitting five identical errors.
            if (res && res.login) {
                results.push({
                    suite: 'api.hook-sweep',
                    page: 'appGet.cgi',
                    severity: SEV.ERROR,
                    message:
                        'session expired during the sweep — the DUT keeps one login at a time, ' +
                        'so another browser or app signing in will end this one',
                });
                break;
            }
            results.push({
                suite: 'api.hook-sweep',
                page: 'appGet.cgi',
                severity: SEV.ERROR,
                message: `appGet.cgi batch failed (HTTP ${res ? res.status : 'no response'}${
                    res && res.parseError ? ', response was not JSON' : ''
                })`,
                detail: { hooks: batch.map((h) => h.expr) },
            });
            continue;
        }
        const keys = new Set(res.keys);
        for (const hook of batch) {
            checked++;
            if (!keys.has(hook.key)) missing.push(hook);
        }
    }

    for (const hook of missing) {
        results.push({
            suite: 'api.hook-sweep',
            page: 'appGet.cgi',
            // A warning, not a failure: the hook may legitimately be #ifdef'd
            // out of this build, which appGet.cgi cannot distinguish from a
            // hook that ran and produced nothing.
            severity: SEV.WARN,
            message: `no response from ${hook.expr} — either it returned nothing or it is not built into this firmware`,
            detail: { expectedKey: hook.key },
        });
    }
    for (const name of API_HOOKS_NEEDING_ARGS) {
        results.push({
            suite: 'api.hook-sweep',
            page: 'appGet.cgi',
            severity: SEV.SKIP,
            message: `hook needs a runtime argument, not swept: ${name}`,
        });
    }
    if (checked) {
        results.push({
            suite: 'api.hook-sweep',
            page: 'appGet.cgi',
            severity: SEV.PASS,
            message: `${checked - missing.length}/${checked} appGet.cgi hooks responded`,
        });
    }
    return results;
}

/** Run-scoped driver suites, keyed by registry id. */
export const DRIVER_RUN_SUITES = {
    'core.reachability': reachability,
    'spec.feature-map': specCheck,
    'api.hook-sweep': apiHookSweep,
};
