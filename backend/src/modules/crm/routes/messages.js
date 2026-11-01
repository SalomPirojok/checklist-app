import { Router } from 'express';
import { supabase } from '../../../lib/supabase.js';
import { decryptSecret } from '../../../lib/secrets.js';
import { requirePermission } from '../middleware.js';
import { crmAudit } from '../lib/audit.js';
import { sendDbError } from '../lib/dbErrors.js';
import { isOutsideWindow, sendText } from '../lib/instagram.js';
import { cleanText } from '../lib/normalize.js';

const router = Router();

const MESSAGE_FIELDS = 'id, client_id, lead_id, channel, direction, body, attachments, sent_by, status, error, sent_at';

// Conversation with one client, oldest first.
router.get('/', requirePermission('clients.manage', 'leads.manage', 'messages.send'), async (req, res) => {
    if (!req.query.client_id) return res.status(400).json({ error: 'client_id обязателен' });
    const { data, error } = await supabase
        .from('crm_messages')
        .select(MESSAGE_FIELDS)
        .eq('organization_id', req.user.organizationId)
        .eq('client_id', req.query.client_id)
        .order('sent_at', { ascending: true })
        .limit(300);
    if (error) return sendDbError(res, error);
    res.json({ messages: data });
});

// Reply in Instagram Direct through the official Send API.
router.post('/', requirePermission('messages.send'), async (req, res) => {
    const orgId = req.user.organizationId;
    const text = cleanText(req.body?.text, 1000);
    if (!text) return res.status(400).json({ error: 'Пустое сообщение' });

    const [{ data: client, error: clientError }, { data: integration, error: integrationError }] = await Promise.all([
        supabase.from('crm_clients').select('id, instagram_user_id').eq('id', req.body?.client_id || '00000000-0000-0000-0000-000000000000').eq('organization_id', orgId).maybeSingle(),
        supabase.from('crm_integrations').select('status, config, secrets_encrypted').eq('organization_id', orgId).eq('provider', 'instagram').maybeSingle(),
    ]);
    if (clientError || integrationError) return sendDbError(res, clientError || integrationError);
    if (!client) return res.status(404).json({ error: 'Клиент не найден' });
    if (!client.instagram_user_id) return res.status(400).json({ error: 'Клиент ещё не писал в Instagram Direct — ответить можно только на его сообщение' });
    if (integration?.status !== 'connected' || !integration.secrets_encrypted) return res.status(400).json({ error: 'Instagram не подключён' });

    const { data: lastIn } = await supabase
        .from('crm_messages')
        .select('lead_id')
        .eq('client_id', client.id)
        .eq('direction', 'in')
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    let externalId = null;
    let status = 'sent';
    let errorText = null;
    try {
        externalId = await sendText(integration.config.ig_user_id, client.instagram_user_id, text, decryptSecret(integration.secrets_encrypted));
    } catch (err) {
        status = 'failed';
        errorText = isOutsideWindow(err)
            ? 'Прошло больше 24 часов с последнего сообщения клиента — Instagram не разрешает писать первым. Свяжитесь по телефону.'
            : `Instagram: ${err.message}`;
    }

    const { data: message, error } = await supabase
        .from('crm_messages')
        .insert({
            organization_id: orgId,
            client_id: client.id,
            lead_id: lastIn?.lead_id || null,
            channel: 'instagram',
            direction: 'out',
            // The echo webhook for this message carries the same id and is skipped.
            external_id: externalId,
            body: text,
            sent_by: req.user.id,
            status,
            error: errorText,
        })
        .select(MESSAGE_FIELDS)
        .single();
    if (error) {
        // Meta's echo of this very message was stored first: it's sent.
        if (error.code === '23505' && externalId) {
            const { data: echoed } = await supabase.from('crm_messages').select(MESSAGE_FIELDS).eq('channel', 'instagram').eq('external_id', externalId).single();
            await supabase.from('crm_messages').update({ sent_by: req.user.id }).eq('id', echoed.id);
            return res.status(201).json({ message: { ...echoed, sent_by: req.user.id } });
        }
        return sendDbError(res, error);
    }
    await crmAudit(req, 'crm.message.send', 'crm_client', client.id, null, { status });
    if (status === 'failed') return res.status(502).json({ error: errorText, message });
    res.status(201).json({ message });
});

export default router;
