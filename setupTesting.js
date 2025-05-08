window.postMessage({ type: "FORM_UI_SETUP_TESTING", testingEnv: {
    menuList: Session.get("menuList." + ui_lang),
    /*
    For testing purpose only
    menuList: [{ menuName: "Network Tools", index: "menu_NekworkTool", tab: [{ url: "Main_Analysis_Content.asp", tabName: "Network Diagnosis" }, { url: "Advanced_Notification_Content.asp", tabName: "Notification" }, { url: "Main_Netstat_Content.asp", tabName: "Netstat" }, { url: "Main_WOL_Content-NOTFOUND.asp", tabName: "Wake on LAN" }, { url: "Advanced_Smart_Connect.asp", tabName: "Smart Connect Rules" }, { url: "NULL", tabName: "__INHERIT__" }] }],
    */
    origin: window.location.origin
}}, "*");
