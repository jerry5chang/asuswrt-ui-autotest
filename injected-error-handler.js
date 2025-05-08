window.addEventListener("error", function (event) {
    const url = location.pathname.includes(event.filename)
        ? event.filename
        : `${event.filename} in ${location.pathname}`;

    window.postMessage({
        type: "FORM_UI_ADD_ERRLOG",
        log: `Error: ${event.message}`,
        url: url
    }, "*");
});