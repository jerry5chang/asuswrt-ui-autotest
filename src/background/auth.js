/**
 * ASUSWRT auth v2 login.
 *
 * The DUT dropped the old login.cgi + Base64 scheme; that path now always
 * fails. The v2 flow is:
 *
 *   1. POST /get_Nonce.cgi  {id}                 -> {nonce}
 *   2. client picks a 32-char cnonce
 *   3. login_authorization = SHA256(user:nonce:pass:cnonce)
 *   4. POST /login_v2.cgi   {login_authorization, id, cnonce}
 *
 * Reference: httpd/web.c do_login_v2_cgi(), httpd/web_hook.c
 *            validate_httpd_auth_v2().
 *
 * Split across two worlds on purpose:
 *   - the network calls run in the page's MAIN world, so Set-Cookie lands on
 *     the DUT origin exactly as a real login would;
 *   - the SHA-256 runs here in the service worker, because http://<router-ip>
 *     is not a secure context and therefore has no crypto.subtle.
 */

async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Step 1: ask the DUT for a nonce and pick our cnonce. */
function getNonceFn() {
    function randomString(length) {
        var chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        var out = '';
        var buf = new Uint32Array(length);
        crypto.getRandomValues(buf);
        for (var i = 0; i < length; i++) out += chars[buf[i] % chars.length];
        return out;
    }

    return (async function () {
        var id = randomString(10);
        var cnonce = randomString(32);
        try {
            var res = await fetch('/get_Nonce.cgi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id }),
                credentials: 'same-origin',
            });
            if (!res.ok) return { ok: false, reason: 'get_Nonce.cgi returned ' + res.status };
            var data = await res.json();
            if (!data || !data.nonce) return { ok: false, reason: 'get_Nonce.cgi returned no nonce' };
            return { ok: true, id: id, cnonce: cnonce, nonce: data.nonce };
        } catch (e) {
            return { ok: false, reason: 'get_Nonce.cgi failed: ' + e.message };
        }
    })();
}

/** Step 4: post the authorization and confirm the session really works. */
function submitLoginFn(payload) {
    return (async function () {
        try {
            var body = new URLSearchParams({
                group_id: '',
                action_mode: '',
                action_script: '',
                action_wait: '5',
                current_page: 'Main_Login.asp',
                next_page: '',
                login_authorization: payload.authorization,
                id: payload.id,
                cnonce: payload.cnonce,
                login_captcha: '',
            });

            var res = await fetch('/login_v2.cgi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
                credentials: 'same-origin',
            });
            var text = await res.text();

            // login_v2.cgi answers 200 either way, so verify with a real hook.
            var probe = await fetch('/appGet.cgi?hook=uptime()', { credentials: 'same-origin' });
            var probeText = await probe.text();
            var authed = probe.ok && probeText.trim().charAt(0) === '{';

            if (!authed) {
                var m = /"error_status"\s*:\s*"?(\d+)/.exec(text);
                return {
                    ok: false,
                    reason: m ? 'login rejected (error_status ' + m[1] + ')' : 'login rejected by the DUT',
                };
            }
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: 'login_v2.cgi failed: ' + e.message };
        }
    })();
}

/** Is the current tab still holding a valid session? */
export async function isLoggedIn(tabId) {
    try {
        const [{ result } = {}] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () =>
                fetch('/appGet.cgi?hook=uptime()', { credentials: 'same-origin' })
                    .then((r) => (r.ok ? r.text() : ''))
                    .then((t) => t.trim().charAt(0) === '{')
                    .catch(() => false),
        });
        return !!result;
    } catch (e) {
        return false;
    }
}

/**
 * Log the tab's origin in with auth v2.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function loginAuthV2(tabId, username, password) {
    if (!username) return { ok: false, reason: 'no username configured' };

    let step1;
    try {
        [{ result: step1 } = {}] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: getNonceFn,
        });
    } catch (e) {
        return { ok: false, reason: 'could not inject into the tab: ' + e.message };
    }
    if (!step1 || !step1.ok) return { ok: false, reason: (step1 && step1.reason) || 'nonce step failed' };

    const authorization = await sha256Hex(`${username}:${step1.nonce}:${password}:${step1.cnonce}`);

    const [{ result: step2 } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: submitLoginFn,
        args: [{ id: step1.id, cnonce: step1.cnonce, authorization }],
    });
    return step2 || { ok: false, reason: 'login step returned nothing' };
}
