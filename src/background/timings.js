/**
 * Measured run costs.
 *
 * The registry's seeds come from one DUT on one machine. Real figures depend
 * on the router, the build, the network and the browser, so the runner times
 * what it does and those measurements take over.
 *
 * Coefficients are normalised before they are stored, so a figure measured on
 * a 119-page sweep is still right for a 5-page one:
 *
 *   shape 'perPage'  ms per page
 *   shape 'fixed'    ms per invocation
 *
 * Kept as an exponential moving average rather than a running mean: when a
 * DUT or a firmware build changes, an EMA follows within a few runs instead of
 * being anchored by months of old samples. `n` is only a confidence counter,
 * used to decide whether to trust the number at all.
 */

const KEY = 'timings';
/** How fast to follow a change. 0.35 settles in ~5 runs. */
const ALPHA = 0.35;
/** Ignore absurd samples; a stalled page should not poison the average. */
const MAX_SANE_MS = 120_000;

export async function getTimings() {
    const bag = await chrome.storage.local.get(KEY);
    return bag[KEY] || {};
}

/**
 * Fold one run's samples into the stored averages.
 * @param {Record<string, {ms: number, n: number}>} samples normalised coefficients
 */
export async function mergeTimings(samples) {
    if (!samples || !Object.keys(samples).length) return getTimings();

    const stored = await getTimings();
    for (const [key, sample] of Object.entries(samples)) {
        if (!sample || !sample.n) continue;
        const observed = sample.ms / sample.n;
        if (!Number.isFinite(observed) || observed < 0 || observed > MAX_SANE_MS) continue;

        const previous = stored[key];
        stored[key] = previous
            ? { ms: previous.ms * (1 - ALPHA) + observed * ALPHA, n: Math.min(previous.n + 1, 99) }
            : { ms: observed, n: 1 };
    }
    await chrome.storage.local.set({ [KEY]: stored });
    return stored;
}

export async function clearTimings() {
    await chrome.storage.local.remove(KEY);
}

/**
 * Collects samples during a run. Totals are summed and divided by the unit
 * count at the end, which is what makes the stored figure page-count
 * independent.
 */
export function createCollector() {
    /** @type {Record<string, {ms: number, n: number}>} */
    const samples = {};

    return {
        /** @param {string} key @param {number} ms @param {number} units */
        add(key, ms, units = 1) {
            if (!Number.isFinite(ms) || ms < 0 || units <= 0) return;
            const entry = (samples[key] = samples[key] || { ms: 0, n: 0 });
            entry.ms += ms;
            entry.n += units;
        },

        /** Time an awaited call and record it. */
        async time(key, units, fn) {
            const started = Date.now();
            try {
                return await fn();
            } finally {
                this.add(key, Date.now() - started, units);
            }
        },

        /** What the report shows: total time and invocations, un-normalised. */
        totals() {
            return samples;
        },
    };
}
