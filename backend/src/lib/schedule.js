import { supabase } from './supabase.js';

// Lateness is judged purely against the employee's own planned shift for that
// exact date (schedule_shifts, filled in via the "Смены сотрудников"
// constructor) -- not the department's weekly pattern or the org-wide
// default. No shift entry, an 'undefined' status, or a 'work' entry missing
// a start_time all mean "we don't know when they were expected", so no
// penalty is possible; an explicit 'off' entry means "not a scheduled work
// day" even if they checked in anyway.
export function resolveScheduleFromShift(shift) {
    if (!shift || shift.status !== 'work' || !shift.start_time) {
        return { startTime: null, isScheduledDay: false };
    }
    return { startTime: shift.start_time, isScheduledDay: true };
}

// For a single check-in event (attendance.js).
export async function resolveScheduleForShiftDate(userId, dateStr) {
    const { data: shift, error } = await supabase
        .from('schedule_shifts')
        .select('status, start_time')
        .eq('user_id', userId)
        .eq('shift_date', dateStr)
        .maybeSingle();
    if (error) throw new Error(error.message);
    return resolveScheduleFromShift(shift);
}
