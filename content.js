(function () {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("injected-error-handler.js");
    document.documentElement.appendChild(script);
    script.onload = () => script.remove();

    chrome.runtime.sendMessage({
        type: `autotestlog`,
        log: `Page loaded successfully.`,
        url: window.location.href
    });

    window.addEventListener("message", function (event) {
        if (event.data && event.data.type === "autotestlog") {
            chrome.runtime.sendMessage(event.data);
        } else if (event.data.type === "SETUP_TESTING") {
            chrome.runtime.sendMessage({ type: "setupTesting", data: event.data.testingEnv });
        } else if (event.data.type === "start_testing") {
            chrome.runtime.sendMessage({ type: "startTesting" });
        }
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "downloadLogs") {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL("endTesting.js");
            script.onload = () => {
                script.remove();
                sendResponse({ status: "success", message: "Testing completed!" });
            };
            script.onerror = () => {
                sendResponse({ status: "error", message: "Unable to load external script." });
            };
            document.documentElement.appendChild(script);
            return true;
        } else if (message.type === "startTesting") {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL("startTesting.js");
            script.onload = () => {
                script.remove();
                sendResponse({ status: "success", message: "startTesting.js executed to start testing" });
            };
            script.onerror = () => {
                console.error("Unable to load external script startTesting.js");
                sendResponse({ status: "error", message: "Unable to load external script." });
            };
            document.documentElement.appendChild(script);
            return true;
        } else if (message.type === "loadSetupTestingScript") {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL("setupTesting.js");
            script.onload = () => {
                script.remove();
                sendResponse({ status: "success", message: "setupTesting.js executed to initialize testing environment" });
            };
            script.onerror = () => {
                console.error("Unable to load external script startTesting.js");
                sendResponse({ status: "error", message: "Unable to load external script." });
            };
            document.documentElement.appendChild(script);
            return true;
        } else if (message.type === "setupLang") {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL("setupLang.js");
            script.onload = () => {
                window.postMessage({ type: "SET_LANG", lang: message.lang }, "*");
                sendResponse({ status: "success", message: `${message.script} injected` });
            };
            script.onerror = () => {
                console.error(`Unable to load external script ${message.script}`);
                sendResponse({ status: "error", message: `Unable to load external script ${message.script}` });
            };
            document.documentElement.appendChild(script);
            return true;
        }
    });
})();