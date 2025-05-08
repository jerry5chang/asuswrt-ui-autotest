document.addEventListener("DOMContentLoaded", () => {
    const startButton = document.getElementById("startTesting");
    const startAllLangButton = document.getElementById("startTestingAllLang");
    const downloadLogsButton = document.getElementById("downloadLogs");
    const progressContainer = document.getElementById("progressContainer");
    const progressBar = document.getElementById("progressBar");

    progressContainer.style.display = "none";

    function disableButtonsIfProgressVisible() {
        const isProgressVisible = progressContainer.style.display === "block";
        startButton.disabled = isProgressVisible;
        startAllLangButton.disabled = isProgressVisible;
    }

    function updateProgress(progress, currentLang) {
        progressBar.style.width = `${progress}%`;
        progressBar.textContent = `[${currentLang}] ${progress}%`;
        if (progress === 100) {
            progressBar.textContent = `Done`;
        }
    }

    function restoreUIState() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0) {
                const currentTabId = tabs[0].id;
                chrome.runtime.sendMessage({ type: "getTestEnvStatus" }, (response) => {
                    if (response.isTesting) {
                        if (response.activeTabId === currentTabId) {
                            progressContainer.style.display = "";
                            updateProgress(response.progress, response.currentLang);
                            if (response.currentTestType === "startTesting") {
                                startButton.style.display = "none";
                                startAllLangButton.style.display = "";
                            } else if (response.currentTestType === "startTestingAllLang") {
                                startAllLangButton.style.display = "none";
                                startButton.style.display = "";
                            }
                            disableButtonsIfProgressVisible();
                        } else {
                            startButton.disabled = true;
                            startAllLangButton.disabled = true;
                            progressBar.textContent = "Test is running in another tab.";
                            progressContainer.style.display = "";
                        }
                    } else {
                        progressContainer.style.display = "none";
                        startButton.style.display = "";
                        startAllLangButton.style.display = "";
                        startButton.disabled = false;
                        startAllLangButton.disabled = false;
                    }
                });
            }
        });
    }

    restoreUIState();

    startButton.addEventListener("click", () => {
        startButton.style.display = "none";
        progressContainer.style.display = "block";
        disableButtonsIfProgressVisible();

        chrome.runtime.sendMessage({ type: "resetUrlQueue" }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Failed to reset urlQueue:", chrome.runtime.lastError.message);
            } else {
                console.log("urlQueue has been reset:", response);
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
                                console.error("Failed to send startTesting message:", chrome.runtime.lastError.message);
                            } else {
                                chrome.runtime.sendMessage({ type: "startTesting" }, (response) => {
                                    console.log("response:", response);
                                });
                            }
                        });
                    }
                );
            } else {
                console.error("No active tab found, unable to send startTesting message.");
            }
        });
    });

    startAllLangButton.addEventListener("click", () => {
        startAllLangButton.style.display = "none";
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
                                console.error("Failed to send startTesting message:", chrome.runtime.lastError.message);
                            } else {
                                chrome.runtime.sendMessage({ type: "startTestingAllLang" }, (response) => {
                                    console.log("response:", response);
                                });
                            }
                        });
                    }
                );
            } else {
                console.error("No active tab found, unable to send startTesting message.");
            }
        });
    });

    downloadLogsButton.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "downloadLogs" }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Failed to send downloadLogs message:", chrome.runtime.lastError.message);
            } else if (response && response.status === "success") {
                console.log("downloadLogs response:", response.message);
            } else {
                console.error("No valid response received for downloadLogs.");
            }
        });
    });

/*
    popup.js will listen to the following messages:
    - progressUpdate: Updates the progress bar with the current testing progress and language.
*/
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === "progressUpdate") {
            updateProgress(message.progress, message.currentLang);
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
            console.error("No active tab found, unable to send startTesting message.");
        }
    });
});