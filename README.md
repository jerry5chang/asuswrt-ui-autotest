# ASUSWRT UI Autotest

A Chrome extension that sweeps every page of an ASUSWRT router Web UI, runs a
set of **selectable** test items against each one, and exports a structured
report.

Version 3.0 is a rewrite. It keeps everything v2.x did and adds test-item
selection, a side panel that survives navigation, an extensible suite registry,
four report formats, and an API-interception layer that makes it safe to click
buttons that would otherwise reboot the DUT.

---

## Documentation

| Document | What it covers |
|---|---|
| [docs/AGENT-HANDBOOK.md](docs/AGENT-HANDBOOK.md) | **Start here to change anything.** Architecture, UI rules, the implementation standard for test items, and every pitfall already hit |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The four worlds, the run loop, the result model |
| [docs/WRITING-TESTS.md](docs/WRITING-TESTS.md) | The short version of adding a test item |
| [docs/TESTING.md](docs/TESTING.md) | What the self-test covers, and what it does not |

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → pick this directory
3. Open the router UI in a tab and log in
4. Click the extension icon — it opens in the **side panel**

Chrome 114 or newer (`sidePanel` API; MAIN-world content scripts need 111).

## Use

| Tab | What you do there |
|---|---|
| **Setup** | Press **Probe** to read the DUT's page inventory, then tick the test items, pages and languages you want |
| **Run** | Start / Pause / Stop, watch progress and results stream in |
| **Report** | Filter the results, then export HTML / JSON / Markdown / TXT |

**Probe** reads `Session.get("menuList.<lang>")` — the same menu tree the UI
builds for its own navigation — so the page list always matches the DUT's real
feature set rather than a hard-coded list.

## Test items

| Group | Item | What it catches |
|---|---|---|
| Core | Page reachability | 404 / 5xx / unreachable pages |
| Core | JavaScript errors | `window.onerror`, unhandled rejections |
| Core | console.error / warn | what the page complains about itself |
| Core | Missing sub-resources | img / script / css / iframe that 404 |
| Core | ASUSWRT UI log | `httpApi.log()` output |
| Core | Page rendered something | white pages, stuck loading overlays |
| Core | Layout overflow | horizontal overflow, elements off-viewport |
| i18n | Untranslated tokens | `<#KEY#>` placeholders left in the DOM |
| SPEC | Feature SPEC check | Support / Not Support, derived from page presence |
| WebAPI | appGet.cgi hook sweep | hooks that return nothing |
| WebAPI | Record outgoing API calls | every XHR / fetch / `nvramSet` the UI sends |
| Page tests | QIS wizard, VLAN switch, Traffic monitor, Apply button | per-page assertions |
| EAA | Skip to main content link | the bypass link is the first Tab stop, reveals itself, and lands focus past the navigation (WCAG 2.4.1) |
| EAA | Client dialog keyboard operation | Network Map: focus enters the dialog, Tab reaches every component without escaping, Escape closes it (WCAG 2.1.2 / 2.4.3) |

### Real key presses

A page cannot make the browser move focus: `dispatchEvent` produces an
untrusted event, so a handler sees the key but Tab does not traverse. With the
`debugger` permission the driver sends the key through CDP's
`Input.dispatchKeyEvent` instead, which **is** trusted — so a suite can walk a
whole Tab cycle and record where focus actually landed at each step.

It attaches only for a page whose suites declare `needsRealKeys`, and detaches
immediately after, because attaching puts a *"being debugged"* banner on the
tab. A tab admits one debugger client, so it cannot attach while DevTools is
open on the page under test; that is reported and the suite falls back to
synthetic keys, saying which it used. Turn it off entirely under
**Options → Real key presses**.

Adding one is a two-file change and needs no manifest edit — see
[docs/WRITING-TESTS.md](docs/WRITING-TESTS.md).

## Safe Mode and button testing

Testing a button is awkward on a router: clicking **Reboot** ends the session,
and clicking **Apply** on a LAN page can drop the link the test is running over.

Safe Mode (on by default) resolves that. Instrumentation installed at
`document_start` records every outgoing request; when one carries a risky
`action_script` (`reboot`, `restart_net`, `restore`, `upgrade`, …) the request
is **re-pointed at a harmless read-only hook** instead of being sent. The click
is fully exercised — validation, payload assembly, callbacks — but `rc_service`
never sees it.

Tests then assert on what was *sent* rather than on what the router *did*:

```js
window.__AUT__.suite('pages.my-button', async (t) => {
    t.click('#applyButton');
    const sent = await t.expectApi({ path: '/applyapp.cgi',
                                     params: { action_script: 'restart_wireless' } });
    t.check(!!sent, 'Apply sent restart_wireless');
    t.check(sent.blocked, 'and Safe Mode held it back');
});
```

`src/suites/page/apply-button.js` is a working example. Turning Safe Mode off
makes every recorded call go through for real — do that only on a DUT you are
willing to lose.

## Login (auth v2)

The DUT no longer accepts the old `login.cgi` + Base64 scheme. v3.0 implements
auth v2:

```
POST /get_Nonce.cgi   {id}                              -> {nonce}
     login_authorization = SHA256(user:nonce:pass:cnonce)
POST /login_v2.cgi    {login_authorization, id, cnonce}
```

Turn on **Re-login automatically** and a session that expires mid-sweep is
recovered without losing the run.

## Layout

```
manifest.json
src/
  background/    service worker: message routing, run engine, driver suites
  page/          MAIN-world scripts: instrument.js (hooks), runtime.js (test API)
  panel/         the side panel
  suites/        registry.js + one file per page suite
  lib/           constants, report builders
tools/           self-test harness (see docs/TESTING.md)
docs/            architecture, how to write a test, how to test the tool
plan.md          the v3.0 execution plan, by stage
```

## Self test

```bash
node tools/selftest.mjs                                    # offline
node tools/selftest.mjs http://192.168.8.1 admin '<pass>'   # against a DUT
```

## What changed from v2.1

| | v2.1 | v3.0 |
|---|---|---|
| UI | 300px popup, 4 buttons | side panel, three tabs, checkboxes |
| Test selection | none — all or nothing | per item, per page, per language |
| State | service-worker globals | `chrome.storage.session`, survives worker restart |
| Instrumentation | `appendChild` after load | registered content script at `document_start` |
| Reachability | unauthenticated `HEAD` from the worker | authenticated probe from the page world (the only way 404 is detectable) |
| Adding a test | edit config + manifest + new file | new file + one registry entry |
| Report | one `.txt` | HTML / JSON / Markdown / TXT, filterable in-panel |
| Buttons | untestable | Safe Mode interception + `expectApi()` |
| Timer speed-up | forced 0.5× | configurable, defaults to 1× |
