window.addEventListener("message", function (event) {
    if (event.data && event.data.type === "SET_LANG") {
        httpApi.nvramSet({
            preferred_lang: event.data.lang,
            action_mode: "apply"
        }, function(){
            window.postMessage({ type: "FORM_UI_START_TESTING" }, "*");    
        })  
    }
});