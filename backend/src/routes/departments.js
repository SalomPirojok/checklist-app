import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.use(requireAuth);

// Read is open to any authenticated role (employees need department names for
// display); only the owner manages the department list itself.
router.get('/', async (req, res) => {
    let query = supabase
        .from('departments')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .order('created_at', { ascending: true });

    if (req.query.archived !== 'true' || req.user.role !== 'owner') {
        query = query.eq('is_archived', false);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Failed to list departments' });
    res.json({ departments: data });
});

router.post('/', async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Only the owner can manage departments' });
    }

    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

    const { data, error } = await supabase
        .from('departments')
        .insert({ organization_id: req.user.organizationId, name: name.trim() })
        .select()
        .single();

    if (error) return res.status(500).json({ error: 'Failed to create department' });
    res.status(201).json({ department: data });
});

router.patch('/:id', async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Only the owner can manage departments' });
    }

    const { data: department, error: lookupError } = await supabase
        .from('departments')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (lookupError) return res.status(500).json({ error: 'Failed to fetch department' });
    if (!department) return res.status(404).json({ error: 'Department not found' });

    const { name, is_archived } = req.body || {};
    const updates = {};
    if (name !== undefined) {
        if (!name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
        updates.name = name.trim();
    }
    if (is_archived !== undefined) updates.is_archived = !!is_archived;

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
        .from('departments')
        .update(updates)
        .eq('id', req.params.id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: 'Failed to update department' });
    res.json({ department: data });
});

// Departments are referenced by users/templates/materials, so "delete" archives rather than removes the row.
router.delete('/:id', async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Only the owner can manage departments' });
    }

    const { data: department, error: lookupError } = await supabase
        .from('departments')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (lookupError) return res.status(500).json({ error: 'Failed to fetch department' });
    if (!department) return res.status(404).json({ error: 'Department not found' });

    const { data, error } = await supabase
        .from('departments')
        .update({ is_archived: true })
        .eq('id', req.params.id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: 'Failed to archive department' });
    res.json({ department: data });
});

export default router;
