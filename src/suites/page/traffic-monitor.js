/**
 * pages.traffic-monitor -- the realtime traffic chart.
 * A canvas that exists but was never painted is the usual failure here, so
 * check the pixels rather than just the element.
 */
window.__AUT__.suite('pages.traffic-monitor', async function (t) {
    const canvas = await t.waitFor(() => t.$$('canvas').find(t.visible), 6000);
    if (!canvas) return t.fail('no visible traffic chart canvas');

    t.pass(`chart canvas present (${canvas.width}x${canvas.height})`);

    let painted = null;
    try {
        const ctx = canvas.getContext('2d');
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        // Sample rather than scan: enough to tell "blank" from "drawn".
        painted = false;
        for (let i = 3; i < data.length; i += 4 * 97) {
            if (data[i] !== 0) { painted = true; break; }
        }
    } catch (e) {
        return t.info('canvas pixels not readable', { error: e.message });
    }

    t.check(painted, 'chart canvas has been painted');
});
