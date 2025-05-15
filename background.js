var menuTree = [];
var menuExclude = {};
let urlQueue = [];
let langQueue = [];
let baseUrl = "";
let logs = [];
let activeTabId = null;
let originalQueueLength = 0;
let startTime = null;
let endTime = null;
let currentLang = "XX";
let currentTestType = null;
let waitPageLoadTime = 2000;
let theme = "";
let modelName = "";
let modelVersion = "";

let specCheckList = {
    "AiCloud": ["cloud_main.asp"],
    "AiDisk": ["aidisk.asp"],
    "VLAN": ["Advanced_VLAN_Switch_Content.asp"],
    "WTFast": ["Advanced_WTFast_Content.asp"],
    "Multi-Function-BTN": ["Advanced_MultiFuncBtn.asp"]
}

function resetParameters() {
    menuTree = [];
    menuExclude = {};
    urlQueue = [];
    langQueue = [];
    baseUrl = "";
    logs = [];
    activeTabId = null;
    originalQueueLength = 0;
    startTime = null;
    endTime = null; 
    currentTestType = null;
    modelName = "";
    modelVersion = "";
    theme = "";
}

function initializeUrlQueue() {
    if (langQueue.length !== 0) {
        currentLang = langQueue.shift();

        if (activeTabId !== null) {
            chrome.tabs.sendMessage(activeTabId, { 
                type: "setupLang", 
                lang: currentLang 
            });
        }
    }

    urlQueue = [];
    menuTree.forEach(menu => {
        if (menuExclude.menus && menuExclude.menus.includes(menu.index)) {
            return;
        }
        menu.tab.forEach(tab => {
            if (
                tab.url && tab.url.toUpperCase() !== "NULL" 
                && !menuExclude.tabs.includes(tab.url) 
                && tab.url !== ""
                && tab.url !== "Main_Login.asp"
                && tab.url !== "index.html"
                && tab.url !== "AdaptiveQoS_Adaptive.asp"
                && tab.url !== "Advanced_TencentDownloadAcceleration.asp"
                && tab.url !== "Main_IPTStatus_Content.asp"
            ) {
                urlQueue.push(tab.url);
            }
        });
    });

    Object.values(specCheckList).flat().forEach(specUrl => {
        if (!urlQueue.includes(specUrl)) {
            urlQueue.push(specUrl);
        }
    });

    originalQueueLength = urlQueue.length;
}

function updateProgress() {
    const completed = originalQueueLength - urlQueue.length;
    const progress = Math.round((completed / originalQueueLength) * 100);
    chrome.runtime.sendMessage({ type: "progressUpdate", progress, currentLang, langQueue });
}

function processNextUrl() {
    if (urlQueue.length === 0) {
        if( langQueue.length === 0 ) {
            endTime = new Date();
            updateProgress();
            downloadLogs();
            return;
        }
        else {
            initializeUrlQueue();
            return;
        }
    }

    const nextUrl = baseUrl + urlQueue.shift();
    updateProgress();

    if (activeTabId !== null) {
        fetch(nextUrl, { method: "HEAD" })
            .then(response => {
                if (response.ok) {
                    chrome.tabs.update(activeTabId, { url: nextUrl }, () => {
                        if (chrome.runtime.lastError) {
                            urlQueue = [];
                            return;
                        }
                        setTimeout(processNextUrl, waitPageLoadTime);
                    });
                } else {
                    logs.push({ url: nextUrl, log: `not found`, lang: currentLang });
                    setTimeout(processNextUrl, waitPageLoadTime);
                }
            })
            .catch(error => {
                logs.push({ url: nextUrl, log: `Error while fetching URL`, lang: currentLang });
                setTimeout(processNextUrl, waitPageLoadTime);
            });
    } else {
        console.error("Unable to update tab because activeTabId is null.");
    }
}

function downloadLogs() {
    if (!activeTabId || !startTime || !baseUrl) {
        return;
    }
    
    if (activeTabId !== null && startTime !== null) {
        chrome.tabs.sendMessage(activeTabId, { type: "endTesting" }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Unable to communicate with Content script:", chrome.runtime.lastError.message);
            } else if (response && response.status === "success") {
                console.log(response.message);
            } else {
                console.error("Content script did not respond or responded with failure.");
            }
        });
    }

    const passPaths = new Set();
    const passLogs = [];
    const passCounts = {};

    const notFoundPaths = new Set();
    const notFoundLogs = [];
    const notFoundCounts = {};

    const specPaths = new Set();
    const specLogs = [];
    const specCounts = {};

    const errorPaths = new Set();
    const errorLogs = [];
    const errorCounts = {};

    const uilogPaths = new Set();
    const uilogLogs = [];
    const uilogCounts = {};

    logs.forEach(log => {
        const url = new URL(log.url, baseUrl);

        if (log.lang.includes("[XX]")) return;

        if (log.log.includes("page loaded successfully")) {
            for (const [key, paths] of Object.entries(specCheckList)) {
                if (paths.includes(url.pathname.replace("/", ""))) {
                    if (!specPaths.has(url.pathname)) {
                        specLogs.push(`[${log.lang}] Support ${key}`);
                        specPaths.add(url.pathname);
                    }
                    if (!specCounts[log.lang]) {
                        specCounts[log.lang] = 0;
                    }
                    specCounts[log.lang] += 1;
                    break;
                }
            }

            if (!passPaths.has(url.pathname)) {
                passLogs.push(`[${log.lang}] ${url.pathname.replace("/", "")}: ${log.log}`);
                passPaths.add(url.pathname);
            }
            if (!passCounts[log.lang]) {
                passCounts[log.lang] = 0;
            }
            passCounts[log.lang] += 1;
        } 
        else if (log.log.includes("not found")) {
            for (const [key, paths] of Object.entries(specCheckList)) {
                if (paths.includes(url.pathname.replace("/", ""))) {
                    if (!specPaths.has(url.pathname)) {
                        specLogs.push(`[${log.lang}] Not Support ${key}`);
                        specPaths.add(url.pathname);
                    }
                    if (!specCounts[log.lang]) {
                        specCounts[log.lang] = 0;
                    }
                    specCounts[log.lang] += 1;
                    break;
                }
            }

            const isInSpecCheckList = Object.values(specCheckList).flat().includes(url.pathname.replace("/", ""));
            if (isInSpecCheckList) {
                return;
            }

            if (!notFoundPaths.has(url.pathname)) {
                notFoundLogs.push(`[${log.lang}] ${url.pathname.replace("/", "")}: ${log.log}`);
                notFoundPaths.add(url.pathname);
            }
            if (!notFoundCounts[log.lang]) {
                notFoundCounts[log.lang] = 0;
            }
            notFoundCounts[log.lang] += 1;
        } 
        else if (log.log.includes("UILOG")) {
            if (!uilogPaths.has(url.pathname)) {
                uilogLogs.push(`[${log.lang}] ${url.pathname.replace("/", "")}: ${log.log}`);
                uilogPaths.add(url.pathname);
            }
            if (!uilogCounts[log.lang]) {
                uilogCounts[log.lang] = 0;
            }
            uilogCounts[log.lang] += 1;
        } 
        else {
            if (!errorPaths.has(log.log)) {
                errorLogs.push(`[${log.lang}] ${url.pathname.replace("/", "")}: ${log.log}`);
                errorPaths.add(log.log);
            }
            if (!errorCounts[log.lang]) {
                errorCounts[log.lang] = 0;
            }
            errorCounts[log.lang] += 1;

        }
    });

    const notFoundSummary = Object.entries(notFoundCounts).map(
        ([lang, count]) => `[${lang}] ${count} page${count === 1 ? '' : 's'} not found.`
    );
    notFoundLogs.push(...notFoundSummary);

    const passSummary = Object.entries(passCounts).map(
        ([lang, count]) => `[${lang}] ${count} page${count === 1 ? '' : 's'} loaded successfully.`
    );
    passLogs.push(...passSummary);

    const errorSummary = Object.entries(errorCounts).map(
        ([lang, count]) => `[${lang}] ${count} page${count === 1 ? '' : 's'} got error.`
    );
    errorLogs.push(...errorSummary);

    const uilogSummary = Object.entries(uilogCounts).map(
        ([lang, count]) => `[${lang}] ${count} page${count === 1 ? '' : 's'} got the same ui log.`
    );
    uilogLogs.push(...uilogSummary);

    const specSummary = Object.entries(specCounts).map(
        ([lang, count]) => `[${lang}] ${count} page${count === 1 ? '' : 's'} matched spec check.`
    );
    specLogs.push(...specSummary);

    const testDuration = startTime && endTime ? 
        `Test Duration: ${((endTime - startTime) / 1000).toFixed(2)} seconds` : 
        `Test Duration: Unable to calculate`;

    const reportContent = [
        "=== TEST ===",
        `Model Name: ${modelName}`,
        `Model Version: ${modelVersion}`,
        testDuration,
        "",
        "=== ERRORS ===",
        ...errorLogs,
        "",
        "=== SPEC CHECK ===",
        ...specLogs,
        "",
        "=== NOT FOUND ===",
        ...notFoundLogs,
        "",
        "=== PASS ===",
        ...passLogs,
        "",
        "=== UI LOG ===",
        ...uilogLogs,
    ].join("\n");

    const url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(reportContent);
    const timestamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).replace(/[-: ]/g, "").split(".")[0];

    chrome.downloads.download({
        url: url,
        filename: `autotest_report_${timestamp}.txt`,
        saveAs: false
    });

    resetParameters();
}

function startNavigation(sendResponse) {
    if (!startTime) startTime = new Date();

    if (activeTabId !== null) {
        processNextUrl();
        sendResponse({ status: "success", message: "Navigation started" });
    } 
    else {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0) {
                activeTabId = tabs[0].id;
                processNextUrl();
                sendResponse({ status: "success", message: "Navigation started" });
            } else {
                currentTestType = null;
                sendResponse({ status: "error", message: "No active tab found" });
            }
        });
    }    
}

/*
    background.js will listen to the following messages:
    - startTesting: Starts the testing process, initializes `startTime`, sets `activeTabId`, and begins processing the URL queue.
    - autotestlog: Logs errors during testing, storing them in `logs` with URL, log message, and language.
    - downloadLogs: Generates and downloads a test report, including errors, 404s, and successful logs.
    - resetUrlQueue: Resets the URL queue to only include "UI" and reinitializes the queue.
    - resetAllLangUrlQueue: Resets the language queue to all supported languages and reinitializes the URL queue.
    - setupTesting: Sets up the testing environment by configuring `menuTree` and `baseUrl`.
*/
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "getMenuTreeLength") {
        sendResponse({ menuTreeLength: menuTree.length, tabId: sender.tab?.id });
    }
    else if (message.type === "isTesting") {
        sendResponse({ isTesting: (currentTestType && activeTabId === sender.tab.id) ? true : false });
    }
    else if (message.type === "startTesting") {
        if (currentTestType && activeTabId !== sender.tab.id) {
            sendResponse({ status: "error", message: "A test is already running." });
            return true;
        }
        currentTestType = "startTesting";
        startNavigation(sendResponse);
        return true;
    }
    else if (message.type === "startTestingAllLang") {
        if (currentTestType && activeTabId !== sender.tab.id) {
            sendResponse({ status: "error", message: "A test is already running." });
            return true;
        }
        currentTestType = "startTestingAllLang";
        startNavigation(sendResponse);
        return true;
    }
    else if (message.type === "restartTesting") {
        if (currentTestType && activeTabId !== sender.tab.id) {
            sendResponse({ status: "error", message: "A test is already running." });
            return true;
        }
        startNavigation(sendResponse);
        return true;
    }    
    else if (message.type === "autotestlog") {
        if (message.log) {
            if(originalQueueLength != 0 && currentLang !== "XX") {
                logs.push({ url: message.url, log: message.log, lang: currentLang });
            }
            sendResponse({ status: "Error logged" });
        } else {
            sendResponse({ status: "Incomplete error message" });
        }
        return true;
    }
    else if (message.type === "downloadLogs") {
        currentTestType = null;
        downloadLogs();
        sendResponse({ status: "success", message: "Logs are being downloaded." });
        return true;
    }
    else if (message.type === "resetParameters") {
        urlQueue = [];
        langQueue = [];

        sendResponse({ status: "success", message: "Parameters are reset" });
        return true;
    }
    else if (message.type === "resetUrlQueue") {
        langQueue = ["UI"];

        initializeUrlQueue();
        sendResponse({ status: "success", message: "urlQueue has been reset" });
        return true;
    }
    else if (message.type === "resetAllLangUrlQueue") {
        langQueue = [
            "UI", 
            "EN", 
            "TW", 
            "CN", 
            "BR", 
            "CZ", 
            "DA", 
            "DE", 
            "ES", 
            "FI", 
            "FR", 
            "HU", 
            "IT", 
            "JP", 
            "KR", 
            "MS", 
            "NL", 
            "NO", 
            "PL", 
            "RO", 
            "RU", 
            "SL", 
            "SV", 
            "TH", 
            "TR", 
            "UK"
        ];

        /*
        For testing purpose only
        langQueue = [ "UI", "EN", "TW", "CN" ];
        */
       
        initializeUrlQueue();
        sendResponse({ status: "success", message: "LangUrlQueue and urlQueue have been reset" });
        return true;
    }
    else if (message.type === "setupTesting") {
        if(baseUrl == "" || menuTree.length == 0) {
            menuTree = message.data.menuList;
            menuExclude = message.data.menuExclude;
            waitPageLoadTime = message.data.waitPageLoadTime || 2000;
            theme = message.data.theme || "ui3";
            modelName = message.data.modelName || "";
            modelVersion = message.data.modelVersion || "";
            baseUrl = `${message.data.origin}/`;
        }
    }
    else if (message.type === "getTestEnvStatus") {
        sendResponse({
            isTesting: !!startTime,
            activeTabId,
            progress: originalQueueLength > 0 ? Math.round(((originalQueueLength - urlQueue.length) / originalQueueLength) * 100) : 0,
            currentLang,
            langQueue,
            currentTestType
        });
        return true;
    }
});

initializeUrlQueue();