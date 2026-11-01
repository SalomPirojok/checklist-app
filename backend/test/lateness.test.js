import { describe, expect, it } from 'vitest';
import { computeLateness } from '../src/lib/lateness.js';

const shift = { startTime: '09:00', isScheduledDay: true };
const TZ = 'Asia/Tashkent';

describe('computeLateness in the organization timezone', () => {
    it('09:10 in Tashkent is 10 minutes late for a 09:00 shift', () => {
        // 09:10 Tashkent = 04:10 UTC
        expect(computeLateness(new Date('2026-11-02T04:10:00Z'), shift, TZ)).toEqual({ isLate: true, lateMinutes: 10, isScheduledDay: true });
    });

    it('08:55 in Tashkent is on time', () => {
        expect(computeLateness(new Date('2026-11-02T03:55:00Z'), shift, TZ)).toMatchObject({ isLate: false, lateMinutes: 0 });
    });

    it('the old UTC reading would have missed the lateness', () => {
        // Same instant read as UTC: 04:10 < 09:00, "on time" -- the bug that was fixed.
        expect(computeLateness(new Date('2026-11-02T04:10:00Z'), shift).isLate).toBe(false);
    });

    it('an evening shift and a day without a shift', () => {
        const evening = { startTime: '18:30', isScheduledDay: true };
        // 18:45 Tashkent = 13:45 UTC
        expect(computeLateness(new Date('2026-11-02T13:45:00Z'), evening, TZ).lateMinutes).toBe(15);
        expect(computeLateness(new Date('2026-11-02T13:45:00Z'), { startTime: null, isScheduledDay: false }, TZ).isLate).toBe(false);
    });
});
