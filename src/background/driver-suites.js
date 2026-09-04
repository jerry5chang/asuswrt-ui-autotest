/**
 * Driver-side test items: the ones that need HTTP or tab control rather than
 * the DOM. They run once per language pass, before the page loop, and may
 * publish data into `ctx.shared` for the runner to use (reachability decides
 * which pages are worth navigating to at all).
 */

import { SEV } from '../lib/const.js';
import { API_HOOKS, API_HOOKS_NEEDING_ARGS } from '../suites/data/api-hooks.js';
import { probeUrls, hookGet } from './page-eval.js';

const PROBE_BATCH = 12;
const HOOK_BATCH = 15;

function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

/** `name-arg` -> `name(arg)`, `name` -> `name()`. */
function toHookExpr(entry) {
    const dash = entry.indexOf('-');
    if (dash === -1) return `${entry}()`;
    return `${entry.slice(0, dash)}(${entry.slice(dash + 1)})`;
}

function hookBaseName(entry) {
    const dash = entry.indexOf('-');
    return dash === -1 ? entry : entry.slice(0, dash);
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

async function apiHookSweep(ctx) {
    const results = [];
    const missing = [];
    let checked = 0;

    for (const batch of chunk(API_HOOKS, HOOK_BATCH)) {
        if (ctx.aborted()) break;
        const res = await hookGet(ctx.tabId, batch.map(toHookExpr));
        if (!res || !res.ok) {
            results.push({
                suite: 'api.hook-sweep',
                page: 'appGet.cgi',
                severity: SEV.ERROR,
                message: `appGet.cgi batch failed (${res ? res.status : 'no response'})`,
                detail: { hooks: batch },
            });
            continue;
        }
        const keys = new Set(res.keys);
        for (const entry of batch) {
            checked++;
            if (!keys.has(hookBaseName(entry))) missing.push(entry);
        }
    }

    for (const entry of missing) {
        results.push({
            suite: 'api.hook-sweep',
            page: 'appGet.cgi',
            severity: SEV.FAIL,
            message: `hook returned no response: ${toHookExpr(entry)}`,
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
