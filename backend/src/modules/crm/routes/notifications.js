import { Router } from 'express';
import { supabase } from '../../../lib/supabase.js';
import { sendTelegramMessage } from '../../../lib/telegramNotify.js';
import { crmAudit } from '../lib/audit.js';
import { sendDbError } from '../lib/dbErrors.js';
import { NOTIFICATION_EVENTS } from '../lib/notifyText.js';

const router = Router();

// Everyone manages their own subscriptions; settings.manage also manages
// other CRM users'.
function canManage(req, userId) {
    return userId === req.user.id || req.crm.permissions.includes('settings.manage');
}

router.get('/', async (req, res) => {
    const orgId = req.user.organizationId;
    const isAdmin = req.crm.permissions.includes('settings.manage');

    let usersQuery = supabase.from('users').select('id, full_name, role, telegram_id, is_active').eq('organization_id', orgId).eq('is_active', true);
    if (!isAdmin) usersQuery = usersQuery.eq('id', req.user.id);
    const [users, roles, subs] = await Promise.all([
        usersQuery.order('full_name'),
        supabase.from('crm_user_roles').select('user_id').eq('organization_id', orgId),
        supabase.from('crm_notification_subscriptions').select('user_id, event_type').eq('organization_id', orgId),
    ]);
    const failed = [users, roles, subs].find((r) => r.error);
    if (failed) return sendDbError(res, failed.error);

    const withRole = new Set(roles.data.map((r) => r.user_id));
    res.json({
        events: NOTIFICATION_EVENTS,
        users: users.data
            // Only people who can open the CRM may receive its notifications.
            .filter((u) => u.role === 'owner' || withRole.has(u.id))
            .map((u) => ({
                id: u.id,
                full_name: u.full_name,
                has_telegram: !!u.telegram_id,
                is_me: u.id === req.user.id,
                events: subs.data.filter((s) => s.user_id === u.id).map((s) => s.event_type),
            })),
    });
});

// Body: { events: [...] } -- the full set of event types for that user.
router.put('/:userId', async (req, res) => {
    const orgId = req.user.organizationId;
    const userId = req.params.userId;
    if (!canManage(req, userId)) return res.status(403).json({ error: 'Недостаточно прав' });
    const events = req.body?.events;
    if (!Array.isArray(events) || events.some((e) => !NOTIFICATION_EVENTS.includes(e))) {
        return res.status(400).json({ error: 'Неверный список уведомлений' });
    }

    const { data: target, error: targetError } = await supabase.from('users').select('id').eq('id', userId).eq('organization_id', orgId).maybeSingle();
    if (targetError) return sendDbError(res, targetError);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

    const { error: deleteError } = await supabase.from('crm_notification_subscriptions').delete().eq('user_id', userId).eq('organization_id', orgId);
    if (deleteError) return sendDbError(res, deleteError);
    if (events.length) {
        const { error } = await supabase
            .from('crm_notification_subscriptions')
            .insert([...new Set(events)].map((event_type) => ({ organization_id: orgId, user_id: userId, event_type })));
        if (error) return sendDbError(res, error, 'Не удалось сохранить уведомления');
    }
    await crmAudit(req, 'crm.notifications.update', 'user', userId, null, { events });
    res.json({ user_id: userId, events });
});

router.post('/test', async (req, res) => {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) return res.status(500).json({ error: 'Бот не настроен на сервере' });
    const { data: me, error } = await supabase.from('users').select('telegram_id').eq('id', req.user.id).single();
    if (error) return sendDbError(res, error);
    if (!me.telegram_id) return res.status(400).json({ error: 'Ваш Telegram не подключён' });
    try {
        await sendTelegramMessage(botToken, me.telegram_id, '✅ Уведомления CRM работают. Так будут приходить новые заявки, заказы и оплаты.');
    } catch (err) {
        return res.status(502).json({ error: `Telegram не принял сообщение: ${err.message}` });
    }
    res.json({ ok: true });
});

export default router;
