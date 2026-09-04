/**
 * appGet.cgi hooks exercised by the `api.hook-sweep` suite.
 *
 * An entry is either a plain string, or an object when the hook needs more
 * than its name:
 *
 *   'uptime'                                  -> uptime()
 *   { name: 'check_passwd_strength',
 *     arg: 'wl_key' }                         -> check_passwd_strength(wl_key)
 *   { name: 'wl_cap_2g', needs: 'broadcom' }  -> skipped on non-Broadcom builds
 *
 * `needs` exists because "the hook returned nothing" and "the hook cannot
 * exist in this firmware" look identical over appGet.cgi -- an unregistered
 * hook is simply absent from the response. Without the annotation, sweeping a
 * platform-specific hook on the wrong platform reports a defect that isn't one.
 *
 * Supported `needs` values (a string, or an array of them):
 *   'broadcom'      the hook is implemented in httpd/sysdeps/web-broadcom.c
 *   'support:<key>' get_ui_support() must report <key> as truthy
 *
 * A radio band is *derived* rather than annotated: any hook whose name ends in
 * a band suffix needs that radio to exist. Deriving it means a hook added later
 * is gated without anyone remembering to say so.
 */
export const API_HOOKS = [
    'get_clientlist',
    'get_clientlist_from_json_database',
    'get_cfg_clientlist',
    'get_onboardingstatus',
    'get_SambaInfo',
    'get_ipsec_conn',
    'get_ethernet_wan_list',
    'get_lan_hwaddr',
    'get_default_reboot_time',
    'get_wl_bandwidth',
    'get_newob_onboardinglist',
    'get_operation_mode',
    'get_ui_support',
    'get_header_info',
    'get_usb_phy_port',
    'get_wan_unit',
    'show_usb_path',
    'channel_list_2g',
    'channel_list_5g',
    'channel_list_5g_2',
    'channel_list_6g',
    'channel_list_6g_2',
    'wlc_psta_state',
    'get_iptvSettings',
    'utctimestamp',
    'check_acorpw',
    { name: 'check_passwd_strength', arg: 'wl_key' },
    'check_wireless_encryption',
    'get_simact_result',
    'get_wgs_parameter',
    'get_wgsc_parameter',
    'get_vpnc_parameter',
    'get_vpnc_count',
    'get_ap_info',
    'get_apg_wifi7_onoff',
    'apg_wifi_sched_on',
    'apm_wifi_sched_on',
    'get_node_wifi_band',
    'get_label_mac',
    'language_support_list',
    'uptime',
    'vpn_crt_client',
    'get_vpnc_status',
    'get_new_vpnc_index',
    'vpn_crt_server',
    'vpn_server_get_parameter',
    'get_wgsc_status',
    'get_feat_def',
    'get_onboardinglist',
    'get_opt_status',
    'get_nvsw',
    'get_vpnc_nondef_wan_prof_list',
    'ookla_speedtest_get_servers',
    'ookla_speedtest_get_result',
    'speedtest_get_eth_monitor_result',
    'ookla_speedtest_get_history',
    'check_pw',
    'chanspecs_2g',
    'chanspecs_5g',
    'chanspecs_5g_2',
    'chanspecs_6g',
    'chanspecs_6g_2',
    // wl_cap_* live in httpd/sysdeps/web-broadcom.c and are absent from MTK
    // builds, so they are not swept there.
    { name: 'wl_cap_2g', needs: 'broadcom' },
    { name: 'wl_cap_5g', needs: 'broadcom' },
    { name: 'wl_cap_5g_2', needs: 'broadcom' },
    { name: 'wl_cap_6g', needs: 'broadcom' },
    { name: 'wl_cap_6g_2', needs: 'broadcom' },
    'wl_nband_info',
    'wl_control_channel',
    'get_wl_channel_list_2g',
    'get_wl_channel_list_5g',
    'get_wl_channel_list_5g_2',
    'get_wl_channel_list_6g',
    'get_wl_channel_list_6g_2',
];

/** Hooks whose argument depends on runtime state; reported as skipped. */
export const API_HOOKS_NEEDING_ARGS = ['get_customized_attribute'];

/**
 * Radios a hook name can be specific to, longest first so `_5g_2` is not read
 * as `_5g`.
 */
const BAND_SUFFIXES = ['5g_2', '6g_2', '2g', '5g', '6g'];

/** `channel_list_5g_2` -> `5g_2`; `uptime` -> null. */
export function bandOf(name) {
    return BAND_SUFFIXES.find((band) => String(name).endsWith(`_${band}`)) || null;
}

/**
 * `wlnband_list` entries -> the band suffixes that exist on this router.
 * The nvram value is `2g1<5g1<6g1`, and httpd hands it over with the
 * separator still HTML-escaped as `&#60`.
 */
export function bandsFrom(wlnbandList) {
    if (!wlnbandList) return null;
    return new Set(
        String(wlnbandList)
            .split(/&#60|</)
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => {
                const parsed = /^(\d+g)(\d+)$/.exec(entry);
                if (!parsed) return null;
                const [, type, index] = parsed;
                // The first of a band carries no suffix: 5g1 -> _5g, 5g2 -> _5g_2.
                return index === '1' ? type : `${type}_${index}`;
            })
            .filter(Boolean)
    );
}

/** `'uptime'` or `{name, arg, needs}` -> a uniform shape. */
export function normalizeHook(entry) {
    const hook = typeof entry === 'string' ? { name: entry } : { ...entry };
    return {
        name: hook.name,
        arg: hook.arg || '',
        needs: hook.needs ? [].concat(hook.needs) : [],
        band: bandOf(hook.name),
        /** What appGet.cgi asks for. */
        expr: `${hook.name}(${hook.arg || ''})`,
        /**
         * The JSON key appGet.cgi answers with. app_call() in httpd/web.c
         * writes `"<func>-<arg0>":` whenever an argument was supplied, and
         * plain `"<func>":` otherwise -- which is why the UI's own code reads
         * `hookGet("check_passwd_strength-wl_key")`.
         */
        key: hook.arg ? `${hook.name}-${hook.arg}` : hook.name,
    };
}

export const NORMALIZED_HOOKS = API_HOOKS.map(normalizeHook);
