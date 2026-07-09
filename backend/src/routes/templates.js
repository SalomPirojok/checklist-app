import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

router.use(requireAuth, requireRole('owner', 'manager'));

async function loadTemplateInOrg(templateId, organizationId) {
    const { data, error } = await supabase
        .from('checklist_templates')
        .select('*')
        .eq('id', templateId)
        .eq('organization_id', organizationId)
        .maybeSingle();
    if (error) throw new Error('lookup failed');
    return data;
}

function normalizeItems(items, templateId) {
    return items.map((item, index) => ({
        template_id: templateId,
        title: item.title,
        description: item.description || null,
        requires_photo: !!item.requires_photo,
        order_index: item.order_index ?? index,
    }));
}

router.get('/', async (req, res) => {
    const includeArchived = req.query.archived === 'true';

    let query = supabase
        .from('checklist_templates')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .order('created_at', { ascending: false });

    if (!includeArchived) query = query.eq('is_archived', false);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Failed to list templates' });
    res.json({ templates: data });
});

router.get('/:id', async (req, res) => {
    let template;
    try {
        template = await loadTemplateInOrg(req.params.id, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch template' });
    }
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const { data: items, error: itemsError } = await supabase
        .from('checklist_template_items')
        .select('*')
        .eq('template_id', template.id)
        .order('order_index', { ascending: true });

    if (itemsError) return res.status(500).json({ error: 'Failed to fetch template items' });
    res.json({ template, items });
});

router.post('/', async (req, res) => {
    const { title, description, items = [] } = req.body || {};

    if (!title) {
        return res.status(400).json({ error: 'title is required' });
    }
    if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'items must be an array' });
    }
    if (items.some((item) => !item.title)) {
        return res.status(400).json({ error: 'every item requires a title' });
    }

    const { data: template, error: templateError } = await supabase
        .from('checklist_templates')
        .insert({
            organization_id: req.user.organizationId,
            title,
            description: description || null,
            created_by: req.user.id,
        })
        .select()
        .single();

    if (templateError) return res.status(500).json({ error: 'Failed to create template' });

    if (items.length === 0) {
        return res.status(201).json({ template, items: [] });
    }

    const { data: insertedItems, error: itemsError } = await supabase
        .from('checklist_template_items')
        .insert(normalizeItems(items, template.id))
        .select();

    if (itemsError) {
        // compensate: don't leave an orphaned template with no items behind
        await supabase.from('checklist_templates').delete().eq('id', template.id);
        return res.status(500).json({ error: 'Failed to create template items' });
    }

    res.status(201).json({ template, items: insertedItems });
});

router.patch('/:id', async (req, res) => {
    let template;
    try {
        template = await loadTemplateInOrg(req.params.id, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch template' });
    }
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const { title, description, is_archived } = req.body || {};
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (is_archived !== undefined) updates.is_archived = is_archived;

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
        .from('checklist_templates')
        .update(updates)
        .eq('id', req.params.id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: 'Failed to update template' });
    res.json({ template: data });
});

// Templates are referenced by assignments once used, so "delete" archives rather than removes the row.
router.delete('/:id', async (req, res) => {
    let template;
    try {
        template = await loadTemplateInOrg(req.params.id, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch template' });
    }
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const { data, error } = await supabase
        .from('checklist_templates')
        .update({ is_archived: true })
        .eq('id', req.params.id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: 'Failed to archive template' });
    res.json({ template: data });
});

router.post('/:id/items', async (req, res) => {
    let template;
    try {
        template = await loadTemplateInOrg(req.params.id, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch template' });
    }
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const { title, description, requires_photo, order_index } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });

    let nextOrderIndex = order_index;
    if (nextOrderIndex === undefined) {
        const { data: maxItem } = await supabase
            .from('checklist_template_items')
            .select('order_index')
            .eq('template_id', template.id)
            .order('order_index', { ascending: false })
            .limit(1)
            .maybeSingle();
        nextOrderIndex = maxItem ? maxItem.order_index + 1 : 0;
    }

    const { data, error } = await supabase
        .from('checklist_template_items')
        .insert({
            template_id: template.id,
            title,
            description: description || null,
            requires_photo: !!requires_photo,
            order_index: nextOrderIndex,
        })
        .select()
        .single();

    if (error) return res.status(500).json({ error: 'Failed to create item' });
    res.status(201).json({ item: data });
});

// Replace the full item list for a template, e.g. after a frontend drag-and-drop reorder.
router.put('/:id/items', async (req, res) => {
    let template;
    try {
        template = await loadTemplateInOrg(req.params.id, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch template' });
    }
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const { items } = req.body || {};
    if (!Array.isArray(items) || items.some((item) => !item.title)) {
        return res.status(400).json({ error: 'items must be an array and every item requires a title' });
    }

    const { error: deleteError } = await supabase
        .from('checklist_template_items')
        .delete()
        .eq('template_id', template.id);
    if (deleteError) return res.status(500).json({ error: 'Failed to replace items' });

    if (items.length === 0) {
        return res.json({ items: [] });
    }

    const { data, error: insertError } = await supabase
        .from('checklist_template_items')
        .insert(normalizeItems(items, template.id))
        .select();

    if (insertError) return res.status(500).json({ error: 'Failed to replace items' });
    res.json({ items: data });
});

router.patch('/:id/items/:itemId', async (req, res) => {
    let template;
    try {
        template = await loadTemplateInOrg(req.params.id, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch template' });
    }
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const { title, description, requires_photo, order_index } = req.body || {};
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (requires_photo !== undefined) updates.requires_photo = !!requires_photo;
    if (order_index !== undefined) updates.order_index = order_index;

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
        .from('checklist_template_items')
        .update(updates)
        .eq('id', req.params.itemId)
        .eq('template_id', template.id)
        .select()
        .maybeSingle();

    if (error) return res.status(500).json({ error: 'Failed to update item' });
    if (!data) return res.status(404).json({ error: 'Item not found' });
    res.json({ item: data });
});

router.delete('/:id/items/:itemId', async (req, res) => {
    let template;
    try {
        template = await loadTemplateInOrg(req.params.id, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch template' });
    }
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const { data, error } = await supabase
        .from('checklist_template_items')
        .delete()
        .eq('id', req.params.itemId)
        .eq('template_id', template.id)
        .select()
        .maybeSingle();

    if (error) return res.status(500).json({ error: 'Failed to delete item' });
    if (!data) return res.status(404).json({ error: 'Item not found' });
    res.json({ deleted: true });
});

export default router;
