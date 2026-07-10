import { supabase } from '../lib/supabase.js';
import { sendTelegramMessage } from '../lib/telegramNotify.js';
import { buildDailyReport, formatDailyReportMessage } from '../lib/dailyReport.js';

// Same periodic-poll model as the overdue/auto-assign jobs: every tick,
// re-derive "should today's report have gone out yet for this org?" rather
// than firing exactly once. Idempotency comes from last_daily_report_sent_date
// -- once set to today, this org is skipped for the rest of the day even if
// nothing was actually sent (no activity).
export async function runDailyReportCheck(botToken) {
    const now = new Date();
    const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
    const todayDate = now.toISOString().slice(0, 10);

    const { data: orgs, error } = await supabase
        .from('organizations')
        .select('id, daily_report_time, last_daily_report_sent_date')
        .lte('daily_report_time', currentTime)
        .or(`last_daily_report_sent_date.is.null,last_daily_report_sent_date.neq.${todayDate}`);
    if (error) throw new Error(`Failed to load organizations for daily report: ${error.message}`);
    if (orgs.length === 0) return { checked: 0, sent: 0 };

    let sent = 0;
    for (const org of orgs) {
        try {
            const report = await buildDailyReport(org.id, now);
            if (report.has_activity) {
                const { data: owner } = await supabase
                    .from('users')
                    .select('telegram_id')
                    .eq('organization_id', org.id)
                    .eq('role', 'owner')
                    .maybeSingle();
                if (owner?.telegram_id) {
                    await sendTelegramMessage(botToken, owner.telegram_id, formatDailyReportMessage(report));
                    sent += 1;
                }
            }
        } catch (err) {
            console.error(`Daily report failed for org ${org.id}:`, err.message);
        } finally {
            // Mark handled regardless of whether a message went out, so a
            // no-activity org isn't recomputed every tick for the rest of the day.
            const { error: markError } = await supabase
                .from('organizations')
                .update({ last_daily_report_sent_date: todayDate })
                .eq('id', org.id);
            if (markError) console.error(`Failed to mark daily report sent for org ${org.id}:`, markError.message);
        }
    }

    return { checked: orgs.length, sent };
}
