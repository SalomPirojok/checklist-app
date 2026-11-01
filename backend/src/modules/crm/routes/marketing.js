import { Router } from 'express';
import { supabase } from '../../../lib/supabase.js';
import { requirePermission } from '../middleware.js';
import { crmAudit } from '../lib/audit.js';
import { sendDbError } from '../lib/dbErrors.js';
import { marketingTable } from '../lib/marketing.js';
import { cleanText } from '../lib/normalize.js';
import { resolvePeriod } from '../lib/period.js';

const router = Router();

// Ad spend not tied to a campaign (group by campaign), or tied to no source.
export const UNALLOCATED = 'unallocated';

router.get('/report', requirePermission('marketing.view'), async (req, res) => {
    const orgId = req.user.organizationId;
    const groupBy = req.query.group === 'campaign' ? 'campaign' : 'source';
    let period;
    try {
        period = await resolvePeriod(req);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    const [leads, issued, expenses, campaigns, categories] = await Promise.all([
        supabase
            .from('crm_leads')
            .select('id, source_id, campaign_id, status, order_id')
            .eq('organization_id', orgId)
            .gte('created_at', period.from)
            .lt('created_at', period.to),
        supabase
            .from('crm_orders')
            .select('id, lead_id, client_id, revenue_base, materials_cost_base, labor_cost_base')
            .eq('organization_id', orgId)
            .eq('status', 'issued')
            .gte('issued_at', period.from)
            .lt('issued_at', period.to),
        supabase
            .from('crm_transactions')
            .select('direction, amount_base, category_id, campaign_id')
            .eq('organization_id', orgId)
            .eq('type', 'expense')
            .gte('occurred_at', period.from)
            .lt('occurred_at', period.to),
        supabase.from('crm_campaigns').select('id, source_id').eq('organization_id', orgId),
        supabase.from('crm_expense_categories').select('id, kind').eq('organization_id', orgId),
    ]);
    const failed = [leads, issued, expenses, campaigns, categories].find((r) => r.error);
    if (failed) return sendDbError(res, failed.error, 'Не удалось построить отчёт');

    const leadIds = leads.data.map((l) => l.id);
    // Orders may come from leads created before the period: load their leads
    // too, and the clients' first-touch source for orders without a lead.
    const orderLeadIds = [...new Set(issued.data.map((o) => o.lead_id).filter((id) => id && !leadIds.includes(id)))];
    const orderClientIds = [...new Set(issued.data.filter((o) => !o.lead_id).map((o) => o.client_id))];
    const [events, extraLeads, clients] = await Promise.all([
        leadIds.length
            ? supabase.from('crm_lead_events').select('lead_id, to_status').in('lead_id', leadIds)
            : { data: [], error: null },
        orderLeadIds.length
            ? supabase.from('crm_leads').select('id, source_id, campaign_id').in('id', orderLeadIds)
            : { data: [], error: null },
        orderClientIds.length
            ? supabase.from('crm_clients').select('id, source_id, campaign_id').in('id', orderClientIds)
            : { data: [], error: null },
    ]);
    const failedMore = [events, extraLeads, clients].find((r) => r.error);
    if (failedMore) return sendDbError(res, failedMore.error, 'Не удалось построить отчёт');

    const leadMap = new Map([...leads.data, ...extraLeads.data].map((l) => [l.id, l]));
    const clientMap = new Map(clients.data.map((c) => [c.id, c]));
    const campaignSource = new Map(campaigns.data.map((c) => [c.id, c.source_id]));
    const field = groupBy === 'campaign' ? 'campaign_id' : 'source_id';

    const orders = issued.data.map((o) => {
        const origin = o.lead_id ? leadMap.get(o.lead_id) : clientMap.get(o.client_id);
        return { ...o, key: origin?.[field] ?? null };
    });

    const kindOf = new Map(categories.data.map((c) => [c.id, c.kind]));
    const spend = expenses.data
        .filter((e) => kindOf.get(e.category_id) === 'marketing')
        .map((e) => {
            const key = groupBy === 'campaign' ? e.campaign_id : campaignSource.get(e.campaign_id);
            return { key: key || UNALLOCATED, amount: -e.direction * Number(e.amount_base) };
        });

    const rows = marketingTable({
        leads: leads.data,
        events: events.data,
        issuedOrders: orders,
        spend,
        keyOfLead: (l) => l[field] ?? null,
        keyOfOrder: (o) => o.key,
    });

    const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
    res.json({
        period: { from: period.startDate, to: period.endDate },
        group: groupBy,
        rows,
        totals: {
            leads: sum('leads'),
            booked: sum('booked'),
            arrived: sum('arrived'),
            orders: sum('orders'),
            issued_orders: sum('issued_orders'),
            revenue: Math.round(sum('revenue') * 100) / 100,
            gross_profit: Math.round(sum('gross_profit') * 100) / 100,
            spend: Math.round(sum('spend') * 100) / 100,
        },
    });
});

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

function parseCampaign(body, { partial }) {
    const out = {};
    if (body.name !== undefined || !partial) {
        out.name = cleanText(body.name, 120);
        if (!out.name) throw new Error('Укажите название кампании');
    }
    if (body.source_id !== undefined || !partial) {
        if (!body.source_id) throw new Error('Выберите источник');
        out.source_id = body.source_id;
    }
    if (body.external_campaign_id !== undefined) out.external_campaign_id = cleanText(body.external_campaign_id, 64);
    if (body.started_on !== undefined) out.started_on = body.started_on || null;
    if (body.ended_on !== undefined) out.ended_on = body.ended_on || null;
    if (body.is_archived !== undefined) out.is_archived = !!body.is_archived;
    return out;
}

router.get('/campaigns', requirePermission('marketing.view', 'leads.manage', 'finance.manage'), async (req, res) => {
    const { data, error } = await supabase
        .from('crm_campaigns')
        .select('id, source_id, name, external_campaign_id, started_on, ended_on, is_archived, created_at')
        .eq('organization_id', req.user.organizationId)
        .order('created_at', { ascending: false });
    if (error) return sendDbError(res, error);
    res.json({ campaigns: data });
});

router.post('/campaigns', requirePermission('settings.manage', 'finance.manage'), async (req, res) => {
    let campaign;
    try {
        campaign = parseCampaign(req.body || {}, { partial: false });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const { data, error } = await supabase
        .from('crm_campaigns')
        .insert({ ...campaign, organization_id: req.user.organizationId })
        .select()
        .single();
    if (error) return sendDbError(res, error, 'Не удалось создать кампанию');
    await crmAudit(req, 'crm.campaign.create', 'crm_campaign', data.id, null, data);
    res.status(201).json({ campaign: data });
});

router.patch('/campaigns/:id', requirePermission('settings.manage', 'finance.manage'), async (req, res) => {
    let updates;
    try {
        updates = parseCampaign(req.body || {}, { partial: true });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Нет полей для изменения' });
    const { data, error } = await supabase
        .from('crm_campaigns')
        .update(updates)
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .select()
        .maybeSingle();
    if (error) return sendDbError(res, error, 'Не удалось сохранить кампанию');
    if (!data) return res.status(404).json({ error: 'Кампания не найдена' });
    await crmAudit(req, 'crm.campaign.update', 'crm_campaign', data.id, null, updates);
    res.json({ campaign: data });
});

export default router;
