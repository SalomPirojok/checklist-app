// PLATFORM_ADMIN_TELEGRAM_IDS is a comma-separated list of Telegram user ids
// that get access to the cross-tenant platform admin panel, independent of
// whether that id is (or is not) a member of any organization.
const adminIds = new Set(
    (process.env.PLATFORM_ADMIN_TELEGRAM_IDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
);

export function isPlatformAdminTelegramId(telegramId) {
    return adminIds.has(Number(telegramId));
}
