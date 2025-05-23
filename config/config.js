export const CONFIG = {
    devMode: 0,
    waitPageLoadTime: 2000,
    
    testCaseList: {
        "QIS_wizard.htm": ["test-QIS_wizard.js", "test-API.js"],
        "index.html?page=trafficmonitor": ["test-trafficmonitor.js"],
        "Advanced_VLAN_Switch_Content.asp": ["test-Advanced_VLAN_Switch_Content.js"]
    },
    
    devSpecCheckList: {
        "AiCloud": ["cloud_main.asp"],
        "AiDisk": ["aidisk.asp"]
    },
    
    prodSpecCheckList: {
        "AiCloud": ["cloud_main.asp"],
        "AiDisk": ["aidisk.asp"],
        "VLAN": ["Advanced_VLAN_Switch_Content.asp"],
        "WTFast": ["Advanced_WTFast_Content.asp"],
        "Multi-Function-BTN": ["Advanced_MultiFuncBtn.asp"]
    },
    
    get specCheckList() {
        return this.devMode ? this.devSpecCheckList : this.prodSpecCheckList;
    },
    
    falseAlarm: [
        { pathname: "js/asus_notice.js", log: "Error: Uncaught ReferenceError: httpApi is not defined" },
    ]
};
