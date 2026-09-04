# Agent handbook

This is the document to read before changing anything in this extension. It is
written for another agent picking the work up cold: it states not just where
things are, but which rules are load-bearing, why each one exists, and what
went wrong the last time it was ignored.

Read it with `docs/ARCHITECTURE.md` (the shape of the system),
`docs/WRITING-TESTS.md` (the short version of adding a test item) and
`docs/TESTING.md` (what the harness does and does not cover). Where they
disagree with this file, this file is newer.

---

## 0. The loop you work in

Every change, without exception:

```bash
node tools/selftest.mjs        # 297 offline checks; must be 0 failed
bash tools/sync-windows.sh     # copy to the Chrome profile that loads it
git add -A && git commit        # one behavioural change per commit
```

There is no build step. The extension is the source tree; `tools/package.py`
only zips it for the Web Store.

The self-test is the contract. It runs with no browser and no DUT, in a couple
of seconds, and it is the reason this tool can be refactored at all. **A change
that cannot be checked offline needs a check that approximates it offline** --
usually a source-level assertion (see §16). Live checks against a real router
are additive: `node tools/selftest.mjs --dut http://192.168.8.1` runs ~225
more, but they are not a substitute, and the DUT is often unavailable (see the
one-login rule in §17).

### Ground rules that outrank your own judgement

1. **Reports must be comparable between people.** Two colleagues running the
   same version against the same firmware must produce the same findings. This
   is why the false-alarm filter list lives in source and cannot be edited in
   the panel, why "developer mode" only *surfaces* rules rather than applying
   them, and why nothing user-configurable is allowed to silence a finding.
2. **Never break the DUT.** Safe Mode is on by default and re-points risky
   `action_script` requests instead of dropping them (§11). A test that would
   reboot, reset or disconnect the router is written to assert what the UI
   *sent*, never what the router *did*.
3. **An unverified item must not produce a verdict.** Items that were written
   but never reached a trustworthy result are marked `draft` and are disabled
   everywhere (§8.3). "It probably works" is not a state this tool ships.
4. **Say what actually happened.** A swallowed error reads as a clean result,
   which is worse than a loud failure. Every `catch` either reports or logs
   (§13). Assertion messages name the evidence they rest on -- see the
   synthetic-keys wording in §12.
5. **Consistency is a feature of the UI, not a preference.** One way to fold a
   group, one way to centre a checkbox, one weight for an item boundary and one
   for a group boundary. Where two mechanisms exist for one job, delete one.

---

## 1. Repository map

```
manifest.json              MV3 manifest. version, permissions, side panel.
plan.md                    The original seven-stage plan and its acceptance criteria.
resource/icon*.png         Extension + panel icon (the panel reuses icon.png).

src/lib/                   Pure modules. No chrome.* -- importable by the harness.
  const.js                 SEV, MSG, RUN, RISKY_ACTIONS, PRESETS, DEFAULT_SETTINGS,
                           DEFAULT_KNOWN_ISSUES (the shipped filter list), DEFAULT_SPEC_MAP.
  i18n.js                  LOCALES, MESSAGES (zh-TW, zh-CN, en), t(), applyTo(), suiteText().
  events.js                EVENT_MAP, severityFor(), knownIssue(), ignoreRuleFor(),
                           mapEvents(), collapseSuiteRows().
  estimate.js              SEED, estimateRun(), formatDuration(), estimateRemaining().
  report.js                buildHtml/buildJson/buildMarkdown/buildTxt, suggestedRules(),
                           ruleSource(), runLogLines(), reportFilename().

src/suites/                What gets tested, declaratively.
  registry.js              SUITES (the single source of truth), pagesInScope(), appliesToPage().
  data/api-hooks.js        API_HOOKS + band derivation + app_call() key rules.
  page/*.js                One file per page suite; self-registers via __AUT__.suite().

src/page/                  Injected into the DUT's MAIN world.
  instrument.js            document_start hooks: JS errors, console, resources, httpApi.log,
                           the API recorder, Safe Mode, the tool-log buffer, AUT.drain().
  runtime.js               The `t` context, suite runner, synthetic keys, tool log.

src/background/            Service worker side.
  service-worker.js        Message handler map. Exported for the harness.
  runner.js                The run loop. The most important file in the repo.
  driver-suites.js         Driver-side items: reachability, SPEC map, appGet.cgi sweep.
  page-eval.js             Thin chrome.scripting wrappers; all page-world I/O.
  probe.js                 Page inventory from the router's own menu tree.
  auth.js                  Auth v2 login and isLoggedIn.
  input.js                 chrome.debugger key input (trusted events).
  state.js                 Run state, persistence, the run log.
  store.js                 Settings and selection persistence.
  timings.js               EMA collector for measured coefficients.

src/panel/                 The side panel: panel.html, panel.css, panel.js.

tools/
  selftest.mjs             The whole test suite. Offline by default, --dut adds live checks.
  chrome-stub.mjs          Minimal chrome.* for the harness.
  dut-session.mjs          Auth v2 session for live checks (Node fetch captured up front).
  package.py               Zip for the Web Store.
  sync-windows.sh          Copy the tree into the Windows Chrome profile.
```

### Import rules

- `src/lib/*` must stay free of `chrome.*`. The harness imports these directly;
  a stray `chrome` reference there breaks every offline check at once.
- `src/panel/*` and `src/background/*` may use `chrome.*`.
- `src/page/*` is **ES5-flavoured on purpose**: `var`, `function`, no
  optional chaining. It runs in the router's own page, whose other scripts are
  ancient, and it must not depend on the extension's module system. It is
  loaded as a plain script into the MAIN world, so it also cannot `import`.

---

## 2. The four worlds

Four execution contexts, and knowing which one you are writing for is most of
the job:

| World | Lives in | Can see | Cannot |
|---|---|---|---|
| **Side panel** | `src/panel/` | DOM of the panel, `chrome.runtime` | the DUT page; run state (it asks for it) |
| **Service worker** | `src/background/` | `chrome.*`, storage, debugger | the DUT's DOM or cookies-on-fetch |
| **Page MAIN world** | `src/page/`, `src/suites/page/` | the router's own JS, `httpApi`, real DOM | `chrome.*` |
| **Node harness** | `tools/` | `src/lib`, `src/suites`, stubs | anything real |

Two consequences that shape everything:

**There is no ISOLATED-world bridge and no `web_accessible_resources`.**
Instrumentation buffers into `window.__AUT__` in the MAIN world and the driver
*pulls* with `chrome.scripting.executeScript`. Nothing is pushed to the
extension by the page, so there is no listener to secure and no message shape
to version. If you find yourself wanting `postMessage`, add a field to
`AUT.drain()` instead.

**`asus_token` has no `SameSite` attribute.** Chrome treats it as `Lax` and
drops it from any fetch the service worker makes, so an extension-side probe is
unauthenticated -- and an unauthenticated ASUSWRT answers `200` with an 88-byte
login redirect *for every path*, including paths that do not exist. 404
detection is therefore impossible from the worker and **all HTTP probing must
happen in the page world** (`page-eval.js`). This is not a preference; it is the
reason `probeUrls()` exists.

---

## 3. Message protocol

`src/lib/const.js` → `MSG`. Panel → worker, all through
`chrome.runtime.sendMessage`:

| Message | Payload | Returns |
|---|---|---|
| `getSnapshot` | `{full?}` | `{run: summary(full)}` |
| `probeEnv` | – | `{ok, env, reason?}` |
| `saveSettings` | `{settings?, selection?}` | the merged snapshot |
| `startRun` | `{settings, selection}` | `{ok, reason?}` |
| `pauseRun` / `resumeRun` / `stopRun` | – | `{ok}` |
| `clearRun` | – | fresh run state |
| `exportReport` | – | `{run: summary({full: true})}` |

Worker → panel is one broadcast, `MSG.SNAPSHOT`, sent by `state.broadcast()`.
No panel open is the normal case, so the send is `.catch(() => {})`.

`service-worker.js` exports its handler map so the harness can call handlers
directly without a browser. **Add a handler to that map, never an ad-hoc
`onMessage` listener** -- the map is what the tests enumerate.

### Snapshot shape (`state.summary`)

The panel gets a *summary*, not the run. Results are the bulk of the payload,
so a live snapshot carries the tail (`results.slice(-200)`,
`apis.slice(-100)`, `notes.slice(-200)`) and the Report tab asks for
`{full: true}` explicitly. If you add an unbounded array to run state, add it
to `summary()` with the same treatment, or a long run will start dropping
snapshots on quota.

---

## 4. Run state

`src/background/state.js` owns one module-level `run` object, mirrored into
`chrome.storage.session` so a recycled service worker resumes rather than
losing the run -- the single biggest reliability problem in v2.x.

- `patch(fields, {flush})` — assign, persist (coalesced 1.5s), broadcast.
- `addResults(list)` / `addApis(list)` — append, persist, no broadcast (the
  caller batches and broadcasts once).
- `note(text)` / `noteAll(lines, prefix)` — the run log. §13.
- `summary({full})` — what the panel sees.
- `reset()` — a fresh idle run.

Rules:

- **Never mutate `state.get()` fields in place** except the deliberately live
  `timings` object (the collector mutates it so later persists carry
  accumulating figures for free).
- Persist writes are coalesced; a sweep produces hundreds of updates a second.
  Do not add a `flush: true` inside the page loop.
- Over-quota is handled: `persistNow()` catches and notes "state too large to
  persist; keeping it in memory only". Do not turn that into a throw.

---

## 5. The run loop, step by step

`src/background/runner.js` → `startRun({tabId, selection, settings, env})`.
Read it top to bottom before changing it; the ordering is load-bearing.

1. **Normalise the selection.** Draft suites are filtered out here, whatever
   the caller sent (§8.3).
2. **Decide the work.** `pages` from the selection (or all probed pages);
   `langs` (empty = the DUT's current language only); channels from which
   instrumentation items are ticked; `driverIds`; `wantsPages` (nothing that
   needs a loaded page means the page loop is skipped entirely);
   `pagesInScope()` narrows to pages a selected item actually acts on.
3. **Seed state and log the environment header** (§13.2), then
   `registerInstrument(origin)` — a `document_start`, MAIN-world, all-frames
   content script for `${origin}/*`.
4. **For each language pass:**
   a. switch the UI language via `httpApi.nvramSet` if it differs, then settle;
   b. **pre-flight** `isLoggedIn()` — one clear error beats a hundred
      identical ones once a session dies; auto re-login if configured;
   c. run the selected **driver suites** with a `ctx` (`tabId`, `lang`,
      `settings`, `pages`, `shared`, `aborted()`, `log()`);
   d. **for each page in scope:** skip if reachability already found it
      unreachable → navigate (`navigateAndWait`, resolves on `complete` or a
      timeout) → `configureInstrument` → settle → detect a bounce to
      `Main_Login.asp` (session death) → inject and run page suites (attaching
      `chrome.debugger` only if one of them declares `needsRealKeys`) → drain
      instrumentation → fold the page's tool log into the run log → one summary
      line → `cursor++`.
5. **Teardown:** restore the original UI language, `unregisterInstrument()`,
   merge measured timings, navigate back to `${origin}/`, mark the run done.

### Invariants

- `gate()` is awaited at every loop boundary: it blocks while paused and
  returns false when stopped. **Any new loop must call it**, or Stop will not
  work.
- `record(rows)` de-duplicates on `lang|suite|page|severity|message`. A sweep
  repeats the same UI-log line on every page; without this the report is
  unreadable. If a row *should* repeat per page, put the page in the message.
- Everything timed goes through `clock.time(key, units, fn)` so the estimate
  learns from the run (§14). Use the existing keys; a new key needs a `SEED`
  entry and a `cost.*` i18n label.
- The page loop pays *shared* costs once per page: navigate, settle,
  configure, drain. Adding a passive instrumentation item costs nothing; this
  is why the estimate model is shaped the way it is and why the panel says so.

---

## 6. Probing: how the page list is built

`src/background/probe.js` injects `probeFn` into the page and reads the
router's **own menu tree** (`menuList`/`tabList` from `js/state.js`), so the
page list matches what this model actually ships rather than a hardcoded list
that rots. It also reads `nvram`/`ui_support` for model, firmware, theme,
territory, language and the available language list.

- `BLOCK` holds pages that must never be swept (logout, reboot,
  firmware-upgrade endpoints). `index.asp` was once in it, which silently meant
  Network Map was never tested -- if you add an entry, say why in a comment.
- Probe failure must always write `state.patch({env})` with a reason. The panel
  renders from state, so an early `return {ok: false, reason}` that skips the
  patch shows the user nothing at all. `describeUrl()` names the scheme
  ("chrome:// pages cannot be probed") rather than echoing a raw URL.

---

## 7. Instrumentation (`src/page/instrument.js`)

Registered at `document_start` in the MAIN world of every frame, so it is in
place before the router's own scripts run. It never throws into the page: every
hook body is wrapped in `try/catch` whose comment says exactly that.

What it hooks, and the `kind` each event carries:

| kind | Source | Notes |
|---|---|---|
| `jsError` | `window.onerror`, `unhandledrejection` | resource failures arrive here too and are re-routed |
| `console` | `console.error`, `console.warn` | **never** `console.info` -- see below |
| `resource` | failed `img`/`script`/`link`/`iframe` | classifies `emptySrc` and `external` |
| `uiLog` | `httpApi.log` | wrapped the moment the page assigns `httpApi`, since `js/httpApi.js` has not run at `document_start` |
| `api` | `fetch`, `XHR`, form posts | the recorder; feeds Safe Mode and `t.expectApi` |

Buffers, all cleared by `AUT.drain()`: `AUT.events`, `AUT.apis`, `AUT.trace`
(the tool log, §13.3), `AUT.dropped` (events lost to `MAX_EVENTS`).

Rules:

- **The tool logs through `console.info`.** `console.error`/`warn` are hooked,
  so logging through them would feed our own capture and report the tool as a
  defect on the page.
- `AUT.cfg` starts with `safeMode: true` and the full risky list, *before* the
  driver pushes the real config. There must be no window between
  `document_start` and configuration in which a destructive request can slip
  through.
- Resource classification matters. `el.src` resolves an empty `src=""` to the
  *document* URL, so `<img src="">` used to be reported as "img failed to load:
  <the page itself>", identically on every page, and de-duplication collapsed
  several distinct elements into one row. Read `getAttribute('src')`, mark
  `emptySrc` in the detail, keep it a WARN, and name the element in the
  message.
- Timers are **not** touched. v2.x scaled every `setTimeout`/`setInterval` to
  finish sooner, which provokes exactly the races it then reports. The wrapper
  was deleted rather than defaulted to 1: do not reintroduce it.

### Safe Mode

When `AUT.cfg.safeMode` is on and an outgoing request carries a risky
`action_script`/`action_mode` (`RISKY_ACTIONS` in `const.js`, grouped
`destructive` / `disconnect`), the request is **re-pointed at
`/appGet.cgi?hook=uptime()`** rather than dropped, and recorded with
`{risk, blocked: true}`.

Re-pointing rather than dropping is deliberate: the page's success callback
still fires, so the click is exercised end to end -- validation, payload
assembly, the UI's own "applying…" flow -- while `rc_service` never sees it.
Dropping the request leaves the UI stuck in a state no user ever sees, and the
test then measures the tool's own interference.

---

## 8. The suite registry (`src/suites/registry.js`)

One entry per test item. This file is the single source of truth: the panel,
the runner, the estimate and the reports all read it.

```js
{
    id: 'eaa.client-dialog',     // stable; appears in reports and stored selections
    name: 'Client dialog keyboard',
    group: 'EAA',                // groups the panel renders, in registry order
    description: '...',          // one sentence, shown under the name
    where: 'driver' | 'page' | 'instrument',
    scope: 'run' | 'each-page' | 'pages',
    pages: ['index.asp'],        // required when scope === 'pages'
    file: 'src/suites/page/eaa-client-dialog.js',   // page suites only
    channel: 'api',              // instrument suites only
    timeoutMs: 30000,            // page suites; the batch allowance is derived from these
    needsRealKeys: true,         // attach chrome.debugger for pages this runs on
    cost: { shape: 'none' | 'perPage' | 'fixed', ms: 1200 },
    defaultOn: true,
    draft: true,                 // written, never verified: disabled everywhere
}
```

### 8.1 `where` decides who runs it

- `driver` — needs HTTP or tab control, not the DOM. Runs once per language
  pass, before the page loop, and may publish into `ctx.shared`. Registered in
  `background/driver-suites.js` → `DRIVER_RUN_SUITES`.
- `page` — needs the DOM. A file injected into the page, self-registering with
  `window.__AUT__.suite(id, fn)`. **The id in the file must match the id in the
  registry**, or the runner injects the file and then reports "suite not
  loaded" (there is a test for this).
- `instrument` — a passive channel that is already collecting; the entry only
  decides whether its events are *reported*. Cost `{shape: 'none'}`: ticking
  all five costs the same as ticking one.

### 8.2 `scope` decides where it runs

- `run` — once per language pass.
- `each-page` — on every page in scope.
- `pages` — only on the listed pages. `appliesToPage()` matches by pathname and
  query, and `pagesInScope()` is what stops "select one dialog item" from
  visiting all 76 pages to run one test on one of them.

### 8.3 `draft`: items that exist but do not vote

Four items are currently marked `draft`, with the evidence in the registry
comment: `pages.qis-wizard` (failed on a healthy DUT -- "no QIS panes found";
QIS_V3 does not lay its steps out as the suite expects), `pages.traffic-monitor`
(could only ever report "canvas pixels not readable"), `pages.vlan-switch`
(never ran: no probed model ships the page), `pages.apply-button` (never ran;
it is the worked example of the Safe Mode pattern).

Draft means, enforced in four places:

1. `RUNNABLE_SUITES` excludes them; the panel's counts and the "All" preset use
   that list.
2. The panel renders the row with a `尚未驗證` tag and a **disabled** checkbox,
   and removes the id from the selection.
3. A group whose items are all drafts has a disabled group checkbox and a
   `0/0` count.
4. `runner.js` filters drafts out of `selection.suiteIds` regardless of what
   arrives -- a stored selection from an older build cannot resurrect one.

Promoting an item is deleting its `draft: true`, after it has produced a
correct verdict against a real DUT. Demoting one is adding the flag plus a
comment saying what the DUT showed.

---

## 9. Writing a page suite

```js
/**
 * <id> -- one line on what this proves.
 *
 * Then the part that matters: why the obvious check is not enough, what the
 * page does that makes this hard, and how each way it can fail is
 * distinguished. Cite firmware source when the behaviour comes from it
 * (js/state.js, js/eaa-plugin.js, httpd/web.c).
 */
window.__AUT__.suite('group.item', async function (t) {
    if (!window.SomeFeature) return t.skip('this build has no <feature>');
    const el = await t.waitFor(() => t.$('#thing'), 5000);
    if (!el) return t.fail('#thing never appeared — <what that means>');
    t.check(condition, 'the sentence that is true when it passes', { detail });
});
```

### 9.1 The `t` context, in full

| Member | Behaviour |
|---|---|
| `t.id`, `t.page`, `t.doc` | suite id, `pathname+search`, `document` |
| `t.pass/info/warn/fail/skip(msg, detail?)` | record one row |
| `t.check(ok, msg, detail?)` | pass or fail on `ok`; **returns the boolean**, so it can guard |
| `t.$(sel, root?)`, `t.$$(sel, root?)` | `querySelector` / an array from `querySelectorAll` |
| `t.visible(el)` | offsetParent + rects + computed style. Not for elements clipped off-screen on purpose |
| `t.sleep(ms)`, `t.waitFor(fn, timeoutMs, stepMs?)` | `waitFor` resolves the first truthy value, or `null` on timeout |
| `t.click(target)` | a real `click()` plus the events the router's own handlers expect |
| `t.recordedApis()` | a copy of what the recorder has seen |
| `t.expectApi(matcher, timeoutMs)` | wait for a matching recorded call; matcher is a predicate or a partial shape |
| `t.safeMode()` | is Safe Mode on |
| `t.realKeys()` | are key presses trusted (debugger attached) |
| `t.pressKey(name, {shift, target, timeout})` | trusted press if available, else a synthetic event |

### 9.2 Style rules, all of them earned

- **One assertion per behaviour, phrased as the true statement.** "the skip
  link is the first element Tab reaches", not "check skip link". The message is
  what a colleague reads in a report without the code in front of them.
- **Distinguish the ways it can fail.** `t.skip` when the feature is absent
  from this build; `t.fail` when it is present and wrong; `t.warn` when the
  firmware may legitimately differ (`#ifdef`'d out); `t.info` for the mechanism
  a reader needs in order to judge the passes that follow.
- **Return early with `t.fail`/`t.skip` when the preconditions are not met.**
  Twelve cascading failures from one missing element is noise.
- **Wait, never assume.** The router's UI initialises on timers; jQuery Mobile
  stamps its classes late; the client list can be 15 s late. Use `t.waitFor`
  with a comment on why the timeout is what it is.
- **Put the evidence in `detail`.** Rects, ids, counts, the element you found
  instead. The HTML report renders details, and the JSON report keeps them.
- **Never assert on your own marker.** A suite once asserted
  `data-eaa-focus-trapped`, which the real dialog does not set -- it carries
  `data-eaa-skip-dialog="1"` and uses the page's own trap. Assert the
  *behaviour*, and report the mechanism as `info`.
- **Never mutate the DUT's settings.** Focus, scroll and clicks are fine (EAA
  items run last for that reason). Anything that writes nvram belongs behind
  Safe Mode with an assertion on what was sent.

### 9.3 Registering and costing it

Add the registry entry (§8), then measure: run it, read "各測項實測時間" in the
Report tab, and set `cost.ms` to roughly what you saw. It is only a seed --
`background/timings.js` replaces it with an EMA of real measurements -- but a
wildly wrong seed makes the first estimate a lie.

---

## 10. Writing a driver suite

```js
async function mySuite(ctx) {
    const results = [];
    for (const batch of chunk(items, BATCH)) {
        if (ctx.aborted()) break;                        // Stop must work
        const res = await hookGet(ctx.tabId, exprs, requestDeadline(ctx));
        if (!res || !res.ok) {
            ctx.log(`... failed after ${res?.ms ?? 0}ms — ${res?.error ?? res?.status}`);
            results.push({ suite: 'my.suite', page: 'appGet.cgi', severity: SEV.ERROR, message: '...' });
            continue;
        }
    }
    return results;
}
```

- `ctx` gives you `tabId`, `lang`, `settings`, `pages`, `shared`, `aborted()`
  and `log()`. Use `ctx.log()` for anything an operator debugging someone
  else's run would want (§13).
- **Batch, and give every request a deadline.** `requestDeadline(ctx)` follows
  the page-timeout setting. A request without one stalls the whole sweep behind
  the browser's own timeout with nothing in the log.
- **Publish shared data into `ctx.shared`** rather than recomputing.
  `reachability` fills `shared.reach`, which the runner uses to skip pages and
  the SPEC map reuses instead of re-probing.
- **One error per cause, not per victim.** A dead session fails every remaining
  appGet.cgi batch identically; the sweep says so once and stops.

### 10.1 appGet.cgi: the two rules that were learned the hard way

1. **`app_call()` keys the response `"<func>-<arg0>"`** when an argument is
   supplied (`httpd/web.c`, ~line 23106), and plain `"<func>"` otherwise --
   which is why the UI itself reads `hookGet("check_passwd_strength-wl_key")`.
   Each entry in `data/api-hooks.js` therefore carries its own `key`. Deriving
   it by stripping the argument reported a healthy hook as missing.
2. **"returned nothing" and "not built into this firmware" look identical.** An
   unregistered hook is simply absent from the response, so a missing key is a
   **WARN**, never a FAIL, and platform/band gating keeps the noise down:
   - `needs: 'broadcom'` for hooks that live in `httpd/sysdeps/web-broadcom.c`;
   - `needs: 'support:<key>'` for `get_ui_support()` gating;
   - the band is **derived** from the hook name (`channel_list_5g_2` → `5g_2`)
     and checked against `nvram_get("wlnband_list")` -- the authoritative radio
     list (`2g1&#605g1&#606g1`, separator HTML-escaped). `get_ui_support()`
     wrongly reports `"5G-2": 1` on a triband BT8, which is what made the
     sweep ask for a radio that does not exist.

---

## 11. Testing buttons without breaking the router

The pattern, of which `src/suites/page/apply-button.js` is the worked example:

1. `if (!t.safeMode()) return t.skip('Safe Mode is off; refusing to click ...')`
2. find the control, `t.click(it)`
3. `await t.expectApi(matcher, timeoutMs)` -- assert the UI **sent** the right
   request, with the right `action_mode`/`action_script`
4. if the recorded call was risky, assert it was `blocked` (intercepted)

Do not assert on router state afterwards. The request never reached
`rc_service`, by design.

---

## 12. Keyboard input: trusted vs synthetic

A page cannot make the browser move focus. `dispatchEvent` produces an
**untrusted** event: a `keydown` handler sees it, but Tab does not traverse,
Escape does not reach the browser's own handling, and nothing the user agent
would do in response happens. CDP's `Input.dispatchKeyEvent` produces a
**trusted** event, which the browser acts on.

So `src/background/input.js` attaches `chrome.debugger` and dispatches through
CDP, and `runtime.js` falls back to a synthetic event when it is not attached.

- Attachment is **per page, only for pages whose suites declare
  `needsRealKeys`**, and detached straight after: attaching puts a "being
  debugged" banner on the tab.
- A tab admits one debugger client, so attaching fails while DevTools is open
  on it. That is reported (`real key presses unavailable (…)`) and the suite
  falls back rather than failing.
- The driver is blocked awaiting the suites, so it cannot answer a key request
  inline. `startInputService()` polls `AUT.input.queue` alongside, presses the
  keys, and marks them done. This is why `pressKey` returns a promise that
  waits for `done`.
- **Synthetic events must set `key`, `keyCode` *and* `which`**, and shadow the
  legacy read-only accessors when the constructor drops them. The firmware's
  `state.js setDialogFocusTrap` switches on `e.keyCode`, so a synthetic event
  carrying only `key` fails on a perfectly working dialog.
- **Say which evidence a pass rests on.** With synthetic keys the dialog's own
  trap moves focus, so the wrap is genuinely verified -- but the browser never
  walked the cycle. Those assertions name that in their message ("the page's
  own trap saw the key; the browser did not"); with trusted keys the suite
  walks all N presses and records where focus actually landed.

`realKeys` is **not** a setting. It had one sensible value, the manifest
carries the `debugger` permission either way (so the install prompt is
identical), and the fallback handles the one case where attaching fails.

---

## 13. The run log

`state.note()` / `state.noteAll()`. This is the tool's own account of what it
did, it is shown newest-first in the panel, and it ships in **all four** report
formats via `report.runLogLines()`.

### 13.1 Rules

- **Local time, never UTC.** `stamp()` builds `[HH:MM:SS]` from `getHours()`
  and friends, deliberately without `Intl`. It used `toISOString()` once, which
  logged a 22:15 run as 14:15 -- worse than no stamp, because everything you
  correlate a log with (the DUT's syslog, a screen recording, your own memory)
  is local.
- The cap is 5000 lines; `notesDropped` counts what fell off the front and
  `runLogLines()` prefixes `… N earlier line(s) dropped`. A truncated log must
  say it is truncated.
- `noteAll(lines, prefix)` for many lines at once: one timestamp, one persist.

### 13.2 The environment header

Every run opens with six lines, written to be pasted into a chat window:

```
tool v3.0 · Chrome 141.0.7390.65 · Windows NT 10.0; Win64; x64
local time 2026-09-04 22:15:50 (UTC+08:00)
DUT http://192.168.8.1 · ZenWiFi_BT8 · 3.0.0.6_102_58407 · ui3 · territory US/01 · UI language TW
pages: 76 of 76 probed; languages: current
items: 13 selected
settings: safe mode on, settle 2000ms, page timeout 20000ms, auto re-login on, detailed log off
```

Debugging a run you were not present for starts with "what was this actually
running against?", and every one of those fields has been the answer at some
point. If you add a setting that changes timing or coverage, add it here.

### 13.3 What must be logged

Anything an operator elsewhere would need, in addition to the report row:

- request failures and **timeouts**, with how long they waited;
- navigation failures, with the timeout that expired;
- language-switch failures, including `nvramSet` never calling back;
- a driver suite throwing; page suites failing to inject or run;
- pages skipped because reachability could not reach them;
- a failed instrumentation harvest -- this was swallowed completely once, so a
  page whose events could not be collected read as a clean page;
- one summary line per page: elapsed, rows, events, API calls;
- with **詳細執行紀錄** (`verboseConsole`) on, every assertion, via the page-side
  `AUT.trace` buffer, prefixed with the page.

A bare `catch (e) {}` is acceptable only where the comment explains that there
is genuinely nothing to report (a tab that has already closed, an unregistered
content script). Otherwise: report a row, log a line, or both.

---

## 14. The estimate model

`src/lib/estimate.js`. The naive sum of per-item costs is wrong, because most
of a run's cost is *shared*.

- `SEED` holds per-key seeds measured on the reference DUT: `navigate`,
  `pageFixed`, `pageSuiteInjection`, `langSwitch`, `preflight`, `returnNav`.
- A suite's own cost comes from `cost.shape`: `none` (passive), `perPage`
  (multiplied by pages in scope) or `fixed` (once per pass).
- `background/timings.js` keeps an EMA (`ALPHA = 0.35`, with a sanity ceiling)
  of what this browser actually observed, keyed the same way, and measured
  values replace seeds. `measuredShare` drives the "≈" hint in the panel.
- `settle` is deliberately **not** measured: it comes from settings, so
  changing the setting must move the estimate immediately rather than waiting
  for new measurements.
- `estimateRemaining()` prefers the pace the run is actually keeping (after 3
  work items) over any a-priori model.

If you add a timed step, add a `SEED` key, a `cost.<key>` i18n label, and a
`clock.time()` call with the same key. The Report tab lists every key, so an
unlabelled one shows up as a raw string.

---

## 15. Reports and the filter list

`src/lib/report.js` builds four formats. **They must carry the same
information** -- the question "do the formats differ?" has been asked, and the
answer must stay "no, only the presentation". When you add a section, add it to
all four (there is a test that the run log appears in each).

| Format | Purpose |
|---|---|
| HTML | the one people read: filterable table, details, per-row filter rule |
| JSON | machine-readable, keeps `detail` and `suggestedIgnoreRules` |
| Markdown | pasteable into a ticket or chat |
| TXT | v2.x section layout, so two runs can be diffed directly |

### 15.1 The filter list workflow

`DEFAULT_KNOWN_ISSUES` in `src/lib/const.js` is the curated list of known false
alarms, **shipped in source and bound to the tool version**. The workflow is:

> receive a report → copy the finding → confirm it is a false alarm →
> maintain the list in source → the next release filters it for everyone

Consequences, all deliberate:

- The list is **not editable in the panel**. A stored copy would shadow the
  shipped one, and then a new rule could never reach anyone who had ever saved
  a setting. (`SHIPPED_ONLY` in `store.js` refuses to store it.)
- Every report prints ready-to-paste rules; `ruleSource()` is the single
  formatter, so what you copy from the panel is byte-identical to the exports.
- **開發者模式** (`devMode`, off by default) only *surfaces* those rules in the
  Report tab with a Copy button. It changes no report content, so a colleague
  who never ticks it sees the same findings.

The list is currently three entries; each carries a comment explaining why it
is a false alarm, and the third (`mobile.customize/customize.css`) is a
deliberate design: the file only ships with the business customisation package.

### 15.2 Row collapsing

`collapseSuiteRows()` turns one row per assertion into one row per suite, but
**only suppresses the pass summary when the suite emitted a real problem**
(`error`/`fail`/`warn`/`blocked`). It once treated `info` as a problem, which
hid every pass and made a working suite look like it had not run.

---

## 16. The self-test (`tools/selftest.mjs`)

One file, ~300 checks, offline by default. `check(label, ok, detail?)` prints
one line; `section(name)` groups them. Live checks are gated behind `--dut`.

What it can do without a browser:

- **Import `src/lib/*` and `src/suites/*` directly** -- these are pure modules.
- **Run page code in a sandbox.** `pageSandbox()` builds a fake `window`/
  `document`, and `loadIntoSandbox(ctx, file)` evaluates `instrument.js` and
  `runtime.js` into it. Suites can then be registered and run for real.
- **Fake the browser.** `tools/chrome-stub.mjs` provides `chrome.storage`,
  `chrome.scripting`, `chrome.debugger`, `chrome.tabs`, so `store.js`,
  `service-worker.js` handlers and `input.js` are exercised.
- **Assert on source text** where behaviour cannot be executed offline: CSS
  rules and tokens, `panel.html` ↔ dictionary key parity, the panel's disabling
  of drafts, the runner's draft filter, the log's local clock. These read as
  crude but they have caught real regressions, and they are the only way to
  keep a rule that lives in CSS or in markup.

### 16.1 Conventions

- **Every bug fix gets a check that would have caught it**, with a comment
  naming the symptom. Nearly every check in the file is there because something
  actually broke.
- The virtual clock: the sandbox's `setTimeout` runs sub-second delays
  immediately and honours ≥1000 ms ones. Ignoring *all* delays made the
  runtime's own 30 s guard fire on the next tick, so every suite "timed out".
- The stub's `failed()` helper must match `error` as well as `fail`, or an
  errored suite reads as passing.
- Mirror the firmware, not the spec: the dialog stub reads `e.keyCode`, because
  `state.js` does.
- CSS assertions must strip comments first (`replace(/\/\*[\s\S]*?\*\//g, '')`)
  -- two checks once matched their own explanatory prose. And capture-then-
  filter beats a lookahead: `border-radius:\s*(?!var\(--radius\))` backtracks
  and matches everything.

### 16.2 Live checks (`--dut http://192.168.8.1`)

`tools/dut-session.mjs` performs auth v2 and holds the session. It captures
`const nodeFetch = globalThis.fetch` **at module load**, because the harness
swaps `globalThis.fetch` for the session's own -- and the session's fetch
calling the global is infinite recursion ("Maximum call stack size exceeded").

---

## 17. The DUT, and what it will not let you do

Reference device: **ZenWiFi_BT8**, `http://192.168.8.1`, `admin` /
`asus#12345`, SSH on port **22222**, UI3, territory US/01, radios 2g/5g/6g.

- **It keeps one login at a time.** Signing in from Chrome kills the harness's
  session, and vice versa. A live run that reports "16 reachable" instead of
  "90" is almost always this, not a regression. Do not hit the DUT while
  someone is using its UI.
- **Auth v2 only.** `POST /get_Nonce.cgi {id}` → nonce; client makes a 32-char
  `cnonce`; `login_authorization = SHA256(user:nonce:pass:cnonce)`; `POST
  /login_v2.cgi`. The old `login.cgi` + Base64 flow **fails**. Source:
  `httpd/web.c do_login_v2_cgi()`, `httpd/web_hook.c validate_httpd_auth_v2()`.
- Firmware source is the tie-breaker for behaviour. Cite it in comments
  (`js/state.js`, `js/eaa-plugin.js`, `httpd/web.c:23106`).

### 17.1 Firmware facts worth knowing

- `#statusframe` defaults to `/device-map/router.asp`; `clients.asp` loads only
  when `#clientStatusLink` is activated, and the client list itself can be 15 s
  late. The EAA dialog suite activates the link, waits for
  `location.pathname` to become `clients.asp`, then waits again -- with
  distinct skip reasons for each way it can come up empty.
- `js/eaa-plugin.js addSkipToContentLink()` inserts the skip link as
  `document.body.firstChild` on every page (state.js `document.write`s the
  plugin in), clipped off-screen until focused.
- `#edit_client_block` carries `data-eaa-skip-dialog="1"` and uses the page's
  own focus trap rather than the plugin's.
- QIS_V3 is one document holding every step as a jQuery Mobile page
  (`div[data-role="page"]`) with one shown at a time, and it links
  `./mobile.customize/customize.css` unconditionally -- that directory only
  ships with the business customisation package, which is why the missing file
  is a shipped filter rule rather than a defect.

---

## 18. UI rules

The panel is the product's surface. These rules are not stylistic preferences;
each replaced something that was visibly wrong.

### 18.1 Layout: an app shell, never `position: sticky`

```
body            flex column, overflow: hidden      (never scrolls)
  .apphead      topbar + tabs + estimate bar       (fixed by structure)
  main          the only scrolling box             overflow-y: auto; min-height: 0
```

The header was `position: sticky` and **drifted a few pixels as scrolling
started**. It is now outside the scrolling box, so it cannot move. `main` needs
`min-height: 0` or the flex column overflows instead of scrolling. There are
four self-test checks holding this shape, including one that fails on any
`position: sticky` anywhere in the file.

### 18.2 Theming: three states, not two

An explicit choice stamps `data-theme="light"|"dark"` on the root; the default
"follow the system" stamps **nothing**, so there only
`prefers-color-scheme` separates light from dark. Therefore:

```css
:root { /* the complete light palette -- every token defined here */ }
@media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { /* dark overrides */ }
}
:root[data-theme="dark"] { /* the same overrides again */ }
```

The two dark blocks must define **exactly the same tokens** (a token in only
one applies in one state and not the other), and every dark token must exist in
the light palette first. Both are asserted. When adding a colour, add it in
three places or the test fails -- and watch the indentation: an eight-space
insert into the four-space block is how a duplicate token slipped in twice.

The toggle is `#themeToggle`, a `role="switch"` icon button whose SVG is a
half-filled circle (a circle outline plus a semicircle path); `aria-checked`
rotates it 180°. No box around it.

### 18.3 Tokens: nothing hardcoded

| Token group | Members | Rule |
|---|---|---|
| Type | `--fs-micro` 11 → `--fs-figure` 18, ~1.15 steps | **no literal `font-size: <n>px` anywhere** |
| Radius | `--radius: 2px` | **no literal `border-radius`** |
| Lines | `--line`, `--line-soft` | two weights, §18.5 |
| Colour | `--bg --panel --fg --mut --accent --accent-fg --go --go-fg` + one per severity | severity colours match the report |

Two self-test checks enforce the first two, and two more check that every type
token defined is used and every one used is defined -- so the scale cannot rot
in either direction.

### 18.4 Groups and subgroups

Two levels, one behaviour each, used identically by 測項, 頁面, 語言, 選項,
禁止使用的 rc service and the report sections:

- `<details class="group">` with a `<summary>` — the section. Its chevron comes
  from `summary::before` rotating on `[open]`; the native marker is hidden. A
  `<span class="badge">` in the summary carries the count.
- `.subgroup` — a group *inside* a section, with a `.grouphead` containing:
  1. `.gtoggle` — a chevron button that folds only (`aria-expanded`), sized
     against `--fs-group` so it reads as part of the heading;
  2. `.glabel` — a label wrapping the group checkbox and `.gname`;
  3. `.gcount` — `on/total`, monospace, pushed right with `margin-left: auto`.

  Folding and selecting are **separate controls**: one element that did both
  was a coin toss every time it was clicked. Folded state lives in
  `collapsedGroups` (settings), debounced 300 ms, so it survives reopening the
  panel. `設備` and `登入` are the only sections open on first load.

Group names are one type step above their items (`--fs-group` vs `--fs-body`),
which is why the old uppercase + letter-spacing was removed: size already does
the work.

Content inset: `.group > *:not(summary) { padding-left/right: 11px }` plus
`margin-bottom` on the last child. **Never use the two-value `padding`
shorthand there** -- it outranks children at specificity `0,1,1` and silently
zeroed the run log's vertical padding. A test rejects the shorthand.

### 18.5 Separators: two weights

```css
.subgroup > .check + .check { border-top: 1px solid var(--line-soft); }  /* item ↔ item */
.subgroup + .subgroup       { border-top: 1px solid var(--line); }       /* group ↔ group */
.group > .check + .check    { border-top: 1px solid var(--line-soft); }  /* ungrouped lists */
```

Rows carry padding rather than margin so the line lands at the row edge instead
of floating in a collapsed gap. One weight made a long checklist read as a
wall; none at all was worse. Both weights are asserted.

### 18.6 Checkboxes

One rule for the whole panel: **the box is centred against its own row**,
one-line or two (`.check, label.item { align-items: center }` and
`margin: 0; align-self: center` on the inputs). The gap between box and label
is 11 px -- 8 px read as touching.

A `.check` row is `<label class="check"><input type="checkbox"><span
class="grow"><span class="name">…</span><span class="desc">…</span></span></label>`.
`.desc` is `--fs-tiny` in `--mut` and describes what the item does, not how it
is implemented.

### 18.7 Buttons

| Class | Meaning |
|---|---|
| `.btn.go` | **Start** only — green (`--go`). The one button that begins something |
| `.btn.primary` | accent blue: Probe |
| `.btn.danger` | Stop |
| `.btn.ghost` | everything secondary; `.sm` / `.xs` for size |
| `.chip` | multi-select and export affordances; `.is-on`/`.solid` fills with accent |
| `.iconbtn` | icon-only, no border (theme toggle) |

Start, Pause/Resume, Stop and Clear must be **the same size and in the same
position**: the run controls replace each other, and a Start button that was
bigger than the three that replaced it made the UI jump. `.controls .btn`
carries that.

### 18.8 Progress

`#progressWrap` holds the bar plus the label **twice**: `.ptext.base` and
`.ptext.over`, the second clipped to the filled width. One colour cannot read
on both the filled and unfilled parts. The text is `狀態 — NN%` only; the
work-item fraction was removed as noise.

### 18.9 State visibility

- `data-when="probed"` hides everything unusable before a probe; `#emptyState`
  carries the onboarding steps, the failure reason and what was seen.
- `hidden` is toggled via `el.hidden`, never `style.display`.
- Empty lists render a `.empty` line saying so, never nothing.

### 18.10 Panel component inventory

| Element | Behaviour |
|---|---|
| `#dutLine` | model · firmware · theme. Wraps -- it must never ellipsise the firmware build |
| `#uiLocale` | panel language; writes `settings.locale` |
| `#btnProbe` / `#btnProbeBig` | re-read the inventory; disabled with a "probing…" label while running |
| `#estimateBar` | inside `.apphead`, so it is visible during setup *and* during a run; shows estimate, then remaining + elapsed |
| `#suiteTree` | rendered by `renderSuites()` from the registry; group checkbox + chevron per group |
| `#presets` | All / Smoke / API only / None. "All" means `RUNNABLE_SUITES` |
| `#pageList` | one `label.item` per page, with search, All/None, and `#pageScope` explaining how many are actually in scope |
| `#langChips` | one chip per available language + All/None; empty = the DUT's current language |
| `#riskyList` | the Safe Mode checklist, rendered as subgroups exactly like the test items |
| `#ruleGroup` | developer-mode only: `suggestedRules()` for the current run + Copy |
| `#liveResults` | newest-first result rows, with the current item folded into the same list |
| `#runLog` | the run log, **newest first** (`runLogLines(run).reverse()`) |
| `#timingRows` | measured cost per item and per shared step |
| `#apiRows` | recorded API calls, newest first, with held/risky/sent pills |

---

## 19. Localisation rules

`src/lib/i18n.js` holds one dictionary per locale. Chrome's own `_locales` +
`chrome.i18n` follows the *browser's* language and cannot be switched from
inside the extension, which is why the panel needs its own layer.

- `LOCALES` order is deliberate: **繁體中文, 简体中文, English**.
- `en` is authoritative: every key exists there, and a missing translation
  falls back to English rather than showing a key.
- Keys are namespaced by surface: `topbar.*`, `tab.*`, `dut.*`, `login.*`,
  `suites.*`, `pages.*`, `langs.*`, `opts.*`, `adv.*`, `run.*`, `report.*`,
  `cost.*`, `sev.*`, `group.*`, `suite.<id>.name|desc`, `api.*`, `estimate.*`.
- Markup carries `data-i18n`, `data-i18n-placeholder` or `data-i18n-title`, and
  `applyTo(root)` fills them. **Sentences stay whole** rather than being split
  around `<b>`/`<code>` -- a translator gets the whole clause and the panel
  needs no `innerHTML`.
- `{count}`-style placeholders are interpolated by `t(key, vars)`.
- Simplified is written as Simplified, not converted Traditional (there is a
  check for a few characters that would betray a conversion).

Four self-test checks make dictionary drift impossible: every locale covers
every `en` key, no locale has keys `en` lacks, every key referenced in
`panel.html` exists, and **no dictionary key is unused** (dynamic prefixes are
listed in the test as `DYNAMIC`). So removing a UI string means removing its
keys in all three locales in the same commit.

Labels name what the thing tests, not the acronym behind it: `group.SPEC` is
產品規格, `group.WebAPI` is API 檢測. Section headings are short -- 設備, 登入,
測項, 頁面, 語言, 選項, 禁止使用的 rc service.

---

## 20. Settings

`DEFAULT_SETTINGS` in `const.js` is the schema. `store.js` persists **only
deviations from it**:

```js
saveSettings(patch)  // merge, then store only keys that differ from the default
getSettings()        // { ...DEFAULT_SETTINGS, ...stored-keys-that-still-exist }
```

Three rules, each from a real failure:

1. **Store deviations, never the merged object.** Storing the whole object froze
   the then-current defaults on the first write, so every later change to
   `DEFAULT_SETTINGS` failed to reach anyone who had ever touched a setting --
   which is how a new filter rule could be shipped and still not apply.
2. **`SHIPPED_ONLY = ['knownIssues', 'specMap']` refuses to be stored at all.**
   A stored copy would shadow the shipped one permanently.
3. **Unknown keys are pruned on read.** Removing an option must actually remove
   its effect: dropping `realKeys` left a stored `false` behind, which kept
   trusted keys off with nothing in the UI to explain it.

Removing a setting is therefore a five-file change: `DEFAULT_SETTINGS`, the
field in `panel.html`, `SETTING_FIELDS` in `panel.js`, its i18n keys in all
three locales, and every reader (`runner.js`, `estimate.js`, `instrument.js`).
Grep for the key name and expect nothing left.

Current settings: `locale`, `theme`, `collapsedGroups`, `pageSettleMs`,
`pageTimeoutMs`, `safeMode`, `stopOnError`, `verboseConsole`, `devMode`,
`autoLogin`, `username`, `password`, `riskyActions`, plus the shipped-only
`knownIssues` and `specMap`.

Deliberately **not** settings: the timer multiplier (provokes the races it
reports), the page to return to after a run (the origin root is valid on every
model), `realKeys` (§12), and anything that would let one person's report
differ from another's.

---

## 21. Change recipes

### Add a page test item
1. `src/suites/page/<name>.js` — see §9; the registered id must match.
2. Registry entry — `where: 'page'`, a scope, a `cost`, `defaultOn`.
3. i18n: `suite.<id>.name` and `suite.<id>.desc` in all three locales.
4. Sandbox checks in `selftest.mjs`: a DOM fixture, the pass path, and one
   check per way it can legitimately skip.
5. Run it against the DUT; set `cost.ms` from what the Report tab measured.
6. If it never produced a trustworthy verdict, mark it `draft` with the
   evidence in a comment rather than shipping it on.

### Add an appGet.cgi hook
Append to `API_HOOKS` (a string, or `{name, arg, needs}`). The band is derived
from the name; add `needs` only for platform gating. Nothing else to touch.

### Add a UI section
`<details class="group" data-when="probed">` + a `data-i18n` summary + a badge,
render into a plain `<div>` (not a `.scroller` unless it genuinely needs its own
scroll), reuse `.subgroup`/`.grouphead` for any grouping, and add the folded
state to `collapsedGroups` handling if it groups.

### Add a report section
Add it to **all four** builders and extend the "carries the run log"-style test
so a format cannot silently drop it.

### Change a default
Edit `DEFAULT_SETTINGS`. Because only deviations are stored, existing users
pick it up -- unless they had changed that setting, which is correct.

### Ship a version
1. `node tools/selftest.mjs` (0 failed) and a manual smoke test in Chrome:
   `chrome://extensions` → reload → open the panel → probe → run a short sweep.
   The `debugger` permission prompt appears on reload.
2. Bump `manifest.json` version and the `v3.0` strings in `report.js` if the
   minor changes.
3. `python3 tools/package.py` → upload the zip to the Web Store (manual; needs
   the developer account).

---

## 22. Pitfalls ledger

Each of these cost real time. The self-test check that guards it is named where
one exists.

| Symptom | Cause | Guard |
|---|---|---|
| Every path returns 200/88 bytes; no 404s ever | `asus_token` is dropped from worker fetches (`SameSite` absent) | probing lives in the page world |
| `check_passwd_strength` reported missing on a healthy DUT | `app_call()` keys the response `func-arg0`; the argument had been stripped | each hook carries its own `key`; two checks |
| Half the `wl_*` hooks reported as defects | `#ifdef`'d hooks are indistinguishable from empty ones; `get_ui_support()` lies about `5G-2` | WARN not FAIL, plus `wlnband_list` band gating |
| `<img src="">` reported as "img failed to load: <the page>" | `el.src` resolves an empty src to the document URL | read `getAttribute`, mark `emptySrc` |
| A new filter rule shipped but did not apply | settings stored the whole merged object, freezing defaults | store deviations only; `SHIPPED_ONLY` |
| An option removed but its effect persisted | stored keys outlived the schema | prune unknown keys on read |
| A working suite looked like it never ran | `collapseSuiteRows` treated `info` as a problem | only error/fail/warn/blocked suppress passes |
| Run log 8 hours out | `toISOString()` is UTC | local-clock `stamp()`; source check |
| The header drifted while scrolling | `position: sticky` | app shell; "nothing relies on sticky" |
| Run log text flush against its own box | `.group > *:not(summary)` two-value `padding` outranked the child | horizontal-only inset; test rejects the shorthand |
| Every CSS radius check "failed" | `(?!var(--radius))` after `\s*` backtracks and matches at the space | capture the value, then filter |
| Two CSS checks matched nothing real | they matched their own explanatory comments | strip comments before matching |
| Tab/Escape assertions failed on a working dialog | synthetic events carried only `key`; `state.js` switches on `e.keyCode` | set `key`+`keyCode`+`which`, shadow the accessors |
| Focus-trap assertion failed on the real dialog | asserted our own marker; `#edit_client_block` uses the page's trap | assert behaviour, report mechanism as `info` |
| Client list never found | `#statusframe` defaults to `router.asp`; `clients.asp` needs `#clientStatusLink`, and can be 15 s late | activate, wait for pathname, wait again, distinct skips |
| Network Map never swept | `index.asp` was in the probe `BLOCK` list | removed; a dead duplicate blocklist deleted |
| Every suite "timed out" in the harness | the stub's `setTimeout` ignored all delays, so the 30 s guard fired next tick | scale only sub-second delays |
| An errored suite read as passing | the stub's `failed()` matched only `'fail'` | match `'error'` too |
| "Maximum call stack size exceeded" in live checks | the session's fetch called `globalThis.fetch`, which was the session's fetch | capture `nodeFetch` at module load |
| A live run reporting 16 pages instead of 90 | the DUT keeps one login at a time; someone was using the UI | not a bug; check before blaming the code |
| A page's events silently missing | a failed harvest was swallowed | it is logged (§13.3) |

---

## 23. Commit and review discipline

- **One behavioural change per commit.** Renames, CSS and logic in one commit
  make a bisect useless.
- Commit messages: an imperative summary line that says what changed *for the
  user*, then prose explaining **why**, including what was wrong before. Look
  at `git log` for the register; "fix bug" is not it.
- Never commit with a failing self-test. Never commit a `draft: true` removal
  without evidence from a real DUT.
- Before you finish, ask:
  1. `node tools/selftest.mjs` — 0 failed?
  2. Does a new rule (UI, log, report) have a check that would catch its
     regression?
  3. Did the change touch a string? All three locales, no orphan keys?
  4. Did it touch severity or filtering? Would two colleagues still get the
     same report?
  5. Did it add a `catch`? Does it report or log?
  6. Is anything now unused -- a token, a key, a CSS rule, a setting?

The working branch is `v3.0`; `main` is what the Web Store build comes from.
The intended finish is a squash merge:

```bash
git checkout main && git merge --squash v3.0 && git commit
git branch -f v3.0 main && git push origin main && git push -f origin v3.0
```
