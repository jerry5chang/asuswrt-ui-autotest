/**
 * Service worker: message router and lifecycle owner.
 *
 * All the work lives in runner.js; this file only translates side-panel
 * messages into calls and keeps the run state honest across worker restarts.
 */

import { MSG, RUN } from '../lib/const.js';
import { SUITES } from '../suites/registry.js';
import * as state from './state.js';
import { getSettings, saveSettings, getSelection, saveSelection } from './store.js';
import { startRun, pauseRun, resumeRun, stopRun, probe, unregisterInstrument } from './runner.js';
import { loginAuthV2 } from './auth.js';

/* ------------------------------------------------------------- lifecycle */

chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

/**
 * A worker restart in the middle of a run kills the loop but not the state.
 * Surface that honestly as "paused" rather than pretending it is still going,
 * and clean up the instrumentation the dead run left registered.
 */
const ready = (async () => {
    await state.load();
    if (state.get().status === RUN.RUNNING || state.get().status === RUN.STOPPING) {
        state.patch({ status: RUN.PAUSED }, { flush: true });
        state.note('service worker restarted mid-run; the run was interrupted');
        await unregisterInstrument();
    }
})();

async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
}

/** A tab URL trimmed to something worth putting in an error message. */
function describeUrl(url) {
    if (!url) return 'a tab with no address';
    const scheme = /^([a-z-]+):/i.exec(url);
    if (scheme && scheme[1] !== 'http' && scheme[1] !== 'https') {
        // chrome://extensions, about:blank, file:// -- name the scheme, since
        // the rest of the URL adds nothing.
        return `a ${scheme[1]}: page`;
    }
    return url.length > 60 ? `${url.slice(0, 57)}...` : url;
}

async function snapshot({ full = false } = {}) {
    return {
        run: state.summary({ full }),
        settings: await getSettings(),
        selection: await getSelection(),
        suites: SUITES,
    };
}

/* --------------------------------------------------------------- routing */

export const handlers = {
    async [MSG.GET_SNAPSHOT](msg) {
        return snapshot({ full: !!msg.full });
    },

    async [MSG.PROBE_ENV]() {
        const tab = await activeTab();

        /**
         * Record the outcome even when probing never got started. The panel
         * renders the DUT card from run state, so a reason that is returned
         * but not stored is a reason nobody ever sees -- it just leaves the
         * generic "press Probe" hint sitting there.
         */
        const failed = (reason, extra = {}) => {
            const env = { ok: false, loggedIn: false, pages: [], langs: [], reason, ...extra };
            state.patch({ env });
            return env;
        };

        if (!tab) {
            return failed('no active tab — open the router UI in a tab, then press Probe');
        }
        if (!/^https?:/.test(tab.url || '')) {
            return failed(
                `the active tab is ${describeUrl(tab.url)}, not the router UI — switch to the ` +
                    'tab showing the router and press Probe again',
                { probedUrl: tab.url || '' }
            );
        }

        const settings = await getSettings();
        const env = { ...(await probe(tab.id, settings)), probedUrl: tab.url };
        state.patch({ env, tabId: tab.id, origin: env.origin || '' });
        return env;
    },

    async [MSG.SAVE_SETTINGS](msg) {
        if (msg.settings) await saveSettings(msg.settings);
        if (msg.selection) await saveSelection(msg.selection);
        return snapshot();
    },

    async [MSG.START_RUN](msg) {
        const current = state.get();
        if (current.status === RUN.RUNNING) return { ok: false, reason: 'a run is already in progress' };

        const tab = await activeTab();
        if (!tab) return { ok: false, reason: 'no active tab' };

        const settings = msg.settings ? await saveSettings(msg.settings) : await getSettings();
        const selection = msg.selection ? await saveSelection(msg.selection) : await getSelection();

        let env = current.env;
        if (!env || !env.ok || env.origin !== new URL(tab.url).origin) {
            env = await probe(tab.id, settings);
        }
        if (!env.ok) return { ok: false, reason: env.reason || 'could not read the DUT page inventory' };
        if (!(selection.suiteIds || []).length) return { ok: false, reason: 'no test items selected' };

        // Deliberately not awaited: the run outlives this message.
        startRun({ tabId: tab.id, selection, settings, env }).catch((e) => {
            state.note(`run failed: ${e.message}`);
        });
        return { ok: true };
    },

    async [MSG.PAUSE_RUN]() {
        pauseRun();
        return { ok: true };
    },

    async [MSG.RESUME_RUN]() {
        resumeRun();
        return { ok: true };
    },

    async [MSG.STOP_RUN]() {
        stopRun();
        return { ok: true };
    },

    async [MSG.CLEAR_RUN]() {
        stopRun();
        await unregisterInstrument();
        await state.reset();
        return snapshot();
    },

    async [MSG.EXPORT_REPORT]() {
        // The panel owns the download: it can make blob URLs, a worker cannot.
        return { run: state.summary({ full: true }) };
    },

    async [MSG.LOGIN](msg) {
        const tab = await activeTab();
        if (!tab) return { ok: false, reason: 'no active tab' };
        const settings = msg.settings ? await saveSettings(msg.settings) : await getSettings();
        return loginAuthV2(tab.id, settings.username, settings.password);
    },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const handler = handlers[msg && msg.type];
    if (!handler) return false;

    ready
        .then(() => handler(msg, sender))
        .then((result) => sendResponse(result))
        .catch((e) => sendResponse({ ok: false, reason: e.message || String(e) }));

    return true; // response is async
});

/** If the swept tab disappears, stop rather than throwing on every step. */
chrome.tabs.onRemoved.addListener((tabId) => {
    const run = state.get();
    if (run.tabId === tabId && (run.status === RUN.RUNNING || run.status === RUN.PAUSED)) {
        stopRun();
        state.note('the tab under test was closed; run stopped');
        unregisterInstrument();
    }
});
