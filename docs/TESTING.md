# Testing the tool itself

```bash
node tools/selftest.mjs                                     # offline
node tools/selftest.mjs http://192.168.8.1 admin '<pass>'    # against a DUT
```

Reports are written to `.selftest/` (git-ignored) so you can open them and look
at the actual output.

## What the harness covers

`tools/chrome-stub.mjs` provides just enough `chrome.*` to run the background
modules under Node. `tools/dut-session.mjs` holds a real auth v2 session, and
the stub binds its `fetch` as the global while running an injected function —
faithful for the driver-side injections, which only ever use `fetch`.

**Offline**

| Area | Checked |
|---|---|
| `page/instrument.js` | Safe Mode default, risk detection in query strings, POST bodies, `httpApi` payloads and `;`-separated service lists; blocked XHR is re-pointed rather than dropped; `drain()` hands over and resets |
| `page/runtime.js` | pass/fail/check recording, a throwing suite becomes one `error`, a hanging suite times out, an unloaded suite reports `skip`, `expectApi()` matches and times out |
| `suites/registry.js` | unique ids, every `where:'page'` file exists, `where`/`scope` valid, page matching |
| `lib/report.js` | JSON parses and redacts the password, HTML escapes result text and is a complete document, TXT keeps the v2.x sections and does not double-report, filename shape |

**Against a DUT**

| Area | Checked |
|---|---|
| `background/auth.js` | the full `get_Nonce.cgi` → `login_v2.cgi` flow |
| `background/page-eval.js` | authenticated probing distinguishes 200 from 404 — and that an *unauthenticated* probe cannot, which is why probes run in the page |
| `core.reachability` | every page classified, `shared.reach` published for the runner |
| `spec.feature-map` | Support and Not Support both produced |
| `api.hook-sweep` | batched `appGet.cgi` calls, hooks with no response identified |
| `lib/report.js` | real results render in all four formats |

## What it does **not** cover

These need a real Chrome and a hand check on `chrome://extensions`:

- manifest loading, `sidePanel` behaviour, the action-click opening the panel
- `registerContentScripts` with `world: 'MAIN'` at `document_start`
- real MAIN-world injection and `drain()` across frames
- side-panel rendering and the export download
- the page suites' DOM assertions (`dom-sanity`, `i18n-token`,
  `layout-overflow`, and the per-page ones)
- clicking a real Apply button and watching Safe Mode hold it

### Manual smoke test

1. Load unpacked, open the router UI, log in.
2. Click the icon → the side panel opens.
3. **Probe** → DUT card fills in with model / firmware / theme and a page count.
4. Tick a handful of pages and the Core items → **Start**.
5. Progress advances, results stream into the Run tab, the tab navigates page
   to page.
6. **Report** → filter, then **Export HTML** and open the file.
7. With Safe Mode on, open a settings page and press Apply by hand: the Report
   tab's API list should show the call as `held`, and the DUT should not
   restart anything.

## Reference DUT

The live checks were run against:

```
ZenWiFi_BT8 (productid BT8) · 3.0.0.4.388_34021-0f3c9437 · UI3 · territory US/01
```

Results on that build, for comparison:

- 119 pages from `menuTree.js` → 90 reachable, 29 missing (404)
- SPEC: Support AiCloud, AiDisk, SDN, WireGuard, VPN-Fusion;
  Not Support VLAN, WTFast, Multi-Function-BTN
- WebAPI: 63/74 hooks responded. The 11 without a response are
  `channel_list_5g_2`, `channel_list_6g_2`, `check_passwd_strength(wl_key)`,
  `get_opt_status`, `get_nvsw`, `speedtest_get_eth_monitor_result` and
  `wl_cap_{2g,5g,5g_2,6g,6g_2}` — the `wl_cap_*` family is Broadcom-only and
  BT8 is MTK, so those are expected on this platform rather than defects.
