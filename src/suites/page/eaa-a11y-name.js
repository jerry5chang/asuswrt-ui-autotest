/**
 * eaa.a11y-name -- every control and image has a usable accessible name.
 * EN 301 549 9.1.1.1 (Non-text Content) and 9.4.1.2 (Name, Role, Value).
 *
 * This is the single largest class of finding in the audit: about sixty of the
 * 187 are "this control has no label" or "this image has no text
 * alternative", repeated across WAN, Wireless, LAN, AiMesh and the rest. They
 * are all the same defect, so they are one item.
 *
 * The obvious check -- does the element have text -- is not enough in either
 * direction:
 *   - an icon-only button (the `?` "about feature", refresh, delete, close,
 *     show-password) has no text and may still be correctly named by
 *     aria-label, alt or title, so the name has to be *computed*;
 *   - a control can have a name and still be wrong: `aria-label="Select
 *     Option"` on every combobox, or a `title` duplicating the visible text,
 *     which is what the audit calls 朗读冗余 -- read twice.
 *
 * So each finding names the element, says which mechanism supplied the name
 * (or that none did), and separates "missing" (fail) from "suspicious" (warn).
 *
 * Division of labour: form fields belong to eaa.form-labels; this item covers
 * buttons, links, images and anything that behaves like a control.
 */
window.__AUT__.suite('eaa.a11y-name', async function (t) {
    var A = window.__AUT__.a11y;

    /* Names that are present but say nothing, or say it twice. Every entry
     * here comes from a specific audit finding. */
    var USELESS_NAME = /^(button|link|image|icon|img|click here|here|more|\.\.\.|…|select option|interactive button|untitled)$/i;
    var REDUNDANT_LABEL = /^(select option|interactive button)$/i;

    var CONTROL_SELECTOR =
        'button, a[href], input[type="button"], input[type="submit"], input[type="reset"], ' +
        'input[type="image"], [role="button"], [role="link"], [role="checkbox"], [role="switch"], ' +
        '[role="tab"], [role="menuitem"], [role="option"], [role="radio"], summary';

    /* --- collect what has to be named ------------------------------------ */

    var candidates = t.$$(CONTROL_SELECTOR).filter(function (el) {
        return A.isRendered(el) && !A.isAriaHidden(el);
    });

    /* Non-semantic elements that behave like controls. Reported separately and
     * more gently: we cannot see addEventListener handlers, so membership of
     * this list is a heuristic (see a11y.looksClickable). */
    var improvised = t
        .$$('div, span, td, li, img, i, a:not([href])')
        .filter(function (el) {
            return A.looksClickable(el) && A.isRendered(el) && !A.isAriaHidden(el);
        });

    var images = t.$$('img, input[type="image"], [role="img"]').filter(function (el) {
        return !A.isAriaHidden(el) && el.getAttribute('role') !== 'presentation' && el.getAttribute('role') !== 'none';
    });

    if (!candidates.length && !images.length && !improvised.length) {
        return t.skip('this page has no controls or images to name');
    }

    /* --- 1. controls with no name at all --------------------------------- */

    var unnamed = [];
    var named = [];
    candidates.forEach(function (el) {
        var got = A.accessibleName(el);
        if (got.name) named.push({ el: el, got: got });
        else unnamed.push(el);
    });

    var failed = A.findings(t, {
        severity: 'fail',
        elements: unnamed,
        what: 'has no accessible name',
        why: 'a screen reader announces only its role, so the user cannot tell what it does',
        detail: function (el) {
            var bareImages = (el.querySelectorAll ? [].slice.call(el.querySelectorAll('img')) : []).filter(
                function (img) {
                    return !A.accessibleName(img).name && img.getAttribute('alt') === null;
                }
            );
            return {
                role: el.getAttribute('role') || el.tagName.toLowerCase(),
                nearbyText: A.nearestText(el),
                // The usual cause for an icon button: the icon has no alt.
                unnamedImagesInside: bareImages.map(function (img) {
                    return img.getAttribute('src') || '(no src)';
                }),
            };
        },
    });
    if (!failed && candidates.length) {
        t.pass('all ' + candidates.length + ' control(s) have an accessible name');
    }

    /* --- 2. images and icons -------------------------------------------- */

    var noAlt = images.filter(function (el) {
        var got = A.accessibleName(el);
        // alt="" is a decision -- "this image is decorative" -- and correct.
        if (got.name || got.from === 'alt-empty') return false;
        /*
         * An unnamed image inside an unnamed control is one defect, not two:
         * giving the image an alt names the control. Report the control and
         * name the image in its detail, so the row says what to fix.
         */
        var owner = el.closest ? el.closest(CONTROL_SELECTOR) : null;
        return !(owner && unnamed.indexOf(owner) !== -1);
    });
    var imagesFailed = A.findings(t, {
        severity: 'fail',
        elements: noAlt,
        what: 'has no text alternative',
        why: 'add alt (or alt="" if it is decorative)',
        detail: function (el) {
            return { src: el.getAttribute('src') || el.getAttribute('data-src') || '', inside: A.describe(el.parentElement) };
        },
    });
    if (!imagesFailed && images.length) {
        t.pass('all ' + images.length + ' image(s) declare a text alternative or are marked decorative');
    }

    /* --- 3. names that are present but useless -------------------------- */

    var redundant = named.filter(function (entry) {
        return entry.got.from === 'aria-label' && REDUNDANT_LABEL.test(entry.got.name);
    });
    A.findings(t, {
        severity: 'fail',
        elements: redundant.map(function (entry) {
            return { el: entry.el, extra: { name: entry.got.name, from: entry.got.from } };
        }),
        what: 'carries a placeholder aria-label that adds nothing',
        why: 'remove it and let the visible text or a real label name the control',
    });

    var vague = named.filter(function (entry) {
        return !REDUNDANT_LABEL.test(entry.got.name) && USELESS_NAME.test(entry.got.name.trim());
    });
    A.findings(t, {
        severity: 'warn',
        elements: vague.map(function (entry) {
            return { el: entry.el, extra: { name: entry.got.name, from: entry.got.from } };
        }),
        what: 'is named with a generic word',
        why: 'the name should say what this control does, not what kind of thing it is',
    });

    /* --- 4. read twice: title duplicating the visible text -------------- */

    var doubled = [];
    candidates.forEach(function (el) {
        var title = (el.getAttribute('title') || '').trim();
        if (!title) return;
        var visible = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        var ariaLabel = (el.getAttribute('aria-label') || '').trim();
        if ((visible && title === visible) || (ariaLabel && title === ariaLabel)) {
            doubled.push({ el: el, extra: { title: title, visibleText: visible } });
        }
    });
    A.findings(t, {
        severity: 'warn',
        elements: doubled,
        what: 'has a title identical to its own text',
        why: 'assistive technology reads the name twice; drop the title',
    });

    /* --- 5. what you see is not what is announced (label in name) ------- */

    var mismatched = [];
    named.forEach(function (entry) {
        if (entry.got.from !== 'aria-label' && entry.got.from !== 'aria-labelledby') return;
        var visible = String(entry.el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!visible || visible.length > 40) return;
        var spoken = entry.got.name.toLowerCase();
        if (spoken.indexOf(visible.toLowerCase()) === -1) {
            mismatched.push({
                el: entry.el,
                extra: { announced: entry.got.name, visibleText: visible, from: entry.got.from },
            });
        }
    });
    A.findings(t, {
        severity: 'warn',
        elements: mismatched,
        what: 'is announced differently from its visible text',
        why: 'speech users cannot ask for it by the words they can see (WCAG 2.5.3)',
    });

    /* --- 6. improvised controls ----------------------------------------- */

    var improvisedUnnamed = improvised.filter(function (el) {
        if (A.accessibleName(el).name) return false;
        // Already reported as a missing image alternative; one row per defect.
        return noAlt.indexOf(el) === -1;
    });
    A.findings(t, {
        severity: 'warn',
        elements: improvisedUnnamed,
        what: 'looks clickable but has no accessible name',
        why: 'if it is a control it needs a name and a role; if it is not, it should not look clickable',
        detail: function (el) {
            return {
                onclick: (el.getAttribute('onclick') || '').slice(0, 80),
                cursor: getComputedStyle(el).cursor,
                nearbyText: A.nearestText(el),
            };
        },
    });
});
