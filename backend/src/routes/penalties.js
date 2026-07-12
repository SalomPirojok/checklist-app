import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

router.use(requireAuth, requireRole('owner', 'manager'));

// Registered before '/:id'-shaped routes would be, so "settings" can never be
// swallowed as an id -- there is no GET/PATCH '/:id' in this router, but kept
// consistent with the pattern used elsewhere in this codebase (training.js).
router.get('/settings', async (req, res) => {
    const { data, error } = await supabase
        .from('organizations')
        .select('late_threshold_minutes, late_penalty_amount, auto_penalty_enabled')
        .eq('id', req.user.organizationId)
        .single();
    if (error) return res.status(500).json({ error: 'Failed to load settings' });
    res.json({ settings: data });
});

router.patch('/settings', async (req, res) => {
    const { late_threshold_minutes, late_penalty_amount, auto_penalty_enabled } = req.body || {};
    const updates = {};

    if (late_threshold_minutes !== undefined) {
        if (!Number.isInteger(late_threshold_minutes) || late_threshold_minutes < 0) {
            return res.status(400).json({ error: 'late_threshold_minutes must be a non-negative integer' });
        }
        updates.late_threshold_minutes = late_threshold_minutes;
    }
    if (late_penalty_amount !== undefined) {
        const amount = Number(late_penalty_amount);
        if (!Number.isFinite(amount) || amount < 0) {
            return res.status(400).json({ error: 'late_penalty_amount must be a non-negative number' });
        }
        updates.late_penalty_amount = amount;
    }
    if (auto_penalty_enabled !== undefined) updates.auto_penalty_enabled = !!auto_penalty_enabled;

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
        .from('organizations')
        .update(updates)
        .eq('id', req.user.organizationId)
        .select('late_threshold_minutes, late_penalty_amount, auto_penalty_enabled')
        .single();
    if (error) return res.status(500).json({ error: 'Failed to update settings' });
    res.json({ settings: data });
});

router.get('/', async (req, res) => {
    const { data: penaltyRows, error } = await supabase
        .from('penalties')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Failed to list penalties' });

    const userIds = [...new Set(penaltyRows.flatMap((p) => [p.user_id, p.created_by]).filter(Boolean))];
    const { data: users, error: usersError } = userIds.length
        ? await supabase.from('users').select('id, full_name').in('id', userIds)
        : { data: [], error: null };
    if (usersError) return res.status(500).json({ error: 'Failed to load employee names' });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const penalties = penaltyRows.map((p) => ({
        ...p,
        user: userMap.get(p.user_id) || null,
        created_by_user: p.created_by ? userMap.get(p.created_by) || null : null,
    }));

    res.json({ penalties });
});

router.post('/', async (req, res) => {
    const { user_id, reason, amount } = req.body || {};
    if (!user_id || !reason || !reason.trim() || amount === undefined || amount === null) {
        return res.status(400).json({ error: 'user_id, reason and amount are required' });
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) {
        return res.status(400).json({ error: 'amount must be a number' });
    }

    const { data: target, error: targetError } = await supabase
        .from('users')
        .select('id')
        .eq('id', user_id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (targetError) return res.status(500).json({ error: 'Failed to look up employee' });
    if (!target) return res.status(404).json({ error: 'Employee not found in your organization' });

    const { data, error } = await supabase
        .from('penalties')
        .insert({
            user_id,
            organization_id: req.user.organizationId,
            reason: reason.trim(),
            amount: numericAmount,
            rule_type: 'manual',
            created_by: req.user.id,
        })
        .select()
        .single();
    if (error) return res.status(500).json({ error: 'Failed to create penalty' });
    res.status(201).json({ penalty: data });
});

export default router;
