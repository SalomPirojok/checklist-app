import { describe, expect, it } from 'vitest';
import { normalizeInstagram, normalizePhone, normalizeTelegram, searchTerm } from '../../src/modules/crm/lib/normalize.js';

describe('normalizePhone', () => {
    it.each([
        ['+998 90 123-45-67', '+998901234567'],
        ['998901234567', '+998901234567'],
        ['90 123 45 67', '+998901234567'],
        ['(90) 1234567', '+998901234567'],
        ['+7 916 123 45 67', '+79161234567'],
    ])('%s -> %s', (input, expected) => {
        expect(normalizePhone(input)).toBe(expected);
    });

    it('treats empty input as no phone', () => {
        expect(normalizePhone('')).toBeNull();
        expect(normalizePhone('   ')).toBeNull();
        expect(normalizePhone(null)).toBeNull();
    });

    it('rejects text and too-short numbers', () => {
        expect(() => normalizePhone('call me')).toThrow();
        expect(() => normalizePhone('12345')).toThrow();
    });
});

describe('normalizeInstagram', () => {
    it.each([
        ['@Kamo.Auto', 'kamo.auto'],
        ['kamo_auto ', 'kamo_auto'],
        ['https://www.instagram.com/kamo.auto/?hl=ru', 'kamo.auto'],
    ])('%s -> %s', (input, expected) => {
        expect(normalizeInstagram(input)).toBe(expected);
    });

    it('rejects invalid usernames', () => {
        expect(() => normalizeInstagram('kamo auto')).toThrow();
    });
});

describe('normalizeTelegram', () => {
    it('strips @ and t.me links but keeps case', () => {
        expect(normalizeTelegram('@Kamo_Auto')).toBe('Kamo_Auto');
        expect(normalizeTelegram('https://t.me/kamo_auto')).toBe('kamo_auto');
    });
});

describe('searchTerm', () => {
    it('drops characters that could break a PostgREST filter', () => {
        expect(searchTerm('Азиз,(phone.eq.1)')).toBe('Азизphone.eq.1');
        expect(searchTerm('50%')).toBe('50');
        expect(searchTerm('@kamo.auto')).toBe('@kamo.auto');
    });
});
