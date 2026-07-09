import crypto from 'node:crypto';

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60; // reject stale initData (bot was not opened, link replayed)

/**
 * Validates Telegram WebApp initData per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Returns the parsed user object on success, or null if the signature is invalid/expired.
 */
export function validateTelegramInitData(initData, botToken) {
    if (!initData || !botToken) return null;

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = [...params.entries()]
        .map(([key, value]) => `${key}=${value}`)
        .sort()
        .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const hashBuffer = Buffer.from(hash, 'hex');
    const computedBuffer = Buffer.from(computedHash, 'hex');
    if (hashBuffer.length !== computedBuffer.length || !crypto.timingSafeEqual(hashBuffer, computedBuffer)) {
        return null;
    }

    const authDate = Number(params.get('auth_date'));
    if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) {
        return null;
    }

    const userRaw = params.get('user');
    if (!userRaw) return null;

    let telegramUser;
    try {
        telegramUser = JSON.parse(userRaw);
    } catch {
        return null;
    }

    if (!telegramUser?.id) return null;

    return telegramUser;
}
