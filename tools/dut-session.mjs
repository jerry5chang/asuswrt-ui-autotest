/**
 * Minimal authenticated ASUSWRT session for the self-test harness.
 * Mirrors the auth v2 flow in src/background/auth.js so the harness can talk
 * to a real DUT the same way the extension does.
 */

/* Captured up front: the harness swaps globalThis.fetch while running an
 * injected page-world function, and this module must not follow it there. */
const nodeFetch = globalThis.fetch;

const CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const UA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function randomString(n) {
    const buf = new Uint32Array(n);
    crypto.getRandomValues(buf);
    let out = '';
    for (let i = 0; i < n; i++) out += CHARS[buf[i] % CHARS.length];
    return out;
}

async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function connect(origin, username, password) {
    let cookie = '';

    const raw = (path, init = {}) =>
        nodeFetch(new URL(path, origin), {
            redirect: 'manual',
            ...init,
            headers: {
                'User-Agent': UA,
                Referer: `${origin}/index.asp`,
                ...(cookie ? { Cookie: cookie } : {}),
                ...(init.headers || {}),
            },
        });

    const id = randomString(10);
    const cnonce = randomString(32);

    const nonceRes = await raw('/get_Nonce.cgi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
    });
    const { nonce } = await nonceRes.json();

    const authorization = await sha256Hex(`${username}:${nonce}:${password}:${cnonce}`);

    const loginRes = await raw('/login_v2.cgi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            group_id: '',
            action_mode: '',
            action_script: '',
            action_wait: '5',
            current_page: 'Main_Login.asp',
            next_page: '',
            login_authorization: authorization,
            id,
            cnonce,
            login_captcha: '',
        }).toString(),
    });

    const setCookie = loginRes.headers.getSetCookie
        ? loginRes.headers.getSetCookie()
        : [loginRes.headers.get('set-cookie')].filter(Boolean);
    cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    if (!/asus_token/.test(cookie)) throw new Error('auth v2 login failed: no session cookie issued');

    const probe = await raw('/appGet.cgi?hook=uptime()');
    if (!(await probe.text()).trim().startsWith('{')) {
        throw new Error('auth v2 login failed: session is not usable');
    }

    return {
        origin,
        /** A fetch with the DUT session attached, for the page-world stub. */
        fetch: (input, init) => raw(typeof input === 'string' ? input : String(input), init),
    };
}
