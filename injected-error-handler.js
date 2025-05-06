window.addEventListener("error", function (event) {
    window.postMessage({
        type: "autotestlog",
        log: `Error: ${event.message}`,
        url: event.filename
    }, "*");
});
