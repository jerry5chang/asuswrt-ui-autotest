/**
 * Report builders. Pure functions over a run summary so the same code can be
 * used by the side panel (which does the downloading) and by tests.
 *
 * Four formats on purpose:
 *   html  a self-contained page to read or attach to a ticket
 *   json  machine-readable, for diffing two firmware builds in CI later
 *   md    for pasting into a PR or Confluence
 *   txt   the v2.x section layout, so old and new reports can be compared
 */

import { SEV, SEV_ORDER, SEV_LABEL } from './const.js';
import { SUITE_BY_ID } from '../suites/registry.js';
import { formatDuration } from './estimate.js';
import { ignoreRuleFor } from './events.js';

/** Shared costs, named for a reader rather than by collector key. */
const COST_LABELS = {
    navigate: 'Navigating to pages',
    pageFixed: 'Instrumenting and harvesting pages',
    pageSuiteInjection: 'Injecting page suites',
    settle: 'Waiting for pages to settle',
    langSwitch: 'Switching UI language',
    preflight: 'Session checks',
    returnNav: 'Returning to the start page',
};

/**
 * Where the run's time went, biggest first. The shared lines matter as much as
 * the per-item ones: navigating and settling is usually the bulk of a sweep,
 * which is why adding another passive check costs nothing.
 */
/**
 * The filter rule each finding would need, ready to paste into
 * DEFAULT_KNOWN_ISSUES.
 *
 * The workflow this serves: read the report, decide which findings are false
 * alarms, add those rules in source so the next release filters them for
 * everyone. Deriving the rule by hand means digging the asset path out of the
 * detail and guessing what to match on, so the report does it.
 *
 * Deduplicated, because one cause repeated across pages is one rule.
 */
export function suggestedRules(run) {
    const SUPPRESSIBLE = new Set([SEV.ERROR, SEV.FAIL, SEV.WARN]);
    const seen = new Map();

    for (const row of run.results || []) {
        if (!SUPPRESSIBLE.has(row.severity)) continue;
        const rule = ignoreRuleFor(row);
        if (!rule) continue;
        const key = `${rule.where}|${rule.match}`;
        if (!seen.has(key)) seen.set(key, { rule, severity: row.severity, pages: new Set() });
        seen.get(key).pages.add(row.page || '-');
    }

    return [...seen.values()].map((entry) => ({
        ...entry,
        pages: [...entry.pages],
    }));
}

/**
 * One pasteable DEFAULT_KNOWN_ISSUES entry. Every surface that offers these
 * rules -- the exports and the panel -- renders them from here, so what you
 * copy out of one is byte-identical to the others.
 */
export function ruleSource(rule) {
    return `{ where: '${rule.where}', match: '${String(rule.match).replace(/'/g, "\\'")}' },`;
}

/**
 * The run log, as lines, with the truncation stated rather than implied.
 * Every format prints this: it is where the tool says what it did, and with
 * verbose on it carries each suite's per-assertion trace.
 */
export function runLogLines(run) {
    const notes = run.notes || [];
    if (!notes.length) return [];
    const dropped = run.notesDropped || 0;
    return dropped ? [`… ${dropped} earlier line(s) dropped`, ...notes] : [...notes];
}

function timingRows(run) {
    const timings = run.timings || {};
    const rows = Object.entries(timings)
        .filter(([, v]) => v && v.ms > 0)
        .map(([key, v]) => ({
            label: key.startsWith('suite:') ? suiteName(key.slice(6)) : COST_LABELS[key] || key,
            item: key.startsWith('suite:'),
            ms: v.ms,
            n: v.n,
        }));

    // The settle sleep is a setting rather than something measured, so the
    // collector never sees it; without it the total is wildly short.
    const visits = (timings.navigate && timings.navigate.n) || 0;
    const settleMs = ((run.settings && run.settings.pageSettleMs) || 0) * visits;
    if (settleMs > 0) rows.push({ label: COST_LABELS.settle, item: false, ms: settleMs, n: visits });

    rows.sort((a, b) => b.ms - a.ms);
    const total = rows.reduce((sum, r) => sum + r.ms, 0);
    return { rows, total };
}

const pad = (n) => String(n).padStart(2, '0');

function stamp(ms = Date.now()) {
    const d = new Date(ms);
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(
        d.getMinutes()
    )}${pad(d.getSeconds())}`;
}

function durationText(run) {
    if (!run.startedAt) return 'n/a';
    const end = run.endedAt || Date.now();
    const secs = (end - run.startedAt) / 1000;
    if (secs < 90) return `${secs.toFixed(1)}s`;
    return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
}

function suiteName(id) {
    return (SUITE_BY_ID[id] && SUITE_BY_ID[id].name) || id;
}

export function reportFilename(run, ext) {
    const model = (run.env && run.env.model) || 'DUT';
    return `autotest_${model}_${stamp(run.startedAt || Date.now())}.${ext}`;
}

function counts(results) {
    const out = {};
    for (const r of results) out[r.severity] = (out[r.severity] || 0) + 1;
    return out;
}

function header(run) {
    const env = run.env || {};
    const c = counts(run.results || []);
    const graded = (c[SEV.PASS] || 0) + (c[SEV.FAIL] || 0) + (c[SEV.ERROR] || 0);
    return {
        model: env.model || '-',
        firmware: env.firmware || '-',
        theme: env.theme || '-',
        territory: env.territory || '-',
        origin: env.origin || '-',
        languages: (run.selection && run.selection.langs && run.selection.langs.length
            ? run.selection.langs
            : [env.lang || 'current']
        ).join(', '),
        suites: (run.selection && run.selection.suiteIds) || [],
        pageCount: run.total || 0,
        started: run.startedAt ? new Date(run.startedAt).toLocaleString('sv-SE') : '-',
        duration: durationText(run),
        counts: c,
        passRate: graded ? Math.round(((c[SEV.PASS] || 0) / graded) * 100) : null,
        verdict: c[SEV.ERROR] || c[SEV.FAIL] ? 'FAIL' : 'PASS',
        estimateMs: run.estimateMs || 0,
        // Rows are one per test; checks are the assertions behind them.
        checks: run.checks || 0,
        items: ((run.selection && run.selection.suiteIds) || []).length,
        rows: (run.results || []).length,
    };
}

/* ------------------------------------------------------------------ JSON */

export function buildJson(run) {
    return JSON.stringify(
        {
            tool: 'asuswrt-ui-autotest',
            version: '3.0',
            runId: run.runId,
            summary: header(run),
            env: run.env,
            selection: run.selection,
            settings: run.settings ? { ...run.settings, password: run.settings.password ? '***' : '' } : null,
            results: run.results,
            apis: run.apis,
            timings: run.timings || {},
            /* Paste the ones you judge false alarms into DEFAULT_KNOWN_ISSUES. */
            suggestedIgnoreRules: suggestedRules(run).map(({ rule, severity, pages }) => ({
                ...rule,
                wouldSuppress: { severity, pages },
            })),
            notes: runLogLines(run),
            notesDropped: run.notesDropped || 0,
        },
        null,
        2
    );
}

/* -------------------------------------------------------------- Markdown */

export function buildMarkdown(run) {
    const h = header(run);
    const lines = [
        `# ASUSWRT UI Autotest report`,
        '',
        `**${h.verdict}** — ${h.model} · ${h.firmware} · ${h.theme.toUpperCase()}`,
        '',
        '| | |',
        '|---|---|',
        `| Model | ${h.model} |`,
        `| Firmware | ${h.firmware} |`,
        `| Theme | ${h.theme} |`,
        `| Territory | ${h.territory} |`,
        `| Origin | ${h.origin} |`,
        `| Languages | ${h.languages} |`,
        `| Work items | ${h.pageCount} |`,
        `| Test items | ${h.items} |`,
        `| Result rows | ${h.rows}${h.checks ? ` (from ${h.checks} assertions)` : ''} |`,
        `| Started | ${h.started} |`,
        `| Duration | ${h.duration} |`,
        `| Pass rate | ${h.passRate === null ? 'n/a' : h.passRate + '%'} |`,
        '',
        '## Summary',
        '',
        '| Severity | Count |',
        '|---|---:|',
        ...SEV_ORDER.filter((s) => h.counts[s]).map((s) => `| ${SEV_LABEL[s]} | ${h.counts[s]} |`),
        '',
    ];

    for (const sev of SEV_ORDER) {
        const rows = (run.results || []).filter((r) => r.severity === sev);
        if (!rows.length) continue;
        lines.push(`## ${SEV_LABEL[sev]} (${rows.length})`, '');
        lines.push('| Suite | Page | Lang | Message |', '|---|---|---|---|');
        for (const r of rows) {
            lines.push(
                `| ${suiteName(r.suite)} | ${r.page || '-'} | ${r.lang || '-'} | ${String(r.message).replace(/\|/g, '\\|')} |`
            );
        }
        lines.push('');
    }

    const suggested = suggestedRules(run);
    if (suggested.length) {
        lines.push(
            `## Filter rules for these findings (${suggested.length})`,
            '',
            'Paste the ones you judge false alarms into `DEFAULT_KNOWN_ISSUES`',
            'in `src/lib/const.js`; the next release filters them for everyone.',
            '',
            '```js',
            ...suggested.map(
                ({ rule, pages }) =>
                    `    ${ruleSource(rule)}  // ${pages.length} page(s): ${pages.slice(0, 3).join(', ')}`
            ),
            '```',
            ''
        );
    }

    const timing = timingRows(run);
    if (timing.rows.length) {
        lines.push(`## Where the time went (${formatDuration(timing.total)})`, '');
        lines.push('| | Cost | Share | Each | Count |', '|---|---|---:|---:|---:|');
        for (const row of timing.rows) {
            lines.push(
                `| ${row.item ? 'item' : 'shared'} | ${row.label} | ` +
                    `${Math.round((row.ms / timing.total) * 100)}% | ` +
                    `${Math.round(row.ms / Math.max(row.n, 1))} ms | ${row.n} |`
            );
        }
        lines.push('');
    }

    if ((run.apis || []).length) {
        lines.push(`## Recorded API calls (${run.apis.length})`, '');
        lines.push('| Page | Via | Path | action_script | Intercepted |', '|---|---|---|---|---|');
        for (const a of run.apis) {
            lines.push(
                `| ${a.page || '-'} | ${a.via} | ${a.path} | ${a.params?.action_script || '-'} | ${a.blocked ? 'yes' : ''} |`
            );
        }
        lines.push('');
    }

    const log = runLogLines(run);
    if (log.length) {
        lines.push(`## Run log (${log.length} lines)`, '', '```', ...log, '```', '');
    }

    return lines.join('\n');
}

/* ------------------------------------------------------------------- TXT
 * Same sections as the v2.x report so two runs can be diffed directly.
 */

export function buildTxt(run) {
    const h = header(run);
    const results = run.results || [];
    const pick = (fn) => results.filter(fn).map((r) => `[${r.lang || '-'}] ${r.page || '-'}: ${r.message}`);

    const sections = [
        ['ERRORS', pick((r) => (r.severity === SEV.ERROR || r.severity === SEV.FAIL) && r.suite !== 'core.reachability' && !r.suite.startsWith('api.'))],
        ['SPEC CHECK', pick((r) => r.suite === 'spec.feature-map').map((s) => s.replace(/^\[[^\]]*\]\s*/, ''))],
        ['WEBAPI TESTING', pick((r) => r.suite.startsWith('api.') && r.severity !== SEV.PASS)],
        ['NOT FOUND', pick((r) => r.suite === 'core.reachability' && (r.severity === SEV.FAIL || r.severity === SEV.ERROR))],
        ['WARNINGS', pick((r) => r.severity === SEV.WARN)],
        ['PASS', pick((r) => r.severity === SEV.PASS)],
        ['UI LOG', pick((r) => r.suite === 'core.ui-log')],
        ['KNOWN ISSUES / SKIPPED', pick((r) => r.severity === SEV.SKIP)],
    ];

    const out = [
        `ASUSWRT UI Autotest v3.0 — ${h.verdict}`,
        `Model Name: ${h.model}`,
        `Model Version: ${h.firmware}`,
        `Theme: ${h.theme}    Territory: ${h.territory}`,
        `Origin: ${h.origin}`,
        `Languages: ${h.languages}`,
        `Work items: ${h.pageCount}`,
        `Test items: ${h.items}`,
        `Result rows: ${h.rows}${h.checks ? ` (from ${h.checks} assertions)` : ''}`,
        `Started: ${h.started}`,
        `Test Duration: ${h.duration}${h.estimateMs ? ` (estimated ${formatDuration(h.estimateMs)})` : ''}`,
        `Pass rate: ${h.passRate === null ? 'n/a' : h.passRate + '%'}`,
        '',
        'Counts: ' + SEV_ORDER.filter((s) => h.counts[s]).map((s) => `${SEV_LABEL[s]}=${h.counts[s]}`).join('  '),
    ];

    for (const [title, rows] of sections) {
        out.push('', `=== ${title} (${rows.length}) ===`, ...rows);
    }

    const suggested = suggestedRules(run);
    if (suggested.length) {
        out.push('', `=== FILTER RULES FOR THESE FINDINGS (${suggested.length}) ===`);
        out.push('Paste the false alarms into DEFAULT_KNOWN_ISSUES in src/lib/const.js.');
        for (const { rule, pages } of suggested) {
            out.push(`    ${ruleSource(rule)}  // ${pages.length} page(s)`);
        }
    }

    const timing = timingRows(run);
    if (timing.rows.length) {
        out.push('', `=== WHERE THE TIME WENT (${formatDuration(timing.total)}) ===`);
        for (const row of timing.rows) {
            out.push(
                `[${row.item ? 'item  ' : 'shared'}] ${String(Math.round((row.ms / timing.total) * 100)).padStart(3)}%  ` +
                    `${formatDuration(row.ms).padEnd(8)} ${String(Math.round(row.ms / Math.max(row.n, 1))).padStart(6)} ms x ${row.n}  ${row.label}`
            );
        }
    }

    const risky = (run.apis || []).filter((a) => a.risk);
    out.push('', `=== RISKY API CALLS (${risky.length}) ===`);
    for (const a of risky) {
        out.push(`[${a.blocked ? 'INTERCEPTED' : 'SENT'}] ${a.page} ${a.via} ${a.path} -> ${a.risk}`);
    }

    const log = runLogLines(run);
    if (log.length) {
        out.push('', `=== RUN LOG (${log.length} lines) ===`, ...log);
    }

    return out.join('\n');
}

/* ------------------------------------------------------------------ HTML */

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function buildHtml(run) {
    const h = header(run);
    const results = run.results || [];
    const suites = [...new Set(results.map((r) => r.suite))].sort();
    const pages = [...new Set(results.map((r) => r.page).filter(Boolean))].sort();

    const rows = results
        .slice()
        .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))
        .map(
            (r) => `<tr data-sev="${r.severity}" data-suite="${esc(r.suite)}" data-page="${esc(r.page || '')}">
      <td><span class="pill ${r.severity}">${SEV_LABEL[r.severity] || r.severity}</span></td>
      <td>${esc(suiteName(r.suite))}</td>
      <td class="mono">${esc(r.page || '-')}</td>
      <td>${esc(r.lang || '-')}</td>
      <td>${esc(r.message)}${
                (() => {
                    const rule = [SEV.ERROR, SEV.FAIL, SEV.WARN].includes(r.severity)
                        ? ignoreRuleFor(r)
                        : null;
                    const parts = [];
                    if (rule) {
                        parts.push(
                            `<div class="rule">filter rule: <code>{ where: '${esc(rule.where)}', ` +
                                `match: '${esc(rule.match)}' }</code></div>`
                        );
                    }
                    if (r.detail) {
                        parts.push(
                            `<details><summary>detail</summary><pre>${esc(
                                JSON.stringify(r.detail, null, 2)
                            )}</pre></details>`
                        );
                    }
                    return parts.join('');
                })()
            }</td>
    </tr>`
        )
        .join('\n');

    const apiRows = (run.apis || [])
        .map(
            (a) => `<tr class="${a.blocked ? 'blocked-row' : a.risk ? 'risk-row' : ''}">
      <td class="mono">${esc(a.page || '-')}</td><td>${esc(a.via)}</td>
      <td class="mono">${esc(a.path)}</td><td>${esc(a.params?.action_mode || '-')}</td>
      <td>${esc(a.params?.action_script || '-')}</td>
      <td>${a.blocked ? 'intercepted' : a.risk ? 'SENT (risky)' : ''}</td>
    </tr>`
        )
        .join('\n');

    const summaryCards = SEV_ORDER.filter((s) => h.counts[s])
        .map((s) => `<div class="card ${s}"><b>${h.counts[s]}</b><span>${SEV_LABEL[s]}</span></div>`)
        .join('');

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Autotest ${esc(h.model)} ${esc(h.firmware)}</title>
<style>
:root{--bg:#f7f8fa;--fg:#1b1f24;--mut:#5b6470;--line:#dfe3e8;--panel:#fff;
--error:#c0233b;--fail:#d9480f;--warn:#a37500;--blocked:#6741d9;--info:#1565c0;--pass:#177245;--skip:#6b7280;}
@media (prefers-color-scheme:dark){:root{--bg:#14171a;--fg:#e6e9ec;--mut:#9aa4b0;--line:#2b3138;--panel:#1b1f24;
--error:#ff7085;--fail:#ffa06b;--warn:#ffd166;--blocked:#b197fc;--info:#74c0fc;--pass:#63d297;--skip:#9aa4b0;}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:28px 20px 64px}
h1{font-size:22px;margin:0 0 4px}
.verdict{display:inline-block;padding:3px 12px;border-radius:999px;font-weight:700;letter-spacing:.04em;font-size:12px;
background:${h.verdict === 'PASS' ? 'var(--pass)' : 'var(--error)'};color:#fff;vertical-align:3px;margin-left:8px}
.sub{color:var(--mut);margin:0 0 22px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:0 0 22px}
.meta{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 13px}
.meta span{display:block;color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.meta b{font-weight:600;word-break:break-word}
.cards{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 22px}
.card{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:8px;
padding:9px 16px;min-width:96px}
.card b{display:block;font-size:20px;line-height:1.2}
.card span{color:var(--mut);font-size:12px}
.card.error{border-left-color:var(--error)}.card.fail{border-left-color:var(--fail)}
.card.warn{border-left-color:var(--warn)}.card.blocked{border-left-color:var(--blocked)}
.card.info{border-left-color:var(--info)}.card.pass{border-left-color:var(--pass)}
.card.skip{border-left-color:var(--skip)}
h2{font-size:15px;margin:30px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}
select,input[type=search]{font:inherit;padding:5px 8px;border:1px solid var(--line);border-radius:6px;
background:var(--panel);color:var(--fg)}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
table{border-collapse:collapse;width:100%;min-width:760px}
th,td{text-align:left;padding:8px 11px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);position:sticky;top:0;background:var(--panel)}
tr:last-child td{border-bottom:0}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;
border:1px solid currentColor}
.pill.error{color:var(--error)}.pill.fail{color:var(--fail)}.pill.warn{color:var(--warn)}
.pill.blocked{color:var(--blocked)}.pill.info{color:var(--info)}.pill.pass{color:var(--pass)}
.pill.skip{color:var(--skip)}
details summary{cursor:pointer;color:var(--mut);font-size:12px}
pre{white-space:pre-wrap;word-break:break-word;background:var(--bg);padding:8px;border-radius:6px;font-size:12px;margin:6px 0 0}
.blocked-row td{background:color-mix(in srgb,var(--blocked) 9%,transparent)}
.risk-row td{background:color-mix(in srgb,var(--fail) 9%,transparent)}
.empty{color:var(--mut);padding:14px}
footer{color:var(--mut);font-size:12px;margin-top:34px}
</style></head><body><div class="wrap">

<h1>ASUSWRT UI Autotest<span class="verdict">${h.verdict}</span></h1>
<p class="sub">${esc(h.model)} · ${esc(h.firmware)} · ${esc(h.theme.toUpperCase())} · ${esc(h.started)}</p>

<div class="grid">
  <div class="meta"><span>Model</span><b>${esc(h.model)}</b></div>
  <div class="meta"><span>Firmware</span><b>${esc(h.firmware)}</b></div>
  <div class="meta"><span>Theme / Territory</span><b>${esc(h.theme)} / ${esc(h.territory)}</b></div>
  <div class="meta"><span>Origin</span><b>${esc(h.origin)}</b></div>
  <div class="meta"><span>Languages</span><b>${esc(h.languages)}</b></div>
  <div class="meta"><span>Work items</span><b>${h.pageCount}</b></div>
  <div class="meta"><span>Test items</span><b>${h.items}</b></div>
  <div class="meta"><span>Result rows</span><b>${h.rows}${h.checks ? ` / ${h.checks} checks` : ''}</b></div>
  <div class="meta"><span>Duration</span><b>${esc(h.duration)}</b></div>
  <div class="meta"><span>Pass rate</span><b>${h.passRate === null ? 'n/a' : h.passRate + '%'}</b></div>
</div>

<div class="cards">${summaryCards || '<div class="empty">No results.</div>'}</div>

<h2>Results (${results.length})</h2>
<div class="filters">
  <select id="fsev"><option value="">All severities</option>${SEV_ORDER.filter((s) => h.counts[s])
      .map((s) => `<option value="${s}">${SEV_LABEL[s]}</option>`)
      .join('')}</select>
  <select id="fsuite"><option value="">All suites</option>${suites
      .map((s) => `<option value="${esc(s)}">${esc(suiteName(s))}</option>`)
      .join('')}</select>
  <select id="fpage"><option value="">All pages</option>${pages
      .map((p) => `<option value="${esc(p)}">${esc(p)}</option>`)
      .join('')}</select>
  <input type="search" id="fq" placeholder="Filter message…">
  <span id="fcount" class="mono"></span>
</div>
<div class="tablewrap"><table id="rt">
<thead><tr><th>Severity</th><th>Suite</th><th>Page</th><th>Lang</th><th>Message</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5" class="empty">No results.</td></tr>'}</tbody>
</table></div>

${(() => {
    const timing = timingRows(run);
    if (!timing.rows.length) return '';
    return `<h2>Where the time went (${esc(formatDuration(timing.total))})</h2>
<div class="tablewrap"><table>
<thead><tr><th></th><th>Cost</th><th>Share</th><th>Each</th><th>Count</th></tr></thead>
<tbody>${timing.rows
        .map(
            (row) => `<tr><td><span class="pill ${row.item ? 'info' : 'skip'}">${row.item ? 'item' : 'shared'}</span></td>
      <td>${esc(row.label)}</td><td class="num">${Math.round((row.ms / timing.total) * 100)}%</td>
      <td class="num">${Math.round(row.ms / Math.max(row.n, 1))} ms</td><td class="num">${row.n}</td></tr>`
        )
        .join('\n')}</tbody>
</table></div>`;
})()}

<h2>Recorded API calls (${(run.apis || []).length})</h2>
<div class="tablewrap"><table>
<thead><tr><th>Page</th><th>Via</th><th>Path</th><th>action_mode</th><th>action_script</th><th>Safe Mode</th></tr></thead>
<tbody>${apiRows || '<tr><td colspan="6" class="empty">Nothing recorded.</td></tr>'}</tbody>
</table></div>

${
    runLogLines(run).length
        ? `<h2>Run log</h2><div class="tablewrap"><pre>${esc(runLogLines(run).join('\n'))}</pre></div>`
        : ''
}

<footer>Generated by ASUSWRT UI Autotest v3.0 · ${esc(new Date().toLocaleString('sv-SE'))}</footer>
</div>
<script>
(function(){
  var rows=[].slice.call(document.querySelectorAll('#rt tbody tr'));
  var sev=document.getElementById('fsev'),su=document.getElementById('fsuite'),
      pg=document.getElementById('fpage'),q=document.getElementById('fq'),
      out=document.getElementById('fcount');
  function apply(){
    var n=0, needle=q.value.toLowerCase();
    rows.forEach(function(tr){
      var ok=(!sev.value||tr.dataset.sev===sev.value)
           &&(!su.value||tr.dataset.suite===su.value)
           &&(!pg.value||tr.dataset.page===pg.value)
           &&(!needle||tr.textContent.toLowerCase().indexOf(needle)!==-1);
      tr.hidden=!ok; if(ok)n++;
    });
    out.textContent=n+' / '+rows.length;
  }
  [sev,su,pg].forEach(function(el){el.addEventListener('change',apply)});
  q.addEventListener('input',apply); apply();
})();
</script>
</body></html>`;
}

export const BUILDERS = {
    html: { build: buildHtml, mime: 'text/html', ext: 'html' },
    json: { build: buildJson, mime: 'application/json', ext: 'json' },
    md: { build: buildMarkdown, mime: 'text/markdown', ext: 'md' },
    txt: { build: buildTxt, mime: 'text/plain', ext: 'txt' },
};
