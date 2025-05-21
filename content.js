(function () {
    chrome.runtime.sendMessage({ type: "isTesting" }, (response) => {
        if (response.isTesting) {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL("inject/injected-error-handler.js");
            document.documentElement.appendChild(script);
            script.onload = () => script.remove();

            chrome.runtime.sendMessage({
                type: `autotestlog`,
                log: `page loaded successfully.`,
                url: window.location.href
            });
        }
    });

/*
    content.js will listen to the following UI messages:
    - FORM_UI_ADD_ERRLOG: Sends error logs from the UI to the background script.
    - FORM_UI_SETUP_TESTING: Configures the testing environment by sending setup data to the background script.
    - FORM_UI_START_TESTING: Triggers the start of the testing process by notifying the background script.
*/
    window.addEventListener("message", function (event) {
        if (event.data && event.data.type === "FORM_UI_ADD_ERRLOG") {
            chrome.runtime.sendMessage({
                type: `autotestlog`,
                log: event.data.log,
                url: event.data.url
            })
        }
        else if (event.data.type === "FORM_UI_SETUP_TESTING") {
            chrome.runtime.sendMessage({
                type: "setupTesting", 
                data: event.data.testingEnv 
            });
        }
        else if (event.data.type === "FORM_UI_START_TESTING") {
            chrome.runtime.sendMessage({ type: "restartTesting" });
        }
    });

/*
    content.js will listen to the following runtime messages:
    - endTesting: injecting and executing `endTesting.js`.
    - startTesting: Starts the testing process by injecting and executing `startTesting.js`.
    - loadSetupTestingScript: Loads and executes `setupTesting.js` to initialize the testing environment.
    - setupLang: Sets the language for testing by injecting `setupLang.js` and posting a message with the language.
*/ 
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "endTesting") {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL("inject/endTesting.js");
            script.onload = () => {
                script.remove();
                sendResponse({ status: "success", message: "Testing completed!" });
            };
            script.onerror = () => {
                sendResponse({ status: "error", message: "Unable to load external script." });
            };
            document.documentElement.appendChild(script);
            return true;
        } 
        else if (message.type === "startTesting") {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL("inject/startTesting.js");
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
        } 
        else if (message.type === "loadSetupTestingScript") {
            chrome.runtime.sendMessage({ type: "isDev" }, (response) => {
                const script = document.createElement("script");
                script.src = chrome.runtime.getURL(`inject/setupTesting${response.isDev?"-dev":""}.js`);
                script.onload = () => {
                    script.remove();
                    sendResponse({ status: "success", message: `setupTesting${response.isDev?"-dev":""}.js executed to initialize testing environment` });
                };
                script.onerror = () => {
                    console.error(`Unable to load external script setupTesting${response.isDev?"-dev":""}.js`);
                    sendResponse({ status: "error", message: "Unable to load external script." });
                };
                document.documentElement.appendChild(script);
            });
            return true;
        } 
        else if (message.type === "setupLang") {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL("inject/setupLang.js");
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
        else if (message.type === "injectTestCase") {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL(`test/${message.testcase}`);
            script.onload = () => {
                sendResponse({ status: "success", message: `${message.testcase} injected` });
            };
            script.onerror = () => {
                sendResponse({ status: "error", message: `Unable to load external script ${message.script}` });
            };
            document.documentElement.appendChild(script);
            return true;
        }
    });
})();