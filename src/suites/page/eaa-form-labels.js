/**
 * eaa.form-labels -- every field is labelled, and says what it requires.
 * EN 301 549 9.1.3.1 (Info and Relationships), 9.3.3.2 (Labels or
 * Instructions), 9.4.1.2 (Name, Role, Value).
 *
 * About forty of the audit findings are one sentence repeated across modules:
 * 「編輯框未正確關聯標籤」-- the text beside the field is not *attached* to the
 * field. Visually there is a label; programmatically there is none, so a
 * screen reader announces "edit, blank" and clicking the text does not focus
 * the input.
 *
 * The distinctions that matter here, and why each is separate:
 *   - no label at all vs. a placeholder doing the job. A placeholder
 *     disappears as soon as you type, which is the 9.3.3.2 finding on the
 *     login page: 「缺少持續的標籤提示」.
 *   - a label that exists but is not associated. This is the common case in
 *     ASUSWRT: `<td>Host Name</td><td><input id=...>` with no `for`.
 *   - state expressed in a class rather than an attribute (`class="readonly"`,
 *     a red asterisk for required). It looks right and is invisible to
 *     assistive technology.
 *   - segmented inputs: IP addresses, MAC addresses and PIN codes are four or
 *     six inputs for one value. Without a group they are announced as
 *     unrelated blank fields, which is the IPv6 finding
 *     「分段編輯框未通過分組語義正確關聯其對應的標籤」.
 *
 * Buttons and images are eaa.a11y-name's job; this item owns text-entry
 * fields, selects, checkboxes and radios.
 */
window.__AUT__.suite('eaa.form-labels', async function (t) {
    var A = window.__AUT__.a11y;

    var ENTRY_TYPES = /^(text|password|email|number|search|tel|url|date|time|datetime-local|month|week|color|file|range)$/;
    var TICK_TYPES = /^(checkbox|radio)$/;

    function isEntry(el) {
        if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return true;
        if (el.tagName !== 'INPUT') return false;
        return ENTRY_TYPES.test((el.getAttribute('type') || 'text').toLowerCase());
    }

    function isTick(el) {
        return el.tagName === 'INPUT' && TICK_TYPES.test((el.getAttribute('type') || '').toLowerCase());
    }

    var fields = t
        .$$('input, select, textarea')
        .filter(function (el) {
            var type = (el.getAttribute('type') || 'text').toLowerCase();
            if (type === 'hidden') return false;
            return A.isRendered(el) && !A.isAriaHidden(el);
        });

    if (!fields.length) return t.skip('this page has no form fields');

    var entries = fields.filter(isEntry);
    var ticks = fields.filter(isTick);

    /* --- 1. no programmatic label --------------------------------------- */

    var unlabelled = [];
    var placeholderOnly = [];

    entries.concat(ticks).forEach(function (el) {
        var got = A.accessibleName(el);
        if (got.from === 'placeholder') {
            placeholderOnly.push({ el: el, extra: { placeholder: got.name } });
            return;
        }
        if (!got.name) unlabelled.push(el);
    });

    var missing = A.findings(t, {
        severity: 'fail',
        elements: unlabelled,
        what: 'has no label',
        why: 'add label[for], wrap it in a label, or give it aria-label',
        detail: function (el) {
            return {
                type: (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase(),
                name: el.getAttribute('name') || '',
                // What a person sees beside the field, which is exactly what
                // should have been associated with it.
                visibleTextNearby: A.nearestText(el),
            };
        },
    });
    if (!missing) {
        t.pass('all ' + (entries.length + ticks.length) + ' field(s) have a programmatic label');
    }

    /* --- 2. placeholder standing in for a label ------------------------- */

    A.findings(t, {
        severity: 'fail',
        elements: placeholderOnly,
        what: 'is labelled only by its placeholder',
        why: 'the placeholder disappears as soon as the field is filled in, leaving nothing (9.3.3.2)',
    });

    /* --- 3. a visible label that is not attached ----------------------- */

    var detached = [];
    entries.concat(ticks).forEach(function (el) {
        var got = A.accessibleName(el);
        if (got.name && got.from !== 'placeholder') return; // already fine
        var nearby = A.nearestText(el);
        if (nearby && nearby.length <= 60) {
            detached.push({ el: el, extra: { textBeside: nearby } });
        }
    });
    if (detached.length) {
        t.info(
            detached.length + ' unlabelled field(s) have visible text beside them that could be the label',
            {
                candidates: detached.slice(0, 12).map(function (entry) {
                    return { selector: A.cssPath(entry.el), text: entry.extra.textBeside };
                }),
            }
        );
    }

    /* --- 4. checkbox and radio labels must be clickable ---------------- */

    var unclickableTicks = ticks.filter(function (el) {
        var label = A.labelElementFor(el);
        // aria-label names it for a screen reader but leaves the visible text
        // dead to the mouse, which is a separate defect from being unnamed.
        return !label && A.nearestText(el);
    });
    A.findings(t, {
        severity: 'fail',
        elements: unclickableTicks,
        what: 'has text beside it that is not a <label>',
        why: 'the words cannot be clicked to toggle it, and are not announced with it',
        detail: function (el) {
            return { textBeside: A.nearestText(el) };
        },
    });

    /* --- 5. required and read-only, in attributes not classes ---------- */

    var REQUIRED_HINT = /[*＊]|required|必填/i;
    var fakeRequired = entries.filter(function (el) {
        if (el.hasAttribute('required') || el.getAttribute('aria-required') === 'true') return false;
        var label = A.labelElementFor(el);
        var hint = (label ? label.textContent : '') + ' ' + A.nearestText(el) + ' ' + (el.className || '');
        return REQUIRED_HINT.test(hint);
    });
    A.findings(t, {
        severity: 'warn',
        elements: fakeRequired,
        what: 'is marked required only visually',
        why: 'add required or aria-required="true" so it is announced as mandatory',
        detail: function (el) {
            return { hint: A.nearestText(el) };
        },
    });

    var fakeReadonly = entries.filter(function (el) {
        if (el.hasAttribute('readonly') || el.hasAttribute('disabled')) return false;
        if (el.getAttribute('aria-readonly') === 'true' || el.getAttribute('aria-disabled') === 'true') return false;
        return /readonly|disabled|\bdis\b/i.test(String(el.className || ''));
    });
    A.findings(t, {
        severity: 'warn',
        elements: fakeReadonly,
        what: 'looks read-only through a class but declares nothing',
        why: 'use readonly / disabled, or aria-readonly, so the state is announced',
        detail: function (el) {
            return { className: String(el.className || '') };
        },
    });

    /* --- 6. segmented inputs need a group ------------------------------ */

    var groups = {};
    entries.forEach(function (el) {
        if (el.tagName !== 'INPUT') return;
        var maxlength = Number(el.getAttribute('maxlength') || 0);
        // An IP octet, a MAC pair, a PIN digit: short, and in a row.
        if (!maxlength || maxlength > 4) return;
        var parent = el.parentElement;
        if (!parent) return;
        var key = A.cssPath(parent);
        (groups[key] = groups[key] || { parent: parent, members: [] }).members.push(el);
    });

    var ungrouped = [];
    Object.keys(groups).forEach(function (key) {
        var group = groups[key];
        if (group.members.length < 3) return;
        var grouped =
            group.parent.closest('fieldset') ||
            group.parent.closest('[role="group"]') ||
            group.parent.getAttribute('role') === 'group';
        var named = group.members.every(function (el) {
            return !!A.accessibleName(el).name;
        });
        if (!grouped && !named) ungrouped.push({ el: group.parent, extra: { fields: group.members.length } });
    });
    A.findings(t, {
        severity: 'warn',
        elements: ungrouped,
        what: 'holds several short inputs for one value with no group semantics',
        why: 'wrap them in a fieldset+legend or role="group" with a name, or label each part',
    });
});
