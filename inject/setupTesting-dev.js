(function(){
    let dutInfo = httpApi.nvramGet(["productid", "odmpid", "firmver", "buildno", "extendno"]);
    window.postMessage({ type: "FORM_UI_SETUP_TESTING", testingEnv: {
        menuList: [{ 
            tab: [
                { url: "Main_Analysis_Content.asp", tabName: "" }, 
                { url: "Advanced_Notification_Content.asp", tabName: "" }, 
                { url: "QIS_wizard.htm", tabName: "" },
                { url: "Main_WOL_Content-NOTFOUND.asp", tabName: "" }, 
                { url: "Advanced_Smart_Connect.asp", tabName: "" }
            ]
        }],
        menuExclude: { menus:[], tabs:[] },
        origin: window.location.origin,
        waitPageLoadTime: 3000,
        theme: (top.webWrapper || isSupport("ui4")) ? "ui4" : "ui3",
        modelName: dutInfo.odmpid || dutInfo.productid,
        modelVersion: `${dutInfo.firmver}_${dutInfo.buildno}_${dutInfo.extendno}`,
        allLangList: [ "UI", "EN", "TW", "CN" ]
    }}, "*");
})();