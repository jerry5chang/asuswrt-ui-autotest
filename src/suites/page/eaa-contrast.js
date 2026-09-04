/**
 * eaa.contrast -- text and control boundaries are dark enough to read.
 * EN 301 549 9.1.4.3 (Contrast Minimum, 4.5:1 / 3:1 for large text) and
 * 9.1.4.11 (Non-text Contrast, 3:1).
 *
 * Twenty-eight findings, and every one of them a number: 「不滿足文字對比度
 * 4.5:1」on table captions, "Max Limit" hints, placeholder text, the login
 * button, the grey counts beside Clients and AiMesh Node.
 *
 * Honesty about what this can and cannot decide, because it is the one group
 * where the tool's answer is an approximation:
 *
 *   - The ratio itself is exact. The colours are read from computed style and
 *     composited: an `rgba` text colour over a translucent panel over an
 *     opaque background gives the right answer.
 *   - What is *behind* the text is a guess when a background image or gradient
 *     is in the stack, because the real colour is in the pixels and we are
 *     reading CSS. Those are reported separately and marked uncertain.
 *   - Non-text contrast is approximated from `border-color` / `fill` /
 *     `stroke`. A genuinely pixel-accurate answer for an icon needs a
 *     screenshot sample, which the page cannot take of itself.
 *
 * So findings are warnings, not failures: every one is worth looking at, and
 * the report says which are certain enough to fix without checking.
 */
window.__AUT__.suite('eaa.contrast', async function (t) {
    var A = window.__AUT__.a11y;

    var TEXT_MIN = 4.5;
    var LARGE_MIN = 3;
    var NON_TEXT_MIN = 3;

    /** Elements whose own text is what a person reads. */
    var candidates = t
        .$$('p, span, div, td, th, li, a, button, label, h1, h2, h3, h4, h5, h6, ' +
            'legend, caption, option, strong, em, small, b, i')
        .filter(function (el) {
            if (!A.directText(el)) return false;
            if (A.isAriaHidden(el)) return false;
            return A.isOnScreen(el);
        });

    var inputs = t.$$('input[placeholder], textarea[placeholder]').filter(A.isOnScreen);

    if (!candidates.length && !inputs.length) {
        return t.skip('no visible text on this page to measure');
    }

    /* --- 1. text contrast ----------------------------------------------- */

    var failing = [];
    var uncertain = [];
    var checked = 0;

    candidates.forEach(function (el) {
        var cs = getComputedStyle(el);
        var fg = A.parseColor(cs.color);
        if (!fg) return;
        var background = A.effectiveBackground(el);
        // Fully transparent text is invisible to everyone; not a contrast bug.
        if (fg.a === 0) return;

        var composited = fg.a < 1 ? A.compositeOver(fg, background.color) : fg;
        var ratio = A.contrast(composited, background.color);
        var large = A.isLargeText(cs);
        var required = large ? LARGE_MIN : TEXT_MIN;
        checked++;
        if (ratio >= required) return;

        var entry = {
            el: el,
            extra: {
                ratio: ratio,
                required: required,
                textColour: cs.color,
                behind: 'rgb(' +
                    Math.round(background.color.r) + ', ' +
                    Math.round(background.color.g) + ', ' +
                    Math.round(background.color.b) + ')',
                fontSize: cs.fontSize,
                largeText: large,
                text: A.directText(el).slice(0, 60),
            },
        };
        if (background.uncertain) {
            entry.extra.note = 'a background image or gradient is behind this, so the real colour may differ';
            uncertain.push(entry);
        } else {
            failing.push(entry);
        }
    });

    var reported = A.findings(t, {
        severity: 'warn',
        elements: failing,
        what: 'does not meet the required text contrast',
        why: 'measured from computed colours with translucency composited',
    });
    if (!reported && checked) {
        t.pass('all ' + checked + ' measurable text element(s) meet their contrast requirement');
    }

    A.findings(t, {
        severity: 'info',
        elements: uncertain,
        max: 6,
        what: 'is below the contrast threshold against the colour we could compute',
        why: 'an image or gradient sits behind it, so this needs an eye rather than a number',
    });

    /* --- 2. placeholders ------------------------------------------------ */

    /*
     * Its own finding twice over -- login and Wireless -- and its own
     * measurement, because the placeholder colour comes from a pseudo-element
     * and is not the field's `color`.
     */
    var placeholders = [];
    inputs.forEach(function (el) {
        var pseudo = null;
        try {
            pseudo = getComputedStyle(el, '::placeholder');
        } catch (e) {
            pseudo = null;
        }
        var fg = A.parseColor(pseudo && pseudo.color ? pseudo.color : getComputedStyle(el).color);
        if (!fg || fg.a === 0) return;
        var background = A.effectiveBackground(el);
        var composited = fg.a < 1 ? A.compositeOver(fg, background.color) : fg;
        var ratio = A.contrast(composited, background.color);
        if (ratio >= TEXT_MIN) return;
        placeholders.push({
            el: el,
            extra: {
                ratio: ratio,
                required: TEXT_MIN,
                placeholderColour: pseudo && pseudo.color ? pseudo.color : '(inherited)',
                placeholder: el.getAttribute('placeholder'),
            },
        });
    });
    A.findings(t, {
        severity: 'warn',
        elements: placeholders,
        what: 'has placeholder text below 4.5:1',
        why: 'the hint is unreadable for anyone who needs contrast — and it is the only label on some fields',
    });

    /* --- 3. non-text contrast ------------------------------------------- */

    /*
     * Control boundaries and icons. Approximated on purpose: the border colour
     * of an input against what is behind it is a real measurement, an icon's
     * effective colour is not, so icons are only measured when they declare a
     * colour in CSS (an SVG fill or stroke) rather than carrying it in pixels.
     */
    var boundaries = [];
    t.$$('input:not([type="hidden"]), select, textarea, button').filter(A.isOnScreen).forEach(function (el) {
        var cs = getComputedStyle(el);
        var width = parseFloat(cs.borderTopWidth || cs.borderWidth || '0');
        if (!width) return;
        var edge = A.parseColor(cs.borderTopColor || cs.borderColor);
        if (!edge || edge.a === 0) return;
        var background = A.effectiveBackground(el.parentElement || el);
        var ratio = A.contrast(edge.a < 1 ? A.compositeOver(edge, background.color) : edge, background.color);
        if (ratio >= NON_TEXT_MIN) return;
        boundaries.push({
            el: el,
            extra: { ratio: ratio, required: NON_TEXT_MIN, borderColour: cs.borderTopColor || cs.borderColor },
        });
    });
    A.findings(t, {
        severity: 'warn',
        elements: boundaries,
        max: 8,
        what: 'has a boundary below 3:1 against its background',
        why: 'the edge of a control is how you know it is there (9.1.4.11)',
    });

    var icons = [];
    t.$$('svg').filter(A.isOnScreen).forEach(function (el) {
        var cs = getComputedStyle(el);
        var paint = A.parseColor(cs.fill) || A.parseColor(cs.stroke) || A.parseColor(cs.color);
        if (!paint || paint.a === 0) return;
        var background = A.effectiveBackground(el.parentElement || el);
        var ratio = A.contrast(paint.a < 1 ? A.compositeOver(paint, background.color) : paint, background.color);
        if (ratio >= NON_TEXT_MIN) return;
        icons.push({ el: el, extra: { ratio: ratio, required: NON_TEXT_MIN, paint: cs.fill || cs.stroke } });
    });
    A.findings(t, {
        severity: 'warn',
        elements: icons,
        max: 6,
        what: 'is an icon painted below 3:1 against its background',
        why: 'measured from the SVG fill; an icon drawn in a bitmap needs a person to judge',
    });

    // The audit's own icon findings are all PNG `?` buttons, which have no
    // colour in CSS at all. Say so, rather than passing silently.
    var bitmapIcons = t.$$('img').filter(function (el) {
        if (!A.isOnScreen(el)) return false;
        var box = el.getBoundingClientRect();
        return box.width <= 32 && box.height <= 32;
    });
    if (bitmapIcons.length) {
        t.info(
            bitmapIcons.length + ' small bitmap icon(s) cannot be measured for contrast from CSS',
            {
                why: 'their colour is in the image; 9.1.4.11 for these needs a screenshot sample or an eye',
                examples: bitmapIcons.slice(0, 6).map(function (el) {
                    return el.getAttribute('src') || A.cssPath(el);
                }),
            }
        );
    }
});
