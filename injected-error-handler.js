(function () {
    // Error handling logic
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

    // Override setTimeout and setInterval to reduce delay times
    const originalSetTimeout = window.setTimeout;
    const originalSetInterval = window.setInterval;

    window.setTimeout = function (callback, delay, ...args) {
        // Reduce delay to a fraction of the original time (e.g., 50%)
        const reducedDelay = Math.max(delay * 0.5, 0); // Ensure delay is not negative
        return originalSetTimeout(callback, reducedDelay, ...args);
    };

    window.setInterval = function (callback, delay, ...args) {
        // Reduce delay to a fraction of the original time (e.g., 50%)
        const reducedDelay = Math.max(delay * 0.5, 0); // Ensure delay is not negative
        return originalSetInterval(callback, reducedDelay, ...args);
    };

    // Capture httpApi.log calls
    const originalHttpApiLog = window.httpApi?.log;
    if (originalHttpApiLog) {
        window.httpApi.log = function (firstParam, secondParam, ...args) {
            if(
                firstParam == "ajaxStatusXML"
            ) return true;

            // Post message with captured log details
            window.postMessage({
                type: "FORM_UI_ADD_ERRLOG",
                log: `UILOG: ${firstParam} ${secondParam}`,
                url: location.pathname
            }, "*");

            return true
        };
    }
})();