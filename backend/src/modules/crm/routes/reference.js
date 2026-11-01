import { Router } from 'express';
import { supabase } from '../../../lib/supabase.js';
import { localDateString } from '../../../lib/time.js';
import { sendDbError } from '../lib/dbErrors.js';
import { getRate } from '../lib/fx.js';

const router = Router();

// Everything the CRM screens need for dropdowns, in one round trip.
router.get('/', async (req, res) => {
    const orgId = req.user.organizationId;
    const [sources, campaigns, categories, users, accounts, staff] = await Promise.all([
        supabase.from('crm_sources').select('id, key, name, is_paid').eq('organization_id', orgId).eq('is_archived', false).order('sort_order'),
        supabase.from('crm_campaigns').select('id, source_id, name').eq('organization_id', orgId).eq('is_archived', false).order('created_at', { ascending: false }),
        supabase.from('crm_service_categories').select('id, key, name').eq('organization_id', orgId).eq('is_archived', false).order('sort_order'),
        supabase.from('users').select('id, full_name, role, is_active').eq('organization_id', orgId).order('full_name'),
        supabase.from('crm_accounts').select('id, name, kind, currency, is_archived').eq('organization_id', orgId).order('created_at'),
        supabase.from('crm_staff').select('id, full_name, specialization, is_active').eq('organization_id', orgId).order('full_name'),
    ]);
    const failed = [sources, campaigns, categories, users, accounts, staff].find((r) => r.error);
    if (failed) return sendDbError(res, failed.error, 'Не удалось загрузить справочники');

    res.json({
        sources: sources.data,
        campaigns: campaigns.data,
        categories: categories.data,
        // Inactive users/staff stay in the lists so old records still show a name.
        users: users.data,
        accounts: accounts.data,
        staff: staff.data,
    });
});

// Today's Central Bank rate, to prefill currency fields.
router.get('/fx/:currency', async (req, res) => {
    const currency = String(req.params.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return res.status(400).json({ error: 'Неверная валюта' });
    try {
        const rate = await getRate(currency, localDateString(new Date(), 'Asia/Tashkent'));
        if (!rate) return res.status(404).json({ error: 'Курс недоступен' });
        res.json(rate);
    } catch {
        res.status(500).json({ error: 'Не удалось получить курс' });
    }
});

export default router;
