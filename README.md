### Message Exchange in the Project

#### `popup.js`
- **Receives:**
  - `progressUpdate`: Updates the progress bar with the current testing progress and language.
- **Sends:**
  - `resetUrlQueue`: Resets the URL queue to only include "UI".
  - `resetAllLangUrlQueue`: Resets the URL queue to include all supported languages.
  - `startTesting`: Notifies `content.js` to start the testing process.
  - `downloadLogs`: Requests `background.js` to download the test logs.

#### `background.js`
- **Receives:**
  - `startTesting`: Initializes the testing process, sets `startTime`, and begins processing the URL queue.
  - `autotestlog`: Logs errors during testing, storing them in `logs` with URL, log message, and language.
  - `downloadLogs`: Generates and downloads a test report, including errors, 404s, and successful logs.
  - `resetUrlQueue`: Resets the URL queue to only include "UI".
  - `resetAllLangUrlQueue`: Resets the URL queue to include all supported languages.
  - `setupTesting`: Configures the testing environment by setting `menuTree` and `baseUrl`.
- **Sends:**
  - `progressUpdate`: Sends progress updates to `popup.js`.
  - `setupLang`: Notifies `content.js` to set the language for testing.

#### `content.js`
- **Receives:**
  - `downloadLogs`: Injects and executes `endTesting.js` to trigger the download of test logs.
  - `startTesting`: Injects and executes `startTesting.js` to start the testing process.
  - `loadSetupTestingScript`: Loads and executes `setupTesting.js` to initialize the testing environment.
  - `setupLang`: Injects `setupLang.js` and posts a message with the language.
- **Sends:**
  - `autotestlog`: Sends error logs to `background.js`.
  - `setupTesting`: Sends testing environment setup data to `background.js`.
  - `startTesting`: Notifies `background.js` to start the testing process.
- **Receives `window.addEventListener("message")`:**
  - `FORM_UI_START_TESTING`: Starts the testing process by injecting `startTesting.js`.
  - `FORM_UI_SETUP_TESTING`: Configures the testing environment by injecting `setupTesting.js`.
  - `FORM_UI_ADD_ERRLOG`: Sends error logs to `background.js`.

#### `setupLang.js`
- **Receives:**
  - `SET_LANG`: Sets the language for testing.
- **Sends:**
  - `FORM_UI_START_TESTING`: Notifies `content.js` to start the testing process.

#### `setupTesting.js`
- **Sends:**
  - `FORM_UI_SETUP_TESTING`: Sends testing environment setup data to `content.js`.

#### `injected-error-handler.js`
- **Sends:**
  - `FORM_UI_ADD_ERRLOG`: Sends error logs from the UI to `content.js`.

#### `ToDo`
  - Reopen the extension app to display the currently running progress bar. (v1.2)
  - Fix the issue where the activeTabId of the window is lost. (v1.2)
  - intergate ui logs (v1.3)
  - support UI4 (v1.4)
  - support 3004 - UI3 (v1.4)
  - support ui SPEC check (v1.4)
  - adds a framework that allows each page to be tested with its own `test-XXX.js` file. (v1.5)
  - Adjusted file structure (v1.6)
  - Support development mode (v1.6)
  - Support API test. (v2.0)