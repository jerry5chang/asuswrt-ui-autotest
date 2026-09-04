/**
 * eaa.feedback -- what the page tells you, it tells everyone.
 * EN 301 549 9.4.1.3 (Status Messages), 9.3.3.1 (Error Identification),
 * 9.3.3.3 (Error Suggestion), 9.3.2.2 (On Input).
 *
 * The smallest group -- eight findings -- and the one that most obviously
 * cannot be fully automated, so it is scoped to the part that can:
 *
 *   - 「操作設備的 reconnect 後出現的提示信息未及時朗讀」: the message appears
 *     visually and is never announced, because the container it lands in is
 *     not a live region. That is decidable from the DOM: find the containers
 *     this UI writes messages into, and check them.
 *   - 「反覆發送相同的密碼強度通知」: an assertive live region updated on every
 *     keystroke. Also decidable: an `aria-live="assertive"` region on a
 *     continuously-updating widget is the defect.
 *   - error text that is not tied to the field it is about (aria-invalid,
 *     aria-describedby).
 *
 * What is left to a person, and said so in the report: whether the wording
 * actually suggests a correction (9.3.3.3), and the 「錯誤消息死循環」 finding,
 * which needs a multi-step interaction and a judgement about what a loop is.
 *
 * The containers are matched by this UI's own vocabulary, because a status
 * message has no marker of its own -- that is precisely the defect.
 */
window.__AUT__.suite('eaa.feedback', async function (t) {
    var A = window.__AUT__.a11y;

    /* Where ASUSWRT puts things it wants to tell you. */
    var STATUS_SELECTOR = [
        '#alert_msg', '.alert_msg', '#hint_block', '.hint_block',
        '#error_status_field', '.error_hint', '[class*="error_hint"]',
        '#loadingBlock', '#loading_block', '.status_msg', '[id*="_status_msg"]',
        '[class*="notice"]', '[id*="notification"]',
    ].join(', ');

    /* Widgets that update as you type, where an assertive region interrupts. */
    var CONTINUOUS_SELECTOR = '[id*="strength"], #scorebarBorder, [class*="scorebar"], [class*="progress"]';

    var LIVE_VALUES = /^(off|polite|assertive)$/;

    function isLiveRegion(el) {
        for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
            var live = node.getAttribute('aria-live');
            var role = (node.getAttribute('role') || '').toLowerCase();
            if ((live && live !== 'off') || role === 'status' || role === 'alert' || role === 'log') {
                return node;
            }
        }
        return null;
    }

    var statusContainers = t.$$(STATUS_SELECTOR).filter(function (el) {
        // Hidden is normal -- they are shown when there is something to say --
        // so presence is what matters here, not visibility.
        return !A.isAriaHidden(el);
    });
    var continuous = t.$$(CONTINUOUS_SELECTOR);
    var declaredLive = t.$$('[aria-live], [role="status"], [role="alert"], [role="log"]');

    /*
     * Fields carrying an error state count as something to check even on a
     * page with no message container at all -- which is how a page with one
     * red-bordered input used to be skipped entirely.
     */
    var ERROR_CLASS = /(error|invalid|warn|red)/i;
    var fields = t.$$('input:not([type="hidden"]), select, textarea');
    var fieldsInError = fields.filter(function (el) {
        if (el.getAttribute('aria-invalid') !== null) return true;
        var hint = String(el.className || '') + ' ' + String((el.parentElement && el.parentElement.className) || '');
        return ERROR_CLASS.test(hint);
    });

    if (!statusContainers.length && !continuous.length && !declaredLive.length && !fieldsInError.length) {
        return t.skip('this page has no status or error containers to check');
    }

    /* --- 1. message containers must be live regions --------------------- */

    var notLive = statusContainers.filter(function (el) {
        return !isLiveRegion(el);
    });
    var missing = A.findings(t, {
        severity: 'fail',
        elements: notLive.map(function (el) {
            return { el: el, extra: { currentText: A.directText(el).slice(0, 60) } };
        }),
        what: 'is a status container that is not a live region',
        why: 'add aria-live="polite" or role="status", or the message is only ever seen, never heard',
    });
    if (!missing && statusContainers.length) {
        t.pass('all ' + statusContainers.length + ' status container(s) are inside a live region');
    }

    /* --- 2. live regions that are declared wrongly ---------------------- */

    var badLive = [];
    declaredLive.forEach(function (el) {
        var live = el.getAttribute('aria-live');
        if (live !== null && !LIVE_VALUES.test(String(live).trim().toLowerCase())) {
            badLive.push({ el: el, extra: { 'aria-live': live } });
        }
    });
    A.findings(t, {
        severity: 'fail',
        elements: badLive,
        what: 'declares an aria-live value that is not off/polite/assertive',
        why: 'an unrecognised value is ignored, so the region announces nothing',
    });

    /* --- 3. assertive on something that updates constantly -------------- */

    var interrupting = [];
    continuous.forEach(function (el) {
        var region = isLiveRegion(el);
        if (!region) return;
        var live = (region.getAttribute('aria-live') || '').toLowerCase();
        var role = (region.getAttribute('role') || '').toLowerCase();
        if (live === 'assertive' || role === 'alert') {
            interrupting.push({ el: el, extra: { region: A.describe(region), live: live || role } });
        }
    });
    A.findings(t, {
        severity: 'warn',
        elements: interrupting,
        what: 'updates continuously inside an assertive live region',
        why: 'every keystroke interrupts the screen reader — this is the repeated password-strength ' +
            'announcement; use polite, or announce only when it changes band',
    });

    /* --- 4. errors have to be tied to their field ----------------------- */

    var unmarked = fields.filter(function (el) {
        if (el.getAttribute('aria-invalid') !== null) return false;
        var hint = String(el.className || '') + ' ' + String((el.parentElement && el.parentElement.className) || '');
        return ERROR_CLASS.test(hint);
    });
    A.findings(t, {
        severity: 'fail',
        elements: unmarked.map(function (el) {
            return { el: el, extra: { className: String(el.className || '') } };
        }),
        what: 'is styled as being in error but does not declare aria-invalid',
        why: 'the red border is the only sign, and it is not announced',
    });

    var undescribed = fields.filter(function (el) {
        if (el.getAttribute('aria-invalid') !== 'true') return false;
        return !el.getAttribute('aria-describedby') && !el.getAttribute('aria-errormessage');
    });
    A.findings(t, {
        severity: 'warn',
        elements: undescribed,
        what: 'is marked invalid but points at no message',
        why: 'aria-describedby (or aria-errormessage) is what connects the field to the reason',
    });

    /* --- 5. what a person still has to judge ---------------------------- */

    var errorText = statusContainers.filter(function (el) {
        return A.directText(el).length > 0;
    });
    if (errorText.length) {
        t.info(
            errorText.length + ' message container(s) currently hold text; whether the wording ' +
                'suggests a correction (9.3.3.3) is a human judgement',
            {
                messages: errorText.slice(0, 6).map(function (el) {
                    return { selector: A.cssPath(el), text: A.directText(el).slice(0, 80) };
                }),
            }
        );
    }
});
