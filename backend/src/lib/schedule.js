import { supabase } from './supabase.js';

// Loads every configured day for a department once, so callers checking
// lateness across many attendance records (e.g. an employee's whole history)
// don't issue one query per record.
export async function loadDepartmentScheduleDays(departmentId) {
    if (!departmentId) return new Map();
    const { data, error } = await supabase
        .from('department_schedule_days')
        .select('day_of_week, status, start_time, end_time')
        .eq('department_id', departmentId);
    if (error) throw new Error(error.message);
    return new Map(data.map((row) => [row.day_of_week, row]));
}

// Resolves the applicable {startTime, isScheduledDay} for one specific day of
// week (0 = Sunday .. 6 = Saturday): an explicit 'work' row uses its own
// hours, an explicit 'off' row means "not a scheduled work day" (never late),
// and no row (or an explicit 'undefined' row, i.e. not yet decided) falls
// back to the organization's single shift_start_time for every day -- the
// legacy behavior for departments with no schedule configured at all.
export function resolveScheduleForDay(scheduleDays, dayOfWeek, orgShiftStartTime) {
    const row = scheduleDays.get(dayOfWeek);
    if (row) {
        if (row.status === 'work') return { startTime: row.start_time, isScheduledDay: true };
        if (row.status === 'off') return { startTime: null, isScheduledDay: false };
    }
    return { startTime: orgShiftStartTime, isScheduledDay: true };
}
