/**
 * Thin wrappers over chrome.scripting for the things the driver needs to do
 * inside the DUT's own origin.
 *
 * Everything the DUT answers depends on the asus_token cookie, and that cookie
 * is never attached to a fetch made from the service worker: it carries no
 * SameSite attribute, so Chrome treats it as Lax and drops it on the
 * extension-initiated (cross-site) request. An unauthenticated probe answers
 * "200 + 88 bytes of login redirect" for every path, which makes 404 detection
 * impossible. Probing from the page's MAIN world sidesteps all of that.
 */

/** Run `func` in the page's MAIN world and return its (possibly async) value. */
export async function evalInPage(tabId, func, args = []) {
    const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func,
        args,
    });
    return result;
}

/** Run `func` in every frame; returns one entry per frame. */
export async function evalInAllFrames(tabId, func, args = []) {
    const frames = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'MAIN',
        func,
        args,
    });
    return frames.map((f) => ({ frameId: f.frameId, result: f.result }));
}

/** GET a batch of URLs from inside the DUT origin. */
export function probeUrls(tabId, urls) {
    return evalInPage(
        tabId,
        (list) =>
            (async () => {
                const out = [];
                for (const url of list) {
                    try {
                        const res = await fetch(url, { credentials: 'same-origin' });
                        const text = await res.text();
                        out.push({
                            url,
                            status: res.status,
                            ok: res.ok,
                            length: text.length,
                            // httpd answers 200 with a tiny login redirect when the
                            // session has expired; that is not a healthy page.
                            login: text.length < 2048 && /Main_Login\.asp/i.test(text),
                        });
                    } catch (e) {
                        out.push({ url, status: 0, ok: false, length: 0, error: String(e.message || e) });
                    }
                }
                return out;
            })(),
        [urls]
    );
}

/** Call appGet.cgi with one hook expression and return its parsed value. */
export function hookGetOne(tabId, expr, key) {
    return evalInPage(
        tabId,
        (hookExpr, hookKey) =>
            (async () => {
                try {
                    const res = await fetch('/appGet.cgi?hook=' + hookExpr, { credentials: 'same-origin' });
                    if (!res.ok) return null;
                    const data = JSON.parse(await res.text());
                    return data[hookKey] === undefined ? null : data[hookKey];
                } catch (e) {
                    return null;
                }
            })(),
        [expr, key]
    );
}

/** Call appGet.cgi with a batch of hook expressions. */
export function hookGet(tabId, hookExprs) {
    return evalInPage(
        tabId,
        (exprs) =>
            (async () => {
                try {
                    const res = await fetch('/appGet.cgi?hook=' + exprs.join('%3B'), {
                        credentials: 'same-origin',
                    });
                    if (!res.ok) return { ok: false, status: res.status, keys: [] };
                    const text = await res.text();
                    let data;
                    try {
                        data = JSON.parse(text);
                    } catch (e) {
                        // httpd answers 200 with a login redirect once the session
                        // is gone -- worth naming, because it is recoverable and
                        // every later batch would fail identically.
                        const login = /Main_Login\.asp/i.test(text);
                        return { ok: false, status: res.status, parseError: true, login, keys: [] };
                    }
                    return { ok: true, status: res.status, keys: Object.keys(data) };
                } catch (e) {
                    return { ok: false, status: 0, error: String(e.message || e), keys: [] };
                }
            })(),
        [hookExprs]
    );
}

/** Switch the DUT's UI language via nvram, the way the UI itself does. */
export function setLanguage(tabId, lang) {
    return evalInPage(
        tabId,
        (code) =>
            new Promise((resolve) => {
                if (typeof httpApi === 'undefined' || !httpApi.nvramSet) {
                    resolve({ ok: false, reason: 'httpApi.nvramSet unavailable' });
                    return;
                }
                const done = setTimeout(() => resolve({ ok: true, timedOut: true }), 8000);
                try {
                    httpApi.nvramSet({ preferred_lang: code, action_mode: 'apply' }, () => {
                        clearTimeout(done);
                        resolve({ ok: true });
                    });
                } catch (e) {
                    clearTimeout(done);
                    resolve({ ok: false, reason: String(e.message || e) });
                }
            }),
        [lang]
    );
}

/** Push the live run config into the page-world instrumentation. */
export function configureInstrument(tabId, cfg) {
    return chrome.scripting
        .executeScript({
            target: { tabId, allFrames: true },
            world: 'MAIN',
            func: (config) => {
                if (window.__AUT__ && window.__AUT__.configure) window.__AUT__.configure(config);
                return !!(window.__AUT__ && window.__AUT__.installed);
            },
            args: [cfg],
        })
        .then((frames) => frames.some((f) => f.result))
        .catch(() => false);
}

/** Collect and clear everything the instrumentation buffered, in every frame. */
export async function drainInstrument(tabId) {
    try {
        const frames = await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            world: 'MAIN',
            func: () => (window.__AUT__ && window.__AUT__.drain ? window.__AUT__.drain() : null),
        });
        const events = [];
        const apis = [];
        const trace = [];
        let dropped = 0;
        for (const f of frames) {
            if (!f.result) continue;
            events.push(...(f.result.events || []));
            apis.push(...(f.result.apis || []));
            trace.push(...(f.result.trace || []));
            dropped += f.result.dropped || 0;
        }
        return { events, apis, trace, dropped };
    } catch (e) {
        return { events: [], apis: [], trace: [], dropped: 0, error: String(e.message || e) };
    }
}

/**
 * Load the runtime plus the given page-suite files into the MAIN world and run
 * them. Injecting files first lets each suite self-register, then a single
 * `func` call drives them and returns the results in one hop.
 */
export async function runPageSuites(tabId, files, suiteIds, timeoutMs) {
    if (!suiteIds.length) return { rows: [], timings: {}, injectMs: 0 };

    const injectStarted = Date.now();
    await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        files: ['src/page/runtime.js', ...files],
    });
    const injectMs = Date.now() - injectStarted;

    const result = await evalInPage(
        tabId,
        (ids, timeout) => {
            if (!window.__AUT__ || !window.__AUT__.runSuites) return { rows: [], timings: {} };
            return window.__AUT__.runSuites(ids, timeout).then((rows) => ({
                rows,
                timings: window.__AUT__.suiteTimings || {},
            }));
        },
        [suiteIds, timeoutMs]
    );

    return { rows: (result && result.rows) || [], timings: (result && result.timings) || {}, injectMs };
}
