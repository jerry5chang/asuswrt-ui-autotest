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

/** Plain-JSON deep equality; every setting is a JSON value. */
function sameAsDefault(key, value) {
    return JSON.stringify(value) === JSON.stringify(DEFAULT_SETTINGS[key]);
}

/**
 * Store only what differs from the defaults.
 *
 * This used to store the whole merged object, so the first time any setting
 * was written -- a theme toggle, a language change -- the defaults as they
 * stood at that moment were frozen into storage. Every later change to
 * DEFAULT_SETTINGS then failed to reach anyone who had ever touched a setting,
 * which is how a new known-issue entry could be added and still not apply.
 */
/**
 * Settings that only ever come from source. Storing one would shadow it, and
 * then shipping a new value could never reach anyone who had saved anything.
 * `knownIssues` is the curated ignore list; local additions go to
 * `ignoredExtra`, which is unioned with it rather than replacing it.
 * `specMap` is the feature-to-page mapping, maintained in development.
 */
const SHIPPED_ONLY = ['knownIssues', 'specMap'];

export async function saveSettings(patch) {
    const effective = { ...(await getSettings()), ...patch };

    const overrides = {};
    for (const [key, value] of Object.entries(effective)) {
        if (SHIPPED_ONLY.includes(key)) continue;
        if (!sameAsDefault(key, value)) overrides[key] = value;
    }

    await chrome.storage.local.set({ [SETTINGS_KEY]: overrides });
    return effective;
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
