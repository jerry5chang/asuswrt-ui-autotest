/**
 * MAIN-world instrumentation, registered as a document_start content script for
 * the duration of a run (see background/runner.js). It must be a plain script:
 * no imports, no chrome.* APIs.
 *
 * Everything it observes is buffered in window.__AUT__.events and harvested by
 * the driver with a one-shot executeScript before the tab navigates away. That
 * keeps the page -> service-worker path free of postMessage plumbing.
 */
(function () {
    'use strict';

    if (window.__AUT__ && window.__AUT__.installed) return;

    var MAX_EVENTS = 500;
    var MAX_APIS = 400;

    var AUT = (window.__AUT__ = window.__AUT__ || {});
    AUT.installed = true;
    AUT.events = [];
    AUT.apis = [];
    AUT.suites = {};
    AUT.dropped = 0;

    /**
     * Safe defaults: Safe Mode starts ON so there is no window between
     * document_start and the driver pushing the real config in which a
     * destructive request could slip through.
     */
    AUT.cfg = {
        timeScale: 1,
        safeMode: true,
        riskyActions: [
            'restore', 'resetdefault', 'restart_defaultsetting', 'erase_nvram',
            'upgrade', 'Upload', 'reboot', 'restart_all', 'restart_net',
            'restart_net_and_phy', 'restart_wireless', 'restart_httpd',
            'restart_httpd_ssl', 'restart_wan', 'restart_wan_if', 'restart_lan',
            'restart_subnet', 'restart_dnsmasq',
        ],
        channels: { jsError: true, console: true, resource: true, uiLog: true, api: true },
    };

    AUT.configure = function (cfg) {
        if (!cfg) return;
        for (var k in cfg) if (Object.prototype.hasOwnProperty.call(cfg, k)) AUT.cfg[k] = cfg[k];
        return AUT.cfg;
    };

    function push(kind, message, detail) {
        if (AUT.events.length >= MAX_EVENTS) { AUT.dropped++; return; }
        AUT.events.push({
            kind: kind,
            message: String(message == null ? '' : message).slice(0, 1200),
            detail: detail || null,
            href: location.href,
            frame: window.top === window ? 'top' : location.pathname,
            ts: Date.now(),
        });
    }
    AUT.push = push;

    /** Hand everything collected so far to the driver and start fresh. */
    AUT.drain = function () {
        var out = { events: AUT.events, apis: AUT.apis, dropped: AUT.dropped, href: location.href };
        AUT.events = [];
        AUT.apis = [];
        AUT.dropped = 0;
        return out;
    };

    /* ------------------------------------------------------- JS errors */

    window.addEventListener(
        'error',
        function (event) {
            // Resource load failures arrive here too, with a target but no message.
            if (event.target && event.target !== window && event.target.tagName) {
                if (!AUT.cfg.channels.resource) return;
                var el = event.target;
                var src = el.src || el.href || '';
                if (!src) return;
                push('resource', el.tagName.toLowerCase() + ' failed to load: ' + src, { tag: el.tagName });
                return;
            }
            if (!AUT.cfg.channels.jsError) return;
            var from = event.filename || '';
            var suffix = from && from.indexOf(location.pathname) === -1 ? ' (' + from + ')' : '';
            push('jsError', (event.message || 'Unknown error') + suffix, {
                file: from,
                line: event.lineno,
                col: event.colno,
                stack: event.error && event.error.stack ? String(event.error.stack).slice(0, 800) : null,
            });
        },
        true
    );

    window.addEventListener('unhandledrejection', function (event) {
        if (!AUT.cfg.channels.jsError) return;
        var r = event.reason;
        push('rejection', 'Unhandled rejection: ' + (r && r.message ? r.message : String(r)), {
            stack: r && r.stack ? String(r.stack).slice(0, 800) : null,
        });
    });

    /* --------------------------------------------------------- console */

    ['error', 'warn'].forEach(function (level) {
        var original = console[level];
        if (typeof original !== 'function') return;
        console[level] = function () {
            try {
                if (AUT.cfg.channels.console) {
                    var text = Array.prototype.map
                        .call(arguments, function (a) {
                            if (a instanceof Error) return a.message;
                            if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return '[object]'; } }
                            return String(a);
                        })
                        .join(' ');
                    if (text.trim()) push('console', text, { level: level });
                }
            } catch (e) { /* never let instrumentation break the page */ }
            return original.apply(console, arguments);
        };
    });

    /* ------------------------------------------------------ timer scale */

    ['setTimeout', 'setInterval'].forEach(function (name) {
        var original = window[name];
        window[name] = function (fn, delay) {
            var scale = AUT.cfg.timeScale;
            var scaled = typeof delay === 'number' && scale && scale !== 1 ? Math.max(delay * scale, 0) : delay;
            var args = Array.prototype.slice.call(arguments, 2);
            return original.apply(window, [fn, scaled].concat(args));
        };
    });

    /* ---------------------------------------------- ASUSWRT httpApi.log
     * httpApi is defined by /js/httpApi.js, which has not run yet at
     * document_start, so wrap it the moment the page assigns it.
     */
    function wrapHttpApi(api) {
        if (!api || api.__autWrapped) return api;
        api.__autWrapped = true;

        if (typeof api.log === 'function') {
            var originalLog = api.log;
            api.log = function (first, second) {
                try {
                    // ajaxStatusXML fires on a timer on every page; pure noise.
                    if (AUT.cfg.channels.uiLog && first !== 'ajaxStatusXML') {
                        push('uiLog', String(first) + (second === undefined ? '' : ' ' + second), null);
                    }
                } catch (e) { /* ignore */ }
                return originalLog.apply(api, arguments);
            };
        }

        ['nvramSet', 'applyRule'].forEach(function (fn) {
            if (typeof api[fn] !== 'function') return;
            var original = api[fn];
            api[fn] = function (payload) {
                var verdict = inspect('httpApi.' + fn, payload || {}, '');
                if (verdict.blocked) {
                    // Swallow the call, but honour the callback so the UI carries on.
                    var cb = arguments[1];
                    if (typeof cb === 'function') setTimeout(function () { cb({}); }, 0);
                    return;
                }
                return original.apply(api, arguments);
            };
        });
        return api;
    }

    if (window.httpApi) {
        wrapHttpApi(window.httpApi);
    } else {
        var _httpApi;
        try {
            Object.defineProperty(window, 'httpApi', {
                configurable: true,
                get: function () { return _httpApi; },
                set: function (v) { _httpApi = wrapHttpApi(v); },
            });
        } catch (e) { /* some pages freeze window; nothing we can do */ }
    }

    /* -------------------------------------------------- API recording
     * Every request the UI makes is recorded. Requests carrying a risky
     * action_script are neutralised rather than blocked outright: the URL is
     * rewritten to a harmless read-only hook so the page's own callbacks still
     * fire and the UI does not hang waiting for a reply.
     */

    var NEUTRAL_URL = '/appGet.cgi?hook=uptime()';

    function parseParams(text) {
        var out = {};
        if (!text) return out;
        try {
            if (text.charAt(0) === '{') {
                var obj = JSON.parse(text);
                for (var k in obj) out[k] = obj[k];
                return out;
            }
        } catch (e) { /* not JSON, fall through */ }
        String(text)
            .replace(/^\?/, '')
            .split('&')
            .forEach(function (pair) {
                if (!pair) return;
                var i = pair.indexOf('=');
                var k = i === -1 ? pair : pair.slice(0, i);
                var v = i === -1 ? '' : pair.slice(i + 1);
                try { out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); }
                catch (e) { out[k] = v; }
            });
        return out;
    }

    function riskOf(params) {
        var list = AUT.cfg.riskyActions || [];
        var keys = ['action_script', 'action_mode', 'rc_service'];
        for (var i = 0; i < keys.length; i++) {
            var raw = params[keys[i]];
            if (!raw) continue;
            // action_script can be a space/semicolon separated list of services.
            var parts = String(raw).split(/[\s;,]+/).filter(Boolean);
            for (var j = 0; j < parts.length; j++) {
                if (list.indexOf(parts[j]) !== -1) return { key: keys[i], value: parts[j] };
            }
        }
        return null;
    }

    /**
     * Record one outgoing call and decide what to do with it.
     * @returns {{blocked: boolean, record: object}}
     */
    function inspect(via, urlOrPayload, body) {
        var url = typeof urlOrPayload === 'string' ? urlOrPayload : '';
        var params = typeof urlOrPayload === 'string'
            ? Object.assign(parseParams(url.split('?')[1] || ''), parseParams(body))
            : Object.assign({}, urlOrPayload);

        var risk = riskOf(params);
        var blocked = !!(risk && AUT.cfg.safeMode);

        var record = {
            via: via,
            url: url || via,
            path: url ? String(url).split('?')[0] : via,
            params: params,
            risk: risk ? risk.value : null,
            blocked: blocked,
            page: location.pathname + location.search,
            ts: Date.now(),
        };

        if (AUT.apis.length < MAX_APIS) AUT.apis.push(record);

        if (risk && AUT.cfg.channels.api) {
            push(blocked ? 'apiBlocked' : 'api',
                (blocked ? 'Intercepted risky call: ' : 'Risky call sent: ') + risk.key + '=' + risk.value +
                ' via ' + via,
                record);
        }
        return { blocked: blocked, record: record };
    }
    AUT.inspect = inspect;

    /* XMLHttpRequest */
    var xhrOpen = XMLHttpRequest.prototype.open;
    var xhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
        this.__autMethod = method;
        this.__autUrl = url;
        return xhrOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
        var self = this;
        try {
            var verdict = inspect('xhr:' + (self.__autMethod || 'GET'), self.__autUrl || '',
                typeof body === 'string' ? body : '');
            if (verdict.blocked) {
                // Re-point at a harmless hook so onreadystatechange still runs.
                xhrOpen.call(self, 'GET', NEUTRAL_URL, true);
                return xhrSend.call(self);
            }
        } catch (e) { /* ignore */ }
        return xhrSend.apply(self, arguments);
    };

    /* fetch */
    if (typeof window.fetch === 'function') {
        var originalFetch = window.fetch;
        window.fetch = function (input, init) {
            try {
                var url = typeof input === 'string' ? input : (input && input.url) || '';
                var body = init && typeof init.body === 'string' ? init.body : '';
                var verdict = inspect('fetch:' + ((init && init.method) || 'GET'), url, body);
                if (verdict.blocked) return originalFetch.call(window, NEUTRAL_URL);
            } catch (e) { /* ignore */ }
            return originalFetch.apply(window, arguments);
        };
    }

    /* form.submit() -- how the classic ASUSWRT pages apply settings */
    var formSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
        try {
            var params = {};
            for (var i = 0; i < this.elements.length; i++) {
                var el = this.elements[i];
                if (el.name) params[el.name] = el.value;
            }
            var verdict = inspect('form:' + (this.getAttribute('action') || ''), params, '');
            if (verdict.blocked) return;
        } catch (e) { /* ignore */ }
        return formSubmit.apply(this, arguments);
    };

    push('debug', 'instrumentation installed at ' + location.pathname);
})();
