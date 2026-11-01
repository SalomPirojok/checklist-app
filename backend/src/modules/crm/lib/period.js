import { supabase } from '../../../lib/supabase.js';
import { periodRange, zonedMidnight } from '../../../lib/time.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function orgTimezone(orgId) {
    const { data, error } = await supabase.from('organizations').select('timezone').eq('id', orgId).single();
    if (error) throw new Error(error.message);
    return data.timezone || 'Asia/Tashkent';
}

function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, organization's local calendar);
// defaults to the current month. Returns ISO instants [from, to) plus the
// inclusive local dates. Throws a user-facing Error on a bad range.
export async function resolvePeriod(req) {
    const tz = await orgTimezone(req.user.organizationId);
    const { from, to } = req.query;
    if (from || to) {
        if (!DATE.test(from || '') || !DATE.test(to || '') || from > to) throw new Error('Неверный период');
        return {
            tz,
            startDate: from,
            endDate: to,
            from: zonedMidnight(from, tz).toISOString(),
            to: zonedMidnight(addDays(to, 1), tz).toISOString(),
        };
    }
    const month = periodRange('month', new Date(), tz);
    return { tz, ...month, endDate: addDays(month.endDate, -1) };
}
