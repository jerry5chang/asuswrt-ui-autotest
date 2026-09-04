/**
 * core.dom-sanity -- did the page actually render anything?
 * Catches the classic "white page" regression where a JS error early in the
 * page stops the UI from being drawn at all.
 */
window.__AUT__.suite('core.dom-sanity', async function (t) {
    const body = document.body;
    if (!body) return t.fail('document.body is missing');

    const text = (body.innerText || '').replace(/\s+/g, ' ').trim();
    const controls = t.$$('input, select, button, table, canvas, svg, a[href]').filter(t.visible);

    if (text.length < 10 && controls.length === 0) {
        return t.fail('page rendered nothing', { textLength: text.length });
    }

    // ASUSWRT shows a full-screen "Loading..." / hourglass overlay while it
    // waits on the DUT. Still up after the settle window means it is stuck.
    const stuck = t.$$('#Loading, .Loading, #loadingIcon, .loadingIcon')
        .filter((el) => t.visible(el) && el.getBoundingClientRect().height > 40);
    if (stuck.length) {
        return t.fail('page is still showing a loading overlay', { count: stuck.length });
    }

    if (controls.length === 0) {
        return t.warn('page has text but no visible controls', { textLength: text.length });
    }

    t.pass(`rendered ${controls.length} visible controls`);
});
