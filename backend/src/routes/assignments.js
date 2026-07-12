import { Router } from 'express';
import multer from 'multer';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
    uploadAssignmentItemPhoto,
    verifyPhotoBelongsToItem,
    uploadSignaturePhoto,
    verifySignatureBelongsToAssignment,
} from '../lib/storage.js';
import { buildInitialSubCheckboxResults, allSubCheckboxesChecked } from '../lib/subCheckboxes.js';

const router = Router();

router.use(requireAuth);

const MIME_EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
};

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!MIME_EXTENSIONS[file.mimetype]) {
            return cb(new Error('Unsupported image type'));
        }
        cb(null, true);
    },
});

async function getOrgUserIds(organizationId) {
    const { data, error } = await supabase.from('users').select('id').eq('organization_id', organizationId);
    if (error) throw new Error('failed to load org users');
    return data.map((u) => u.id);
}

// Assignments don't carry organization_id directly, so scoping goes through assigned_to's organization.
async function loadAssignmentInOrg(assignmentId, organizationId) {
    const { data: assignment, error } = await supabase
        .from('checklist_assignments')
        .select('*')
        .eq('id', assignmentId)
        .maybeSingle();
    if (error) throw new Error('lookup failed');
    if (!assignment) return null;

    const { data: assignee, error: userError } = await supabase
        .from('users')
        .select('id, organization_id')
        .eq('id', assignment.assigned_to)
        .maybeSingle();
    if (userError || !assignee || assignee.organization_id !== organizationId) return null;

    return assignment;
}

// The assignment row only carries template_id/assigned_to; callers (owner list,
// employee's own list, detail view) all need the human-readable title/name too.
async function enrichAssignments(assignmentRows) {
    if (assignmentRows.length === 0) return assignmentRows;

    const templateIds = [...new Set(assignmentRows.map((a) => a.template_id))];
    const assignedToIds = [...new Set(assignmentRows.map((a) => a.assigned_to))];

    const [{ data: templates }, { data: assignees }] = await Promise.all([
        supabase.from('checklist_templates').select('id, title, description').in('id', templateIds),
        supabase.from('users').select('id, full_name').in('id', assignedToIds),
    ]);

    const templateMap = new Map((templates || []).map((t) => [t.id, t]));
    const assigneeMap = new Map((assignees || []).map((u) => [u.id, u]));

    return assignmentRows.map((a) => ({
        ...a,
        template: templateMap.get(a.template_id) || null,
        assignee: assigneeMap.get(a.assigned_to) || null,
    }));
}

// Lazily flips not_started/in_progress assignments past their deadline to 'overdue'.
// Actual Telegram notifications on overdue are handled separately.
async function syncOverdueStatuses(assignmentRows) {
    const now = new Date();
    const overdueIds = assignmentRows
        .filter((a) => !a.is_standing && (a.status === 'not_started' || a.status === 'in_progress') && a.due_at && new Date(a.due_at) < now)
        .map((a) => a.id);

    if (overdueIds.length === 0) return assignmentRows;

    const { data: updated, error } = await supabase
        .from('checklist_assignments')
        .update({ status: 'overdue' })
        .in('id', overdueIds)
        .select();

    if (error) return assignmentRows; // best-effort; don't fail the read just because the sync failed

    const updatedMap = new Map(updated.map((u) => [u.id, u]));
    return assignmentRows.map((a) => updatedMap.get(a.id) || a);
}

// An assignment only becomes 'completed' once every item is done AND the
// employee's signature is on file — the signature is the last required step.
function computeStatusUpdate(assignment, allItemsDone, hasSignature) {
    const now = new Date();
    const updates = {};

    if (allItemsDone && hasSignature) {
        updates.status = 'completed';
        updates.completed_at = now.toISOString();
    } else if (!assignment.is_standing && assignment.due_at && new Date(assignment.due_at) < now) {
        updates.status = 'overdue';
        if (!assignment.started_at) updates.started_at = now.toISOString();
    } else {
        updates.status = 'in_progress';
        if (!assignment.started_at) updates.started_at = now.toISOString();
    }
    // Reverting after a prior completion (e.g. un-checking an item) should clear the stale completed_at.
    if (updates.status !== 'completed' && assignment.completed_at) {
        updates.completed_at = null;
    }
    return updates;
}

router.get('/', async (req, res) => {
    const { status, assigned_to } = req.query;

    let query = supabase.from('checklist_assignments').select('*').order('due_at', { ascending: true });

    if (req.user.role === 'employee') {
        query = query.eq('assigned_to', req.user.id);
    } else {
        let orgUserIds;
        try {
            orgUserIds = await getOrgUserIds(req.user.organizationId);
        } catch {
            return res.status(500).json({ error: 'Failed to list assignments' });
        }
        query = query.in('assigned_to', orgUserIds);
        if (assigned_to) query = query.eq('assigned_to', assigned_to);
    }

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Failed to list assignments' });

    const synced = await syncOverdueStatuses(data);
    const enriched = await enrichAssignments(synced);
    res.json({ assignments: enriched });
});

router.post('/', async (req, res) => {
    if (req.user.role !== 'owner' && req.user.role !== 'manager') {
        return res.status(403).json({ error: 'Only owner or manager can assign checklists' });
    }

    const { template_id, assigned_to, due_at, is_standing } = req.body || {};
    const standing = !!is_standing;
    if (!template_id || !assigned_to || (!standing && !due_at)) {
        return res.status(400).json({ error: 'template_id, assigned_to are required (due_at is also required unless is_standing is true)' });
    }
    if (!standing && Number.isNaN(new Date(due_at).getTime())) {
        return res.status(400).json({ error: 'due_at must be a valid date' });
    }

    const { data: template, error: templateError } = await supabase
        .from('checklist_templates')
        .select('*')
        .eq('id', template_id)
        .eq('organization_id', req.user.organizationId)
        .eq('is_archived', false)
        .maybeSingle();
    if (templateError) return res.status(500).json({ error: 'Failed to look up template' });
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const { data: assignee, error: assigneeError } = await supabase
        .from('users')
        .select('*')
        .eq('id', assigned_to)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (assigneeError) return res.status(500).json({ error: 'Failed to look up assignee' });
    if (!assignee || !assignee.is_active || assignee.role === 'owner') {
        return res.status(400).json({ error: 'assigned_to must be an active employee or manager in your organization' });
    }

    const { data: templateItems, error: itemsError } = await supabase
        .from('checklist_template_items')
        .select('id, sub_checkboxes')
        .eq('template_id', template_id)
        .eq('is_removed', false);
    if (itemsError) return res.status(500).json({ error: 'Failed to load template items' });
    if (templateItems.length === 0) {
        return res.status(400).json({ error: 'Template has no items to assign' });
    }

    const { data: assignment, error: assignmentError } = await supabase
        .from('checklist_assignments')
        .insert({
            template_id,
            assigned_to,
            assigned_by: req.user.id,
            due_at: standing ? null : due_at,
            is_standing: standing,
            status: 'not_started',
        })
        .select()
        .single();
    if (assignmentError) return res.status(500).json({ error: 'Failed to create assignment' });

    const { data: assignmentItems, error: assignmentItemsError } = await supabase
        .from('checklist_assignment_items')
        .insert(
            templateItems.map((item) => ({
                assignment_id: assignment.id,
                template_item_id: item.id,
                sub_checkbox_results: buildInitialSubCheckboxResults(item.sub_checkboxes),
            }))
        )
        .select();

    if (assignmentItemsError) {
        await supabase.from('checklist_assignments').delete().eq('id', assignment.id);
        return res.status(500).json({ error: 'Failed to create assignment items' });
    }

    res.status(201).json({ assignment, items: assignmentItems });
});

router.get('/:id', async (req, res) => {
    let assignment;
    try {
        assignment = await loadAssignmentInOrg(req.params.id, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch assignment' });
    }
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    if (req.user.role === 'employee' && assignment.assigned_to !== req.user.id) {
        return res.status(403).json({ error: 'Not allowed to view this assignment' });
    }

    const synced = await syncOverdueStatuses([assignment]);
    const [enriched] = await enrichAssignments(synced);

    const { data: items, error: itemsError } = await supabase
        .from('checklist_assignment_items')
        .select('*, template_item:checklist_template_items(title, description, requires_photo, category, order_index, sub_checkboxes)')
        .eq('assignment_id', assignment.id);
    if (itemsError) return res.status(500).json({ error: 'Failed to fetch assignment items' });

    items.sort((a, b) => (a.template_item?.order_index ?? 0) - (b.template_item?.order_index ?? 0));

    res.json({ assignment: enriched, items });
});

router.patch('/:id', async (req, res) => {
    if (req.user.role !== 'owner' && req.user.role !== 'manager') {
        return res.status(403).json({ error: 'Only owner or manager can reschedule assignments' });
    }

    let assignment;
    try {
        assignment = await loadAssignmentInOrg(req.params.id, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch assignment' });
    }
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const { due_at } = req.body || {};
    if (!due_at || Number.isNaN(new Date(due_at).getTime())) {
        return res.status(400).json({ error: 'due_at must be a valid date' });
    }

    const updates = { due_at };
    // Rescheduling forward can pull an assignment out of overdue.
    if (assignment.status === 'overdue' && new Date(due_at) > new Date()) {
        updates.status = assignment.started_at ? 'in_progress' : 'not_started';
    }

    const { data, error } = await supabase
        .from('checklist_assignments')
        .update(updates)
        .eq('id', req.params.id)
        .select()
        .single();
    if (error) return res.status(500).json({ error: 'Failed to update assignment' });

    res.json({ assignment: data });
});

router.post('/:id/signature', upload.single('signature'), async (req, res) => {
    let assignment;
    try {
        assignment = await loadAssignmentInOrg(req.params.id, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch assignment' });
    }
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const isOwnerOrManager = req.user.role === 'owner' || req.user.role === 'manager';
    if (!isOwnerOrManager && assignment.assigned_to !== req.user.id) {
        return res.status(403).json({ error: 'Not allowed to update this assignment' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'signature file is required' });
    }

    let signatureUrl;
    try {
        signatureUrl = await uploadSignaturePhoto({
            assignmentId: assignment.id,
            buffer: req.file.buffer,
            contentType: req.file.mimetype,
            extension: MIME_EXTENSIONS[req.file.mimetype],
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }

    const verified = await verifySignatureBelongsToAssignment(signatureUrl, assignment.id);
    if (!verified) {
        return res.status(500).json({ error: 'Failed to verify uploaded signature' });
    }

    const { data: allItems, error: allItemsError } = await supabase
        .from('checklist_assignment_items')
        .select('is_done')
        .eq('assignment_id', assignment.id);
    if (allItemsError) return res.status(500).json({ error: 'Failed to recompute assignment status' });

    const allDone = allItems.length > 0 && allItems.every((i) => i.is_done);
    const statusUpdates = computeStatusUpdate(assignment, allDone, true);

    const { data: updatedAssignment, error: updateError } = await supabase
        .from('checklist_assignments')
        .update({ signature_url: signatureUrl, ...statusUpdates })
        .eq('id', assignment.id)
        .select()
        .single();
    if (updateError) return res.status(500).json({ error: 'Failed to save signature' });

    const [enrichedAssignment] = await enrichAssignments([updatedAssignment]);
    res.json({ assignment: enrichedAssignment });
});

router.post('/:id/items/:itemId/photo', upload.single('photo'), async (req, res) => {
    let assignment;
    try {
        assignment = await loadAssignmentInOrg(req.params.id, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch assignment' });
    }
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const isOwnerOrManager = req.user.role === 'owner' || req.user.role === 'manager';
    if (!isOwnerOrManager && assignment.assigned_to !== req.user.id) {
        return res.status(403).json({ error: 'Not allowed to update this assignment' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'photo file is required' });
    }

    const { data: item, error: itemError } = await supabase
        .from('checklist_assignment_items')
        .select('id')
        .eq('id', req.params.itemId)
        .eq('assignment_id', assignment.id)
        .maybeSingle();
    if (itemError) return res.status(500).json({ error: 'Failed to fetch item' });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    try {
        const photoUrl = await uploadAssignmentItemPhoto({
            assignmentId: assignment.id,
            itemId: item.id,
            buffer: req.file.buffer,
            contentType: req.file.mimetype,
            extension: MIME_EXTENSIONS[req.file.mimetype],
        });
        res.status(201).json({ photo_url: photoUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.patch('/:id/items/:itemId', async (req, res) => {
    let assignment;
    try {
        assignment = await loadAssignmentInOrg(req.params.id, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch assignment' });
    }
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const isOwnerOrManager = req.user.role === 'owner' || req.user.role === 'manager';
    if (!isOwnerOrManager && assignment.assigned_to !== req.user.id) {
        return res.status(403).json({ error: 'Not allowed to update this assignment' });
    }

    const { data: item, error: itemError } = await supabase
        .from('checklist_assignment_items')
        .select('*, template_item:checklist_template_items(requires_photo)')
        .eq('id', req.params.itemId)
        .eq('assignment_id', assignment.id)
        .maybeSingle();
    if (itemError) return res.status(500).json({ error: 'Failed to fetch item' });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const { is_done, photo_url, comment, sub_checkbox_results } = req.body || {};
    const updates = {};
    if (comment !== undefined) updates.comment = comment;
    if (photo_url !== undefined) updates.photo_url = photo_url;

    if (sub_checkbox_results !== undefined) {
        if (!Array.isArray(item.sub_checkbox_results)) {
            return res.status(400).json({ error: 'This item has no sub-checkboxes' });
        }
        const existingIds = new Set(item.sub_checkbox_results.map((r) => r.id));
        const validShape =
            Array.isArray(sub_checkbox_results) &&
            sub_checkbox_results.length === existingIds.size &&
            sub_checkbox_results.every((r) => r && typeof r.checked === 'boolean' && existingIds.has(r.id));
        if (!validShape) {
            return res.status(400).json({ error: 'sub_checkbox_results must match this item\'s existing sub-checkbox ids' });
        }
        updates.sub_checkbox_results = sub_checkbox_results;
    }

    if (is_done !== undefined) {
        const willBeDone = !!is_done;
        const finalPhotoUrl = photo_url !== undefined ? photo_url : item.photo_url;
        const finalSubResults = sub_checkbox_results !== undefined ? sub_checkbox_results : item.sub_checkbox_results;
        if (willBeDone && !allSubCheckboxesChecked(finalSubResults)) {
            return res.status(400).json({ error: 'All sub-items must be checked before this item can be marked done' });
        }
        if (willBeDone && item.template_item.requires_photo) {
            if (!finalPhotoUrl) {
                return res.status(400).json({ error: 'This item requires a photo before it can be marked done' });
            }
            const verified = await verifyPhotoBelongsToItem(finalPhotoUrl, assignment.id, item.id);
            if (!verified) {
                return res.status(400).json({ error: 'Photo could not be verified — please upload it again' });
            }
        }
        updates.is_done = willBeDone;
        updates.done_at = willBeDone ? new Date().toISOString() : null;
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data: updatedItem, error: updateError } = await supabase
        .from('checklist_assignment_items')
        .update(updates)
        .eq('id', req.params.itemId)
        .select()
        .single();
    if (updateError) return res.status(500).json({ error: 'Failed to update item' });

    const { data: allItems, error: allItemsError } = await supabase
        .from('checklist_assignment_items')
        .select('is_done')
        .eq('assignment_id', assignment.id);
    if (allItemsError) return res.status(500).json({ error: 'Failed to recompute assignment status' });

    const allDone = allItems.every((i) => i.is_done);
    const assignmentUpdates = computeStatusUpdate(assignment, allDone, !!assignment.signature_url);

    let updatedAssignment = assignment;
    if (assignmentUpdates.status !== assignment.status || assignmentUpdates.completed_at !== undefined || assignmentUpdates.started_at) {
        const { data, error } = await supabase
            .from('checklist_assignments')
            .update(assignmentUpdates)
            .eq('id', assignment.id)
            .select()
            .single();
        if (error) return res.status(500).json({ error: 'Failed to update assignment status' });
        updatedAssignment = data;
    }

    const [enrichedAssignment] = await enrichAssignments([updatedAssignment]);
    res.json({ item: updatedItem, assignment: enrichedAssignment });
});

// Standing checklists get reset in place instead of recreated -- clears every
// item's completion state plus the assignment's signature/status, but the
// assignment row itself (and its id/history) stays put.
router.post('/:id/reset', async (req, res) => {
    let assignment;
    try {
        assignment = await loadAssignmentInOrg(req.params.id, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch assignment' });
    }
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const isOwnerOrManager = req.user.role === 'owner' || req.user.role === 'manager';
    if (!isOwnerOrManager && assignment.assigned_to !== req.user.id) {
        return res.status(403).json({ error: 'Not allowed to reset this assignment' });
    }
    if (!assignment.is_standing) {
        return res.status(400).json({ error: 'Only standing checklists can be reset' });
    }

    const { error: itemsError } = await supabase
        .from('checklist_assignment_items')
        .update({ is_done: false, photo_url: null, comment: null, done_at: null })
        .eq('assignment_id', assignment.id);
    if (itemsError) return res.status(500).json({ error: 'Failed to reset items' });

    // sub_checkbox_results carries per-item ids, so each row needs its own
    // all-unchecked value rather than one shared blanket update.
    const { data: itemsWithSubs, error: subsLookupError } = await supabase
        .from('checklist_assignment_items')
        .select('id, sub_checkbox_results')
        .eq('assignment_id', assignment.id)
        .not('sub_checkbox_results', 'is', null);
    if (subsLookupError) return res.status(500).json({ error: 'Failed to reset sub-checkboxes' });
    for (const item of itemsWithSubs) {
        const resetResults = item.sub_checkbox_results.map((r) => ({ id: r.id, checked: false }));
        const { error: subResetError } = await supabase
            .from('checklist_assignment_items')
            .update({ sub_checkbox_results: resetResults })
            .eq('id', item.id);
        if (subResetError) return res.status(500).json({ error: 'Failed to reset sub-checkboxes' });
    }

    const { data: updatedAssignment, error: assignmentUpdateError } = await supabase
        .from('checklist_assignments')
        .update({ status: 'not_started', started_at: null, completed_at: null, signature_url: null })
        .eq('id', assignment.id)
        .select()
        .single();
    if (assignmentUpdateError) return res.status(500).json({ error: 'Failed to reset assignment' });

    const { data: items, error: fetchItemsError } = await supabase
        .from('checklist_assignment_items')
        .select('*, template_item:checklist_template_items(title, description, requires_photo, category, order_index, sub_checkboxes)')
        .eq('assignment_id', assignment.id);
    if (fetchItemsError) return res.status(500).json({ error: 'Failed to fetch reset items' });
    items.sort((a, b) => (a.template_item?.order_index ?? 0) - (b.template_item?.order_index ?? 0));

    const [enrichedAssignment] = await enrichAssignments([updatedAssignment]);
    res.json({ assignment: enrichedAssignment, items });
});

export default router;
