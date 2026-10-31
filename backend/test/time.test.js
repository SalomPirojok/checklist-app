import { describe, expect, it } from 'vitest';
import { localDateString, periodRange, zonedMidnight, zoneOffsetMinutes } from '../src/lib/time.js';

const TZ = 'Asia/Tashkent';

describe('time helpers in Asia/Tashkent (UTC+5)', () => {
    it('reports a +300 minute offset', () => {
        expect(zoneOffsetMinutes(new Date('2026-10-31T12:00:00Z'), TZ)).toBe(300);
    });

    it('rolls the local date over at 19:00 UTC', () => {
        expect(localDateString(new Date('2026-10-31T18:59:59Z'), TZ)).toBe('2026-10-31');
        expect(localDateString(new Date('2026-10-31T19:00:00Z'), TZ)).toBe('2026-11-01');
    });

    it('puts local midnight at 19:00 UTC the previous day', () => {
        expect(zonedMidnight('2026-11-01', TZ).toISOString()).toBe('2026-10-31T19:00:00.000Z');
    });

    it('treats 02:00 local as "today", not as the previous UTC day', () => {
        // 2026-11-01 02:00 in Tashkent == 2026-10-31 21:00 UTC
        const range = periodRange('day', new Date('2026-10-31T21:00:00Z'), TZ);
        expect(range).toEqual({
            startDate: '2026-11-01',
            endDate: '2026-11-02',
            from: '2026-10-31T19:00:00.000Z',
            to: '2026-11-01T19:00:00.000Z',
        });
    });

    it('starts weeks on Monday', () => {
        // 2026-11-01 is a Sunday
        const range = periodRange('week', new Date('2026-11-01T10:00:00Z'), TZ);
        expect(range.startDate).toBe('2026-10-26');
        expect(range.endDate).toBe('2026-11-02');
    });

    it('covers the whole local month, including December rollover', () => {
        const range = periodRange('month', new Date('2026-12-15T10:00:00Z'), TZ);
        expect(range.startDate).toBe('2026-12-01');
        expect(range.endDate).toBe('2027-01-01');
        expect(range.from).toBe('2026-11-30T19:00:00.000Z');
    });

    it('handles a DST zone correctly on the switch day', () => {
        // Europe/Berlin moves from UTC+2 to UTC+1 on 2026-10-25.
        expect(zonedMidnight('2026-10-25', 'Europe/Berlin').toISOString()).toBe('2026-10-24T22:00:00.000Z');
        expect(zonedMidnight('2026-10-26', 'Europe/Berlin').toISOString()).toBe('2026-10-25T23:00:00.000Z');
    });

    it('rejects malformed dates and unknown periods', () => {
        expect(() => zonedMidnight('2026-1-1', TZ)).toThrow();
        expect(() => periodRange('year', new Date(), TZ)).toThrow();
    });
});
