/**
 * pages.apply-button -- the pattern for testing buttons that would otherwise
 * take the DUT off the network.
 *
 * The trick: do not verify that the router *did* the thing. Verify that the UI
 * *sent* the right request. Safe Mode (src/page/instrument.js) records the
 * outgoing call and then re-points it at a harmless read-only hook, so the
 * click is fully exercised -- validation, payload assembly, callbacks -- while
 * restart_net / reboot never reach rc_service.
 *
 * Copy this file as the starting point for new button tests.
 */
window.__AUT__.suite('pages.apply-button', async function (t) {
    if (!t.safeMode()) {
        return t.skip('Safe Mode is off; refusing to click Apply on a live DUT');
    }

    const apply = t.$$('input[type="button"], button, .button_gen, #applyButton')
        .filter(t.visible)
        .find((el) => /apply|套用|應用|保存/i.test(el.value || el.textContent || ''));

    if (!apply) return t.skip('no Apply control on this page');

    const before = t.recordedApis().length;
    t.click(apply);

    // ASUSWRT applies through applyapp.cgi (httpApi) or a start_apply form post.
    const sent = await t.expectApi(
        (r) =>
            /applyapp\.cgi|apply\.cgi|start_apply/.test(r.path) ||
            r.via.startsWith('httpApi.') ||
            r.via.startsWith('form:'),
        6000
    );

    if (!sent) {
        const after = t.recordedApis().length;
        return t.fail('Apply was clicked but no settings request was sent', {
            newRequests: after - before,
        });
    }

    t.pass(`Apply sent ${sent.via} (${sent.path})`, {
        action_mode: sent.params.action_mode || null,
        action_script: sent.params.action_script || null,
    });

    if (sent.risk) {
        t.check(
            sent.blocked,
            `risky action_script "${sent.risk}" was intercepted instead of executed`
        );
    } else {
        t.info('request carried no risky action_script');
    }
});
