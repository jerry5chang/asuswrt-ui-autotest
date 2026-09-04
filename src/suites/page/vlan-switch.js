/**
 * pages.vlan-switch -- Advanced_VLAN_Switch_Content.asp
 * Verifies the profile table rendered and the add-profile control is present.
 */
window.__AUT__.suite('pages.vlan-switch', async function (t) {
    const table = await t.waitFor(
        () => t.$$('table').find((el) => t.visible(el) && el.rows.length > 0),
        5000
    );
    if (!table) return t.fail('no VLAN table rendered');

    t.pass(`VLAN table rendered with ${table.rows.length} row(s)`);

    const addBtn = t.$$('.icon_add, #addProfile, input[type="button"]')
        .filter(t.visible)
        .find((el) => /add|新增/i.test(el.value || el.title || el.textContent || ''));
    t.check(!!addBtn, 'add-profile control present');

    // Empty tables should say so rather than render a blank body.
    const bodyText = (table.innerText || '').trim();
    t.check(bodyText.length > 0, 'VLAN table has content');
});
