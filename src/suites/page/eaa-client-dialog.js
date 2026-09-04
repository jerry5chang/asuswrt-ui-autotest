/**
 * eaa.client-dialog -- keyboard operability of the Network Map client dialog
 * (WCAG 2.1.2 No Keyboard Trap, 2.4.3 Focus Order, 4.1.2 Name/Role/Value).
 *
 * Network Map (index.asp) loads the client list in the #statusframe iframe.
 * Clicking a card there calls parent.popupEditBlock(), so the dialog itself --
 * #edit_client_block -- opens in the *top* document while the trigger lives in
 * the frame. Both halves matter, so this suite reaches into the frame for the
 * card and asserts against the top document for the dialog.
 *
 * On synthesising keys: the browser moves focus for a plain Tab and no script
 * can fake that, so "Tab reaches every component in order" is checked as
 * (a) every focusable component actually accepts focus, in DOM order, and
 * (b) the wrap at each end, which the plugin's own trap implements in a keydown
 * handler and therefore does respond to a dispatched event. Escape is likewise
 * a keydown handler, so it is exercised for real.
 */
window.__AUT__.suite('eaa.client-dialog', async function (t) {
    const DIALOG = '#edit_client_block';
    const CARD = '.clientBg[role="button"]';
    // Same definition the plugin traps on, so the two agree on what a
    // "component" is.
    const FOCUSABLE =
        'button:not([disabled]), input:not([type="hidden"]):not([disabled]), ' +
        'select:not([disabled]), textarea:not([disabled]), a[href], ' +
        '[tabindex]:not([tabindex="-1"]), [role="button"]';

    const describe = (el) => {
        if (!el) return 'nothing';
        const id = el.id ? `#${el.id}` : '';
        const name = !id && el.name ? `[name=${el.name}]` : '';
        return `${el.tagName.toLowerCase()}${id}${name}`;
    };

    const rendered = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 || r.height > 0;
    };

    const isOpen = (el) => !!el && rendered(el);

    const key = (target, name, extra = {}) =>
        target.dispatchEvent(
            new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra })
        );

    if (!window.EAAPlugin) {
        return t.skip('this build has no EAA plugin (js/eaa-plugin.js is not loaded)');
    }

    /* --- reach the trigger, which lives one frame down ------------------- */

    const frame = t.$('#statusframe');
    if (!frame) return t.skip('no #statusframe on this page — not the Network Map');

    let frameDoc = null;
    try {
        frameDoc = frame.contentDocument;
    } catch (e) {
        frameDoc = null;
    }
    if (!frameDoc) return t.skip('the client list frame is not readable');

    // The list is filled from a poll, so it is not there the instant we run.
    const card = await t.waitFor(() => frameDoc.querySelector(CARD), 5000);
    if (!card) {
        return t.skip('no client cards in the list — nothing to open');
    }

    const dialog = t.$(DIALOG);
    if (!dialog) return t.fail(`${DIALOG} is not present in the page`);

    /* --- open it -------------------------------------------------------- */

    card.click();
    const opened = await t.waitFor(() => (isOpen(dialog) ? dialog : null), 3000);
    if (!opened) return t.fail('clicking a client card did not open the client dialog');
    t.pass('clicking a client card opens the dialog');

    /* --- it has to announce itself as a dialog --------------------------- */

    t.check(
        ['dialog', 'alertdialog'].includes(dialog.getAttribute('role')),
        'the dialog carries role="dialog"',
        { role: dialog.getAttribute('role') }
    );
    t.check(dialog.getAttribute('aria-modal') === 'true', 'the dialog is marked aria-modal');
    t.check(
        !!(dialog.getAttribute('aria-label') || dialog.getAttribute('aria-labelledby')),
        'the dialog has an accessible name'
    );

    await t.sleep(350);
    t.check(dialog.contains(document.activeElement), 'opening it moves focus inside', {
        focused: describe(document.activeElement),
    });

    /* --- every component is reachable, in order ------------------------- */

    const components = t.$$(FOCUSABLE, dialog).filter(rendered);
    if (!components.length) {
        return t.fail('the dialog has no focusable component, so Tab cannot enter it');
    }
    t.pass(`${components.length} focusable component(s) in the dialog`);

    // A component that looks focusable but refuses focus is a hole in the
    // sequence: Tab skips it and the control becomes keyboard-unreachable.
    const unreachable = [];
    for (const el of components) {
        el.focus();
        if (document.activeElement !== el) unreachable.push(describe(el));
    }
    t.check(unreachable.length === 0, 'every component in the dialog accepts focus', {
        unreachable: unreachable.slice(0, 8),
    });

    // Focus order should follow the reading order; a positive tabindex inside
    // the dialog reorders it away from what is on screen.
    const reordered = components
        .filter((el) => Number(el.getAttribute('tabindex')) > 0)
        .map(describe);
    t.check(reordered.length === 0, 'nothing inside reorders the sequence with a positive tabindex', {
        elements: reordered.slice(0, 5),
    });

    /* --- Tab must not escape the dialog --------------------------------- */

    t.check(
        dialog.getAttribute('data-eaa-focus-trapped') === '1',
        'a focus trap is installed on the dialog'
    );

    const first = components[0];
    const last = components[components.length - 1];

    if (components.length > 1) {
        last.focus();
        key(last, 'Tab');
        await t.sleep(80);
        t.check(document.activeElement === first, 'Tab past the last component wraps to the first', {
            focused: describe(document.activeElement),
            expected: describe(first),
        });

        first.focus();
        key(first, 'Tab', { shiftKey: true });
        await t.sleep(80);
        t.check(
            document.activeElement === last,
            'Shift+Tab before the first component wraps to the last',
            { focused: describe(document.activeElement), expected: describe(last) }
        );
    } else {
        t.info('only one focusable component, so there is no wrap to check');
    }

    /* --- Escape closes it ----------------------------------------------- */

    key(dialog, 'Escape');
    const closed = await t.waitFor(() => (isOpen(dialog) ? null : true), 2500);

    if (!t.check(!!closed, 'Escape closes the dialog')) {
        // Leave the page as we found it for the suites that follow.
        card.click();
        return;
    }

    // Focus stranded on a hidden element leaves a screen reader nowhere.
    t.check(
        !dialog.contains(document.activeElement),
        'focus is not left stranded inside the closed dialog',
        { focused: describe(document.activeElement) }
    );
});
