/** Persisted settings and test selection (chrome.storage.local). */

import { DEFAULT_SETTINGS } from '../lib/const.js';
import { DEFAULT_SUITE_IDS } from '../suites/registry.js';

const SETTINGS_KEY = 'settings';
const SELECTION_KEY = 'selection';

export const DEFAULT_SELECTION = {
    suiteIds: DEFAULT_SUITE_IDS,
    pages: null, // null == every page the probe found
    langs: [], // empty == whatever the DUT is set to right now
};

export async function getSettings() {
    const bag = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(bag[SETTINGS_KEY] || {}) };
}

export async function saveSettings(patch) {
    const next = { ...(await getSettings()), ...patch };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
}

export async function getSelection() {
    const bag = await chrome.storage.local.get(SELECTION_KEY);
    return { ...DEFAULT_SELECTION, ...(bag[SELECTION_KEY] || {}) };
}

export async function saveSelection(patch) {
    const next = { ...(await getSelection()), ...patch };
    await chrome.storage.local.set({ [SELECTION_KEY]: next });
    return next;
}
