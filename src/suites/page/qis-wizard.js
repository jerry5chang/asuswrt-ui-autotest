/**
 * pages.qis-wizard -- Quick Internet Setup wizard.
 * The wizard is a single page that swaps between numbered panes, so a plain
 * page-load test tells you almost nothing. Check that a pane is actually shown.
 */
window.__AUT__.suite('pages.qis-wizard', async function (t) {
    const panes = t.$$('[id^="QIS_"], .qis-page, #qis_container > div');
    if (panes.length === 0) return t.fail('no QIS panes found in the DOM');

    const shown = panes.filter(t.visible);
    if (shown.length === 0) {
        return t.fail(`${panes.length} QIS panes exist but none is visible`);
    }
    t.pass(`${shown.length}/${panes.length} QIS pane(s) visible`);

    const next = await t.waitFor(
        () => t.$$('#nextButton, .btn_next, input[value="Next"]').find(t.visible),
        3000
    );
    t.check(!!next, 'wizard has a usable Next control');

    // The wizard must not have silently fallen back to the login page.
    t.check(
        !/Main_Login/i.test(location.pathname),
        'wizard did not bounce to the login page'
    );
});
