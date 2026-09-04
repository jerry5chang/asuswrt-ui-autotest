/**
 * eaa.page-structure -- the document says what it is and how it is organised.
 * EN 301 549 9.1.3.1, 9.2.4.1 (Bypass Blocks), 9.2.4.2 (Page Titled),
 * 9.3.1.1 (Language of Page), 9.1.4.12 (Text Spacing).
 *
 * Fewer findings than the other groups -- about twelve -- but they are the
 * cheapest to check and they apply to all 76 pages, so a single defect here is
 * 76 defects in the audit's terms. Two of them are specific and instructive:
 *
 *   - 「錯誤的使用了表格結構」: a layout table around a form. A screen reader
 *     announces "table with 4 rows" and reads coordinates at the user, because
 *     the markup claims the rows and columns *mean* something.
 *   - 「頁面中可瀏覽到多處不可見的元素」: content hidden visually but not from
 *     assistive technology, which is the mirror image of the skip link.
 *
 * Text spacing (1.4.12) is measured by *doing* it: the suite injects the
 * spacing the criterion requires, re-measures, and removes the style again.
 * That is the only way to answer it, and it is why this suite has to clean up
 * after itself.
 *
 * Reflow at 320px is deliberately not here: the viewport cannot be resized
 * from inside the page. `core.layout-overflow` covers horizontal overflow at
 * the current width, and a real 320px check needs the driver to call
 * Emulation.setDeviceMetricsOverride -- see docs/EAA-TEST-PLAN.md.
 */
window.__AUT__.suite('eaa.page-structure', async function (t) {
    var A = window.__AUT__.a11y;

    /* --- 1. language and title ------------------------------------------ */

    var html = document.documentElement;
    var lang = (html.getAttribute('lang') || '').trim();
    t.check(!!lang, 'the document declares a language', {
        lang: lang || '(none)',
        why: 'without lang, a screen reader reads the page with the wrong pronunciation rules',
    });
    if (lang) {
        t.check(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang), 'the declared language is a valid tag', {
            lang: lang,
        });
    }

    var title = (document.title || '').trim();
    t.check(!!title, 'the page has a title', { title: title || '(empty)' });
    if (title) {
        t.check(
            title.length > 3 && !/^(index|untitled|document|asus)$/i.test(title),
            'the title says something about this page',
            { title: title }
        );
    }

    /* --- 2. headings ---------------------------------------------------- */

    var headings = t.$$('h1, h2, h3, h4, h5, h6').filter(function (el) {
        return A.isRendered(el) && !A.isAriaHidden(el);
    });
    var h1s = headings.filter(function (el) {
        return el.tagName === 'H1';
    });

    if (!headings.length) {
        t.warn('this page has no headings at all, so it cannot be navigated by structure', {
            why: 'heading navigation is how screen-reader users skim a page',
        });
    } else {
        t.check(h1s.length >= 1, 'the page has an h1', { headings: headings.length });
        if (h1s.length > 1) {
            A.findings(t, {
                severity: 'warn',
                elements: h1s.slice(1),
                what: 'is a second h1 on the page',
                why: 'one h1 names the page; the rest should be h2 and below',
            });
        }

        var skipped = [];
        var previousLevel = 0;
        headings.forEach(function (el) {
            var level = Number(el.tagName.slice(1));
            if (previousLevel && level > previousLevel + 1) {
                skipped.push({ el: el, extra: { from: 'h' + previousLevel, to: el.tagName.toLowerCase() } });
            }
            previousLevel = level;
        });
        A.findings(t, {
            severity: 'warn',
            elements: skipped,
            what: 'skips a heading level',
            why: 'the outline is read as a tree, and a missing level breaks the nesting',
        });
    }

    /* --- 3. landmarks --------------------------------------------------- */

    var main = t.$('main, [role="main"]');
    t.check(!!main, 'the page has a main landmark', {
        why: 'the skip link needs somewhere to land, and "skip to content" means this element',
    });
    var nav = t.$('nav, [role="navigation"]');
    if (!nav) {
        t.warn('the page has no navigation landmark', {
            why: 'the menus are the same on every page; a landmark is what lets you jump past them',
        });
    }

    /* --- 4. tables: data or layout, and say which ----------------------- */

    var tables = t.$$('table').filter(function (el) {
        return A.isRendered(el);
    });
    var missingHeaders = [];
    var layoutTables = [];
    var scopeless = [];

    tables.forEach(function (table) {
        var role = (table.getAttribute('role') || '').toLowerCase();
        if (role === 'presentation' || role === 'none') return; // declared as layout: fine

        var ths = table.querySelectorAll ? [].slice.call(table.querySelectorAll('th')) : [];
        var rows = table.rows ? table.rows.length : (table.querySelectorAll ? table.querySelectorAll('tr').length : 0);
        var controls = table.querySelectorAll
            ? table.querySelectorAll('input, select, textarea, button').length
            : 0;
        var cells = table.querySelectorAll ? table.querySelectorAll('td').length : 0;

        // A table full of form controls and without a single header is the
        // layout-table pattern the audit flagged.
        if (!ths.length && controls > 0) {
            layoutTables.push({ el: table, extra: { rows: rows, controls: controls } });
            return;
        }
        if (!ths.length && rows > 1 && cells > rows) {
            missingHeaders.push({ el: table, extra: { rows: rows, cells: cells } });
            return;
        }
        ths.forEach(function (th) {
            if (!th.getAttribute('scope') && !th.getAttribute('abbr')) scopeless.push(th);
        });
    });

    A.findings(t, {
        severity: 'fail',
        elements: layoutTables,
        what: 'is a table used for layout without declaring it',
        why: 'add role="presentation", or the rows and columns are announced as if they meant something',
    });
    A.findings(t, {
        severity: 'fail',
        elements: missingHeaders,
        what: 'is a data table with no header cells',
        why: 'add th (with scope), so a cell can be read together with what it is under',
    });
    A.findings(t, {
        severity: 'warn',
        elements: scopeless,
        what: 'is a header cell with no scope',
        why: 'scope="col" or "row" is what associates the header with its cells',
    });
    if (tables.length && !layoutTables.length && !missingHeaders.length) {
        t.pass('all ' + tables.length + ' table(s) declare their structure');
    }

    /* --- 5. frames need names ------------------------------------------- */

    var frames = t.$$('iframe, frame').filter(function (el) {
        return !A.isAriaHidden(el);
    });
    A.findings(t, {
        severity: 'fail',
        elements: frames.filter(function (el) {
            return !(el.getAttribute('title') || '').trim() && !A.accessibleName(el).name;
        }),
        what: 'is a frame with no title',
        why: 'the frame list is a navigation aid, and an untitled frame is announced as "frame"',
        detail: function (el) {
            return { src: el.getAttribute('src') || '' };
        },
    });

    /* --- 6. hidden to the eye, present to the reader -------------------- */

    /*
     * Content moved off screen (or given zero size) without being hidden from
     * assistive technology. The skip link does this on purpose and reveals
     * itself on focus, so only elements that carry text and are *not*
     * focusable are reported.
     */
    var ghosts = t
        .$$('p, span, div, li, td, h1, h2, h3, label')
        .filter(function (el) {
            if (A.isAriaHidden(el) || A.isFocusable(el)) return false;
            if (!A.directText(el)) return false;
            if (!A.isRendered(el)) return false; // display:none is hidden from both
            var box = el.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) return true;
            return box.right <= 0 || box.bottom <= 0;
        });
    A.findings(t, {
        severity: 'warn',
        elements: ghosts,
        max: 8,
        what: 'has text but is not visible, while still being readable by assistive technology',
        why: 'hide it with display:none or aria-hidden, or make it visible — not one and not the other',
        detail: function (el) {
            return { text: A.directText(el).slice(0, 60) };
        },
    });

    /* --- 7. text spacing (1.4.12), measured by applying it -------------- */

    var body = document.body;
    if (body) {
        var before = body.scrollHeight;
        var overflowingBefore = countClipped();
        var style = document.createElement('style');
        style.id = '__aut_text_spacing';
        style.textContent =
            '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; ' +
            'word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';
        document.head.appendChild(style);
        await t.sleep(120);

        var overflowingAfter = countClipped();
        var newlyClipped = overflowingAfter - overflowingBefore;

        // Put the page back before asserting, so a failure cannot leave the
        // DUT's stylesheet modified for the suites that follow.
        if (style.parentNode) style.parentNode.removeChild(style);
        await t.sleep(60);

        t.check(
            newlyClipped <= 0,
            'no content is clipped when the required text spacing is applied',
            {
                clippedBefore: overflowingBefore,
                clippedAfter: overflowingAfter,
                bodyHeightBefore: before,
                why: 'WCAG 1.4.12: line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em',
            }
        );
    }

    /** Elements whose own content does not fit inside them. */
    function countClipped() {
        var all = t.$$('div, p, span, td, li, label, button, a');
        var clipped = 0;
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (!A.directText(el)) continue;
            var cs = getComputedStyle(el);
            if (cs.overflow === 'visible' || cs.overflow === '') continue;
            if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) clipped++;
        }
        return clipped;
    }
});
