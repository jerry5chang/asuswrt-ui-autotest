window.addEventListener("error", function (event) {
    window.postMessage({
        type: "FORM_UI_ADD_ERRLOG",
        log: `Error: ${event.message}`,
        url: event.filename
    }, "*");
});
