# EAA test items: proposal

Source: `D:\ASUS\EAA-TEST` — five issue lists (`附件1_EAA_issue_list_20260831`
being the most complete, plus `EAA_issue_list_MERGED`, `附件2_问题列表模板_1226`
and the BT-8 58367 result sheet). De-duplicated by defect description:
**187 unique findings** across **22 UI modules**, each tagged with the EN 301 549
clause it violates.

**Status: all eight groups are implemented** (`src/suites/page/eaa-*.js`), with
415 offline checks behind them. Each ships `defaultOn: false` until it has
produced a correct verdict against a real DUT — see §6.

## 1. What the findings actually are

| Clause | WCAG name | Findings |
|---|---|---:|
| 9.4.1.2 | Name, Role, Value | 118 |
| 9.1.3.1 | Info and Relationships | 88 |
| 9.1.1.1 | Non-text Content | 55 |
| 9.2.1.1 | Keyboard | 52 |
| 9.2.4.3 | Focus Order | 27 |
| 9.1.4.3 | Contrast (Minimum) | 19 |
| 9.1.4.11 | Non-text Contrast | 9 |
| 9.2.4.4 / 9.2.4.7 | Link Purpose / Focus Visible | 4 |
| 9.3.3.1–9.3.3.3 | Error Identification / Labels / Suggestion | 6 |
| 9.1.4.1 / 9.1.4.10 / 9.1.4.12 | Use of Colour / Reflow / Text Spacing | 4 |
| 9.3.2.2 / 9.4.1.3 | On Input / Status Messages | 3 |

(A finding usually violates several clauses, so the column exceeds 187.)

The important property: **almost none of these are about one component.** The
same defect repeats across modules — 24 findings in WAN, 26 in Wireless, 14 in
LAN, and the *same* missing label or missing `aria-checked` in each. That is
what makes generic items possible.

Where the findings live, which decides whether we can reach them at all:

| Reachability | Findings | Our position |
|---|---:|---|
| Visible on page load | 123 | swept directly |
| Inside a dialog | 40 | reachable — a dialog engine opens them (§2.5) |
| Behind one click on a visible control | 19 | reachable, with a click budget |
| Needs data to be created first (add a rule, upload) | 5 | **not attempted** — it writes to the DUT |

## 2. Proposed items: eight groups

Eight sub-items under the existing **EAA** group. The grouping rule is *one
item per class of defect*, not per component and not per clause — so a
Wireless combobox and a WAN combobox are the same finding, and one item covers
both.

Each check below is marked **[A]** (a program can point at the offending
element and be right) or **[H]** (a program can flag the candidate; a person
confirms).

### 2.1 `eaa.a11y-name` — accessible names and text alternatives
*Clauses 9.1.1.1, 9.4.1.2, 9.2.5.3 · ~60 findings*

- [A] every interactive element (`button`, `a[href]`, `input[type=button|submit|image]`,
  `[role=button]`, non-semantic elements with a click handler) has a
  non-empty accessible name from text, `aria-label`, `aria-labelledby`,
  `title`, `alt` or `value`
- [A] icon-only controls specifically — the `?` "about feature", refresh,
  delete, close, show/hide-password buttons that account for most of these
  findings
- [A] `img` / `svg[role=img]` / `input[type=image]` carry `alt` or an ARIA
  name; decorative images carry `alt=""` or `aria-hidden="true"`
- [A] known-redundant names: `aria-label="Select Option"`,
  `"Interactive button"`, a `title` identical to the visible text
- [H] `aria-label` differs from the visible text (label-in-name: the spoken
  name should contain what you can see)
- [H] the name looks wrong rather than missing ("FAQ Search" search button
  named something else) — flagged for a human

### 2.2 `eaa.form-labels` — form labelling and input attributes
*Clauses 9.1.3.1, 9.3.3.2, 9.4.1.2 · ~40 findings*

- [A] every `input` / `select` / `textarea` has a programmatic label
  (`label[for]`, an ancestor `label`, `aria-label`, `aria-labelledby`)
- [A] `placeholder` is not the only label
- [A] checkbox / radio labels are associated, so the text is clickable
- [A] fields marked required visually (`*`, a class) also carry `required` or
  `aria-required`
- [A] read-only / disabled state uses the real attribute, not a class
- [A] segmented inputs (IP, MAC, PIN — several inputs for one value) sit in a
  `fieldset`+`legend` or `role="group"` with a name
- [A] a custom combobox exposes `role="combobox"`, `aria-expanded` and
  `aria-controls`

### 2.3 `eaa.control-state` — roles and states of custom controls
*Clauses 9.4.1.2, 9.1.3.1 · ~30 findings*

- [A] toggles/switches are a native checkbox or expose
  `role="switch"|"checkbox"` **and** `aria-checked`
- [A] tab strips expose `role="tablist"/"tab"/"tabpanel"` and `aria-selected`
- [A] expandable controls expose `aria-expanded`
- [A] the current item in a menu or option row exposes `aria-current` or
  `aria-selected` (the left menu, the Highest/High rows)
- [A] non-semantic elements with a click handler expose a `role`
- [A] role nesting is legal (no interactive descendant inside `role="button"`;
  no redundant container role)
- [H] the state attribute actually changes when the control is operated
  (needs one click per control, so a budget applies)

### 2.4 `eaa.keyboard` — keyboard operability
*Clauses 9.2.1.1, 9.2.4.3, 9.2.4.7 · ~55 findings*

- [A] every element that responds to a click is focusable (native, or
  `tabindex="0"`)
- [A] click and keyboard are equivalent: a non-native interactive element
  binds `keydown`/`keyup` as well as `click`
- [A] nothing uses a positive `tabindex`
- [A] elements that are not visible are not in the tab order
- [A] focusing a control changes something visible (outline, box-shadow,
  border, background) — focus visible
- [H] Space toggles native checkboxes and radios, Enter activates buttons —
  verified with **trusted keys** on a sample per page, not on all of them
- [H] the tab order follows the visual order (flags a clear divergence; "does
  it match the visual reading order" ultimately needs a person)

### 2.5 `eaa.dialog` — dialog accessibility (the biggest single win)
*Clauses 9.1.3.1, 9.2.4.3, 9.4.1.2 · ~40 findings*

An engine, not a single test: find dialog triggers on the page (the `?`
"about feature" buttons, `more info`, `edit`, `add`, `Check log`, known
`#*_block` containers), open each within a budget, run the checklist, close it,
and restore the page.

- [A] the container exposes `role="dialog"|"alertdialog"` (plus `aria-modal`
  or an equivalent guard)
- [A] it has an accessible name
- [A] focus moves into the dialog when it opens
- [A] the page behind is not focusable (a trap, `inert`, or `aria-hidden`)
- [A] Tab cycles inside the dialog; Shift+Tab reverses (trusted keys)
- [A] Escape closes it
- [A] focus returns to the trigger after it closes
- [A] the close button has a name and is focusable

The existing `eaa.client-dialog` is one instance of this checklist, hand-written
for the Network Map client dialog. It stays as the deep case (it knows about
`#statusframe`, `clientStatusLink` and the 15 s list) and this item covers
the breadth.

### 2.6 `eaa.page-structure` — document and semantic structure
*Clauses 9.1.3.1, 9.2.4.1, 9.2.4.2, 9.1.4.10, 9.1.4.12 · ~12 findings, every page*

- [A] `html[lang]` present and plausible for the UI language
- [A] `document.title` non-empty and not the same on every page
- [A] exactly one `h1`; heading levels do not skip
- [A] a `main` landmark exists and the skip link points into it
- [A] data tables have `th` with `scope` (or correct ARIA); layout tables are
  marked `role="presentation"`
- [H] repeated structures that are not lists (a device list built from `div`s)
- [H] reflow at 320 px: no two-dimensional scrolling (needs
  `Emulation.setDeviceMetricsOverride` via the debugger we already attach)
- [H] text-spacing override (1.4.12) does not clip or overlap content

### 2.7 `eaa.contrast` — contrast
*Clauses 9.1.4.3, 9.1.4.11 · ~28 findings*

- [H] text contrast ≥ 4.5:1 (≥ 3:1 for large text), computed from the element's
  colour against the first opaque ancestor background, with `opacity` and
  `rgba` composited. Reliable for flat backgrounds — which is most of this UI —
  and reported as a candidate, not a verdict, where a gradient or image sits
  behind
- [H] `::placeholder` contrast, which is its own finding several times over
- [H] non-text contrast ≥ 3:1 for icons and control boundaries — approximated
  from `fill`/`stroke`/`border-color`; a genuinely pixel-accurate answer needs
  a screenshot sample per icon

### 2.8 `eaa.feedback` — status messages and error handling
*Clauses 9.4.1.3, 9.3.3.1, 9.3.3.3, 9.3.2.2 · ~8 findings*

- [A] status/error containers the UI writes into are inside a live region
  (`aria-live`, `role="status"`, `role="alert"`)
- [A] a field with an error exposes `aria-invalid` and points at the message
  with `aria-describedby`
- [H] the same message is not announced repeatedly (watch live-region mutations
  while typing — the password-strength finding)
- [H] an error message offers a correction, not just "invalid"

## 3. Coverage

Against the 187 unique findings, by whether **the core defect** is something a
program can decide:

| | Findings | Share |
|---|---:|---:|
| **[A] Automatable** — the tool points at the element and is right | 133 | **71 %** |
| **[H] Assisted** — the tool flags a candidate, a person confirms | 51 | 27 % |
| **Manual** — needs a person or a screen reader | 3 | 2 % |

By clause:

| Clause | Findings | [A] | [H] | Manual |
|---|---:|---:|---:|---:|
| 9.4.1.2 Name, Role, Value | 118 | 107 | 11 | 0 |
| 9.1.3.1 Info and Relationships | 88 | 78 | 10 | 0 |
| 9.1.1.1 Non-text Content | 55 | 51 | 4 | 0 |
| 9.2.1.1 Keyboard | 52 | 51 | 0 | 1 |
| 9.2.4.3 Focus Order | 27 | 22 | 5 | 0 |
| 9.1.4.3 Contrast (Minimum) | 19 | 0 | 19 | 0 |
| 9.1.4.11 Non-text Contrast | 9 | 1 | 8 | 0 |
| 9.3.3.x Errors and labels | 6 | 2 | 4 | 0 |
| 9.2.4.4 / 9.2.4.7 | 4 | 4 | 0 | 0 |
| 9.4.1.3 Status Messages | 2 | 0 | 2 | 0 |
| 9.1.4.1 / 9.1.4.10 / 9.1.4.12 | 4 | 1 | 2 | 1 |
| 9.3.2.2 On Input | 1 | 0 | 0 | 1 |

Two honest qualifications:

1. **Coverage of the *class*, not of the exact wording.** When a finding says
   "the button is named incorrectly", we can prove a name exists and flag it as
   suspicious; whether the name is *good* is a human call. The 71 % counts
   findings whose defect is structural ("no label", "not focusable", "no
   `aria-checked`", "focus stayed behind the dialog"), which is what most of
   this list is.
2. **Reachability caps it in practice.** 123 findings are on the page as
   loaded; 40 need a dialog opened (§2.5 does that); 19 need one click; 5 need
   data created on the DUT first, which we will not do. So expect roughly
   **65–70 % of the list to be reproducible by a sweep**, and the rest to need
   a person to put the UI in the right state first.

## 4. What we will not do

| Not attempted | Why |
|---|---|
| Verify what a screen reader actually says | 97 findings were written with NVDA. We can assert the DOM contract that produces the announcement, never the announcement. Wording, order and verbosity stay human judgement |
| Judge whether a name or `alt` is *correct* | Existence, emptiness and redundancy are decidable; meaning is not |
| Information conveyed by colour alone (9.1.4.1) | Requires understanding what the colour means |
| Visual occlusion (a button hidden behind text) | Geometry can flag overlap, but "is it hidden" needs eyes; the one finding here also contradicts itself (keyboard-operable, mouse-blocked) |
| Error-message loops (9.3.2.2) | Needs a multi-step interaction state machine and a judgement about "loop" |
| Anything that writes to the DUT to reach the UI state | Adding a rule, uploading a file, creating a client entry. Against the Safe Mode rule; a person can put the UI there and re-run |
| Pixel-accurate non-text contrast | Needs a screenshot sample per icon; we approximate from CSS and mark it assisted |
| Whether the tab order matches the *visual* reading order | We can flag clear divergences (positive `tabindex`, DOM order vs geometry), not aesthetics |
| Reading a PDF or a chart's meaning | Out of scope for a DOM tool |

## 5. Implementation notes

- Eight new files under `src/suites/page/`, eight registry entries in the EAA
  group, `suite.<id>.name|desc` in three locales.
- Findings must be **per element, de-duplicated per page**: one row per
  offending selector, not one per instance, or a page with 40 unlabelled
  inputs produces 40 rows. `collapseSuiteRows` already collapses per suite;
  these items should also collapse identical selectors within a page.
- Severity: a missing label or an unfocusable control is `fail`; a heuristic
  ([H]) is `warn`, so the report separates "this is wrong" from "look at this".
- `eaa.dialog` and the interactive parts of `eaa.keyboard` need trusted keys
  and a click budget; both must restore the page (close dialogs, blur) so the
  next suite on the page is not affected. EAA items already run last.
- Every group starts as `draft: true` until it has produced a correct verdict
  against the BT8 — including on a page where the finding is known to exist,
  which these lists give us: they name the module and the control.
- The 187 findings are a **regression corpus**. A sensible next step after the
  items exist: a checked list of "finding → page → expected item to catch it",
  so a firmware fix that regresses shows up as a specific item flipping.

## 6. As built

| Item | File | Default | Notes |
|---|---|---|---|
| `eaa.a11y-name` | `eaa-a11y-name.js` | off | names, alt text, redundant/mismatched names |
| `eaa.form-labels` | `eaa-form-labels.js` | off | labels, placeholders, required/read-only, segmented inputs |
| `eaa.control-state` | `eaa-control-state.js` | off | switch/tab/current state, ARIA typos and bad values, role nesting |
| `eaa.keyboard` | `eaa-keyboard.js` | off | focusability, click/key equivalence, tab order, focus visibility, Space |
| `eaa.dialog` | `eaa-dialog.js` | off | opens up to 4 dialogs per page and runs the full checklist |
| `eaa.page-structure` | `eaa-page-structure.js` | off | lang, title, headings, landmarks, tables, frames, text spacing |
| `eaa.contrast` | `eaa-contrast.js` | off | text, placeholder and boundary contrast, with uncertainty stated |
| `eaa.feedback` | `eaa-feedback.js` | off | live regions, aria-invalid, assertive-on-continuous |

Shared machinery added for them:

- **`src/page/a11y.js`** — injected between `runtime.js` and the suite files.
  Accessible-name computation that also reports *which mechanism* named an
  element, focusability and tab-order rules, contrast with translucency
  composited, focus-appearance measurement, the ARIA vocabulary, and
  `findings()`: one report row per offending element, capped per check with a
  summary row naming the rest.
- **`tools/mini-dom.mjs`** — an HTML parser and a DOM subset (selectors,
  `closest`, computed style with inheritance, geometry from `data-rect`, focus,
  event bubbling) so these items are tested against fixtures rather than
  against a stub that answers its own questions. No dependencies; it throws on
  anything it does not implement.

### Turning them on

They are off because nobody has confirmed their verdicts against a router yet.
That is one run away: tick the EAA group, run it against the BT8, and read the
findings against these lists — the audit names the module and the control for
every one of the 187, so a correct item should reproduce them. Each item that
does gets `defaultOn: true`; anything whose verdict cannot be trusted gets
`draft: true` and a comment saying what the DUT showed, like the four Page
tests items.

Cost, if all eight are on: about 5.4 s per page on top of the existing sweep,
so roughly seven minutes across 76 pages — `eaa.dialog` is most of it, because
it opens dialogs and waits for them.
