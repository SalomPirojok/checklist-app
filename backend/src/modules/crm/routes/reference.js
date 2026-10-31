import { Router } from 'express';
import { supabase } from '../../../lib/supabase.js';
import { sendDbError } from '../lib/dbErrors.js';

const router = Router();

// Everything the CRM screens need for dropdowns, in one round trip.
router.get('/', async (req, res) => {
    const orgId = req.user.organizationId;
    const [sources, campaigns, categories, users] = await Promise.all([
        supabase.from('crm_sources').select('id, key, name, is_paid').eq('organization_id', orgId).eq('is_archived', false).order('sort_order'),
        supabase.from('crm_campaigns').select('id, source_id, name').eq('organization_id', orgId).eq('is_archived', false).order('created_at', { ascending: false }),
        supabase.from('crm_service_categories').select('id, key, name').eq('organization_id', orgId).eq('is_archived', false).order('sort_order'),
        supabase.from('users').select('id, full_name, role, is_active').eq('organization_id', orgId).order('full_name'),
    ]);
    const failed = [sources, campaigns, categories, users].find((r) => r.error);
    if (failed) return sendDbError(res, failed.error, 'Не удалось загрузить справочники');

    res.json({
        sources: sources.data,
        campaigns: campaigns.data,
        categories: categories.data,
        // Inactive users stay in the list so old records still show a name.
        users: users.data,
    });
});

export default router;
