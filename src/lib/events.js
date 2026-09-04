/**
 * Turning buffered page events into report rows.
 *
 * Kept out of the runner and free of chrome.* so the classification rules --
 * which is the part that decides whether someone sees a FAIL -- can be tested
 * directly.
 */

import { SEV } from './const.js';

/** kind -> which suite owns it, and its baseline severity. */
export const EVENT_MAP = {
    jsError: { suite: 'core.js-error', severity: SEV.ERROR },
    rejection: { suite: 'core.js-error', severity: SEV.ERROR },
    console: { suite: 'core.console-error', severity: SEV.WARN },
    resource: { suite: 'core.resource-error', severity: SEV.FAIL },
    uiLog: { suite: 'core.ui-log', severity: SEV.INFO },
    api: { suite: 'api.recorder', severity: SEV.WARN },
    apiBlocked: { suite: 'api.recorder', severity: SEV.BLOCKED },
};

/** Is this event a known false alarm? */
export function knownIssue(settings, event) {
    return (settings.knownIssues || []).some((k) => {
        if (!k.match) return false;
        const where = k.where;
        const whereOk =
            !where ||
            (event.href || '').includes(where) ||
            ((event.detail && event.detail.file) || '').includes(where) ||
            ((event.detail && event.detail.src) || '').includes(where);
        return whereOk && event.message.includes(k.match);
    });
}

/**
 * Severity for one event. Two cases have to differ from the baseline:
 *
 * - `console.warn` is not `console.error`.
 * - A sub-resource on **another origin** fails for reasons the firmware does
 *   not own: whether the tester's browser has internet, and what the third
 *   party chose to serve. A same-origin 404 is a firmware defect and stays a
 *   FAIL; a cross-origin one is a WARN, so the two do not sit in the report
 *   looking equally like a bug to fix.
 */
export function severityFor(event, mapping) {
    const detail = event.detail || {};
    if (event.kind === 'console' && detail.level === 'warn') return SEV.INFO;
    if (event.kind === 'resource' && detail.external) return SEV.WARN;
    return mapping.severity;
}

/**
 * @param {Array<object>} events  buffered by src/page/instrument.js
 * @param {{page: string, lang: string, settings: object, enabledChannels: Set<string>}} ctx
 * @returns {Array<object>} report rows
 */
export function mapEvents(events, { page, lang, settings, enabledChannels }) {
    const out = [];
    for (const event of events) {
        const mapping = EVENT_MAP[event.kind];
        if (!mapping) continue; // 'debug', and anything unrecognised
        if (!enabledChannels.has(mapping.suite)) continue;

        const known = knownIssue(settings, event);
        out.push({
            suite: mapping.suite,
            severity: known ? SEV.SKIP : severityFor(event, mapping),
            message: known ? `known issue: ${event.message}` : event.message,
            detail: event.detail,
            page,
            lang,
            href: event.href,
            ts: event.ts,
        });
    }
    return out;
}
