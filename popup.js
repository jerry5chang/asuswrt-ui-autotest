document.addEventListener("DOMContentLoaded", () => {
    const startButton = document.getElementById("startTesting");
    const startAllLangButton = document.getElementById("startTestingAllLang");
    const downloadLogsButton = document.getElementById("downloadLogs");
    const progressContainer = document.getElementById("progressContainer");

    progressContainer.style.display = "none";

    function disableButtonsIfProgressVisible() {
        const isProgressVisible = progressContainer.style.display === "block";
        startButton.disabled = isProgressVisible;
        startAllLangButton.disabled = isProgressVisible;
    }

    startButton.addEventListener("click", () => {
        document.getElementById("startTesting").style.display = "none";
        progressContainer.style.display = "block";
        disableButtonsIfProgressVisible();

        chrome.runtime.sendMessage({ type: "resetUrlQueue" }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("重置 urlQueue 失敗:", chrome.runtime.lastError.message);
            } else {
                console.log("urlQueue 已重置:", response);
            }
        });

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0) {
                chrome.scripting.executeScript(
                    {
                        target: { tabId: tabs[0].id },
                        files: ["content.js"]
                    },
                    () => {               
                        chrome.tabs.sendMessage(tabs[0].id, { type: "startTesting" }, (response) => {
                            if (chrome.runtime.lastError) {
                                console.error("發送 startTesting 訊息失敗:", chrome.runtime.lastError.message);
                            } else {
                                chrome.runtime.sendMessage({ type: "startTesting" }, (response) => {
                                    console.log("response:", response);
                                });
                            }
                        });
                    }
                );
            } else {
                console.error("未找到活動的標籤頁，無法發送 startTesting 訊息。");
            }
        });
    });

    startAllLangButton.addEventListener("click", () => {
        document.getElementById("startTestingAllLang").style.display = "none";
        progressContainer.style.display = "block";
        disableButtonsIfProgressVisible();

        chrome.runtime.sendMessage({ type: "resetAllLangUrlQueue" });
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0) {
                chrome.scripting.executeScript(
                    {
                        target: { tabId: tabs[0].id },
                        files: ["content.js"]
                    },
                    () => {               
                        chrome.tabs.sendMessage(tabs[0].id, { type: "startTesting" }, (response) => {
                            if (chrome.runtime.lastError) {
                                console.error("發送 startTesting 訊息失敗:", chrome.runtime.lastError.message);
                            } else {
                                chrome.runtime.sendMessage({ type: "startTesting" }, (response) => {
                                    console.log("response:", response);
                                });
                            }
                        });
                    }
                );
            } else {
                console.error("未找到活動的標籤頁，無法發送 startTesting 訊息。");
            }
        });
    });

    downloadLogsButton.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "downloadLogs" }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("發送 downloadLogs 訊息失敗:", chrome.runtime.lastError.message);
            } else if (response && response.status === "success") {
                console.log("downloadLogs response:", response.message);
            } else {
                console.error("未收到有效的 downloadLogs 回應。");
            }
        });
    });

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === "progressUpdate") {
            const progressBar = document.getElementById("progressBar");
            progressBar.style.width = `${message.progress}%`;
            progressBar.textContent = `[${message.currentLang}] ${message.progress}%`;

            if (message.progress === 100) {
                progressBar.textContent = `Done`;
                disableButtonsIfProgressVisible();
            }
        }
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
            chrome.scripting.executeScript(
                {
                    target: { tabId: tabs[0].id },
                    files: ["content.js"]
                },
                () => {
                    chrome.tabs.sendMessage(tabs[0].id, { type: "loadSetupTestingScript" }, (response) => {});
                }
            );
        } else {
            console.error("未找到活動的標籤頁，無法發送 startTesting 訊息。");
        }
    });
});