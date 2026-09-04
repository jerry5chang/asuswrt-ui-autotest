/**
 * eaa.keyboard -- everything you can click, you can operate from the keyboard.
 * EN 301 549 9.2.1.1 (Keyboard), 9.2.4.3 (Focus Order), 9.2.4.7 (Focus
 * Visible).
 *
 * The largest single sentence in the audit is 「無焦點」-- no focus. Fifty-odd
 * findings: device rows, table action buttons, dialog buttons, icon lists,
 * switches. Underneath them are three distinct defects, and a report that
 * merges them is useless because each has a different fix:
 *
 *   1. the element cannot hold focus at all (a `div` with an onclick, no
 *      tabindex) -- the fix is a real control or tabindex="0";
 *   2. it can hold focus but only the mouse operates it (a click handler and
 *      no key handler) -- 「點擊事件與鍵盤事件不一致」, the fix is a keydown
 *      handler or a native button;
 *   3. it is reachable and operable but you cannot see where you are -- the
 *      theme removed the outline (9.2.4.7).
 *
 * Two of those are decidable from the DOM. The third is *measured*: read the
 * computed style, focus the element, read it again (a11y.focusChangesAppearance).
 *
 * What this cannot see: handlers attached with addEventListener. There is no
 * API for enumerating them from the page, and the extension deliberately has
 * no ISOLATED-world bridge. So "responds to a click" is a heuristic --
 * an inline onclick, a pointer cursor, one of the UI's clickable classes --
 * and findings that rest on it are warnings, not failures. The one exception
 * is an element that also has no role and no name: three heuristics agreeing
 * is a finding.
 *
 * Real key presses: with the debugger attached this suite verifies Space on a
 * native checkbox literally. Without it, `dispatchEvent` cannot move focus or
 * toggle anything, so that check says so and is skipped rather than faked.
 */
window.__AUT__.suite('eaa.keyboard', async function (t) {
    var A = window.__AUT__.a11y;

    var visible = function (el) {
        return A.isRendered(el) && !A.isAriaHidden(el);
    };

    var clickable = t.$$('div, span, td, li, i, img, a:not([href])').filter(function (el) {
        return A.looksClickable(el) && visible(el);
    });
    var stops = A.tabStops(document);

    if (!clickable.length && !stops.length) {
        return t.skip('this page has nothing focusable and nothing that looks clickable');
    }

    /* --- 1. clickable but not focusable --------------------------------- */

    var unreachable = clickable.filter(function (el) {
        return !A.isFocusable(el);
    });

    // Splitting by how much evidence there is, because the fix is the same but
    // the confidence is not: an element with an inline onclick is definitely a
    // control; a div with cursor:pointer might be a styled label.
    var certain = unreachable.filter(function (el) {
        return el.getAttribute('onclick') || el.getAttribute('role');
    });
    var suspected = unreachable.filter(function (el) {
        return certain.indexOf(el) === -1;
    });

    var reachFailed = A.findings(t, {
        severity: 'fail',
        elements: certain.map(function (el) {
            return {
                el: el,
                extra: {
                    onclick: (el.getAttribute('onclick') || '').slice(0, 80),
                    role: el.getAttribute('role') || '(none)',
                    accessibleName: A.accessibleName(el).name,
                },
            };
        }),
        what: 'can be clicked but cannot be focused',
        why: 'the keyboard cannot reach it — use a button/a, or add tabindex="0" plus a key handler',
    });

    A.findings(t, {
        severity: 'warn',
        elements: suspected.map(function (el) {
            return { el: el, extra: { cursor: getComputedStyle(el).cursor, className: String(el.className || '') } };
        }),
        what: 'looks clickable and cannot be focused',
        why: 'if it is a control the keyboard cannot reach it; if it is not, it should not look like one',
    });

    if (!reachFailed && clickable.length) {
        t.pass('all ' + clickable.length + ' clickable element(s) with a handler or a role can be focused');
    }

    /* --- 2. click without a keyboard equivalent ------------------------- */

    var mouseOnly = clickable.filter(function (el) {
        if (!el.getAttribute('onclick')) return false;
        if (A.hasKeyHandler(el)) return false;
        // A focusable div with a click handler and no key handler is the
        // classic 「點擊事件與鍵盤事件不一致」: Enter and Space do nothing.
        return true;
    });
    A.findings(t, {
        severity: 'fail',
        elements: mouseOnly.map(function (el) {
            return { el: el, extra: { onclick: (el.getAttribute('onclick') || '').slice(0, 80) } };
        }),
        what: 'has a click handler and no keyboard handler',
        why: 'Enter and Space do nothing; a native button gets this for free',
    });

    /* --- 3. tab order --------------------------------------------------- */

    var jumpers = t.$$('[tabindex]').filter(function (el) {
        return Number(el.getAttribute('tabindex')) > 0 && visible(el);
    });
    A.findings(t, {
        severity: 'fail',
        elements: jumpers.map(function (el) {
            return { el: el, extra: { tabindex: el.getAttribute('tabindex') } };
        }),
        what: 'claims an explicit position in the tab order',
        why: 'a positive tabindex jumps ahead of document order and reorders the whole page',
    });

    /*
     * Elements in the tab order that are not on screen. The skip link is the
     * legitimate version of this (clipped, revealed on focus), so an element
     * that becomes visible when focused is not reported.
     */
    var offScreen = [];
    for (var i = 0; i < stops.length; i++) {
        var stop = stops[i];
        if (A.isOnScreen(stop)) continue;
        var rect = stop.getBoundingClientRect();
        // Below the fold is fine -- the page scrolls. Off to the side or
        // behind the viewport start is not.
        if (rect.top >= innerHeight && rect.height > 0) continue;
        offScreen.push({ el: stop, extra: { rect: A.rectOf(stop) } });
    }
    A.findings(t, {
        severity: 'warn',
        elements: offScreen,
        max: 8,
        what: 'is in the tab order but not visible on the page',
        why: 'keyboard users focus something they cannot see (unless it reveals itself on focus)',
    });

    var ariaDisabledTabbable = stops.filter(function (el) {
        return el.getAttribute('aria-disabled') === 'true' && !el.disabled;
    });
    A.findings(t, {
        severity: 'warn',
        elements: ariaDisabledTabbable,
        what: 'is announced as disabled but still takes focus',
        why: 'use the disabled attribute, or remove it from the tab order',
    });

    /*
     * Tab order vs. reading order. Compared coarsely on purpose: only a stop
     * that comes *earlier* in the DOM while sitting a full row lower than its
     * predecessor is reported, which catches a control appended to the end of
     * the markup and positioned in the middle of the page -- the 「焦點順序不符
     * 合視覺瀏覽邏輯」 findings -- without arguing about columns.
     */
    var outOfOrder = [];
    var previous = null;
    for (var j = 0; j < stops.length; j++) {
        var current = stops[j];
        if (!A.isOnScreen(current)) continue;
        var box = current.getBoundingClientRect();
        if (previous) {
            var prevBox = previous.getBoundingClientRect();
            if (box.bottom < prevBox.top - 4) {
                outOfOrder.push({
                    el: current,
                    extra: { after: A.describe(previous), thisTop: Math.round(box.top), previousTop: Math.round(prevBox.top) },
                });
            }
        }
        previous = current;
    }
    A.findings(t, {
        severity: 'warn',
        elements: outOfOrder,
        max: 6,
        what: 'comes next in the tab order but sits above the element before it',
        why: 'the focus order does not follow the visual reading order',
    });

    /* --- 4. focus visible ----------------------------------------------- */

    if (stops.length) {
        // Sampled: focusing every stop on a 200-control page is slow, and one
        // theme decides this for the whole UI.
        var sample = [];
        var step = Math.max(1, Math.floor(stops.length / 8));
        for (var k = 0; k < stops.length && sample.length < 8; k += step) sample.push(stops[k]);

        var invisibleFocus = [];
        for (var s = 0; s < sample.length; s++) {
            var result = A.focusChangesAppearance(sample[s]);
            if (!result.changed && !result.error) invisibleFocus.push(sample[s]);
        }
        if (invisibleFocus.length) {
            A.findings(t, {
                severity: 'warn',
                elements: invisibleFocus,
                what: 'shows nothing when it is focused',
                why: 'no outline, shadow, border or colour change — keyboard users lose their place (9.2.4.7)',
                detail: function () {
                    return { sampledOf: stops.length };
                },
            });
        } else {
            t.pass('focus is visible on all ' + sample.length + ' sampled control(s)');
        }
    }

    /* --- 5. real keys, when we have them -------------------------------- */

    var tickbox = t.$$('input[type="checkbox"]').filter(function (el) {
        return visible(el) && !el.disabled;
    })[0];

    if (!tickbox) {
        t.info('no enabled checkbox on this page, so Space could not be exercised');
    } else if (!t.realKeys()) {
        // Deliberately not faked: a synthetic keydown cannot toggle a native
        // checkbox, so a "pass" here would be a lie about what was verified.
        t.skip('Space on a checkbox needs trusted key events; the debugger is not attached');
    } else {
        var before = tickbox.checked;
        tickbox.focus();
        await t.sleep(60);
        if (document.activeElement !== tickbox) {
            t.warn(A.describe(tickbox) + ' refused focus, so Space could not be tested', {
                selector: A.cssPath(tickbox),
            });
        } else {
            await t.pressKey(' ');
            await t.sleep(120);
            t.check(
                tickbox.checked !== before,
                A.describe(tickbox) + ' toggles when Space is pressed',
                { selector: A.cssPath(tickbox), was: before, now: tickbox.checked }
            );
            // Leave the DUT's form as we found it.
            if (tickbox.checked !== before) {
                await t.pressKey(' ');
                await t.sleep(80);
            }
        }
    }
});
