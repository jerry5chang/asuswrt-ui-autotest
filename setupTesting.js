window.postMessage({ type: "SETUP_TESTING", testingEnv: {
//    menuList: Session.get("menuList." + ui_lang),
///*
//    For testing purpose only
    menuList: [
        {
            "menuName": "网络工具",
            "index": "menu_NekworkTool",
            "tab": [
                {
                    "url": "Main_Analysis_Content.asp",
                    "tabName": "网络诊断"
                },
                {
                    "url": "Main_Netstat_Content.asp",
                    "tabName": "Netstat"
                },
                {
                    "url": "Main_WOL_Content.asp",
                    "tabName": "通过网络（LAN）唤醒"
                },
                {
                    "url": "Advanced_Smart_Connect.asp",
                    "tabName": "Smart Connect 规则"
                },
                {
                    "url": "NULL",
                    "tabName": "__INHERIT__"
                }
            ]
        }
    ],
//*/
    origin: window.location.origin
}}, "*");