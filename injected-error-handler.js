(function () {
    window.addEventListener("error", function (event) {
        const errorPage = event.filename.includes(location.pathname)
            ? ""
            : ` (${location.pathname.replace("/", "")})`;

        window.postMessage({
            type: "FORM_UI_ADD_ERRLOG",
            log: `Error: ${event.message}${errorPage}`,
            url: event.filename
        }, "*");
    });

    const originalSetTimeout = window.setTimeout;
    const originalSetInterval = window.setInterval;

    window.setTimeout = function (callback, delay, ...args) {
        const reducedDelay = Math.max(delay * 0.5, 0);
        return originalSetTimeout(callback, reducedDelay, ...args);
    };

    window.setInterval = function (callback, delay, ...args) {
        const reducedDelay = Math.max(delay * 0.5, 0);
        return originalSetInterval(callback, reducedDelay, ...args);
    };

    const originalHttpApiLog = window.httpApi?.log;
    if (originalHttpApiLog) {
        window.httpApi.log = function (firstParam, secondParam, ...args) {
            if(
                firstParam == "ajaxStatusXML"
            ) return true;

            window.postMessage({
                type: "FORM_UI_ADD_ERRLOG",
                log: `UILOG: ${firstParam} ${secondParam}`,
                url: location.pathname
            }, "*");

            return true
        };
    }

    window.addEventListener("message", function(event) {
        if (event.data && event.data.type === "IFRAME_ERROR") {
            window.postMessage({
                type: "FORM_UI_ADD_ERRLOG",
                log: `Error: ${event.data.message}`,
                url: event.data.filename
            }, "*");
        }
    });
})();