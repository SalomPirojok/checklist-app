import { Router } from 'express';
import { supabase } from '../../../lib/supabase.js';
import { encryptSecret } from '../../../lib/secrets.js';
import { requirePermission } from '../middleware.js';
import { crmAudit } from '../lib/audit.js';
import { sendDbError } from '../lib/dbErrors.js';
import { getMe, subscribeToMessages } from '../lib/instagram.js';

const router = Router();

router.use(requirePermission('settings.manage'));

function publicView(row) {
    return row
        ? { status: row.status, username: row.config?.username || null, ig_user_id: row.config?.ig_user_id || null, connected_at: row.connected_at, last_error: row.last_error }
        : { status: 'disconnected' };
}

router.get('/instagram', async (req, res) => {
    const { data, error } = await supabase
        .from('crm_integrations')
        .select('status, config, connected_at, last_error')
        .eq('organization_id', req.user.organizationId)
        .eq('provider', 'instagram')
        .maybeSingle();
    if (error) return sendDbError(res, error);
    res.json({
        instagram: publicView(data),
        // What to enter in the Meta app's webhook settings.
        // Render terminates TLS at its proxy, so req.protocol would say http.
        webhook_url: `${process.env.PUBLIC_API_URL || `https://${req.get('host')}`}/api/webhooks/instagram`,
        server_ready: !!(process.env.META_APP_SECRET && process.env.META_VERIFY_TOKEN && process.env.CRM_ENCRYPTION_KEY),
    });
});

// Body: { access_token } -- a long-lived Instagram User token generated in
// the Meta app dashboard. It is verified, encrypted and never sent back.
router.put('/instagram', async (req, res) => {
    const token = String(req.body?.access_token || '').trim();
    if (token.length < 20) return res.status(400).json({ error: 'Вставьте токен доступа Instagram' });
    if (!process.env.CRM_ENCRYPTION_KEY) return res.status(500).json({ error: 'На сервере не задан CRM_ENCRYPTION_KEY' });

    let me;
    try {
        me = await getMe(token);
    } catch (err) {
        return res.status(400).json({ error: `Instagram не принял токен: ${err.message}` });
    }
    if (!me.user_id) return res.status(400).json({ error: 'Не удалось определить аккаунт Instagram' });

    // Another organization must not receive this account's messages.
    const { data: taken, error: takenError } = await supabase
        .from('crm_integrations')
        .select('organization_id')
        .eq('provider', 'instagram')
        .filter('config->>ig_user_id', 'eq', String(me.user_id))
        .neq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (takenError) return sendDbError(res, takenError);
    if (taken) return res.status(409).json({ error: 'Этот Instagram уже подключён к другой организации' });

    let lastError = null;
    try {
        await subscribeToMessages(token);
    } catch (err) {
        lastError = `Подписка на сообщения: ${err.message}`;
    }

    const row = {
        organization_id: req.user.organizationId,
        provider: 'instagram',
        status: 'connected',
        config: { ig_user_id: String(me.user_id), username: me.username || null, token_refreshed_at: new Date().toISOString() },
        secrets_encrypted: encryptSecret(token),
        last_error: lastError,
        connected_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
        .from('crm_integrations')
        .upsert(row, { onConflict: 'organization_id,provider' })
        .select('status, config, connected_at, last_error')
        .single();
    if (error) return sendDbError(res, error, 'Не удалось сохранить подключение');
    await crmAudit(req, 'crm.integration.instagram.connect', 'crm_integration', null, null, { username: me.username, ig_user_id: me.user_id });
    res.json({ instagram: publicView(data) });
});

router.delete('/instagram', async (req, res) => {
    const { error } = await supabase
        .from('crm_integrations')
        .update({ status: 'disconnected', secrets_encrypted: null, last_error: null })
        .eq('organization_id', req.user.organizationId)
        .eq('provider', 'instagram');
    if (error) return sendDbError(res, error);
    await crmAudit(req, 'crm.integration.instagram.disconnect', 'crm_integration', null);
    res.json({ instagram: { status: 'disconnected' } });
});

export default router;
