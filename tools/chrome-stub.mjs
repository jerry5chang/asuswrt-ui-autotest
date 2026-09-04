/**
 * A chrome.* stub just deep enough to run the extension's background modules
 * under Node, so the driver suites, auth flow and report builders can be
 * exercised against a real DUT without a browser.
 *
 * What it does NOT cover: real MAIN-world injection, side panel rendering, and
 * dynamic content-script registration. Those need Chrome; see docs/TESTING.md.
 */

export function installChromeStub(session, { tabUrl } = {}) {
    let tabs = [{ id: 1, url: tabUrl || `${session.origin}/index.asp` }];
    const local = new Map();
    const sess = new Map();

    const area = (map) => ({
        async get(key) {
            if (key == null) return Object.fromEntries(map);
            const keys = Array.isArray(key) ? key : [key];
            const out = {};
            for (const k of keys) if (map.has(k)) out[k] = map.get(k);
            return out;
        },
        async set(obj) {
            for (const [k, v] of Object.entries(obj)) map.set(k, v);
        },
        async remove(key) {
            map.delete(key);
        },
        async clear() {
            map.clear();
        },
    });

    const listeners = { message: [], updated: [], removed: [] };
    const registered = new Map();
    const calls = { executeScript: 0, files: [], navigations: [] };

    /**
     * Run an injected `func` with the DUT session's fetch bound as the global.
     * The driver-side injections only use fetch, which is exactly what makes
     * this substitution faithful for them.
     */
    async function runInjected(func, args) {
        const realFetch = globalThis.fetch;
        globalThis.fetch = (input, init) => session.fetch(input, init);
        try {
            return await func(...(args || []));
        } finally {
            globalThis.fetch = realFetch;
        }
    }

    globalThis.chrome = {
        storage: { local: area(local), session: area(sess) },

        runtime: {
            async sendMessage() {
                return undefined;
            },
            onMessage: { addListener: (fn) => listeners.message.push(fn) },
            onInstalled: { addListener: () => {} },
            onStartup: { addListener: () => {} },
            lastError: null,
        },

        tabs: {
            async query() {
                return tabs.filter((t) => t.url !== undefined);
            },
            async get(id) {
                return tabs.find((t) => t.id === id) || tabs[0];
            },
            async update(id, info) {
                calls.navigations.push(info.url);
                // Report "complete" so navigateAndWait resolves.
                for (const fn of listeners.updated) fn(id, { status: 'complete' });
            },
            onUpdated: {
                addListener: (fn) => listeners.updated.push(fn),
                removeListener: (fn) => {
                    const i = listeners.updated.indexOf(fn);
                    if (i !== -1) listeners.updated.splice(i, 1);
                },
            },
            onRemoved: { addListener: (fn) => listeners.removed.push(fn) },
        },

        scripting: {
            async executeScript({ func, args, files }) {
                calls.executeScript++;
                if (files) {
                    calls.files.push(...files);
                    return files.map(() => ({ frameId: 0, result: undefined }));
                }
                return [{ frameId: 0, result: await runInjected(func, args) }];
            },
            async registerContentScripts(scripts) {
                for (const s of scripts) registered.set(s.id, s);
            },
            async unregisterContentScripts({ ids }) {
                for (const id of ids) registered.delete(id);
            },
            async getRegisteredContentScripts({ ids } = {}) {
                return [...registered.values()].filter((s) => !ids || ids.includes(s.id));
            },
        },

        sidePanel: { async setPanelBehavior() {} },
        downloads: { async download() {} },
        webNavigation: { onCommitted: { addListener: () => {} } },
    };

    return {
        local,
        sess,
        registered,
        calls,
        listeners,
        /** Point the "active tab" somewhere else, or nowhere. */
        setTabs(next) {
            tabs = next;
        },
    };
}
