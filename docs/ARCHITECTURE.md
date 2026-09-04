# Architecture

> The full standard -- UI rules, component details, implementation rules
> for test items and the pitfalls behind them -- is in
> [AGENT-HANDBOOK.md](AGENT-HANDBOOK.md). This file is the narrower view.


## The four worlds

```
┌─ side panel (extension page) ──────────────────────────────────┐
│  panel.js — selection UI, live progress, report + export       │
└──────────────────────── chrome.runtime.sendMessage ────────────┘
                                   │
┌─ service worker (module) ─────────▼────────────────────────────┐
│  service-worker.js  message router, lifecycle                  │
│  runner.js          the run loop                               │
│  driver-suites.js   HTTP-level test items                      │
│  state.js           run state -> chrome.storage.session        │
│  store.js           settings   -> chrome.storage.local         │
│  auth.js            auth v2                                    │
└──────────────────── chrome.scripting.executeScript ────────────┘
                                   │
┌─ page MAIN world (the router UI's own JS context) ─────────────┐
│  instrument.js  document_start hooks; buffers into __AUT__     │
│  runtime.js     the `t` context for page suites                │
│  suites/page/*  the page test items                            │
└────────────────────────────────────────────────────────────────┘
```

There is deliberately **no ISOLATED-world content script and no
`postMessage` bridge**. v2.x needed one because page scripts had no way to
reach the worker; v3.0 instead has the worker *pull* from the page:
instrumentation buffers into `window.__AUT__`, and the driver harvests it with
`executeScript` right before it navigates away. One direction, one mechanism,
no message protocol to keep in sync.

The manifest therefore declares no `content_scripts` and no
`web_accessible_resources` at all.

## Injection, and why it is timed the way it is

| Need | Mechanism |
|---|---|
| Read the DUT's menu once | one-shot `executeScript({world:'MAIN', func})` — the return value comes straight back |
| Catch errors thrown by the page's *first* script | `chrome.scripting.registerContentScripts({world:'MAIN', runAt:'document_start'})`, registered only while a run is active |
| Run a page suite after load | inject `runtime.js` + the suite files, then one `func` call that returns a promise of the results |

Registering the instrumentation dynamically, scoped to the DUT's origin, means
normal browsing is never touched: outside a run nothing is installed anywhere.

### Config with no unsafe window

`registerContentScripts` cannot carry arguments, so `instrument.js` starts with
**Safe Mode on** and a mutable `AUT.cfg` that the driver overwrites right after
load. Defaulting to safe means there is no interval during which a destructive
request could slip past — and nothing that matters happens at
`document_start` anyway, since risky calls only follow a click.

## The run loop

```
for each selected language
    switch preferred_lang (nvramSet) if needed
    verify the session  ── expired? auth v2 re-login, or stop
    driver suites
        core.reachability  → publishes shared.reach
        spec.feature-map   → Support / Not Support
        api.hook-sweep     → appGet.cgi hooks with no response
    for each selected page
        skip if shared.reach says 404 / unreachable
        navigate, wait for `complete`, push config, settle
        bounced to Main_Login.asp? re-login and retry, or stop
        run the page suites that apply to this URL
        drain the instrumentation buffers  ← always before navigating away
restore the original language
unregister the instrumentation
return to the configured page
```

Reachability runs **before** the page loop, in batches, rather than one `HEAD`
per page inline. That is both faster than v2.x and what lets the loop skip
pages that do not exist instead of navigating to them.

### Why probes run inside the page

The `asus_token` cookie carries no `SameSite` attribute, so Chrome treats it as
`Lax` and drops it from the extension-initiated (cross-site) request a service
worker makes. Unauthenticated, ASUSWRT answers **`200` plus 88 bytes of login
redirect for every path**, real or not — measured on 3.0.0.4.388_34021:

```
unauthenticated:  Advanced_LAN_Content.asp 200/88   Nope_Missing_Page.asp 200/88
authenticated:    Advanced_LAN_Content.asp 200/35663   Nope_Missing_Page.asp 404
```

So every probe goes through `probeUrls()` / `hookGet()` in
`background/page-eval.js`, which run in the page's MAIN world where the cookie
is same-origin and applies normally.

### Auth v2 spans two worlds on purpose

The network calls run in the page so `Set-Cookie` lands on the DUT origin
exactly as a real login would. The SHA-256 runs in the service worker, because
`http://<router-ip>` is not a secure context and therefore has no
`crypto.subtle`.

## State and worker restarts

Run state lives in a module variable and is mirrored into
`chrome.storage.session`, coalesced to one write every 1.5s.

A worker restart kills the loop but not the state. On startup the worker
notices a run still marked `running`, marks it `paused`, notes why, and
unregisters the instrumentation the dead run left behind — the honest outcome,
rather than v2.x's silent loss of everything.

## Result model

Every row is:

```js
{ suite, severity, message, detail, page, lang, href, ts }
```

`severity` ∈ `error | fail | warn | blocked | info | pass | skip`, ordered
worst-first everywhere (panel, cards, report sorting).

- `blocked` — Safe Mode held a risky call back. Not a defect; the tool working.
- `skip` — not applicable, or matched a known-issue entry. Kept in the report
  rather than dropped, so a suppression is visible instead of invisible.

Rows are de-duplicated on `lang | suite | page | severity | message`, which is
what stops one recurring UI log from filling the report.

## Report

`src/lib/report.js` is pure functions over the run summary, so the panel, the
self-test harness and any future CI step all build from the same code. The
panel does the downloading: a service worker has no `URL.createObjectURL`.

`buildTxt` deliberately reproduces the v2.x section layout
(`=== ERRORS ===`, `=== SPEC CHECK ===`, …) so a v3.0 run can be diffed against
an archived v2.x report.

## Known gaps

- **UI4 / webWrapper** is implemented (settings-iframe `Session`,
  `index.html?page=…` entries) but unverified — no UI4 DUT to hand. The
  reference DUT is UI3.
- ROG / TUF / BUSINESS menu trees are untested.
- The self-test harness stubs `chrome.*`; it covers the driver suites, the
  instrumentation logic, the page-suite runtime and the report builders, but
  not real MAIN-world injection or the side panel. See
  [TESTING.md](TESTING.md).
