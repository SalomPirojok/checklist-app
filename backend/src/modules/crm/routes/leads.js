import { Router } from 'express';
import { supabase } from '../../../lib/supabase.js';
import { writeAuditLog } from '../../../lib/auditLog.js';
import { requirePermission } from '../middleware.js';
import { CLIENT_LIST_FIELDS, duplicateResponse, findDuplicateClient, parseClientInput } from '../lib/clients.js';
import { sendDbError } from '../lib/dbErrors.js';
import { cleanText, searchTerm } from '../lib/normalize.js';

const router = Router();

router.use(requirePermission('leads.manage'));

const PAGE_SIZE = 50;

export const LEAD_STATUSES = ['new', 'in_progress', 'waiting_reply', 'booked', 'arrived', 'order_created', 'completed', 'lost'];
// Set by the order flow (creating / issuing an order), not by hand.
const SYSTEM_STATUSES = ['order_created', 'completed'];
const CHANNELS = ['instagram', 'telegram', 'phone', 'walk_in', 'website', 'other'];
const CLOSED_STATUSES = ['completed', 'lost'];

const LEAD_FIELDS = 'id, number, client_id, source_id, campaign_id, channel, status, lost_reason, manager_id, booked_for, arrived_at, closed_at, order_id, notes, created_at, updated_at';

async function audit(req, action, entityType, entityId, before, after) {
    try {
        await writeAuditLog(req.user, {
            organizationId: req.user.organizationId,
            action,
            entityType,
            entityId,
            before,
            after,
        });
    } catch (err) {
        console.error('Audit log write failed:', err.message);
    }
}

function parseIsoDate(value) {
    if (value === null || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('Неверная дата');
    return date.toISOString();
}

function clientSearchConditions(q) {
    const digits = q.replace(/\D/g, '');
    const conditions = [`first_name.ilike.%${q}%`, `last_name.ilike.%${q}%`, `instagram_username.ilike.%${q.replace(/^@/, '')}%`];
    if (digits.length >= 3) conditions.push(`phone.ilike.%${digits}%`);
    return conditions.join(',');
}

router.get('/', async (req, res) => {
    const orgId = req.user.organizationId;
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const statuses = String(req.query.status || '')
        .split(',')
        .filter((s) => LEAD_STATUSES.includes(s));

    let query = supabase
        .from('crm_leads')
        .select(LEAD_FIELDS, { count: 'exact' })
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
    if (statuses.length) query = query.in('status', statuses);
    if (req.query.source_id) query = query.eq('source_id', req.query.source_id);
    if (req.query.manager_id) query = query.eq('manager_id', req.query.manager_id);

    const q = searchTerm(req.query.q);
    if (q) {
        const { data: matches, error: matchError } = await supabase
            .from('crm_clients')
            .select('id')
            .eq('organization_id', orgId)
            .or(clientSearchConditions(q))
            .limit(500);
        if (matchError) return sendDbError(res, matchError, 'Не удалось выполнить поиск');
        if (!matches.length) return res.json({ leads: [], total: 0, page_size: PAGE_SIZE });
        query = query.in('client_id', matches.map((m) => m.id));
    }

    const { data: leads, error, count } = await query;
    if (error) return sendDbError(res, error, 'Не удалось загрузить заявки');

    const clientIds = [...new Set(leads.map((l) => l.client_id))];
    const { data: clients, error: clientsError } = clientIds.length
        ? await supabase.from('crm_clients').select(CLIENT_LIST_FIELDS).in('id', clientIds)
        : { data: [], error: null };
    if (clientsError) return sendDbError(res, clientsError, 'Не удалось загрузить клиентов');
    const clientMap = new Map(clients.map((c) => [c.id, c]));

    res.json({
        leads: leads.map((l) => ({ ...l, client: clientMap.get(l.client_id) || null })),
        total: count,
        page_size: PAGE_SIZE,
    });
});

// Counts of open leads per status, for the filter chips.
router.get('/summary', async (req, res) => {
    const { data, error } = await supabase
        .from('crm_leads')
        .select('status')
        .eq('organization_id', req.user.organizationId)
        .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`);
    if (error) return sendDbError(res, error, 'Не удалось загрузить сводку');
    const counts = {};
    for (const { status } of data) counts[status] = (counts[status] || 0) + 1;
    res.json({ counts });
});

router.get('/:id', async (req, res) => {
    const { data: lead, error } = await supabase
        .from('crm_leads')
        .select(LEAD_FIELDS)
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (error) return sendDbError(res, error, 'Не удалось загрузить заявку');
    if (!lead) return res.status(404).json({ error: 'Заявка не найдена' });

    const [client, events, order] = await Promise.all([
        supabase.from('crm_clients').select(CLIENT_LIST_FIELDS).eq('id', lead.client_id).single(),
        supabase
            .from('crm_lead_events')
            .select('id, from_status, to_status, user_id, created_at')
            .eq('lead_id', lead.id)
            .order('created_at'),
        lead.order_id
            ? supabase.from('crm_orders').select('id, number, status').eq('id', lead.order_id).single()
            : { data: null, error: null },
    ]);
    const failed = [client, events, order].find((r) => r.error);
    if (failed) return sendDbError(res, failed.error, 'Не удалось загрузить заявку');
    res.json({ lead: { ...lead, client: client.data, order: order.data }, events: events.data });
});

// Body: either client_id (existing client) or client: {...} (new client),
// plus lead fields. A new client matching an existing phone/Instagram gets a
// 409 with that client, so the UI can offer to attach the lead to it.
router.post('/', async (req, res) => {
    const body = req.body || {};
    const orgId = req.user.organizationId;

    const lead = { organization_id: orgId, created_by: req.user.id, updated_by: req.user.id };
    try {
        lead.channel = body.channel || 'other';
        if (!CHANNELS.includes(lead.channel)) throw new Error('Неверный канал обращения');
        lead.source_id = body.source_id || null;
        lead.campaign_id = body.campaign_id || null;
        lead.manager_id = body.manager_id || req.user.id;
        lead.notes = cleanText(body.notes, 5000);
        if (body.booked_for) {
            lead.booked_for = parseIsoDate(body.booked_for);
            lead.status = 'booked';
        }
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    let clientId = body.client_id || null;
    let createdClient = null;
    if (clientId) {
        const { data: existing, error } = await supabase
            .from('crm_clients')
            .select('id, source_id')
            .eq('id', clientId)
            .eq('organization_id', orgId)
            .maybeSingle();
        if (error) return sendDbError(res, error);
        if (!existing) return res.status(404).json({ error: 'Клиент не найден' });

        // A returning client with no explicit source counts as a repeat client.
        if (!lead.source_id) {
            const [{ count, error: countError }, { data: repeat, error: repeatError }] = await Promise.all([
                supabase.from('crm_leads').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
                supabase.from('crm_sources').select('id').eq('organization_id', orgId).eq('key', 'repeat').maybeSingle(),
            ]);
            if (countError || repeatError || count === null) return sendDbError(res, countError || repeatError);
            lead.source_id = count > 0 && repeat ? repeat.id : existing.source_id;
        }
    } else {
        let input;
        try {
            input = parseClientInput(body.client || {}, { requireName: true });
        } catch (err) {
            return res.status(400).json({ error: err.message });
        }
        try {
            const duplicate = await findDuplicateClient(orgId, input);
            if (duplicate) return duplicateResponse(res, duplicate);
        } catch {
            return res.status(500).json({ error: 'Не удалось проверить дубли' });
        }
        const { data, error } = await supabase
            .from('crm_clients')
            .insert({
                ...input,
                source_id: input.source_id ?? lead.source_id,
                campaign_id: input.campaign_id ?? lead.campaign_id,
                manager_id: input.manager_id ?? lead.manager_id,
                organization_id: orgId,
                created_by: req.user.id,
            })
            .select()
            .single();
        if (error) return sendDbError(res, error, 'Не удалось создать клиента');
        createdClient = data;
        clientId = data.id;
    }

    const { data: created, error } = await supabase
        .from('crm_leads')
        .insert({ ...lead, client_id: clientId })
        .select(LEAD_FIELDS)
        .single();
    if (error) {
        // Don't leave a client card behind for a lead that failed to save.
        if (createdClient) await supabase.from('crm_clients').delete().eq('id', createdClient.id);
        return sendDbError(res, error, 'Не удалось создать заявку');
    }
    if (createdClient) await audit(req, 'crm.client.create', 'crm_client', createdClient.id, null, createdClient);
    await audit(req, 'crm.lead.create', 'crm_lead', created.id, null, created);
    res.status(201).json({ lead: created, client: createdClient });
});

router.patch('/:id', async (req, res) => {
    const body = req.body || {};
    const updates = {};
    try {
        if (body.status !== undefined) {
            if (!LEAD_STATUSES.includes(body.status)) throw new Error('Неверный статус');
            if (SYSTEM_STATUSES.includes(body.status)) {
                throw new Error('Этот статус ставится автоматически при оформлении и выдаче заказа');
            }
            updates.status = body.status;
        }
        if (body.channel !== undefined) {
            if (!CHANNELS.includes(body.channel)) throw new Error('Неверный канал обращения');
            updates.channel = body.channel;
        }
        if (body.source_id !== undefined) updates.source_id = body.source_id || null;
        if (body.campaign_id !== undefined) updates.campaign_id = body.campaign_id || null;
        if (body.manager_id !== undefined) updates.manager_id = body.manager_id || null;
        if (body.notes !== undefined) updates.notes = cleanText(body.notes, 5000);
        if (body.lost_reason !== undefined) updates.lost_reason = cleanText(body.lost_reason, 500);
        if (body.booked_for !== undefined) updates.booked_for = parseIsoDate(body.booked_for);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Нет полей для изменения' });

    const { data: before, error: beforeError } = await supabase
        .from('crm_leads')
        .select(LEAD_FIELDS)
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (beforeError) return sendDbError(res, beforeError);
    if (!before) return res.status(404).json({ error: 'Заявка не найдена' });
    if (SYSTEM_STATUSES.includes(before.status) && updates.status) {
        return res.status(400).json({ error: 'Статус заявки с заказом меняется через заказ' });
    }

    if (updates.status === 'arrived' && !before.arrived_at) updates.arrived_at = new Date().toISOString();
    if (updates.status === 'lost') updates.closed_at = new Date().toISOString();
    if (updates.status && updates.status !== 'lost' && before.status === 'lost') {
        updates.closed_at = null;
        updates.lost_reason = null;
    }

    const { data, error } = await supabase
        .from('crm_leads')
        .update({ ...updates, updated_by: req.user.id })
        .eq('id', before.id)
        .eq('organization_id', req.user.organizationId)
        .select(LEAD_FIELDS)
        .single();
    if (error) return sendDbError(res, error, 'Не удалось сохранить заявку');
    await audit(req, 'crm.lead.update', 'crm_lead', data.id, before, data);
    res.json({ lead: data });
});

export default router;
