try{
    let dutInfo = httpApi.nvramGet(["productid", "odmpid", "firmver", "buildno", "extendno"]);

    if(top.webWrapper || isSupport("ui4")) {
        var currPage = window.localStorage.getItem("page");

        if(currPage != "settings") {
            window.localStorage.setItem("page", "settings");
            location.href = "/index.html?current_theme=white";
        }
        else {
            var settingsFrame = document.getElementById('settingsWindow').contentWindow;
            var mergedMenu = settingsFrame.Session.get("menuList." + settingsFrame.ui_lang) || settingsFrame.Session.get("menuList");

            menuList.forEach(menu => {
                if (menu.url !== "QIS_wizard.htm") {
                    mergedMenu[0].tab.push({
                        url: `index.html?page=${menu.url}`
                    });
                }
            });

            window.postMessage({ type: "FORM_UI_SETUP_TESTING", testingEnv: {
                menuList: mergedMenu,
                /*
                For testing purpose only
                menuList: [{ menuName: "Network Tools", index: "menu_NekworkTool", tab: [{ url: "Main_Analysis_Content.asp", tabName: "Network Diagnosis" }, { url: "Advanced_Notification_Content.asp", tabName: "Notification" }, { url: "Main_Netstat_Content.asp", tabName: "Netstat" }, { url: "Main_WOL_Content-NOTFOUND.asp", tabName: "Wake on LAN" }, { url: "Advanced_Smart_Connect.asp", tabName: "Smart Connect Rules" }, { url: "NULL", tabName: "__INHERIT__" }] }],
                */
                menuExclude: settingsFrame.Session.get("menuExclude"),
                origin: window.location.origin,
                waitPageLoadTime: 3000,
                theme: "ui4",
                modelName: dutInfo.odmpid || dutInfo.productid,
                modelVersion: `${dutInfo.firmver}_${dutInfo.buildno}_${dutInfo.extendno}`
            }}, "*");
        }
    }
    else{
        window.postMessage({ type: "FORM_UI_SETUP_TESTING", testingEnv: {
            menuList: Session.get("menuList." + ui_lang) || Session.get("menuList"),
            menuExclude: Session.get("menuExclude"),
            /*
            For testing purpose only
            menuList: [{ menuName: "Network Tools", index: "menu_NekworkTool", tab: [{ url: "Main_Analysis_Content.asp", tabName: "Network Diagnosis" }, { url: "Advanced_Notification_Content.asp", tabName: "Notification" }, { url: "Main_Netstat_Content.asp", tabName: "Netstat" }, { url: "Main_WOL_Content-NOTFOUND.asp", tabName: "Wake on LAN" }, { url: "Advanced_Smart_Connect.asp", tabName: "Smart Connect Rules" }, { url: "NULL", tabName: "__INHERIT__" }] }],
            */
            origin: window.location.origin,
            waitPageLoadTime: 2000,
            theme: "ui3",
            modelName: dutInfo.odmpid || dutInfo.productid,
            modelVersion: `${dutInfo.firmver}_${dutInfo.buildno}_${dutInfo.extendno}`
        }}, "*");
    }
}
catch(e){}