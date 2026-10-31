import { Router } from 'express';
import { supabase } from '../../../lib/supabase.js';
import { writeAuditLog } from '../../../lib/auditLog.js';
import { requirePermission } from '../middleware.js';
import { CLIENT_LIST_FIELDS, duplicateResponse, findDuplicateClient, parseClientInput } from '../lib/clients.js';
import { sendDbError } from '../lib/dbErrors.js';
import { cleanText, searchTerm } from '../lib/normalize.js';

const router = Router();

const PAGE_SIZE = 50;

async function audit(req, action, entityId, before, after) {
    try {
        await writeAuditLog(req.user, {
            organizationId: req.user.organizationId,
            action,
            entityType: 'crm_client',
            entityId,
            before,
            after,
        });
    } catch (err) {
        console.error('Audit log write failed:', err.message);
    }
}

router.get('/', requirePermission('clients.manage', 'leads.manage'), async (req, res) => {
    const q = searchTerm(req.query.q);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let query = supabase
        .from('crm_clients')
        .select(CLIENT_LIST_FIELDS, { count: 'exact' })
        .eq('organization_id', req.user.organizationId)
        .is('merged_into_id', null)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
    if (q) {
        const digits = q.replace(/\D/g, '');
        const conditions = [`first_name.ilike.%${q}%`, `last_name.ilike.%${q}%`, `instagram_username.ilike.%${q.replace(/^@/, '')}%`];
        if (digits.length >= 3) conditions.push(`phone.ilike.%${digits}%`);
        query = query.or(conditions.join(','));
    }
    const { data: clients, error, count } = await query;
    if (error) return sendDbError(res, error, 'Не удалось загрузить клиентов');

    // Latest lead per client, for the status shown in the list.
    const ids = clients.map((c) => c.id);
    const { data: leads, error: leadsError } = ids.length
        ? await supabase
              .from('crm_leads')
              .select('id, client_id, status, created_at')
              .in('client_id', ids)
              .order('created_at', { ascending: false })
        : { data: [], error: null };
    if (leadsError) return sendDbError(res, leadsError, 'Не удалось загрузить заявки');
    const latestLead = new Map();
    for (const lead of leads) if (!latestLead.has(lead.client_id)) latestLead.set(lead.client_id, lead);

    res.json({
        clients: clients.map((c) => ({ ...c, latest_lead: latestLead.get(c.id) || null })),
        total: count,
        page_size: PAGE_SIZE,
    });
});

// Duplicate pre-check while typing a new client/lead.
router.get('/lookup', requirePermission('clients.manage', 'leads.manage'), async (req, res) => {
    let input;
    try {
        input = parseClientInput(
            { phone: req.query.phone || undefined, instagram_username: req.query.instagram_username || undefined },
            { requireName: false }
        );
    } catch {
        return res.json({ client: null });
    }
    try {
        res.json({ client: await findDuplicateClient(req.user.organizationId, input) });
    } catch {
        res.status(500).json({ error: 'Не удалось проверить клиента' });
    }
});

router.get('/:id', requirePermission('clients.manage', 'leads.manage'), async (req, res) => {
    const orgId = req.user.organizationId;
    const { data: client, error } = await supabase
        .from('crm_clients')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', orgId)
        .maybeSingle();
    if (error) return sendDbError(res, error, 'Не удалось загрузить клиента');
    if (!client) return res.status(404).json({ error: 'Клиент не найден' });

    const [leads, comments, vehicles, orders] = await Promise.all([
        supabase
            .from('crm_leads')
            .select('id, number, status, channel, source_id, manager_id, booked_for, lost_reason, notes, created_at')
            .eq('client_id', client.id)
            .order('created_at', { ascending: false }),
        supabase
            .from('crm_client_comments')
            .select('id, body, author_id, created_at')
            .eq('client_id', client.id)
            .order('created_at', { ascending: false }),
        supabase
            .from('crm_vehicles')
            .select('id, make, model, year, plate, color')
            .eq('client_id', client.id)
            .eq('is_archived', false)
            .order('created_at'),
        supabase
            .from('crm_orders')
            .select('id, number, status, currency, total, paid_amount, created_at, issued_at')
            .eq('client_id', client.id)
            .order('created_at', { ascending: false }),
    ]);
    const failed = [leads, comments, vehicles, orders].find((r) => r.error);
    if (failed) return sendDbError(res, failed.error, 'Не удалось загрузить карточку клиента');

    res.json({
        client,
        leads: leads.data,
        comments: comments.data,
        vehicles: vehicles.data,
        orders: orders.data,
    });
});

router.post('/', requirePermission('clients.manage', 'leads.manage'), async (req, res) => {
    let input;
    try {
        input = parseClientInput(req.body || {}, { requireName: true });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    try {
        const duplicate = await findDuplicateClient(req.user.organizationId, input);
        if (duplicate) return duplicateResponse(res, duplicate);
    } catch {
        return res.status(500).json({ error: 'Не удалось проверить дубли' });
    }

    const { data, error } = await supabase
        .from('crm_clients')
        .insert({ ...input, organization_id: req.user.organizationId, created_by: req.user.id })
        .select()
        .single();
    if (error) return sendDbError(res, error, 'Не удалось создать клиента');
    await audit(req, 'crm.client.create', data.id, null, data);
    res.status(201).json({ client: data });
});

router.patch('/:id', requirePermission('clients.manage', 'leads.manage'), async (req, res) => {
    let input;
    try {
        input = parseClientInput(req.body || {}, { requireName: false });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    if (!Object.keys(input).length) return res.status(400).json({ error: 'Нет полей для изменения' });

    const { data: before, error: beforeError } = await supabase
        .from('crm_clients')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (beforeError) return sendDbError(res, beforeError);
    if (!before) return res.status(404).json({ error: 'Клиент не найден' });

    try {
        const duplicate = await findDuplicateClient(
            req.user.organizationId,
            { phone: input.phone, instagram_username: input.instagram_username },
            before.id
        );
        if (duplicate) return duplicateResponse(res, duplicate);
    } catch {
        return res.status(500).json({ error: 'Не удалось проверить дубли' });
    }

    const { data, error } = await supabase
        .from('crm_clients')
        .update(input)
        .eq('id', before.id)
        .eq('organization_id', req.user.organizationId)
        .select()
        .single();
    if (error) return sendDbError(res, error, 'Не удалось сохранить клиента');
    await audit(req, 'crm.client.update', data.id, before, data);
    res.json({ client: data });
});

router.post('/:id/comments', requirePermission('clients.manage', 'leads.manage'), async (req, res) => {
    const body = cleanText(req.body?.body, 5000);
    if (!body) return res.status(400).json({ error: 'Комментарий пустой' });

    const { data, error } = await supabase
        .from('crm_client_comments')
        .insert({ organization_id: req.user.organizationId, client_id: req.params.id, author_id: req.user.id, body })
        .select('id, body, author_id, created_at')
        .single();
    if (error) return sendDbError(res, error, 'Не удалось добавить комментарий');
    res.status(201).json({ comment: data });
});

export default router;
