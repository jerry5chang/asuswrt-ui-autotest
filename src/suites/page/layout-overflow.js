/**
 * core.layout-overflow -- catch layout breakage that a page-load test misses.
 * Reports horizontal document overflow and visible elements that stick out
 * past the right edge of the viewport.
 */
window.__AUT__.suite('core.layout-overflow', async function (t) {
    const docEl = document.documentElement;
    const viewport = docEl.clientWidth;
    const overflow = docEl.scrollWidth - viewport;

    // Sub-pixel rounding and scrollbars routinely produce a few px; ignore those.
    const SLACK = 8;

    if (overflow > SLACK) {
        t.warn(`document overflows horizontally by ${overflow}px`, {
            scrollWidth: docEl.scrollWidth,
            clientWidth: viewport,
        });
    }

    const offenders = [];
    for (const el of t.$$('body *')) {
        if (offenders.length >= 10) break;
        if (!t.visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.width > viewport * 2) continue;
        if (r.right - viewport > SLACK) {
            // Only report the outermost offender of a subtree.
            if (offenders.some((o) => o.el.contains(el))) continue;
            offenders.push({ el, over: Math.round(r.right - viewport) });
        }
    }

    for (const o of offenders) {
        const id = o.el.id ? `#${o.el.id}` : o.el.className ? `.${String(o.el.className).split(/\s+/)[0]}` : '';
        t.warn(`${o.el.tagName.toLowerCase()}${id} extends ${o.over}px past the viewport`);
    }

    if (overflow <= SLACK && offenders.length === 0) t.pass('no horizontal overflow');
});
