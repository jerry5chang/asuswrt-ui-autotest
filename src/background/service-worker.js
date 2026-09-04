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

async function snapshot({ full = false } = {}) {
    return {
        run: state.summary({ full }),
        settings: await getSettings(),
        selection: await getSelection(),
        suites: SUITES,
    };
}

/* --------------------------------------------------------------- routing */

const handlers = {
    async [MSG.GET_SNAPSHOT](msg) {
        return snapshot({ full: !!msg.full });
    },

    async [MSG.PROBE_ENV]() {
        const tab = await activeTab();
        if (!tab) return { ok: false, reason: 'no active tab' };
        if (!/^https?:/.test(tab.url || '')) {
            return { ok: false, reason: 'the active tab is not an http(s) page' };
        }
        const settings = await getSettings();
        const env = await probe(tab.id, settings);
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
