document.getElementById('settingsWindow').contentWindow.Session.set("lastPage", "");
window.localStorage.setItem("page", "dashboard");
console.log("End Testing!");
location.href = "/";