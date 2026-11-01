import { supabase } from '../../../lib/supabase.js';
import { sendTelegramMessage } from '../../../lib/telegramNotify.js';

// Opens the Mini App straight on a CRM screen, e.g. "orders/<uuid>".
// MINI_APP_URL (or FRONTEND_ORIGIN) must be the URL the bot's menu opens.
function openButton(path) {
    const base = process.env.MINI_APP_URL || process.env.FRONTEND_ORIGIN;
    if (!base || !path) return {};
    const url = `${base.replace(/\/$/, '')}/?crm=${encodeURIComponent(path)}`;
    return { reply_markup: { inline_keyboard: [[{ text: 'Открыть в CRM', web_app: { url } }]] } };
}

// Subscribers to an event who can still see the CRM: active, connected to
// Telegram, and either the owner or holding a CRM role.
export async function recipientsFor(orgId, eventType) {
    const { data: subs, error } = await supabase
        .from('crm_notification_subscriptions')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('event_type', eventType);
    if (error) throw new Error(error.message);
    if (!subs.length) return [];

    const userIds = subs.map((s) => s.user_id);
    const [users, roles] = await Promise.all([
        supabase.from('users').select('id, role, telegram_id, is_active').in('id', userIds).eq('organization_id', orgId),
        supabase.from('crm_user_roles').select('user_id').in('user_id', userIds),
    ]);
    if (users.error || roles.error) throw new Error((users.error || roles.error).message);
    const withRole = new Set(roles.data.map((r) => r.user_id));
    return users.data.filter((u) => u.is_active && u.telegram_id && (u.role === 'owner' || withRole.has(u.id)));
}

export async function notify(orgId, eventType, text, linkPath) {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) return 0;
    const recipients = await recipientsFor(orgId, eventType);
    let sent = 0;
    for (const user of recipients) {
        try {
            await sendTelegramMessage(botToken, user.telegram_id, text, openButton(linkPath));
            sent += 1;
        } catch (err) {
            // e.g. the user blocked the bot; others still get it.
            console.error(`CRM notification ${eventType} to ${user.id} failed:`, err.message);
        }
    }
    return sent;
}

// Fire-and-forget from request handlers: never delays or fails the request.
// `build` is an async function returning { text, link } (or null to skip),
// so name lookups also happen off the request path.
export function notifyLater(orgId, eventType, build) {
    Promise.resolve()
        .then(build)
        .then((msg) => (msg ? notify(orgId, eventType, msg.text, msg.link) : 0))
        .catch((err) => console.error(`CRM notification ${eventType} failed:`, err.message));
}

// Names for order messages.
export async function orderContext(order) {
    const [client, vehicle] = await Promise.all([
        supabase.from('crm_clients').select('first_name, last_name, phone, instagram_username').eq('id', order.client_id).single(),
        order.vehicle_id ? supabase.from('crm_vehicles').select('make, model, plate').eq('id', order.vehicle_id).single() : { data: null },
    ]);
    return { client: client.data, vehicle: vehicle.data };
}
