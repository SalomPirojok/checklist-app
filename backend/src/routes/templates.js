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

// null means "for everyone" (unchanged legacy behavior) -- only a non-null
// value needs to be verified as belonging to this organization.
async function validateDepartmentId(departmentId, organizationId) {
    if (departmentId === null || departmentId === undefined) return null;
    const { data, error } = await supabase
        .from('departments')
        .select('id')
        .eq('id', departmentId)
        .eq('organization_id', organizationId)
        .eq('is_archived', false)
        .maybeSingle();
    if (error) return 'Failed to look up department';
    if (!data) return 'department_id not found in your organization';
    return null;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const VALID_DAYS_OF_WEEK = new Set([0, 1, 2, 3, 4, 5, 6]);

function validateAutoAssignFields({ auto_assign_time, due_offset_minutes, auto_assign_days_of_week }) {
    if (auto_assign_time !== undefined && auto_assign_time !== null && !TIME_PATTERN.test(auto_assign_time)) {
        return 'auto_assign_time must be in HH:MM format';
    }
    // null means "no deadline" (the checklist never becomes overdue) -- only
    // reject values that are neither a positive integer nor explicitly null.
    if (due_offset_minutes !== undefined && due_offset_minutes !== null) {
        if (!Number.isInteger(due_offset_minutes) || due_offset_minutes <= 0) {
            return 'due_offset_minutes must be a positive integer or null for no deadline';
        }
    }
    // null/undefined/empty means "every day" -- only reject a non-empty array
    // that isn't made of valid 0-6 day-of-week integers.
    if (auto_assign_days_of_week !== undefined && auto_assign_days_of_week !== null) {
        if (
            !Array.isArray(auto_assign_days_of_week) ||
            auto_assign_days_of_week.length === 0 ||
            auto_assign_days_of_week.some((d) => !VALID_DAYS_OF_WEEK.has(d))
        ) {
            return 'auto_assign_days_of_week must be a non-empty array of integers 0-6, or null for every day';
        }
    }
    return null;
}

// Empty array is normalized to null so "no sub-checkboxes" has one
// representation and every existing item keeps behaving exactly as before.
function validateSubCheckboxes(subCheckboxes) {
    if (subCheckboxes === undefined || subCheckboxes === null) return null;
    if (!Array.isArray(subCheckboxes)) return 'sub_checkboxes must be an array';
    if (subCheckboxes.some((sc) => !sc || typeof sc.id !== 'string' || !sc.id || typeof sc.label !== 'string' || !sc.label.trim())) {
        return 'every sub_checkbox requires a non-empty id and label';
    }
    const ids = subCheckboxes.map((sc) => sc.id);
    if (new Set(ids).size !== ids.length) return 'sub_checkbox ids must be unique within an item';
    return null;
}

function normalizeSubCheckboxes(subCheckboxes) {
    return Array.isArray(subCheckboxes) && subCheckboxes.length > 0
        ? subCheckboxes.map((sc) => ({ id: sc.id, label: sc.label.trim() }))
        : null;
}

function normalizeItems(items, templateId) {
    return items.map((item, index) => ({
        template_id: templateId,
        title: item.title,
        description: item.description || null,
        requires_photo: !!item.requires_photo,
        category: item.category || null,
        order_index: item.order_index ?? index,
        sub_checkboxes: normalizeSubCheckboxes(item.sub_checkboxes),
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
    const {
        title,
        description,
        items = [],
        auto_assign_enabled,
        auto_assign_time,
        due_offset_minutes,
        auto_assign_days_of_week,
        department_id,
        is_standing,
    } = req.body || {};

    if (!title) {
        return res.status(400).json({ error: 'title is required' });
    }
    if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'items must be an array' });
    }
    if (items.some((item) => !item.title)) {
        return res.status(400).json({ error: 'every item requires a title' });
    }
    for (const item of items) {
        const subError = validateSubCheckboxes(item.sub_checkboxes);
        if (subError) return res.status(400).json({ error: subError });
    }
    const autoAssignError = validateAutoAssignFields({ auto_assign_time, due_offset_minutes, auto_assign_days_of_week });
    if (autoAssignError) return res.status(400).json({ error: autoAssignError });
    const departmentError = await validateDepartmentId(department_id, req.user.organizationId);
    if (departmentError) return res.status(400).json({ error: departmentError });

    const templateInsert = {
        organization_id: req.user.organizationId,
        title,
        description: description || null,
        created_by: req.user.id,
    };
    if (auto_assign_enabled !== undefined) templateInsert.auto_assign_enabled = !!auto_assign_enabled;
    if (auto_assign_time) templateInsert.auto_assign_time = auto_assign_time;
    if (due_offset_minutes !== undefined) templateInsert.due_offset_minutes = due_offset_minutes;
    if (auto_assign_days_of_week !== undefined) templateInsert.auto_assign_days_of_week = auto_assign_days_of_week;
    if (department_id !== undefined) templateInsert.department_id = department_id;
    if (is_standing !== undefined) templateInsert.is_standing = !!is_standing;

    const { data: template, error: templateError } = await supabase
        .from('checklist_templates')
        .insert(templateInsert)
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

    const {
        title,
        description,
        is_archived,
        auto_assign_enabled,
        auto_assign_time,
        due_offset_minutes,
        auto_assign_days_of_week,
        department_id,
        is_standing,
    } = req.body || {};
    const autoAssignError = validateAutoAssignFields({ auto_assign_time, due_offset_minutes, auto_assign_days_of_week });
    if (autoAssignError) return res.status(400).json({ error: autoAssignError });
    const departmentError = await validateDepartmentId(department_id, req.user.organizationId);
    if (departmentError) return res.status(400).json({ error: departmentError });

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (is_archived !== undefined) updates.is_archived = is_archived;
    if (auto_assign_enabled !== undefined) updates.auto_assign_enabled = !!auto_assign_enabled;
    if (auto_assign_time) updates.auto_assign_time = auto_assign_time;
    if (due_offset_minutes !== undefined) updates.due_offset_minutes = due_offset_minutes;
    if (auto_assign_days_of_week !== undefined) updates.auto_assign_days_of_week = auto_assign_days_of_week;
    if (is_standing !== undefined) updates.is_standing = !!is_standing;
    if (department_id !== undefined) updates.department_id = department_id;

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

    const { title, description, requires_photo, category, order_index, sub_checkboxes } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    const subError = validateSubCheckboxes(sub_checkboxes);
    if (subError) return res.status(400).json({ error: subError });

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
            category: category || null,
            order_index: nextOrderIndex,
            sub_checkboxes: normalizeSubCheckboxes(sub_checkboxes),
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
    for (const item of items) {
        const subError = validateSubCheckboxes(item.sub_checkboxes);
        if (subError) return res.status(400).json({ error: subError });
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

    const { title, description, requires_photo, category, order_index, sub_checkboxes } = req.body || {};
    const subError = validateSubCheckboxes(sub_checkboxes);
    if (subError) return res.status(400).json({ error: subError });

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (requires_photo !== undefined) updates.requires_photo = !!requires_photo;
    if (category !== undefined) updates.category = category || null;
    if (order_index !== undefined) updates.order_index = order_index;
    if (sub_checkboxes !== undefined) updates.sub_checkboxes = normalizeSubCheckboxes(sub_checkboxes);

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
