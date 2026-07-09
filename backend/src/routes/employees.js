import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { canActOnRole } from '../lib/roles.js';

const router = Router();

router.use(requireAuth, requireRole('owner', 'manager'));

const ASSIGNABLE_ROLES = ['employee', 'manager'];

router.get('/', async (req, res) => {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: 'Failed to list employees' });
    res.json({ employees: data });
});

router.get('/:id', async (req, res) => {
    const { data: employee, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();

    if (error) return res.status(500).json({ error: 'Failed to fetch employee' });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    res.json({ employee });
});

router.post('/', async (req, res) => {
    const { telegram_id, full_name, username, role = 'employee' } = req.body || {};

    if (!telegram_id || !full_name) {
        return res.status(400).json({ error: 'telegram_id and full_name are required' });
    }
    if (!ASSIGNABLE_ROLES.includes(role)) {
        return res.status(400).json({ error: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` });
    }
    if (!canActOnRole(req.user.role, role)) {
        return res.status(403).json({ error: 'Not allowed to assign this role' });
    }

    const { data, error } = await supabase
        .from('users')
        .insert({
            telegram_id,
            full_name,
            username: username || null,
            role,
            organization_id: req.user.organizationId,
        })
        .select()
        .single();

    if (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'A user with this telegram_id already exists' });
        }
        return res.status(500).json({ error: 'Failed to create employee' });
    }

    res.status(201).json({ employee: data });
});

router.patch('/:id', async (req, res) => {
    const { data: target, error: lookupError } = await supabase
        .from('users')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();

    if (lookupError) return res.status(500).json({ error: 'Failed to fetch employee' });
    if (!target) return res.status(404).json({ error: 'Employee not found' });
    if (!canActOnRole(req.user.role, target.role)) {
        return res.status(403).json({ error: 'Not allowed to modify this user' });
    }

    const { full_name, username, role, is_active } = req.body || {};
    const updates = {};

    if (full_name !== undefined) updates.full_name = full_name;
    if (username !== undefined) updates.username = username;
    if (is_active !== undefined) updates.is_active = is_active;
    if (role !== undefined) {
        if (!ASSIGNABLE_ROLES.includes(role) || !canActOnRole(req.user.role, role)) {
            return res.status(403).json({ error: 'Not allowed to assign this role' });
        }
        updates.role = role;
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', req.params.id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: 'Failed to update employee' });
    res.json({ employee: data });
});

// Soft delete: users are referenced by templates/assignments, so we deactivate instead of removing the row.
router.delete('/:id', async (req, res) => {
    const { data: target, error: lookupError } = await supabase
        .from('users')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();

    if (lookupError) return res.status(500).json({ error: 'Failed to fetch employee' });
    if (!target) return res.status(404).json({ error: 'Employee not found' });
    if (!canActOnRole(req.user.role, target.role)) {
        return res.status(403).json({ error: 'Not allowed to deactivate this user' });
    }

    const { data, error } = await supabase
        .from('users')
        .update({ is_active: false })
        .eq('id', req.params.id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: 'Failed to deactivate employee' });
    res.json({ employee: data });
});

export default router;
