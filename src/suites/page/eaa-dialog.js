/**
 * eaa.dialog -- dialogs announce themselves, take focus, keep it, and give it
 * back. EN 301 549 9.1.3.1, 9.2.4.3, 9.4.1.2, 9.2.1.2.
 *
 * Forty of the 187 findings are about dialogs, and they are the same eight
 * sentences repeated once per module: 「未設置對話框類型」, 「焦點仍停留在底層元素」,
 * 「彈窗彈出後可瀏覽底層元素」, 「close button 無標籤及系統焦點」. Every `?`
 * "about feature" button on every page produces the same four defects.
 *
 * So this is an engine rather than a test: find the things that open a dialog,
 * open each one, run one checklist against whatever appeared, close it, and
 * put the page back.
 *
 * Why it has to open them rather than inspect the markup: these dialogs exist
 * in the DOM from page load, hidden, with no role and no name. Statically they
 * are indistinguishable from any other hidden div. Everything worth checking --
 * where focus went, what is still reachable behind, whether Escape works --
 * only exists while one is open.
 *
 * Deliberate limits:
 *   - a budget of MAX_DIALOGS per page. A page with eight help icons produces
 *     the same finding eight times, and the sweep has 76 pages to get through.
 *   - triggers are found by this UI's own vocabulary (helpicon, about_feature,
 *     onclick containing a show/open call). A dialog opened by a control we do
 *     not recognise is not tested, and the suite says how many it tried.
 *   - nothing is clicked that might change a setting: triggers whose handler
 *     looks like an apply/delete/reboot call are skipped by name.
 */
window.__AUT__.suite('eaa.dialog', async function (t) {
    var A = window.__AUT__.a11y;

    var MAX_DIALOGS = 4;
    var OPEN_TIMEOUT = 3000;

    /* Things that open an informational dialog in this UI. */
    var TRIGGER_SELECTOR = [
        '.about_feature',
        '.helpicon',
        '.icon_help',
        'img[src*="helpicon"]',
        'img[src*="icon_help"]',
        '[id*="about_feature"]',
        '[onclick*="show_feature_desc"]',
        '[onclick*="showhelp"]',
        '[onclick*="show_help"]',
        '[onclick*="openHint"]',
        '[onclick*="show_more_info"]',
        '[onclick*="more_info"]',
        '[onclick*="popupWindow"]',
        '[onclick*="showLoading"]',
        '[aria-haspopup="dialog"]',
    ].join(', ');

    /* Never click these, whatever else they match: they write to the DUT. */
    var DESTRUCTIVE = /(apply|save|submit|delete|remove|reset|restore|reboot|restart|upgrade|erase|logout)/i;

    /* Containers this UI uses for a dialog, checked for "did something open". */
    var DIALOG_SELECTOR = [
        '[role="dialog"]',
        '[role="alertdialog"]',
        '.contentM_qis',
        '.panel_folder',
        '.popup_bg',
        '.pop_div',
        '.hint_div',
        '.dialog',
        '[id$="_block"]',
        '[id$="_dialog"]',
        '[id*="popup"]',
    ].join(', ');

    var CLOSE_SELECTOR =
        '.close, .closeBtn, .icon_close, [class*="close"], [onclick*="close"], [aria-label*="lose"]';

    function visible(el) {
        return A.isRendered(el) && !A.isAriaHidden(el);
    }

    /** Dialog-shaped containers that are on screen right now. */
    function openDialogs() {
        return t.$$(DIALOG_SELECTOR).filter(function (el) {
            if (!visible(el)) return false;
            var box = el.getBoundingClientRect();
            if (box.width < 80 || box.height < 40) return false;
            // A container holding the whole page is the page, not a dialog.
            return box.width < innerWidth * 0.98 || box.height < innerHeight * 0.98;
        });
    }

    /* --- find the triggers ---------------------------------------------- */

    var triggers = t.$$(TRIGGER_SELECTOR).filter(function (el) {
        if (!visible(el)) return false;
        var handler = (el.getAttribute('onclick') || '') + ' ' + (el.id || '') + ' ' + (el.className || '');
        if (DESTRUCTIVE.test(handler)) return false;
        // An icon inside a button: click the button, not the icon.
        var owner = el.closest ? el.closest('a[href], button, [role="button"]') : null;
        return !(owner && owner !== el && triggersContain(owner));
    });

    function triggersContain(el) {
        return el && el.matches && el.matches(TRIGGER_SELECTOR);
    }

    var alreadyOpen = openDialogs();
    if (alreadyOpen.length) {
        t.info(alreadyOpen.length + ' dialog-shaped container(s) were already open when the page loaded', {
            selectors: alreadyOpen.slice(0, 4).map(A.cssPath),
        });
    }

    if (!triggers.length) {
        return t.skip('no dialog trigger recognised on this page');
    }

    t.info(
        'found ' + triggers.length + ' dialog trigger(s); testing up to ' + MAX_DIALOGS,
        { triggers: triggers.slice(0, 8).map(A.describe) }
    );

    /* --- the checklist, per dialog --------------------------------------- */

    var tested = 0;

    for (var i = 0; i < triggers.length && tested < MAX_DIALOGS; i++) {
        var trigger = triggers[i];
        var before = openDialogs();
        var behindBefore = A.tabStops(document);

        trigger.focus && trigger.focus();
        t.click(trigger);

        /* eslint-disable no-loop-func */
        var appeared = await t.waitFor(
            (function (known) {
                return function () {
                    var now = openDialogs().filter(function (el) {
                        return known.indexOf(el) === -1;
                    });
                    return now.length ? now[0] : null;
                };
            })(before),
            OPEN_TIMEOUT
        );
        /* eslint-enable no-loop-func */

        if (!appeared) {
            // Not a failure: the trigger may do something else entirely, or
            // the dialog may be a container shape we do not recognise.
            t.info(A.describe(trigger) + ' did not open a container we recognise as a dialog', {
                selector: A.cssPath(trigger),
                onclick: (trigger.getAttribute('onclick') || '').slice(0, 80),
            });
            continue;
        }

        tested++;
        var dialog = appeared;
        var where = { dialog: A.cssPath(dialog), openedBy: A.describe(trigger) };

        /* 1. it says it is a dialog */
        var role = (dialog.getAttribute('role') || '').toLowerCase();
        t.check(
            role === 'dialog' || role === 'alertdialog',
            A.describe(dialog) + ' declares role="dialog"',
            { role: role || '(none)', dialog: where.dialog, openedBy: where.openedBy }
        );
        if (role === 'dialog' || role === 'alertdialog') {
            t.check(
                dialog.getAttribute('aria-modal') === 'true',
                A.describe(dialog) + ' declares aria-modal="true"',
                where
            );
        }

        /* 2. it has a name */
        var name = A.accessibleName(dialog);
        t.check(!!name.name, A.describe(dialog) + ' has an accessible name', {
            name: name.name || '(none)',
            from: name.from,
            dialog: where.dialog,
        });

        /* 3. focus moved into it */
        await t.sleep(200);
        var focused = document.activeElement;
        var focusInside = focused && dialog.contains(focused);
        t.check(
            focusInside,
            'focus moved into ' + A.describe(dialog) + ' when it opened',
            {
                focusedNow: focused ? A.describe(focused) : '(nothing)',
                dialog: where.dialog,
                openedBy: where.openedBy,
            }
        );

        /* 4. the page behind is out of reach */
        var stopsNow = A.tabStops(document);
        var behindStillReachable = stopsNow.filter(function (el) {
            return !dialog.contains(el) && behindBefore.indexOf(el) !== -1;
        });
        t.check(
            behindStillReachable.length === 0,
            'the page behind ' + A.describe(dialog) + ' is no longer in the tab order',
            {
                reachable: behindStillReachable.length,
                examples: behindStillReachable.slice(0, 5).map(A.describe),
                fix: 'trap focus, or mark the background inert / aria-hidden',
                dialog: where.dialog,
            }
        );

        /* 5. the close button */
        var closer = dialog.querySelector ? dialog.querySelector(CLOSE_SELECTOR) : null;
        if (closer) {
            var closerName = A.accessibleName(closer);
            t.check(!!closerName.name, A.describe(closer) + ' (close) has an accessible name', {
                from: closerName.from,
                dialog: where.dialog,
            });
            t.check(A.isFocusable(closer), A.describe(closer) + ' (close) can be focused', {
                dialog: where.dialog,
            });
        } else {
            t.warn('no close control found inside ' + A.describe(dialog), where);
        }

        /* 6. Tab stays inside -- only meaningful with trusted keys */
        var inside = A.tabStops(dialog);
        if (!t.realKeys()) {
            t.skip('Tab containment in ' + A.describe(dialog) + ' needs trusted key events');
        } else if (inside.length < 2) {
            t.info(A.describe(dialog) + ' has fewer than two tab stops, so there is no cycle to walk', {
                stops: inside.length,
                dialog: where.dialog,
            });
        } else {
            inside[inside.length - 1].focus();
            await t.pressKey('Tab');
            await t.sleep(120);
            var afterTab = document.activeElement;
            t.check(
                afterTab && dialog.contains(afterTab),
                'Tab from the last control in ' + A.describe(dialog) + ' stays inside it',
                { focusedNow: afterTab ? A.describe(afterTab) : '(nothing)', dialog: where.dialog }
            );
        }

        /* 7. Escape closes it, and focus comes back */
        var closedByEscape = false;
        if (t.realKeys()) {
            await t.pressKey('Escape', { target: dialog });
            await t.sleep(250);
            closedByEscape = openDialogs().indexOf(dialog) === -1;
            t.check(closedByEscape, 'Escape closes ' + A.describe(dialog), where);
            if (closedByEscape) {
                t.check(
                    document.activeElement === trigger,
                    'focus returns to ' + A.describe(trigger) + ' after the dialog closes',
                    {
                        focusedNow: document.activeElement ? A.describe(document.activeElement) : '(nothing)',
                        dialog: where.dialog,
                    }
                );
            }
        } else {
            t.skip('Escape on ' + A.describe(dialog) + ' needs trusted key events');
        }

        /* --- leave the page as we found it ------------------------------- */
        if (!closedByEscape && openDialogs().indexOf(dialog) !== -1) {
            if (closer) t.click(closer);
            await t.sleep(250);
            if (openDialogs().indexOf(dialog) !== -1) {
                t.warn(
                    A.describe(dialog) + ' could not be closed, so later checks on this page ' +
                        'may see it still open',
                    where
                );
                break;
            }
        }
    }

    if (!tested) {
        t.info('none of the ' + triggers.length + ' trigger(s) opened a recognisable dialog');
    } else {
        t.info('checked ' + tested + ' dialog(s) on this page');
    }
});
