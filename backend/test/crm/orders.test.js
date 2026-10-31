import { describe, expect, it } from 'vitest';
import { parseCbuResponse } from '../../src/modules/crm/lib/fx.js';
import { normalizePlate } from '../../src/modules/crm/routes/vehicles.js';
import { parseStaff } from '../../src/modules/crm/routes/orders.js';

describe('parseCbuResponse', () => {
    it('reads the rate and converts the date', () => {
        const json = [{ Ccy: 'USD', Rate: '12023.46', Nominal: '1', Date: '31.10.2026' }];
        expect(parseCbuResponse(json, 'USD')).toEqual({ rate: 12023.46, rateDate: '2026-10-31' });
    });

    it('divides by the nominal', () => {
        const json = [{ Ccy: 'JPY', Rate: '8000', Nominal: '100', Date: '01.11.2026' }];
        expect(parseCbuResponse(json, 'JPY').rate).toBe(80);
    });

    it('returns null for an unexpected answer', () => {
        expect(parseCbuResponse({ error: 'x' }, 'USD')).toBeNull();
        expect(parseCbuResponse([{ Ccy: 'EUR', Rate: '1', Date: '01.11.2026' }], 'USD')).toBeNull();
    });
});

describe('normalizePlate', () => {
    it('removes spaces and dashes and uppercases', () => {
        expect(normalizePlate('01 a 123 bc')).toBe('01A123BC');
        expect(normalizePlate('01-A-123-BC')).toBe('01A123BC');
    });

    it('treats empty as no plate and rejects junk', () => {
        expect(normalizePlate('')).toBeNull();
        expect(() => normalizePlate('01A!')).toThrow();
    });
});

describe('parseStaff', () => {
    it('accepts shares that add up to 100%', () => {
        expect(
            parseStaff([
                { staff_id: 'a', share_percent: 60 },
                { staff_id: 'b', share_percent: '40' },
            ])
        ).toEqual([
            { staff_id: 'a', share_percent: 60 },
            { staff_id: 'b', share_percent: 40 },
        ]);
    });

    it('allows a line without masters', () => {
        expect(parseStaff([])).toEqual([]);
        expect(parseStaff(undefined)).toBeUndefined();
    });

    it('rejects shares that do not add up, duplicates and bad values', () => {
        expect(() => parseStaff([{ staff_id: 'a', share_percent: 50 }])).toThrow(/100%/);
        expect(() => parseStaff([{ staff_id: 'a', share_percent: 50 }, { staff_id: 'a', share_percent: 50 }])).toThrow(/дважды/);
        expect(() => parseStaff([{ staff_id: 'a', share_percent: 0 }])).toThrow();
    });
});
