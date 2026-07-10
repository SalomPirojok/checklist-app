import { supabase } from './supabase.js';

// Resolves the applicable {startTime, daysOfWeek} for a user: their
// department's schedule if one is configured, else the org-wide
// shift_start_time with no day restriction (legacy default, matches
// pre-department-schedule behavior).
export async function resolveScheduleForDepartment(departmentId, orgShiftStartTime) {
    if (departmentId) {
        const { data: schedule } = await supabase
            .from('department_schedules')
            .select('start_time, days_of_week')
            .eq('department_id', departmentId)
            .maybeSingle();
        if (schedule) return { startTime: schedule.start_time, daysOfWeek: schedule.days_of_week };
    }
    return { startTime: orgShiftStartTime, daysOfWeek: null };
}
