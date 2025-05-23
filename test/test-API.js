let apiList = [
    "get_clientlist",
    "get_clientlist_from_json_database",
    "get_cfg_clientlist",
    "get_onboardingstatus",
    "get_SambaInfo",
    "get_ipsec_conn",
    "get_ethernet_wan_list",
    "get_lan_hwaddr",
    "get_default_reboot_time",
    "get_wl_bandwidth",
    "get_newob_onboardinglist",
    "get_operation_mode",
    "get_ui_support",
    "get_header_info",
    "get_usb_phy_port",
    "get_wan_unit",
    "show_usb_path",
    "channel_list_5g",
    "channel_list_5g_2",
    "wlc_psta_state",
    "get_iptvSettings",
    "utctimestamp",
    "check_acorpw",
    "check_passwd_strength-wl_key",
    "check_wireless_encryption",
    "get_simact_result",
    "get_wgs_parameter",
    "get_wgsc_parameter",
    "get_vpnc_parameter",
    "get_vpnc_count",
    "get_ap_info",
    "get_apg_wifi7_onoff",
    "apg_wifi_sched_on",
    "apm_wifi_sched_on",
    "get_customized_attribute-<dynamic>",
    "get_node_wifi_band",
    "get_label_mac",
    "language_support_list",
    "uptime",
    "vpn_crt_client",
    "get_vpnc_status",
    "get_new_vpnc_index",
    "vpn_crt_server",
    "vpn_server_get_parameter",
    "get_wgsc_status",
    "get_feat_def",
    "get_onboardinglist",
    "get_opt_status",
    "get_nvsw",
    "get_vpnc_nondef_wan_prof_list",
    "ookla_speedtest_get_servers",
    "ookla_speedtest_get_result",
    "speedtest_get_eth_monitor_result",
    "ookla_speedtest_get_history",
    "check_pw",
    "channel_list_2g",
    "channel_list_6g",
    "channel_list_6g_2",
    "chanspecs_2g",
    "chanspecs_5g",
    "chanspecs_5g_2",
    "chanspecs_6g",
    "chanspecs_6g_2",
    "wl_cap_2g",
    "wl_cap_5g",
    "wl_cap_5g_2",
    "wl_cap_6g",
    "wl_cap_6g_2",
    "wl_nband_info",
    "wl_control_channel",
    "get_wl_channel_list_2g",
    "get_wl_channel_list_5g",
    "get_wl_channel_list_5g_2",
    "get_wl_channel_list_6g",
    "get_wl_channel_list_6g_2"
]

let hookGetMore = function(objItems){
	var queryArray = [];
	var retData = {};

	var __hookNames = function(hookNames){
		return hookNames.map(function(hookName){
			return hookName.split("-")[0] + "(" + (hookName.split("-")[1] || "") + ")";
		}).join("%3B");
	};

	objItems.forEach(function(key){
		queryArray.push(key);
	});

	var xhr = new XMLHttpRequest();
	xhr.open('GET', '/appGet.cgi?hook=' + __hookNames(queryArray), false);
	xhr.setRequestHeader('Content-Type', 'application/json');
	xhr.send();

	if (xhr.status >= 200 && xhr.status < 300) {
		var response = JSON.parse(xhr.responseText);
		Object.keys(response).forEach(function(key){retData[key] = response[key];});
		retData.isError = false;
	} else {
		throw new Error('HTTP Error: ' + xhr.status);
	}

	return retData;
}

var apiTestResult = hookGetMore(apiList);
apiList.forEach(apiName => {
    if (!apiTestResult.hasOwnProperty(apiName)) {
        window.postMessage({
            type: "FORM_UI_ADD_ERRLOG",
            log: `webApi->${apiName} did not return a response during testing.`,
            url: `test-API.js`
        }, "*");
    }
});