/**
 * Run state.
 *
 * Kept in a module variable for speed and mirrored into chrome.storage.session
 * so a recycled service worker can pick the run back up -- the single biggest
 * reliability problem in v2.x, where a terminated worker silently lost
 * everything.
 */

import { MSG, RUN } from '../lib/const.js';

const KEY = 'run';
const PERSIST_INTERVAL_MS = 1500;

/** @returns {object} a fresh, idle run. */
export function emptyRun() {
    return {
        runId: null,
        status: RUN.IDLE,
        tabId: null,
        origin: '',
        env: null,
        selection: null,
        settings: null,
        queue: [], // [{lang, page}]
        cursor: 0,
        current: null,
        startedAt: null,
        endedAt: null,
        results: [],
        apis: [],
        notes: [],
    };
}

let run = emptyRun();
let loaded = false;
let persistTimer = null;
let dirty = false;

export async function load() {
    if (loaded) return run;
    try {
        const bag = await chrome.storage.session.get(KEY);
        if (bag[KEY]) run = { ...emptyRun(), ...bag[KEY] };
    } catch (e) {
        // session storage unavailable; carry on in memory only
    }
    loaded = true;
    return run;
}

export function get() {
    return run;
}

async function persistNow() {
    dirty = false;
    try {
        await chrome.storage.session.set({ [KEY]: run });
    } catch (e) {
        // Over quota: results are the only thing that can grow without bound.
        run.notes.push('state too large to persist; keeping it in memory only');
    }
}

/** Coalesce writes: a sweep can produce hundreds of updates a second. */
function schedulePersist() {
    dirty = true;
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        if (dirty) persistNow();
    }, PERSIST_INTERVAL_MS);
}

export function broadcast() {
    // No panel open is the normal case; swallow the resulting error.
    chrome.runtime.sendMessage({ type: MSG.SNAPSHOT, run: summary() }).catch(() => {});
}

export function patch(fields, { flush = false } = {}) {
    Object.assign(run, fields);
    if (flush) persistNow();
    else schedulePersist();
    broadcast();
    return run;
}

export function addResults(list) {
    if (!list || !list.length) return;
    run.results.push(...list);
    schedulePersist();
}

export function addApis(list) {
    if (!list || !list.length) return;
    run.apis.push(...list);
    schedulePersist();
}

export function note(text) {
    run.notes.push(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
    if (run.notes.length > 300) run.notes.splice(0, run.notes.length - 300);
    schedulePersist();
}

export async function reset() {
    run = emptyRun();
    await persistNow();
    broadcast();
    return run;
}

export async function flush() {
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
    await persistNow();
}

/**
 * What the side panel needs. Results are the bulk of the payload, so send the
 * tail rather than the whole history on every tick; the panel keeps its own
 * copy and the Report tab pulls the full set explicitly.
 */
export function summary({ full = false } = {}) {
    const total = run.queue.length;
    return {
        runId: run.runId,
        status: run.status,
        tabId: run.tabId,
        origin: run.origin,
        env: run.env,
        selection: run.selection,
        current: run.current,
        cursor: run.cursor,
        total,
        progress: total ? Math.round((run.cursor / total) * 100) : 0,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        counts: countBySeverity(run.results),
        resultCount: run.results.length,
        apiCount: run.apis.length,
        results: full ? run.results : run.results.slice(-200),
        apis: full ? run.apis : run.apis.slice(-100),
        notes: run.notes.slice(-40),
    };
}

export function countBySeverity(results) {
    const counts = {};
    for (const r of results) counts[r.severity] = (counts[r.severity] || 0) + 1;
    return counts;
}
