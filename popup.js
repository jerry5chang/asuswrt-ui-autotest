document.addEventListener("DOMContentLoaded", () => {
    const startButton = document.getElementById("startTesting");
    const startAllLangButton = document.getElementById("startTestingAllLang");
    const downloadLogsButton = document.getElementById("downloadLogs");
    const progressContainer = document.getElementById("progressContainer");
    const progressBar = document.getElementById("progressBar");
    const progressText = document.getElementById("progressText");
    const resetButton = document.getElementById("resetButton");

    progressContainer.style.display = "none";

    function disableButtonsIfProgressVisible() {
        const isProgressVisible = (progressContainer.style.display === "block" || progressContainer.style.display === "");
        startButton.disabled = isProgressVisible;
        startAllLangButton.disabled = isProgressVisible;

        if (isProgressVisible) {
            startButton.classList.add("disabled-btn");
            startAllLangButton.classList.add("disabled-btn");
        } else {
            startButton.classList.remove("disabled-btn");
            startAllLangButton.classList.remove("disabled-btn");
        }
    }

    function updateProgress(progress, currentLang, totalLangs) {
        var langQueueTotal = totalLangs ? `/${totalLangs}` : ``;
        progressBar.style.width = `${progress}%`;
        progressText.textContent = `[${currentLang}${langQueueTotal}] ${progress}%`;
        if (progress === 100) {
            progressText.textContent = `Done`;
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
                            updateProgress(response.progress, response.currentLang, response.langQueue.length || 0);
                            if (response.currentTestType === "startTesting") {
                                startButton.style.display = "none";
                                startAllLangButton.style.display = "";
                            } else if (response.currentTestType === "startTestingAllLang") {
                                startButton.style.display = "";
                                startAllLangButton.style.display = "none";
                            }
                            disableButtonsIfProgressVisible();
                        } else {
                            const alertMessage = document.getElementById("alertMessage");
                            alertMessage.style.display = "block";

                            // Remove all other elements
                            startButton.style.display = "none";
                            startAllLangButton.style.display = "none";
                            downloadLogsButton.style.display = "none";
                            progressContainer.style.display = "none";
                            resetButton.style.display = "none";
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
                        func: () => {
                            if (!window.__CONTENT_JS_INJECTED__) {
                                window.__CONTENT_JS_INJECTED__ = true;
                                return false;
                            }
                            return true;
                        }
                    },
                    (results) => {
                        if (results && results[0] && results[0].result === false) {
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
                        func: () => {
                            if (!window.__CONTENT_JS_INJECTED__) {
                                window.__CONTENT_JS_INJECTED__ = true;
                                return false;
                            }
                            return true;
                        }
                    },
                    (results) => {
                        if (results && results[0] && results[0].result === false) {
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
                    }
                );
            } else {
                console.error("No active tab found, unable to send startTestingAllLang message.");
            }
        });
    });

    downloadLogsButton.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "downloadLogs" });
    });

    resetButton.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "resetParameters" });
    });

/*
    popup.js will listen to the following messages:
    - progressUpdate: Updates the progress bar with the current testing progress and language.
*/
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === "progressUpdate") {
            updateProgress(message.progress, message.currentLang, message.langQueue.length || 0);
        }
        else if (message.type === "reloadPopupWindow") {
            location.reload();
        }
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
            chrome.scripting.executeScript(
                {
                    target: { tabId: tabs[0].id },
                    func: () => {
                        if (!window.__CONTENT_JS_INJECTED__) {
                            window.__CONTENT_JS_INJECTED__ = true;
                            return false;
                    }
                    return true;
                }
            },
            (results) => {
                if (results && results[0] && results[0].result === false) {
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
                    chrome.tabs.sendMessage(tabs[0].id, { type: "loadSetupTestingScript" }, (response) => {});
                }
            }
        );
        } else {
            console.error("No active tab found, unable to send startTesting message.");
        }
    });
});