import { supabase } from '../lib/supabase.js';
import { localDateString } from '../lib/time.js';
import { buildDashboard } from '../modules/crm/lib/dashboardData.js';
import { notify } from '../modules/crm/lib/notify.js';
import { dailySummaryText } from '../modules/crm/lib/notifyText.js';

// Evening CRM summary to everyone subscribed to 'daily_summary'. Same
// periodic-poll model as the Kontrolla daily report: each tick checks
// whether today's summary is due and not yet sent; the sent date is kept
// in the organization's crm module settings.
const SUMMARY_HOUR = 21; // local time in the organization's timezone

function localHour(now, timeZone) {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
}

export async function runCrmDailySummary(now = new Date()) {
    const { data: modules, error } = await supabase
        .from('organization_modules')
        .select('id, organization_id, settings, organization:organizations(timezone, is_suspended)')
        .eq('module_key', 'crm')
        .eq('enabled', true);
    if (error) throw new Error(error.message);

    let sent = 0;
    for (const mod of modules) {
        if (mod.organization?.is_suspended) continue;
        const tz = mod.organization?.timezone || 'Asia/Tashkent';
        const today = localDateString(now, tz);
        if (localHour(now, tz) < SUMMARY_HOUR || mod.settings?.daily_summary_sent_on === today) continue;

        // Mark first: a failure must not turn into a message every 5 minutes.
        const { error: markError } = await supabase
            .from('organization_modules')
            .update({ settings: { ...mod.settings, daily_summary_sent_on: today } })
            .eq('id', mod.id);
        if (markError) {
            console.error(`CRM summary: failed to mark org ${mod.organization_id}:`, markError.message);
            continue;
        }
        try {
            const dashboard = await buildDashboard(mod.organization_id, now);
            sent += await notify(mod.organization_id, 'daily_summary', dailySummaryText(dashboard), '');
        } catch (err) {
            console.error(`CRM summary failed for org ${mod.organization_id}:`, err.message);
        }
    }
    return { checked: modules.length, sent };
}
