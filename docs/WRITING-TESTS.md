# Writing a test item

Two files change: your suite, and one entry in the registry. **The manifest is
never touched** — v3.0 injects through `chrome.scripting`, so there is no
`web_accessible_resources` list to keep in sync (that was the third file you
had to remember in v2.x).

---

## 1. Decide where it runs

| `where` | Runs in | Use it when the test needs |
|---|---|---|
| `page` | the page's MAIN world, after load | the DOM, `httpApi`, clicking things |
| `driver` | the service worker | HTTP probing, tab control, cross-page state |
| `instrument` | `src/page/instrument.js` at `document_start` | to observe from before the first page script runs |

Most new tests are `page`.

`scope` says how often it runs:

| `scope` | Meaning |
|---|---|
| `each-page` | on every swept page |
| `pages` | only on the URLs in `pages: [...]` |
| `run` | once per language pass (`driver` only) |

---

## 2. Write the suite

`src/suites/page/my-thing.js` — a plain script (no `import`/`export`; it is
injected, not imported):

```js
/**
 * pages.my-thing -- what this checks, and why it is worth checking.
 */
window.__AUT__.suite('pages.my-thing', async function (t) {
    const table = await t.waitFor(() => t.$('#myTable'), 5000);
    if (!table) return t.fail('table never rendered');

    t.pass(`table rendered with ${table.rows.length} rows`);
    t.check(t.visible(t.$('#addButton')), 'add button is visible');
});
```

The id you pass to `suite()` **must** match the registry id, or the runner will
inject the file and then report the suite as `skip`.

### The `t` context

| | |
|---|---|
| `t.pass/info/warn/fail/skip(msg, detail?)` | record a result |
| `t.check(ok, msg, detail?)` | pass or fail on a boolean, returns it |
| `t.$(sel)` / `t.$$(sel)` | `querySelector` / `querySelectorAll` as an array |
| `t.visible(el)` | rendered, not `display:none`/`hidden`/zero-sized |
| `t.waitFor(fn, timeoutMs?)` | poll until truthy; resolves `null` on timeout |
| `t.sleep(ms)` | |
| `t.click(elOrSelector)` | scroll into view and click |
| `t.recordedApis()` | every request the instrumentation has seen on this page |
| `t.expectApi(want, timeoutMs?)` | wait for a matching request; `null` on timeout |
| `t.safeMode()` | is Safe Mode intercepting risky calls right now |
| `t.page`, `t.doc` | current page URL, `document` |

`want` for `expectApi` is either a predicate or
`{ path?, params?: {k: v}, risk? }`.

Guarantees: a suite that throws becomes one `error` result, and a suite that
hangs is cut off at the per-suite timeout. Neither takes the run down.

---

## 3. Register it

In `src/suites/registry.js`:

```js
{
    id: 'pages.my-thing',
    name: 'My thing',
    group: 'Page tests',
    description: 'One line; it is the help text under the checkbox.',
    where: 'page',
    scope: 'pages',
    pages: ['Advanced_MyThing_Content.asp'],
    file: 'src/suites/page/my-thing.js',
    defaultOn: true,
}
```

The side-panel checkbox, run planning and report grouping all derive from this
entry. `group` creates the section heading if it is new.

---

## 4. Testing a button that would disconnect the DUT

Assert on the request, not on the router's behaviour. Safe Mode intercepts
risky `action_script` values, so the click runs end to end without the DUT
acting on it:

```js
window.__AUT__.suite('pages.reboot-button', async function (t) {
    if (!t.safeMode()) return t.skip('needs Safe Mode; refusing to reboot a live DUT');

    t.click('#rebootButton');
    const sent = await t.expectApi({ risk: 'reboot' }, 6000);

    t.check(!!sent, 'reboot button sent a reboot request');
    t.check(sent && sent.blocked, 'and Safe Mode held it back');
});
```

`src/suites/page/apply-button.js` is the shipped example. If you need a service
covered that Safe Mode does not know about, add it to `riskyActions` in
`src/lib/const.js` (users can also edit the list in Settings).

---

## 5. Adding a driver suite

Add the function to `DRIVER_RUN_SUITES` in
`src/background/driver-suites.js`, keyed by the registry id:

```js
async function myProbe(ctx) {
    const probed = await probeUrls(ctx.tabId, ['some_page.asp']);
    return [{ suite: 'my.probe', page: 'some_page.asp',
              severity: probed[0].ok ? SEV.PASS : SEV.FAIL,
              message: `status ${probed[0].status}` }];
}
```

`ctx` gives you `{ tabId, lang, settings, pages, shared, aborted() }`. Check
`ctx.aborted()` inside long loops so Stop stays responsive, and use `shared` to
hand data to later suites — `core.reachability` publishes `shared.reach`, which
is how the runner knows not to navigate to a page that returned 404.

Probing must go through `probeUrls`/`hookGet` (i.e. the page's MAIN world). A
`fetch` from the service worker does not carry the `asus_token` cookie, and an
unauthenticated ASUSWRT request answers `200` with a login redirect for
*every* path — including ones that do not exist.

---

## 6. Adding an instrumentation channel

1. Hook it in `src/page/instrument.js` and `push(kind, message, detail)`.
2. Gate it on `AUT.cfg.channels.<yourChannel>`.
3. Map `kind` → suite id + severity in `EVENT_MAP` in `src/background/runner.js`.
4. Add the registry entry with `where: 'instrument'` and `channel: '<yourChannel>'`.
5. Wire the channel into the `channels` object in `runner.js` `startRun()`.

Keep hooks defensive — wrap the observation in `try/catch` and always call
through to the original. Instrumentation that breaks the page under test
produces failures that are not real.

---

## 7. Verify

```bash
node tools/selftest.mjs                                    # registry + logic
node tools/selftest.mjs http://192.168.8.1 admin '<pass>'   # against a DUT
```

The harness checks that every `where: 'page'` suite points at a file that
exists and that ids are unique, so a typo fails fast rather than showing up as
a mystery `skip` mid-sweep.
