// Single org-wide shift_start_time for MVP (no per-employee schedules yet).
// Shared between the auto-penalty check, the instant attendance notification,
// and the daily report so "late" means the same thing everywhere.
export function computeLateness(checkInAt, shiftStartTime) {
    const [hours, minutes] = shiftStartTime.split(':').map(Number);
    const expectedStart = new Date(
        Date.UTC(checkInAt.getUTCFullYear(), checkInAt.getUTCMonth(), checkInAt.getUTCDate(), hours, minutes)
    );
    const lateMinutes = Math.round((checkInAt.getTime() - expectedStart.getTime()) / 60000);
    return { isLate: lateMinutes > 0, lateMinutes: Math.max(lateMinutes, 0) };
}
