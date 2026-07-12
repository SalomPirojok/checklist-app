// Shared between the auto-penalty check, the instant attendance notification,
// the daily report, and the employee profile, so "late" means the same thing
// everywhere. `schedule` is { startTime: 'HH:MM'|null, isScheduledDay: boolean }
// -- the per-date result of resolveScheduleFromShift().
export function computeLateness(checkInAt, schedule) {
    if (!schedule.isScheduledDay) {
        return { isLate: false, lateMinutes: 0, isScheduledDay: false };
    }

    const [hours, minutes] = schedule.startTime.split(':').map(Number);
    const expectedStart = new Date(
        Date.UTC(checkInAt.getUTCFullYear(), checkInAt.getUTCMonth(), checkInAt.getUTCDate(), hours, minutes)
    );
    const lateMinutes = Math.round((checkInAt.getTime() - expectedStart.getTime()) / 60000);
    return { isLate: lateMinutes > 0, lateMinutes: Math.max(lateMinutes, 0), isScheduledDay: true };
}
