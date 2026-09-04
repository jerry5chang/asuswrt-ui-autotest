/**
 * Shared constants. Imported by the service worker, the side panel and the
 * suite registry. Must stay dependency-free so it can be loaded anywhere.
 */

/** Result severities, ordered worst-first. */
export const SEV = {
    ERROR: 'error',
    FAIL: 'fail',
    WARN: 'warn',
    BLOCKED: 'blocked',
    INFO: 'info',
    PASS: 'pass',
    SKIP: 'skip',
};

export const SEV_ORDER = [SEV.ERROR, SEV.FAIL, SEV.WARN, SEV.BLOCKED, SEV.INFO, SEV.PASS, SEV.SKIP];

/** Severities that make a run "not green". */
export const SEV_BAD = [SEV.ERROR, SEV.FAIL];

export const SEV_LABEL = {
    error: 'Error',
    fail: 'Fail',
    warn: 'Warn',
    blocked: 'Blocked',
    info: 'Info',
    pass: 'Pass',
    skip: 'Skip',
};

/** Run lifecycle. */
export const RUN = {
    IDLE: 'idle',
    RUNNING: 'running',
    PAUSED: 'paused',
    STOPPING: 'stopping',
    DONE: 'done',
    ABORTED: 'aborted',
};

/** Messages: side panel -> service worker. */
export const MSG = {
    GET_SNAPSHOT: 'getSnapshot',
    PROBE_ENV: 'probeEnv',
    SAVE_SETTINGS: 'saveSettings',
    START_RUN: 'startRun',
    PAUSE_RUN: 'pauseRun',
    RESUME_RUN: 'resumeRun',
    STOP_RUN: 'stopRun',
    CLEAR_RUN: 'clearRun',
    EXPORT_REPORT: 'exportReport',
    // service worker -> side panel (broadcast)
    SNAPSHOT: 'snapshot',
};

/**
 * action_script / action_mode values that disconnect or destroy the DUT.
 * When Safe Mode is on these are recorded and then dropped instead of sent,
 * which is what makes button testing possible without losing the session.
 */
export const RISKY_ACTIONS = {
    destructive: [
        'restore',
        'resetdefault',
        'restart_defaultsetting',
        'erase_nvram',
        'upgrade',
        'Upload',
    ],
    disconnect: [
        'reboot',
        'restart_all',
        'restart_net',
        'restart_net_and_phy',
        'restart_wireless',
        'restart_httpd',
        'restart_httpd_ssl',
        'restart_wan',
        'restart_wan_if',
        'restart_lan',
        'restart_subnet',
        'restart_dnsmasq',
    ],
};

export const ALL_RISKY_ACTIONS = [...RISKY_ACTIONS.destructive, ...RISKY_ACTIONS.disconnect];

/** Full ASUSWRT language code list; the real list is probed from the DUT. */
export const FALLBACK_LANGS = [
    'EN', 'TW', 'CN', 'BR', 'CZ', 'DA', 'DE', 'ES', 'FI', 'FR', 'HU', 'IT',
    'JP', 'KR', 'MS', 'NL', 'NO', 'PL', 'RO', 'RU', 'SL', 'SV', 'TH', 'TR', 'UK',
];

/*
 * Pages that must never be swept live in the BLOCK array inside
 * background/probe.js. probeFn is stringified and injected, so it cannot
 * import from here; keeping a second copy in this file only created something
 * that looked authoritative and changed nothing.
 */

/** Feature -> page mapping used by the SPEC check suite. */
export const DEFAULT_SPEC_MAP = {
    AiCloud: ['cloud_main.asp'],
    AiDisk: ['aidisk.asp'],
    VLAN: ['Advanced_VLAN_Switch_Content.asp'],
    WTFast: ['Advanced_WTFast_Content.asp'],
    'Multi-Function-BTN': ['Advanced_MultiFuncBtn.asp'],
    SDN: ['SDN.asp'],
    WireGuard: ['Advanced_WireguardServer_Content.asp'],
    'VPN-Fusion': ['Advanced_VPNClient_Content.asp'],
};

/** Known false alarms, filtered out of the report. User-editable in Settings. */
export const DEFAULT_KNOWN_ISSUES = [
    { where: 'js/asus_notice.js', match: 'httpApi is not defined' },
    { where: 'tm.svg', match: "Cannot read properties of null (reading 'getItem')" },
    /*
     * QIS_V3 links ./mobile.customize/customize.css unconditionally, but that
     * directory only ships with the business customisation package. By design:
     * without the package installed there is no custom styling to apply, so
     * the 404 is expected rather than a defect.
     */
    { where: 'mobile.customize/customize.css', match: 'failed to load' },
];

export const DEFAULT_SETTINGS = {
    /** '' follows the browser's UI language; see lib/i18n.js. */
    locale: '',
    /** Suite groups the user has folded away in the panel. */
    collapsedGroups: [],
    /** '' follows the OS; 'light' or 'dark' is an explicit choice. */
    theme: '',
    pageSettleMs: 2000,
    pageTimeoutMs: 20000,
    timeScale: 1.0,
    safeMode: true,
    stopOnError: false,
    /** Echo every assertion to the DUT page's console, for diagnosis. */
    verboseConsole: false,
    /** Allow chrome.debugger attach for suites that need real key presses. */
    realKeys: true,
    /**
     * Maintainer actions -- ignoring a finding, restoring it. Off by default,
     * so a colleague running the tool sees the curated list applied but no
     * buttons to change it.
     */
    devMode: false,
    autoLogin: false,
    username: 'admin',
    password: '',
    riskyActions: ALL_RISKY_ACTIONS,
    knownIssues: DEFAULT_KNOWN_ISSUES,
    specMap: DEFAULT_SPEC_MAP,
    returnPage: 'Advanced_LAN_Content.asp',
};

export const PRESETS = {
    smoke: ['core.reachability', 'core.js-error', 'core.dom-sanity'],
    full: null, // null == everything
    api: ['api.hook-sweep', 'api.recorder'],
};
