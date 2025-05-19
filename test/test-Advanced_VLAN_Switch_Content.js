/*
Exmaple

window.postMessage({
    type: "FORM_UI_ADD_ERRLOG",
    log: `UILOG: [test-Advanced_VLAN_Switch_Content] Injected.`,
    url: `Advanced_VLAN_Switch_Content`
}, "*");

window.postMessage({
    type: "FORM_UI_ADD_ERRLOG",
    log: `ERROR: [test-Advanced_VLAN_Switch_Content] ERROR.`,
    url: `Advanced_VLAN_Switch_Content`
}, "*");

*/