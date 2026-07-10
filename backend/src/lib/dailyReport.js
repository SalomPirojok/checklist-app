import { supabase } from './supabase.js';
import { computeLateness } from './lateness.js';

function startOfDayUTC(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function endOfDayUTC(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
}

// Builds the same summary used both by the evening Telegram report and the
// "Отчёты" screen, for a single UTC calendar day.
export async function buildDailyReport(organizationId, day) {
    const dayStart = startOfDayUTC(day);
    const dayEnd = endOfDayUTC(day);

    const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('shift_start_time')
        .eq('id', organizationId)
        .single();
    if (orgError) throw new Error(orgError.message);

    const { data: orgUsers, error: usersError } = await supabase
        .from('users')
        .select('id, full_name, role, is_active')
        .eq('organization_id', organizationId);
    if (usersError) throw new Error(usersError.message);
    const orgUserIds = orgUsers.map((u) => u.id);
    const activeStaff = orgUsers.filter((u) => u.is_active && u.role !== 'owner');

    const [
        { data: attendanceRecords, error: attendanceError },
        { data: assignments, error: assignmentsError },
        { data: penaltyRows, error: penaltiesError },
    ] = await Promise.all([
        supabase
            .from('attendance_records')
            .select('*')
            .eq('organization_id', organizationId)
            .gte('created_at', dayStart)
            .lt('created_at', dayEnd),
        orgUserIds.length
            ? supabase
                  .from('checklist_assignments')
                  .select('id, status, assigned_to')
                  .in('assigned_to', orgUserIds)
                  .eq('is_standing', false)
                  .or(
                      `and(due_at.gte.${dayStart},due_at.lt.${dayEnd}),and(due_at.is.null,created_at.gte.${dayStart},created_at.lt.${dayEnd})`
                  )
            : Promise.resolve({ data: [], error: null }),
        supabase.from('penalties').select('*').eq('organization_id', organizationId).gte('created_at', dayStart).lt('created_at', dayEnd),
    ]);
    if (attendanceError || assignmentsError || penaltiesError) {
        throw new Error('Failed to load daily report data');
    }

    const attendanceByUser = new Map();
    for (const rec of attendanceRecords) {
        if (!attendanceByUser.has(rec.user_id)) attendanceByUser.set(rec.user_id, {});
        attendanceByUser.get(rec.user_id)[rec.type] = rec;
    }

    const attendance = activeStaff.map((u) => {
        const recs = attendanceByUser.get(u.id) || {};
        let checkIn = null;
        if (recs.check_in) {
            const { isLate, lateMinutes } = computeLateness(new Date(recs.check_in.created_at), org.shift_start_time);
            checkIn = { time: recs.check_in.created_at, isLate, lateMinutes };
        }
        return {
            user_id: u.id,
            full_name: u.full_name,
            check_in: checkIn,
            check_out: recs.check_out ? { time: recs.check_out.created_at } : null,
        };
    });
    const noCheckIn = attendance.filter((a) => !a.check_in).map((a) => ({ user_id: a.user_id, full_name: a.full_name }));

    const checklists = {
        total: assignments.length,
        completed: assignments.filter((a) => a.status === 'completed').length,
        overdue: assignments.filter((a) => a.status === 'overdue').length,
    };

    const userMap = new Map(orgUsers.map((u) => [u.id, u]));
    const penalties = penaltyRows.map((p) => ({
        ...p,
        full_name: userMap.get(p.user_id)?.full_name || '—',
    }));

    const hasActivity = attendanceRecords.length > 0 || assignments.length > 0 || penalties.length > 0;

    return {
        date: dayStart.slice(0, 10),
        attendance,
        no_checkin: noCheckIn,
        checklists,
        penalties,
        has_activity: hasActivity,
    };
}

function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

export function formatDailyReportMessage(report) {
    const lines = [`📊 Отчёт за ${report.date}`];

    const withCheckIn = report.attendance.filter((a) => a.check_in);
    lines.push('', 'Посещаемость:');
    if (withCheckIn.length === 0) {
        lines.push('Никто не отметился.');
    } else {
        for (const a of withCheckIn) {
            const inPart = `пришёл в ${formatTime(a.check_in.time)}${a.check_in.isLate ? ` (опоздание на ${a.check_in.lateMinutes} мин)` : ' (вовремя)'}`;
            const outPart = a.check_out ? `, ушёл в ${formatTime(a.check_out.time)}` : '';
            lines.push(`• ${a.full_name}: ${inPart}${outPart}`);
        }
    }

    if (report.no_checkin.length > 0) {
        lines.push('', 'Не отметили приход:');
        for (const u of report.no_checkin) lines.push(`• ${u.full_name}`);
    }

    lines.push('', `Чек-листы: выполнено ${report.checklists.completed} из ${report.checklists.total}, просрочено ${report.checklists.overdue}`);

    if (report.penalties.length > 0) {
        lines.push('', 'Штрафы:');
        for (const p of report.penalties) lines.push(`• ${p.full_name} — ${p.reason} (${Number(p.amount).toLocaleString('ru-RU')} сум)`);
    }

    return lines.join('\n');
}
