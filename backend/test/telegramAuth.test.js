import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateTelegramInitData } from '../src/lib/telegramAuth.js';

const BOT_TOKEN = '123456:TEST';

function signInitData(fields, botToken = BOT_TOKEN) {
    const params = new URLSearchParams(fields);
    const dataCheckString = [...params.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    params.set('hash', crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex'));
    return params.toString();
}

const nowSeconds = () => String(Math.floor(Date.now() / 1000));
const user = JSON.stringify({ id: 42, first_name: 'Test' });

describe('validateTelegramInitData', () => {
    it('accepts correctly signed, fresh initData', () => {
        const initData = signInitData({ auth_date: nowSeconds(), user });
        expect(validateTelegramInitData(initData, BOT_TOKEN)).toMatchObject({ id: 42 });
    });

    it('rejects data signed with another bot token', () => {
        const initData = signInitData({ auth_date: nowSeconds(), user }, '999:OTHER');
        expect(validateTelegramInitData(initData, BOT_TOKEN)).toBeNull();
    });

    it('rejects tampered fields', () => {
        const params = new URLSearchParams(signInitData({ auth_date: nowSeconds(), user }));
        params.set('user', JSON.stringify({ id: 43, first_name: 'Test' }));
        expect(validateTelegramInitData(params.toString(), BOT_TOKEN)).toBeNull();
    });

    it('rejects initData older than 24 hours', () => {
        const stale = String(Math.floor(Date.now() / 1000) - 25 * 60 * 60);
        expect(validateTelegramInitData(signInitData({ auth_date: stale, user }), BOT_TOKEN)).toBeNull();
    });
});
