# Working on this repository

**Read `docs/AGENT-HANDBOOK.md` first.** It is the authoritative guide: the
architecture, the UI rules, the implementation standard for test items, and a
ledger of the mistakes already made here. The other docs are narrower views of
the same system (`docs/ARCHITECTURE.md`, `docs/WRITING-TESTS.md`,
`docs/TESTING.md`).

Every change, without exception:

```bash
node tools/selftest.mjs        # must report 0 failed
bash tools/sync-windows.sh     # copy into the Chrome profile that loads it
```

Non-negotiables, in full in the handbook's §0:

1. Reports must be comparable between people — the false-alarm filter list
   lives in source, not in the panel.
2. Never break the DUT — Safe Mode intercepts risky `action_script` values, and
   button tests assert what the UI *sent*.
3. An unverified item must not produce a verdict — mark it `draft`.
4. Say what actually happened — no swallowed errors.
5. One way to do each thing in the UI.

The DUT (`http://192.168.8.1`, admin / `asus#12345`, SSH 22222) keeps **one
login at a time**: do not touch it while someone is using its web UI, and use
auth v2 only (`get_Nonce.cgi` + `login_v2.cgi`).
