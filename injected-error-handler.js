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