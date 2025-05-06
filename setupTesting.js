window.postMessage({ type: "FORM_UI_SETUP_TESTING", testingEnv: {
/*
    For testing purpose only
    menuList: [{"menuName":"Network Tools","index":"menu_NekworkTool","tab":[{"url":"Main_Analysis_Content.asp","tabName":"Network Diagnosis"},{"url":"Main_Netstat_Content.asp","tabName":"Netstat"},{"url":"Main_WOL_Content.asp","tabName":"Wake on LAN"},{"url":"Advanced_Smart_Connect.asp","tabName":"Smart Connect Rules"},{"url":"NULL","tabName":"__INHERIT__"}]}],
*/
    menuList: Session.get("menuList." + ui_lang),
    origin: window.location.origin
}}, "*");
