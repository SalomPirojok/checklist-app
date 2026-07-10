// Shared between the auto-penalty check, the instant attendance notification,
// the daily report, and the employee profile, so "late" means the same thing
// everywhere. `schedule` is { startTime: 'HH:MM', daysOfWeek: number[]|null }
// -- daysOfWeek null/empty means "every day" (the org-wide default for
// employees with no department schedule configured).
export function computeLateness(checkInAt, schedule) {
    const daysOfWeek = schedule.daysOfWeek;
    if (Array.isArray(daysOfWeek) && daysOfWeek.length > 0 && !daysOfWeek.includes(checkInAt.getUTCDay())) {
        // Not a scheduled work day for this department -- nothing to be late against.
        return { isLate: false, lateMinutes: 0, isScheduledDay: false };
    }

    const [hours, minutes] = schedule.startTime.split(':').map(Number);
    const expectedStart = new Date(
        Date.UTC(checkInAt.getUTCFullYear(), checkInAt.getUTCMonth(), checkInAt.getUTCDate(), hours, minutes)
    );
    const lateMinutes = Math.round((checkInAt.getTime() - expectedStart.getTime()) / 60000);
    return { isLate: lateMinutes > 0, lateMinutes: Math.max(lateMinutes, 0), isScheduledDay: true };
}
