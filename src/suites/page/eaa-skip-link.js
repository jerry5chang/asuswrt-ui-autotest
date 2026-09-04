/**
 * eaa.skip-link -- the "Skip to main content" bypass link (WCAG 2.4.1).
 *
 * Added by `js/eaa-plugin.js` -> `addSkipToContentLink()`, which state.js
 * document.write()s into every page, so every page is expected to have it.
 * The link is inserted as `document.body.firstChild` and kept off-screen until
 * focused, so one Tab press should reveal it and activating it should move
 * focus past the banner and menus into the page's own content.
 *
 * Three things have to hold, and each fails differently:
 *   1. one Tab reaches it, and focusing it makes it visible;
 *   2. activating it moves focus *into* the main content, not merely scrolls;
 *   3. the target really is the content region -- a link whose target still
 *      contains the navigation has bypassed nothing.
 *
 * Note on (1): this checks the tab order the browser would follow -- the link
 * must be the first keyboard-reachable element in the document, with nothing
 * jumping ahead of it via a positive tabindex -- and then focuses it to
 * observe the reveal. Walking it with real presses would need the debugger
 * attached on every page of the sweep, which is not worth a banner on all of
 * them for a first-stop check; see eaa.client-dialog for that approach.
 */
window.__AUT__.suite('eaa.skip-link', async function (t) {
    const SKIP_LINK = 'a.eaa-skip-link, a.skip-to-main';
    // Global chrome the link is supposed to bypass.
    const CHROME = ['#TopBanner', '#mainMenu', '#tabMenu'];
    const NATIVELY_FOCUSABLE = /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/;

    const describe = (el) => {
        if (!el) return 'nothing';
        const id = el.id ? `#${el.id}` : '';
        const cls = !id && typeof el.className === 'string' && el.className
            ? `.${el.className.split(/\s+/)[0]}`
            : '';
        return `${el.tagName.toLowerCase()}${id}${cls}`;
    };

    /**
     * Can the keyboard reach this element? Deliberately not t.visible(): the
     * skip link is clipped off-screen by design and must still be reachable,
     * whereas display:none / visibility:hidden removes it from the tab order.
     */
    const keyboardReachable = (el) => {
        if (el.disabled || el.getAttribute('aria-hidden') === 'true') return false;
        if (Number(el.getAttribute('tabindex')) < 0) return false;
        for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
            const cs = getComputedStyle(node);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') {
                return false;
            }
        }
        return true;
    };

    /* --- is the feature even in this build? ------------------------------ */

    if (!window.EAAPlugin) {
        return t.skip('this build has no EAA plugin (js/eaa-plugin.js is not loaded)');
    }

    // The plugin runs its enhancement pass on a timer, so give it a moment.
    const link = await t.waitFor(() => t.$(SKIP_LINK), 5000);
    if (!link) {
        return t.fail(
            'no skip link on this page — EAAPlugin is loaded but addSkipToContentLink() ' +
                'added nothing, most likely because findMainContentArea() found no content region'
        );
    }

    /* --- 1. one Tab reaches it, and focusing it reveals it --------------- */

    const links = t.$$(SKIP_LINK);
    t.check(links.length === 1, `exactly one skip link on the page (found ${links.length})`);

    const focusables = t
        .$$('a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]')
        .filter(keyboardReachable);
    t.check(focusables[0] === link, 'the skip link is the first element Tab reaches', {
        firstWas: describe(focusables[0]),
    });

    // A positive tabindex anywhere jumps ahead of document order, so the link
    // would no longer be the first stop however early it sits in the DOM.
    const queueJumpers = t.$$('[tabindex]').filter((el) => Number(el.getAttribute('tabindex')) > 0);
    t.check(queueJumpers.length === 0, 'nothing claims an explicit tab position ahead of it', {
        elements: queueJumpers.slice(0, 5).map(describe),
    });

    const atRest = link.getBoundingClientRect();
    const restCs = getComputedStyle(link);
    t.check(
        restCs.display !== 'none' && restCs.visibility !== 'hidden',
        'it is hidden by clipping rather than display:none, so it keeps its tab stop'
    );
    const offScreenAtRest =
        atRest.right <= 0 ||
        atRest.bottom <= 0 ||
        atRest.left >= innerWidth ||
        atRest.top >= innerHeight;
    t.check(offScreenAtRest, 'it stays off-screen until focused', {
        rect: { left: Math.round(atRest.left), top: Math.round(atRest.top) },
    });

    link.focus();
    await t.sleep(100);
    if (!t.check(document.activeElement === link, 'it accepts keyboard focus')) return;

    const shown = link.getBoundingClientRect();
    t.check(
        shown.width > 0 &&
            shown.height > 0 &&
            shown.right > 0 &&
            shown.bottom > 0 &&
            shown.left < innerWidth &&
            shown.top < innerHeight,
        'focusing it brings it on screen',
        { rect: { left: Math.round(shown.left), top: Math.round(shown.top), w: Math.round(shown.width) } }
    );

    /* --- 2. it points at something focusable ----------------------------- */

    const href = link.getAttribute('href') || '';
    const targetId = href.startsWith('#') ? href.slice(1) : '';
    if (!targetId) return t.fail(`the link's href is "${href}", not a fragment`);

    const target = document.getElementById(targetId);
    if (!target) return t.fail(`href "#${targetId}" does not resolve to any element`);

    t.check(
        target.hasAttribute('tabindex') || NATIVELY_FOCUSABLE.test(target.tagName),
        'the target is programmatically focusable, so activating the link moves focus ' +
            'and does not merely scroll',
        { target: describe(target) }
    );

    /* --- 3. the target is the content, not the whole page ---------------- */

    t.check(
        target !== document.body && target !== document.documentElement,
        'the target is a content region rather than the whole document',
        { target: describe(target) }
    );

    const notBypassed = CHROME.filter((sel) => {
        const el = t.$(sel);
        return el && target.contains(el);
    });
    t.check(notBypassed.length === 0, 'the target sits past the banner and the menus', {
        stillInsideTarget: notBypassed,
    });

    const box = target.getBoundingClientRect();
    t.check(box.width > 0 && box.height > 0, 'the target region is rendered', {
        target: describe(target),
        size: { w: Math.round(box.width), h: Math.round(box.height) },
    });

    /* --- 4. activating it actually lands there --------------------------- */

    link.click();
    await t.sleep(250);

    const landed = document.activeElement;
    t.check(
        landed === target || target.contains(landed),
        'activating the link moves focus into the main content',
        { focusedAfterClick: describe(landed), expectedWithin: describe(target) }
    );
});
