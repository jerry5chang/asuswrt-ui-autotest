/**
 * Trusted keyboard input, via chrome.debugger.
 *
 * A page cannot make the browser move focus. `dispatchEvent` produces an
 * untrusted event: a keydown handler sees it, but Tab does not traverse,
 * Escape does not reach the browser's own handling, and nothing the user agent
 * does in response to a key happens at all. So "Tab reaches every component in
 * order" could only ever be checked as a composition -- each element accepts
 * focus, and the trap wraps at the ends -- never as a literal twelve presses.
 *
 * CDP's Input.dispatchKeyEvent produces a *trusted* event, which the browser
 * acts on. That makes the literal check possible.
 *
 * The cost is real and the reason it is not simply on:
 *   - attaching shows "... is debugging this browser" on the tab, so we attach
 *     only for the page whose suites asked for it, and detach immediately;
 *   - a tab admits one debugger client, so attaching fails while DevTools is
 *     open on it. That is reported and the suite falls back to synthetic keys
 *     rather than failing.
 */

const PROTOCOL = '1.3';

/** CDP modifier bitfield. */
const SHIFT = 8;

/**
 * What each key needs to look like to the renderer. `text` matters: a key that
 * produces text must be sent as keyDown carrying it, or the browser treats the
 * press as a bare raw key and some handling is skipped.
 */
const KEYS = {
    Tab: { code: 'Tab', keyCode: 9, text: '\t' },
    Escape: { code: 'Escape', keyCode: 27, text: '' },
    Enter: { code: 'Enter', keyCode: 13, text: '\r' },
    ' ': { code: 'Space', keyCode: 32, text: ' ' },
    ArrowUp: { code: 'ArrowUp', keyCode: 38, text: '' },
    ArrowDown: { code: 'ArrowDown', keyCode: 40, text: '' },
};

export function supportsRealKeys() {
    return typeof chrome !== 'undefined' && !!(chrome.debugger && chrome.debugger.attach);
}

/**
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function attach(tabId) {
    if (!supportsRealKeys()) return { ok: false, reason: 'the debugger API is not available' };
    try {
        await chrome.debugger.attach({ tabId }, PROTOCOL);
        return { ok: true };
    } catch (e) {
        const reason = String((e && e.message) || e);
        // The usual case by far: DevTools is open on the tab under test.
        return {
            ok: false,
            reason: /already attached/i.test(reason)
                ? 'another debugger is attached to this tab (DevTools open?)'
                : reason,
        };
    }
}

export async function detach(tabId) {
    try {
        await chrome.debugger.detach({ tabId });
    } catch (e) {
        // Already gone, or the tab closed; either way there is nothing to undo.
    }
}

/** Send one real key press. Resolves false for a key we have no mapping for. */
export async function pressKey(tabId, name, { shift = false } = {}) {
    const spec = KEYS[name];
    if (!spec) return false;

    const base = {
        key: name,
        code: spec.code,
        windowsVirtualKeyCode: spec.keyCode,
        nativeVirtualKeyCode: spec.keyCode,
        modifiers: shift ? SHIFT : 0,
    };

    try {
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            ...base,
            type: spec.text ? 'keyDown' : 'rawKeyDown',
            text: spec.text,
            unmodifiedText: spec.text,
        });
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            ...base,
            type: 'keyUp',
        });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Service the page's key-press queue while its suites run.
 *
 * The driver is blocked awaiting the suites, so it cannot answer a request
 * inline; this polls alongside instead. Deliberately only started for a page
 * whose suites declared they need real keys.
 */
export function startInputService(tabId, { evalInPage, intervalMs = 60 } = {}) {
    let stopped = false;

    const loop = (async () => {
        while (!stopped) {
            let pending = [];
            try {
                pending = await evalInPage(tabId, () => {
                    const input = window.__AUT__ && window.__AUT__.input;
                    if (!input) return [];
                    const fresh = input.queue.filter((r) => !r.taken && !r.done);
                    fresh.forEach((r) => {
                        r.taken = true;
                    });
                    return fresh.map((r) => ({ id: r.id, key: r.key, shift: r.shift }));
                });
            } catch (e) {
                pending = [];
            }

            for (const request of pending || []) {
                await pressKey(tabId, request.key, { shift: request.shift });
            }

            if (pending && pending.length) {
                try {
                    await evalInPage(
                        tabId,
                        (ids) => {
                            const input = window.__AUT__ && window.__AUT__.input;
                            if (!input) return;
                            input.queue.forEach((r) => {
                                if (ids.includes(r.id)) r.done = true;
                            });
                        },
                        [pending.map((r) => r.id)]
                    );
                } catch (e) {
                    // The page navigated; the suite's wait will time out.
                }
            }

            if (!pending || !pending.length) await new Promise((r) => setTimeout(r, intervalMs));
        }
    })();

    return {
        async stop() {
            stopped = true;
            await loop;
        },
    };
}

/** Tell the page whether its key presses will be real. */
export function setRealKeysAvailable(tabId, available, { evalInPage }) {
    return evalInPage(
        tabId,
        (flag) => {
            if (window.__AUT__ && window.__AUT__.input) window.__AUT__.input.available = flag;
            return !!(window.__AUT__ && window.__AUT__.input);
        },
        [available]
    ).catch(() => false);
}
