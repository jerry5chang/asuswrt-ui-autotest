/**
 * Shared accessibility primitives for the EAA suites.
 *
 * Injected into the DUT's MAIN world right after runtime.js and before the
 * suite files, so every suite gets the same answers to the same questions --
 * "what is this element called?", "can the keyboard reach it?", "what is
 * behind it?" -- rather than eight slightly different implementations.
 *
 * ES5 on purpose, like the rest of src/page: this runs inside the router's own
 * document, alongside scripts that predate `let`.
 *
 * The findings helper is the reason this file exists as much as the algorithms
 * are. Every EAA finding has to name **which element** is missing **what**, or
 * the report says "control-state failed" and the reader has to go hunting. One
 * row per offending element, with a pasteable selector in the detail.
 */
(function () {
    var AUT = (window.__AUT__ = window.__AUT__ || {});
    if (AUT.a11y) return;

    var A = {};

    /* ------------------------------------------------------- identification */

    function text(el) {
        if (!el) return '';
        return String(el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function clip(s, n) {
        s = String(s == null ? '' : s);
        return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }

    /**
     * A short, human-readable identity: `input#wan_ip.form_input «WAN IP»`.
     * Includes the visible text because ASUSWRT ids are often meaningless
     * (`#tr_1`), and the text is what the reader recognises in the UI.
     */
    A.describe = function (el) {
        if (!el || el.nodeType !== 1) return String(el);
        var tag = el.tagName.toLowerCase();
        var id = el.id ? '#' + el.id : '';
        var cls = '';
        if (!id && typeof el.className === 'string' && el.className.trim()) {
            cls = '.' + el.className.trim().split(/\s+/)[0];
        }
        var name = el.getAttribute && el.getAttribute('name');
        var attr = !id && !cls && name ? '[name=' + name + ']' : '';
        var own = clip(text(el), 34);
        // For a control with no text of its own, borrow the nearest label so
        // the row still says where in the page this is. An image has neither,
        // so it is identified by the file it loads.
        var fallback = '';
        if (!own) {
            var src = el.getAttribute && (el.getAttribute('src') || el.getAttribute('data-src'));
            if (src) fallback = String(src).split('/').pop();
            else fallback = clip(A.nearestText(el), 34);
        }
        var shown = own || fallback;
        return tag + id + cls + attr + (shown ? ' «' + shown + '»' : '');
    };

    /** A selector you can paste into DevTools. Ids win; otherwise nth-of-type. */
    A.cssPath = function (el) {
        if (!el || el.nodeType !== 1) return '';
        if (el.id) return '#' + el.id;
        var parts = [];
        var node = el;
        for (var depth = 0; node && node.nodeType === 1 && depth < 5; depth++) {
            var part = node.tagName.toLowerCase();
            if (node.id) {
                parts.unshift('#' + node.id);
                break;
            }
            var parent = node.parentElement;
            if (parent) {
                var same = [];
                for (var i = 0; i < parent.children.length; i++) {
                    if (parent.children[i].tagName === node.tagName) same.push(parent.children[i]);
                }
                if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
            }
            parts.unshift(part);
            node = parent;
        }
        return parts.join(' > ');
    };

    /** Only this element's own text nodes -- not its descendants'. */
    function directText(el) {
        if (!el || !el.childNodes) return '';
        var out = '';
        for (var i = 0; i < el.childNodes.length; i++) {
            var node = el.childNodes[i];
            if (node.nodeType === 3) out += node.nodeValue || '';
        }
        return out.replace(/\s+/g, ' ').trim();
    }
    A.directText = directText;

    /**
     * Text near a control, for naming it in a report row.
     *
     * Deliberately conservative about what counts as "near": a preceding
     * `label[for=...]` that names a *different* control is not this control's
     * text, and a parent's full textContent is the whole row rather than this
     * cell. Getting this wrong makes a finding point at the wrong element,
     * which is worse than having no text at all.
     */
    /** The text node immediately after `el` in its parent, if any. */
    function textAfter(el) {
        var parent = el.parentElement;
        if (!parent || !parent.childNodes) return '';
        var seen = false;
        for (var i = 0; i < parent.childNodes.length; i++) {
            var node = parent.childNodes[i];
            if (node === el) {
                seen = true;
                continue;
            }
            if (!seen) continue;
            if (node.nodeType === 3 && String(node.nodeValue).trim()) {
                return String(node.nodeValue).replace(/\s+/g, ' ').trim();
            }
            if (node.nodeType === 1) break;
        }
        return '';
    }

    A.nearestText = function (el) {
        var label = A.labelElementFor(el);
        if (label && text(label)) return text(label);

        var placeholder = el.getAttribute ? el.getAttribute('placeholder') : '';
        if (placeholder) return String(placeholder).trim();

        // Before it: `<td>Host Name</td><td><input></td>` and `Label <input>`.
        var prev = el.previousElementSibling;
        for (var hops = 0; prev && hops < 3; hops++) {
            var forId = prev.getAttribute ? prev.getAttribute('for') : null;
            var namesSomeoneElse = forId && forId !== el.id;
            if (!namesSomeoneElse && text(prev)) return text(prev);
            prev = prev.previousElementSibling;
        }

        // After it: `<input type="checkbox"> Mon`, which is how every weekday
        // checkbox in the firewall schedule is written.
        var trailing = textAfter(el);
        if (trailing) return trailing;
        var next = el.nextElementSibling;
        if (next && text(next) && text(next).length <= 40) return text(next);

        // Its own cell, then the cell before it: the ASUSWRT table layout puts
        // the label in the previous column.
        var cell = el.closest ? el.closest('td, th, li, .formfontdesc, .form_label') : null;
        if (cell && cell !== el) {
            if (directText(cell)) return directText(cell);
            var prevCell = cell.previousElementSibling;
            if (prevCell && text(prevCell)) return text(prevCell);
        }

        // Machine names are a last resort: `name="hostname"` identifies the
        // field for a developer, but it is not what the user sees.
        var machine = el.getAttribute ? el.getAttribute('name') || el.getAttribute('value') : '';
        if (machine) return String(machine).trim();

        return directText(el.parentElement);
    };

    /** A trimmed outerHTML, for the report detail. */
    A.snippet = function (el) {
        if (!el || !el.outerHTML) return '';
        return clip(String(el.outerHTML).replace(/\s+/g, ' '), 240);
    };

    A.rectOf = function (el) {
        try {
            var r = el.getBoundingClientRect();
            return {
                x: Math.round(r.left),
                y: Math.round(r.top),
                w: Math.round(r.width),
                h: Math.round(r.height),
            };
        } catch (e) {
            return null;
        }
    };

    /* -------------------------------------------------------- accessible name
     * A pragmatic subset of the accname algorithm: the steps that decide
     * whether ASUSWRT's own controls have a name at all, in the order the
     * spec applies them. Deliberately not the full spec (no aria-owns
     * recursion, no CSS content): the findings we are chasing are missing
     * names, not exotic composition.
     */

    function labelledByText(el) {
        var ids = (el.getAttribute('aria-labelledby') || '').trim();
        if (!ids) return '';
        var out = [];
        ids.split(/\s+/).forEach(function (id) {
            var target = document.getElementById(id);
            if (target) out.push(text(target));
        });
        return out.join(' ').trim();
    }

    /** The <label> that names this control, if any. */
    A.labelElementFor = function (el) {
        if (!el || !el.tagName) return null;
        if (el.id) {
            var byFor = document.querySelector('label[for="' + cssEscape(el.id) + '"]');
            if (byFor) return byFor;
        }
        var wrapping = el.closest ? el.closest('label') : null;
        return wrapping || null;
    };

    function cssEscape(value) {
        return String(value).replace(/["\\]/g, '\\$&');
    }

    var NATIVE_LABELABLE = /^(INPUT|SELECT|TEXTAREA|BUTTON|METER|OUTPUT|PROGRESS)$/;

    /**
     * @returns {{name: string, from: string}} `from` is the mechanism, which
     * is what a fix has to change -- and what tells a redundant name from a
     * real one.
     */
    A.accessibleName = function (el) {
        if (!el || el.nodeType !== 1) return { name: '', from: 'none' };

        var byLabelledBy = labelledByText(el);
        if (byLabelledBy) return { name: byLabelledBy, from: 'aria-labelledby' };

        var ariaLabel = (el.getAttribute('aria-label') || '').trim();
        if (ariaLabel) return { name: ariaLabel, from: 'aria-label' };

        var tag = el.tagName;

        if (NATIVE_LABELABLE.test(tag)) {
            var label = A.labelElementFor(el);
            if (label && text(label)) return { name: text(label), from: 'label' };
        }

        if (tag === 'INPUT') {
            var type = (el.getAttribute('type') || 'text').toLowerCase();
            if (type === 'button' || type === 'submit' || type === 'reset') {
                var value = (el.value || '').trim();
                if (value) return { name: value, from: 'value' };
            }
            if (type === 'image') {
                var alt = (el.getAttribute('alt') || '').trim();
                if (alt) return { name: alt, from: 'alt' };
            }
        }

        if (tag === 'IMG' || tag === 'AREA') {
            var imgAlt = el.getAttribute('alt');
            if (imgAlt !== null && imgAlt.trim()) return { name: imgAlt.trim(), from: 'alt' };
            // alt="" is a *decision*, not an absence: it declares the image
            // decorative, and must not be reported as a missing name.
            if (imgAlt !== null) return { name: '', from: 'alt-empty' };
        }

        if (tag === 'SVG' || tag === 'svg') {
            var title = el.querySelector ? el.querySelector('title') : null;
            if (title && text(title)) return { name: text(title), from: 'svg-title' };
        }

        var own = text(el);
        if (own) return { name: own, from: 'content' };

        // A wrapper whose only content is an image can still be named by it.
        var img = el.querySelector ? el.querySelector('img[alt], svg > title, input[type=image][alt]') : null;
        if (img) {
            var nested = A.accessibleName(img.tagName === 'title' ? img.parentElement : img);
            if (nested.name) return { name: nested.name, from: 'child ' + nested.from };
        }

        var titleAttr = (el.getAttribute('title') || '').trim();
        // title is a legitimate last resort in the spec, and simultaneously
        // the most common cause of the "reads twice" findings, so it is
        // reported as its own mechanism.
        if (titleAttr) return { name: titleAttr, from: 'title' };

        var placeholder = (el.getAttribute('placeholder') || '').trim();
        if (placeholder) return { name: placeholder, from: 'placeholder' };

        return { name: '', from: 'none' };
    };

    /* ------------------------------------------------------------ visibility */

    /** Rendered at all: not display:none, not visibility:hidden, has a box. */
    A.isRendered = function (el) {
        if (!el || el.nodeType !== 1) return false;
        if (!el.getClientRects || el.getClientRects().length === 0) {
            // A zero-box element can still be rendered if it has children.
            if (!el.offsetParent && !(el.offsetWidth || el.offsetHeight)) return false;
        }
        for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
            var cs = getComputedStyle(node);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') {
                return false;
            }
            if (Number(cs.opacity) === 0) return false;
        }
        return true;
    };

    /** Rendered *and* inside the viewport box. */
    A.isOnScreen = function (el) {
        if (!A.isRendered(el)) return false;
        var r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
    };

    /** Hidden from assistive technology, whatever it looks like. */
    A.isAriaHidden = function (el) {
        for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
            if (node.getAttribute('aria-hidden') === 'true') return true;
        }
        return false;
    };

    /* -------------------------------------------------------------- keyboard */

    var NATIVE_FOCUSABLE = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|AUDIO|VIDEO|IFRAME)$/;

    /**
     * Only the native attribute. `aria-disabled` *claims* a control is
     * disabled without making it so: the browser still gives it focus and
     * still fires its handlers. Treating the two as equivalent here hid the
     * "announced as disabled but still takes focus" finding entirely, because
     * the element was excluded from the tab order this file computed.
     */
    A.isDisabled = function (el) {
        return !!el.disabled;
    };

    A.isAriaDisabled = function (el) {
        return !!(el.getAttribute && el.getAttribute('aria-disabled') === 'true');
    };

    /** Can this element hold focus? */
    A.isFocusable = function (el) {
        if (!el || el.nodeType !== 1 || A.isDisabled(el)) return false;
        var tabindex = el.getAttribute('tabindex');
        if (tabindex !== null && Number(tabindex) >= 0) return true;
        if (tabindex !== null && Number(tabindex) < 0) return false;
        if (el.tagName === 'A') return el.hasAttribute('href');
        if (el.tagName === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'hidden') return false;
        return NATIVE_FOCUSABLE.test(el.tagName) || el.isContentEditable === true;
    };

    /** In the sequential tab order (focusable, rendered, not aria-hidden). */
    A.isTabbable = function (el) {
        return A.isFocusable(el) && A.isRendered(el) && !A.isAriaHidden(el);
    };

    /** Every tab stop in a container, in DOM order. */
    A.tabStops = function (root) {
        var scope = root || document;
        var candidates = scope.querySelectorAll(
            'a[href], button, input:not([type="hidden"]), select, textarea, summary, ' +
                '[tabindex], [contenteditable="true"], audio[controls], video[controls], iframe'
        );
        var out = [];
        for (var i = 0; i < candidates.length; i++) {
            if (A.isTabbable(candidates[i])) out.push(candidates[i]);
        }
        return out;
    };

    /** Key handlers we can see: inline attributes, and our own recorder. */
    A.hasKeyHandler = function (el) {
        for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
            if (node.getAttribute('onkeydown') || node.getAttribute('onkeypress') || node.getAttribute('onkeyup')) {
                return true;
            }
            // A native control has the browser's own key behaviour.
            if (NATIVE_FOCUSABLE.test(node.tagName) && node === el) return true;
        }
        return false;
    };

    /*
     * Interactive-looking elements that are not interactive elements.
     *
     * addEventListener handlers are invisible to us, so this is a heuristic:
     * an inline onclick, a pointer cursor, or one of the UI's own clickable
     * classes. False positives are possible (a styled label), which is why
     * suites report these as warnings unless the element is unambiguous.
     */
    var CLICKY_CLASS = /(^|\s)(button_gen|button_gen_dis|icon_|tab|tabclick|clickable|switch|iconSwitch|link)/i;

    A.looksClickable = function (el) {
        if (!el || el.nodeType !== 1) return false;
        if (NATIVE_FOCUSABLE.test(el.tagName)) return false;
        /*
         * `cursor: pointer` inherits, so every img inside a button looks
         * clickable. Its interactivity belongs to the ancestor, and reporting
         * it here would blame the child for the parent's job.
         */
        var owner = el.closest
            ? el.closest('a[href], button, label, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="switch"]')
            : null;
        if (owner && owner !== el) return false;
        if (el.getAttribute('onclick')) return true;
        var role = (el.getAttribute('role') || '').toLowerCase();
        if (/^(button|link|checkbox|switch|tab|menuitem|option|radio)$/.test(role)) return true;
        if (typeof el.className === 'string' && CLICKY_CLASS.test(el.className)) return true;
        try {
            if (getComputedStyle(el).cursor === 'pointer' && text(el).length <= 60) return true;
        } catch (e) {
            /* detached node */
        }
        return false;
    };

    /* -------------------------------------------------------------- contrast */

    function parseColor(value) {
        var m = /rgba?\(([^)]+)\)/.exec(String(value || ''));
        if (!m) return null;
        var parts = m[1].split(',').map(function (p) {
            return parseFloat(p);
        });
        return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }
    A.parseColor = parseColor;

    /** Composite `fg` (possibly translucent) over opaque `bg`. */
    function over(fg, bg) {
        var a = fg.a == null ? 1 : fg.a;
        return {
            r: fg.r * a + bg.r * (1 - a),
            g: fg.g * a + bg.g * (1 - a),
            b: fg.b * a + bg.b * (1 - a),
            a: 1,
        };
    }
    A.compositeOver = over;

    function channel(c) {
        var v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }

    A.luminance = function (c) {
        return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    };

    /** WCAG contrast ratio, rounded to two decimals. */
    A.contrast = function (fg, bg) {
        var l1 = A.luminance(fg);
        var l2 = A.luminance(bg);
        var hi = Math.max(l1, l2);
        var lo = Math.min(l1, l2);
        return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    };

    /**
     * What is actually behind this element: walk up compositing translucent
     * backgrounds until an opaque one is found.
     *
     * `uncertain` is set when something in the stack makes the answer a
     * guess -- a background image, a gradient, a transform. Suites report
     * those as warnings rather than failures, because the real colour is in
     * the pixels and we are reading CSS.
     */
    A.effectiveBackground = function (el) {
        var stack = [];
        var uncertain = false;
        for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
            var cs = getComputedStyle(node);
            if (cs.backgroundImage && cs.backgroundImage !== 'none') uncertain = true;
            var c = parseColor(cs.backgroundColor);
            if (!c || c.a === 0) continue;
            stack.push(c);
            if (c.a === 1) {
                var acc = stack.pop();
                while (stack.length) acc = over(stack.pop(), acc);
                return { color: acc, uncertain: uncertain };
            }
        }
        // Nothing opaque all the way up: the canvas is white by default.
        var white = { r: 255, g: 255, b: 255, a: 1 };
        var result = white;
        while (stack.length) result = over(stack.pop(), result);
        return { color: result, uncertain: uncertain };
    };

    /** WCAG large text: >=24px, or >=18.66px bold. */
    A.isLargeText = function (cs) {
        var size = parseFloat(cs.fontSize) || 0;
        var weight = String(cs.fontWeight);
        var bold = weight === 'bold' || weight === 'bolder' || Number(weight) >= 700;
        return size >= 24 || (bold && size >= 18.66);
    };

    /* -------------------------------------------------- focus appearance */

    var FOCUS_PROPS = [
        'outline-style', 'outline-width', 'outline-color', 'box-shadow',
        'border-color', 'border-width', 'background-color', 'color', 'text-decoration-line',
    ];

    function appearance(el) {
        var cs = getComputedStyle(el);
        var out = {};
        for (var i = 0; i < FOCUS_PROPS.length; i++) {
            out[FOCUS_PROPS[i]] = cs.getPropertyValue
                ? cs.getPropertyValue(FOCUS_PROPS[i])
                : cs[FOCUS_PROPS[i]];
        }
        return out;
    }

    /**
     * Does focusing this element change anything you can see?
     *
     * Measured rather than inferred: read the computed style, focus, read it
     * again. A CSS `:focus` rule, an `outline` the theme did not remove, a
     * class the page adds on focus -- all of them show up here, and a page
     * that removed the outline without replacing it shows up as no change.
     */
    A.focusChangesAppearance = function (el) {
        var before = appearance(el);
        var wasFocused = document.activeElement;
        try {
            el.focus({ preventScroll: true });
        } catch (e) {
            try {
                el.focus();
            } catch (e2) {
                return { changed: false, error: 'element refused focus' };
            }
        }
        if (document.activeElement !== el) {
            return { changed: false, error: 'element did not take focus' };
        }
        var after = appearance(el);
        var differences = [];
        for (var i = 0; i < FOCUS_PROPS.length; i++) {
            var prop = FOCUS_PROPS[i];
            if (String(before[prop]) !== String(after[prop])) {
                differences.push(prop + ': ' + before[prop] + ' -> ' + after[prop]);
            }
        }
        // Leave the page as it was found; EAA items run last, but not alone.
        if (wasFocused && wasFocused.focus) {
            try {
                wasFocused.focus({ preventScroll: true });
            } catch (e3) {
                /* the previous element may have gone away */
            }
        }
        return { changed: differences.length > 0, differences: differences };
    };

    /* ------------------------------------------------------ aria vocabulary */

    /** Every ARIA attribute in the 1.2 vocabulary, for typo detection. */
    var ARIA_ATTRS = (
        'activedescendant atomic autocomplete braillelabel brailleroledescription busy checked colcount ' +
        'colindex colindextext colspan controls current describedby description details disabled ' +
        'errormessage expanded flowto haspopup hidden invalid keyshortcuts label labelledby level live ' +
        'modal multiline multiselectable orientation owns placeholder posinset pressed readonly relevant ' +
        'required roledescription rowcount rowindex rowindextext rowspan selected setsize sort ' +
        'valuemax valuemin valuenow valuetext'
    ).split(' ');

    A.isKnownAriaAttribute = function (name) {
        var m = /^aria-([a-z]+)$/.exec(String(name).toLowerCase());
        return !!m && ARIA_ATTRS.indexOf(m[1]) !== -1;
    };

    /** Attributes on this element that look like ARIA but are not. */
    A.misspelledAria = function (el) {
        var out = [];
        // getAttributeNames rather than the attributes collection: it is a
        // plain array of strings in both a browser and the test DOM.
        var names = el.getAttributeNames ? el.getAttributeNames() : [];
        for (var i = 0; i < names.length; i++) {
            if (/^aria-/.test(names[i]) && !A.isKnownAriaAttribute(names[i])) out.push(names[i]);
        }
        return out;
    };

    /* -------------------------------------------------------------- findings
     * One row per offending element, naming the element and what it lacks.
     * Capped, because a page with forty unlabelled inputs must not produce
     * forty rows -- the cap is stated in the summary row and the full list
     * goes into its detail.
     */

    var DEFAULT_MAX = 12;

    /**
     * @param {object} t         the suite context
     * @param {object} opts
     * @param {string} opts.severity   'fail' | 'warn' | 'info'
     * @param {Array}  opts.elements   offending elements (or {el, extra} pairs)
     * @param {string} opts.what       "has no accessible name"
     * @param {string} [opts.why]      why it matters, appended after an em dash
     * @param {number} [opts.max]      rows before collapsing into a summary
     * @param {function} [opts.detail] el -> extra detail fields
     * @returns {number} how many elements were reported
     */
    A.findings = function (t, opts) {
        var list = (opts.elements || []).filter(Boolean);
        if (!list.length) return 0;

        var severity = opts.severity || 'fail';
        var max = opts.max == null ? DEFAULT_MAX : opts.max;
        var why = opts.why ? ' — ' + opts.why : '';

        var shown = list.slice(0, max);
        for (var i = 0; i < shown.length; i++) {
            var entry = shown[i];
            var el = entry && entry.nodeType === 1 ? entry : entry.el;
            var extra = entry && entry.nodeType === 1 ? null : entry.extra;
            var detail = {
                selector: A.cssPath(el),
                html: A.snippet(el),
                rect: A.rectOf(el),
            };
            if (opts.detail) {
                var more = opts.detail(el) || {};
                for (var k in more) if (Object.prototype.hasOwnProperty.call(more, k)) detail[k] = more[k];
            }
            if (extra) for (var k2 in extra) if (Object.prototype.hasOwnProperty.call(extra, k2)) detail[k2] = extra[k2];
            t[severity](A.describe(el) + ' ' + opts.what + why, detail);
        }

        if (list.length > max) {
            t[severity](
                list.length - max + ' more element(s) ' + opts.what + ' on this page',
                {
                    selectors: list.slice(max).map(function (entry) {
                        return A.cssPath(entry && entry.nodeType === 1 ? entry : entry.el);
                    }),
                }
            );
        }
        return list.length;
    };

    /**
     * The counterpart: say what was checked when nothing was wrong, so a pass
     * carries its own evidence instead of being an empty assertion.
     */
    A.ok = function (t, count, what) {
        t.pass('all ' + count + ' ' + what);
    };

    AUT.a11y = A;
})();
