/**
 * pages.qis-wizard -- Quick Internet Setup wizard.
 *
 * QIS_V3 is one document holding every step as a jQuery Mobile page
 * (`<div id="welcome" data-role="page">`, `prelink_desc`, `advanced_setting`,
 * …) with exactly one shown at a time. A plain page-load test therefore tells
 * you almost nothing: the document can load fine with every step hidden.
 */
window.__AUT__.suite('pages.qis-wizard', async function (t) {
    // jQuery Mobile only stamps its own classes once it has initialised, so
    // wait for the panes rather than reading the DOM the instant we are run.
    const panes = await t.waitFor(() => {
        const found = t.$$('div[data-role="page"]');
        return found.length ? found : null;
    }, 6000);

    if (!panes) return t.fail('no QIS panes found (expected div[data-role="page"])');

    const shown = panes.filter(t.visible);
    if (shown.length === 0) {
        return t.fail(`${panes.length} QIS panes exist but none is visible`);
    }
    if (shown.length > 1) {
        t.warn(`${shown.length} QIS panes visible at once`, {
            ids: shown.map((el) => el.id || '(no id)'),
        });
    } else {
        t.pass(`showing QIS step "${shown[0].id || '(no id)'}" of ${panes.length}`);
    }

    // The wizard must not have quietly bounced back to the login page.
    t.check(!/Main_Login/i.test(location.pathname), 'wizard did not bounce to the login page');

    // Every step needs a way forward, or the user is stranded.
    const advance = t.$$('input[type="button"], button, .welcome_button, .action_button')
        .filter((el) => t.visible(el) && shown.some((pane) => pane.contains(el)));
    t.check(advance.length > 0, 'the visible step offers a control to continue');
});
