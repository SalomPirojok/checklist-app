import { localDateString, zonedMidnight } from './time.js';

// Shared between the auto-penalty check, the instant attendance notification,
// the daily report, and the employee profile, so "late" means the same thing
// everywhere. `schedule` is { startTime: 'HH:MM'|null, isScheduledDay: boolean }
// -- the per-date result of resolveScheduleFromShift().
//
// Shift times are entered on the business's wall clock, so "09:00" means
// 09:00 in the organization's timezone, not 09:00 UTC.
export function computeLateness(checkInAt, schedule, timeZone = 'UTC') {
    if (!schedule.isScheduledDay) {
        return { isLate: false, lateMinutes: 0, isScheduledDay: false };
    }

    const [hours, minutes] = schedule.startTime.split(':').map(Number);
    const localMidnight = zonedMidnight(localDateString(checkInAt, timeZone), timeZone);
    const expectedStart = new Date(localMidnight.getTime() + (hours * 60 + minutes) * 60000);
    const lateMinutes = Math.round((checkInAt.getTime() - expectedStart.getTime()) / 60000);
    return { isLate: lateMinutes > 0, lateMinutes: Math.max(lateMinutes, 0), isScheduledDay: true };
}
