/**
 * MAIN-world runtime for page test items. Injected just before the selected
 * page suites, which register themselves against it. Plain script, no imports.
 *
 * A page suite looks like:
 *
 *   window.__AUT__.suite('my.suite', async (t) => {
 *       if (!t.$('#myTable')) return t.fail('table missing');
 *       t.pass('table present');
 *   });
 */
(function () {
    'use strict';

    var AUT = (window.__AUT__ = window.__AUT__ || {});
    AUT.suites = AUT.suites || {};
    if (AUT.runtimeInstalled) return;
    AUT.runtimeInstalled = true;

    AUT.suite = function (id, fn) {
        AUT.suites[id] = fn;
    };

    function sleep(ms) {
        return new Promise(function (r) { setTimeout(r, ms); });
    }

    /*
     * ASUSWRT reads e.keyCode (state.js setDialogFocusTrap switches on it), so
     * a synthetic event carrying only `key` matches nothing. A real press sets
     * both; so does this.
     */
    var KEY_CODES = { Tab: 9, Escape: 27, Enter: 13, ' ': 32, ArrowUp: 38, ArrowDown: 40 };

    function dispatchSynthetic(target, name, options) {
        var code = KEY_CODES[name] || 0;
        var event = new KeyboardEvent('keydown', {
            key: name,
            keyCode: code,
            which: code,
            shiftKey: !!options.shift,
            bubbles: true,
            cancelable: true,
        });
        // Legacy fields are read-only accessors and the constructor does not
        // always carry them, so shadow them.
        if (event.keyCode !== code) {
            Object.defineProperty(event, 'keyCode', { value: code, configurable: true });
            Object.defineProperty(event, 'which', { value: code, configurable: true });
        }
        return target.dispatchEvent(event);
    }

    function makeContext(suiteId) {
        var results = [];

        function add(severity, message, detail) {
            results.push({
                suite: suiteId,
                severity: severity,
                message: String(message == null ? '' : message).slice(0, 1200),
                detail: detail === undefined ? null : detail,
            });
            /*
             * With verbose on, every assertion is echoed to the page's own
             * console. That is the only way to see where a suite stopped when
             * the report shows one collapsed row -- open DevTools on the DUT
             * page and read the [AUT] lines.
             *
             * console.info deliberately: instrument.js hooks error and warn,
             * so logging through those would feed our own capture.
             */
            if (AUT.cfg && AUT.cfg.verbose) {
                console.info(
                    '[AUT] ' + suiteId + ' — ' + severity + ': ' + message,
                    detail === undefined || detail === null ? '' : detail
                );
            }
        }

        var t = {
            id: suiteId,
            page: location.pathname.replace(/^\//, '') + location.search,
            doc: document,

            pass: function (m, d) { add('pass', m, d); },
            info: function (m, d) { add('info', m, d); },
            warn: function (m, d) { add('warn', m, d); },
            fail: function (m, d) { add('fail', m, d); },
            skip: function (m, d) { add('skip', m, d); },

            /** Assert helper: records pass or fail and returns the boolean. */
            check: function (ok, message, detail) {
                if (ok) t.pass(message, detail);
                else t.fail(message, detail);
                return !!ok;
            },

            $: function (sel, root) { return (root || document).querySelector(sel); },
            $$: function (sel, root) {
                return Array.prototype.slice.call((root || document).querySelectorAll(sel));
            },

            /** Rendered and not display:none / visibility:hidden / zero-sized. */
            visible: function (el) {
                if (!el) return false;
                var r = el.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) return false;
                var cs = getComputedStyle(el);
                return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
            },

            sleep: sleep,

            /** Poll `fn` until truthy. Resolves with its value, or null on timeout. */
            waitFor: function (fn, timeoutMs, stepMs) {
                var deadline = Date.now() + (timeoutMs || 5000);
                var step = stepMs || 100;
                return (function poll() {
                    var v;
                    try { v = fn(); } catch (e) { v = null; }
                    if (v) return Promise.resolve(v);
                    if (Date.now() > deadline) return Promise.resolve(null);
                    return sleep(step).then(poll);
                })();
            },

            click: function (target) {
                var el = typeof target === 'string' ? document.querySelector(target) : target;
                if (!el) return false;
                el.scrollIntoView && el.scrollIntoView({ block: 'center' });
                el.click();
                return true;
            },

            /** Everything the instrumentation has recorded on this page so far. */
            recordedApis: function () { return (AUT.apis || []).slice(); },

            /**
             * Wait for an API call matching `want` to be recorded.
             *   want: function(record) -> bool
             *      or { path?: string, params?: {k: v}, risk?: string }
             * Resolves with the record, or null on timeout. This is how a button
             * is verified: assert the request was *sent*, not that the DUT acted.
             */
            expectApi: function (want, timeoutMs) {
                var match =
                    typeof want === 'function'
                        ? want
                        : function (r) {
                              if (want.path && String(r.path).indexOf(want.path) === -1) return false;
                              if (want.risk && r.risk !== want.risk) return false;
                              if (want.params) {
                                  for (var k in want.params) {
                                      if (String(r.params[k]) !== String(want.params[k])) return false;
                                  }
                              }
                              return true;
                          };
                return t.waitFor(function () {
                    var list = AUT.apis || [];
                    for (var i = list.length - 1; i >= 0; i--) if (match(list[i])) return list[i];
                    return null;
                }, timeoutMs || 5000);
            },

            /** Is Safe Mode currently intercepting risky calls? */
            safeMode: function () { return !!(AUT.cfg && AUT.cfg.safeMode); },

            /**
             * Are key presses real? With the debugger attached the driver
             * sends trusted events, which the browser acts on -- so Tab
             * actually traverses. Without it, only handlers see the key.
             */
            realKeys: function () { return !!(AUT.input && AUT.input.available); },

            /**
             * Press a key. Trusted through the driver where possible, else a
             * synthetic keydown, which a handler still sees but which cannot
             * move focus.
             *
             * @returns {Promise<{trusted: boolean}>}
             */
            pressKey: function (name, opts) {
                var options = opts || {};

                if (!AUT.input || !AUT.input.available) {
                    var target = options.target || document.activeElement || document.body;
                    dispatchSynthetic(target, name, options);
                    return Promise.resolve({ trusted: false });
                }

                var id = ++AUT.input.seq;
                AUT.input.queue.push({ id: id, key: name, shift: !!options.shift, done: false });

                return t
                    .waitFor(function () {
                        for (var i = 0; i < AUT.input.queue.length; i++) {
                            if (AUT.input.queue[i].id === id && AUT.input.queue[i].done) return true;
                        }
                        return null;
                    }, options.timeout || 4000)
                    .then(function (ok) {
                        return { trusted: !!ok };
                    });
            },
        };

        return { t: t, results: results };
    }

    /**
     * Run the given suite ids in order. Always resolves; a throwing suite
     * becomes an `error` result rather than taking the run down.
     */
    AUT.runSuites = function (ids, perSuiteTimeoutMs) {
        var timeout = perSuiteTimeoutMs || 10000;
        var all = [];
        // Read by the driver in the same executeScript hop; kept off the
        // return value so the contract stays "an array of results".
        AUT.suiteTimings = {};

        return ids
            .reduce(function (chain, id) {
                return chain.then(function () {
                    var fn = AUT.suites[id];
                    if (typeof fn !== 'function') {
                        all.push({ suite: id, severity: 'skip', message: 'suite not loaded on this page', detail: null });
                        return;
                    }
                    var ctx = makeContext(id);
                    var startedAt = Date.now();
                    if (AUT.cfg && AUT.cfg.verbose) console.info('[AUT] ' + id + ' — start');
                    var guard = new Promise(function (resolve) {
                        setTimeout(function () { resolve('__timeout__'); }, timeout);
                    });
                    return Promise.race([Promise.resolve().then(function () { return fn(ctx.t); }), guard])
                        .then(function (r) {
                            if (r === '__timeout__') {
                                ctx.results.push({
                                    suite: id, severity: 'error',
                                    message: 'suite timed out after ' + timeout + 'ms', detail: null,
                                });
                            }
                        })
                        .catch(function (e) {
                            ctx.results.push({
                                suite: id, severity: 'error',
                                message: 'suite threw: ' + (e && e.message ? e.message : String(e)),
                                detail: e && e.stack ? String(e.stack).slice(0, 600) : null,
                            });
                        })
                        .then(function () {
                            AUT.suiteTimings[id] = Date.now() - startedAt;
                            if (AUT.cfg && AUT.cfg.verbose) {
                                console.info(
                                    '[AUT] ' + id + ' — done in ' + (Date.now() - startedAt) + 'ms, ' +
                                        ctx.results.length + ' check(s)'
                                );
                            }
                            all = all.concat(ctx.results);
                        });
                });
            }, Promise.resolve())
            .then(function () { return all; });
    };
})();
