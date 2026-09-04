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

/**
 * Every rule in force: the list shipped with the extension, plus whatever was
 * added on this machine. A union rather than an override, so updating the
 * extension always delivers its new rules -- a stored copy of the whole list
 * would shadow them permanently.
 */
export function activeIgnoreRules(settings = {}) {
    return [...(settings.knownIssues || []), ...(settings.ignoredExtra || [])].filter(
        // Unticking one in the panel disables it without losing it, so it can
        // be put back. Shipped rules carry no flag and are always on.
        (rule) => rule && rule.enabled !== false
    );
}

/** Is this event a known false alarm? */
export function knownIssue(settings, event) {
    return activeIgnoreRules(settings).some((k) => {
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

/** Rules from `settings` that would suppress this already-recorded row. */
export function rulesMatching(settings, row) {
    if (!row) return [];
    // Rows the run already suppressed carry the prefix; strip it to match.
    const message = String(row.message || '').replace(/^known issue: /, '');
    return activeIgnoreRules(settings).filter((rule) =>
        knownIssue({ knownIssues: [rule] }, { ...row, message })
    );
}

/**
 * Turn a reported row into a known-issue rule that will suppress it.
 *
 * `where` is the asset or file the finding points at, stripped of the origin
 * so the rule survives the DUT changing address; `match` is the message with
 * URLs removed, so it survives a port or host change too. Together they are
 * specific: the pair matches that finding and little else.
 *
 * @returns {{where: string, match: string}|null}
 */
export function ignoreRuleFor(row) {
    if (!row || !row.message) return null;

    const detail = row.detail || {};
    const source = detail.src || detail.file || row.href || '';
    // Everything after the origin, which is the part that identifies the file.
    const where = String(source).replace(/^[a-z]+:\/\/[^/]+\//i, '') || row.page || '';

    const match = row.message
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (!match) return null;
    return { where, match };
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
 * - An empty `src` is not a missing asset at all. Nothing is broken: the page
 *   just spends one wasted request fetching itself. Worth surfacing, not worth
 *   failing a build over.
 */
export function severityFor(event, mapping) {
    const detail = event.detail || {};
    if (event.kind === 'console' && detail.level === 'warn') return SEV.INFO;
    if (event.kind === 'resource' && (detail.emptySrc || detail.external)) return SEV.WARN;
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

/**
 * One row per test, not one per assertion.
 *
 * A page suite makes many assertions -- eaa.skip-link makes twelve -- and
 * emitting each as its own row meant a single item on 75 pages produced 899
 * "pass" rows, which drowned every other item and made the severity totals
 * impossible to read against the number of test items.
 *
 * So each suite invocation collapses to one row:
 *   all assertions passed  -> one pass row saying how many
 *   anything else          -> only the rows that were not passes, since the
 *                             passes alongside a failure are not the story
 *
 * The raw assertion count is returned separately, so the report can still say
 * "899 checks across 75 pages" without spending 899 rows on it.
 *
 * @param {Array<object>} rows results from one page's suites
 * @returns {{rows: Array<object>, checks: number}}
 */
export function collapseSuiteRows(rows) {
    /*
     * Only an actual problem suppresses the pass summary. Treating any
     * non-pass as a problem meant a suite that passed twelve checks and also
     * logged one diagnostic `info` reported the info alone -- so a working
     * suite looked like it had not run at all.
     */
    const PROBLEMS = new Set([SEV.ERROR, SEV.FAIL, SEV.WARN, SEV.BLOCKED]);

    const bySuite = new Map();
    for (const row of rows || []) {
        if (!bySuite.has(row.suite)) bySuite.set(row.suite, []);
        bySuite.get(row.suite).push(row);
    }

    const out = [];
    for (const [suite, group] of bySuite) {
        const problems = group.filter((r) => PROBLEMS.has(r.severity));
        const passes = group.filter((r) => r.severity === SEV.PASS);
        // info and skip are deliberate notes from the suite; they are kept
        // either way, because they say how something was verified.
        const notes = group.filter((r) => r.severity === SEV.INFO || r.severity === SEV.SKIP);

        if (!problems.length && passes.length) {
            out.push({
                suite,
                severity: SEV.PASS,
                message: `${passes.length} check${passes.length === 1 ? '' : 's'} passed`,
                detail: { checks: passes.map((r) => r.message) },
            });
        }

        for (const row of problems) {
            out.push(passes.length ? { ...row, detail: { ...(row.detail || {}), alsoPassed: passes.length } } : row);
        }
        out.push(...notes);
    }
    return { rows: out, checks: (rows || []).length };
}
