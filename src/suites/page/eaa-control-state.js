/**
 * eaa.control-state -- custom controls declare what they are and what state
 * they are in. EN 301 549 9.4.1.2 (Name, Role, Value), 9.1.3.1.
 *
 * Around thirty findings say a variant of the same sentence: 「控件狀態缺失」,
 * 「缺少控件選中狀態」, 「朗讀錯誤」. The ASUSWRT UI builds its switches, tabs and
 * menus out of `div`s with click handlers and CSS classes, so what a sighted
 * user reads from a highlighted tab or a slid-over toggle has no programmatic
 * counterpart at all: the class changes, and nothing else does.
 *
 * This item is deliberately about *state*, not names -- eaa.a11y-name owns
 * names, eaa.keyboard owns operability, and a switch that is unnamed,
 * unfocusable and stateless should produce one finding from each rather than
 * three copies of the same row.
 *
 * The hard part is deciding what a `div` is *meant* to be. Nothing in the DOM
 * says "this is a switch". So the detection is by the vocabulary this UI
 * actually uses -- `iconSwitch`, `switch_container`, `.tab`, `#tabMenu`,
 * `.menu_clicked` -- plus ARIA roles wherever they are already present. That
 * makes the checks specific to ASUSWRT on purpose: a generic "some div might
 * be a control" would drown the report.
 */
window.__AUT__.suite('eaa.control-state', async function (t) {
    var A = window.__AUT__.a11y;

    /* The UI's own vocabulary for a two-state control. */
    var SWITCH_SELECTOR =
        '[role="switch"], .switch_container, .iconSwitch, .switch, .sw_container, ' +
        '[id$="_switch"], [class*="switchButton"]';
    /* ...and for a tab. */
    var TAB_SELECTOR = '[role="tab"], #tabMenu li, .tab, .tabclick, [class*="tab_NW"]';
    /* ...and for the item you are currently on. */
    var MENU_SELECTOR = '#mainMenu a, #tabMenu a, .menu_clicked, .selected, .current, [class*="_active"]';

    var TRISTATE = /^(true|false|mixed)$/;

    var visible = function (el) {
        return A.isRendered(el) && !A.isAriaHidden(el);
    };

    var switches = t.$$(SWITCH_SELECTOR).filter(visible);
    var tabs = t.$$(TAB_SELECTOR).filter(visible);
    var menuItems = t.$$(MENU_SELECTOR).filter(visible);
    var improvised = t.$$('div, span, td, li').filter(function (el) {
        return A.looksClickable(el) && visible(el);
    });
    var ariaBearing = t.$$('[role], [aria-checked], [aria-selected], [aria-expanded], [aria-current]');

    if (!switches.length && !tabs.length && !menuItems.length && !improvised.length && !ariaBearing.length) {
        return t.skip('this page has no custom controls or ARIA state to check');
    }

    /* --- 1. two-state controls need a role and a state ------------------- */

    var statelessSwitches = [];
    switches.forEach(function (el) {
        // A real checkbox already has both, whatever it is styled to look like.
        if (el.tagName === 'INPUT' && /^(checkbox|radio)$/.test((el.getAttribute('type') || '').toLowerCase())) {
            return;
        }
        // Some switches are a styled label wrapping the real input.
        if (el.querySelector && el.querySelector('input[type="checkbox"], input[type="radio"]')) return;

        var role = (el.getAttribute('role') || '').toLowerCase();
        var state = el.getAttribute('aria-checked') || el.getAttribute('aria-pressed');
        var missing = [];
        if (role !== 'switch' && role !== 'checkbox' && role !== 'button') missing.push('role="switch"');
        if (state === null) missing.push('aria-checked');
        if (missing.length) {
            statelessSwitches.push({ el: el, extra: { role: role || '(none)', missing: missing } });
        }
    });
    var switchProblems = A.findings(t, {
        severity: 'fail',
        elements: statelessSwitches.map(function (entry) {
            return { el: entry.el, extra: entry.extra };
        }),
        what: 'is a switch with no programmatic state',
        why: 'add role="switch" and aria-checked, or use a real checkbox — on/off is invisible without it',
    });
    if (!switchProblems && switches.length) {
        t.pass('all ' + switches.length + ' switch-like control(s) expose their state');
    }

    /* --- 2. tabs need a role and a selected state ----------------------- */

    var statelessTabs = [];
    tabs.forEach(function (el) {
        var role = (el.getAttribute('role') || '').toLowerCase();
        var selected = el.getAttribute('aria-selected');
        var missing = [];
        if (role !== 'tab') missing.push('role="tab"');
        if (selected === null) missing.push('aria-selected');
        if (missing.length) el.__autMissing = missing;
        if (missing.length) statelessTabs.push({ el: el, extra: { missing: missing, role: role || '(none)' } });
    });
    A.findings(t, {
        severity: 'fail',
        elements: statelessTabs,
        what: 'is a tab with no selected state',
        why: 'which tab you are on is announced from aria-selected, not from a highlight class',
    });

    var tablistMissing = tabs
        .map(function (el) {
            return el.parentElement;
        })
        .filter(function (parent, index, list) {
            if (!parent || list.indexOf(parent) !== index) return false;
            return (parent.getAttribute('role') || '').toLowerCase() !== 'tablist';
        });
    A.findings(t, {
        severity: 'warn',
        elements: tablistMissing,
        what: 'holds tabs but is not a tablist',
        why: 'without role="tablist" the tabs are announced as unrelated controls',
    });

    /* --- 3. the item you are on ----------------------------------------- */

    var CURRENT_CLASS = /(menu_clicked|selected|current|_active|is-active)/i;
    var currentWithoutState = menuItems.filter(function (el) {
        if (!CURRENT_CLASS.test(String(el.className || ''))) return false;
        if (el.getAttribute('aria-current') || el.getAttribute('aria-selected')) return false;
        // A tab is covered above; do not report it twice.
        return (el.getAttribute('role') || '').toLowerCase() !== 'tab';
    });
    A.findings(t, {
        severity: 'fail',
        elements: currentWithoutState.map(function (el) {
            return { el: el, extra: { className: String(el.className || '') } };
        }),
        what: 'is marked as the current item by a class only',
        why: 'add aria-current="page" (or aria-selected) so the position is announced',
    });

    /* --- 4. expandable things ------------------------------------------- */

    var EXPAND_HINT = /(expand|collaps|accordion|arrow|dropdown|more_?info|show_?hide)/i;
    var expandableWithoutState = improvised.filter(function (el) {
        if (el.getAttribute('aria-expanded') !== null) return false;
        var hint = String(el.className || '') + ' ' + String(el.id || '') + ' ' + (el.getAttribute('onclick') || '');
        return EXPAND_HINT.test(hint) || el.getAttribute('aria-controls') !== null;
    });
    A.findings(t, {
        severity: 'warn',
        elements: expandableWithoutState.map(function (el) {
            return { el: el, extra: { className: String(el.className || ''), controls: el.getAttribute('aria-controls') } };
        }),
        what: 'looks like it expands something but has no aria-expanded',
        why: 'open or closed is state, and has to be readable as state',
    });

    /* --- 5. improvised controls need a role ----------------------------- */

    var roleless = improvised.filter(function (el) {
        if (el.getAttribute('role')) return false;
        // Already covered as a switch, a tab or the current item.
        if (statelessSwitches.some(function (entry) { return entry.el === el; })) return false;
        if (statelessTabs.some(function (entry) { return entry.el === el; })) return false;
        return currentWithoutState.indexOf(el) === -1;
    });
    A.findings(t, {
        severity: 'fail',
        elements: roleless.map(function (el) {
            return {
                el: el,
                extra: {
                    onclick: (el.getAttribute('onclick') || '').slice(0, 80),
                    accessibleName: A.accessibleName(el).name,
                },
            };
        }),
        what: 'responds to a click but declares no role',
        why: 'it is announced as text, so nobody knows it can be operated — use a button, or add role',
    });

    /* --- 6. ARIA that is present but wrong ------------------------------ */

    var badValues = [];
    ariaBearing.forEach(function (el) {
        ['aria-checked', 'aria-selected', 'aria-expanded', 'aria-pressed'].forEach(function (attr) {
            var value = el.getAttribute(attr);
            if (value === null) return;
            if (!TRISTATE.test(String(value).trim().toLowerCase())) {
                badValues.push({ el: el, extra: { attribute: attr, value: value } });
            }
        });
    });
    A.findings(t, {
        severity: 'fail',
        elements: badValues,
        what: 'carries an ARIA state with a value that is not true/false/mixed',
        why: 'an unparseable value is treated as absent, so the state is lost',
    });

    var typos = [];
    ariaBearing.concat(improvised).forEach(function (el) {
        var wrong = A.misspelledAria(el);
        if (wrong.length) typos.push({ el: el, extra: { attributes: wrong } });
    });
    A.findings(t, {
        severity: 'fail',
        elements: typos,
        what: 'has an attribute that looks like ARIA but is not in the vocabulary',
        why: 'a typo in an ARIA attribute is silent — nothing warns, and the state simply never arrives',
    });

    /* --- 7. role nesting ------------------------------------------------ */

    var INTERACTIVE_ROLE = /^(button|link|checkbox|switch|tab|menuitem|option|radio)$/;
    var nested = [];
    t.$$('[role]').forEach(function (el) {
        var role = (el.getAttribute('role') || '').toLowerCase();
        if (!INTERACTIVE_ROLE.test(role)) return;
        var inside = el.querySelectorAll
            ? [].slice.call(el.querySelectorAll('a[href], button, input, select, textarea, [role]'))
            : [];
        var offenders = inside.filter(function (child) {
            var childRole = (child.getAttribute('role') || '').toLowerCase();
            return INTERACTIVE_ROLE.test(childRole) || A.isFocusable(child);
        });
        if (offenders.length) {
            nested.push({
                el: el,
                extra: { role: role, contains: offenders.slice(0, 4).map(A.describe) },
            });
        }
    });
    A.findings(t, {
        severity: 'warn',
        elements: nested,
        what: 'is an interactive role containing another interactive element',
        why: 'the inner control is unreachable for some assistive technology; flatten the nesting',
    });
});
