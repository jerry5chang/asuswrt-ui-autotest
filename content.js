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
                sendResponse({ status: "error", message: "無法載入外部腳本。" });
            };
            document.documentElement.appendChild(script);
            return true;
        } else if (message.type === "startTesting") {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL("startTesting.js");
            script.onload = () => {
                script.remove();
                sendResponse({ status: "success", message: "已執行 startTesting.js 啟動測試" });
            };
            script.onerror = () => {
                console.error("無法載入外部腳本 startTesting.js");
                sendResponse({ status: "error", message: "無法載入外部腳本。" });
            };
            document.documentElement.appendChild(script);
            return true;
        } else if (message.type === "loadSetupTestingScript") {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL("setupTesting.js");
            script.onload = () => {
                script.remove();
                sendResponse({ status: "success", message: "已執行 setupTesting.js 初始化測試環境" });
            };
            script.onerror = () => {
                console.error("無法載入外部腳本 startTesting.js");
                sendResponse({ status: "error", message: "無法載入外部腳本。" });
            };
            document.documentElement.appendChild(script);
            return true;
        } else if (message.type === "setupLang") {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL("setupLang.js");
            script.onload = () => {
                window.postMessage({ type: "SET_LANG", lang: message.lang }, "*");
                sendResponse({ status: "success", message: `${message.script} 已注入` });
            };
            script.onerror = () => {
                console.error(`無法載入外部腳本 ${message.script}`);
                sendResponse({ status: "error", message: `無法載入外部腳本 ${message.script}` });
            };
            document.documentElement.appendChild(script);
            return true;
        }
    });
})();