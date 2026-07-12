import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.use(requireAuth);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const VALID_STATUSES = new Set(['work', 'off', 'undefined']);

function canManageSchedule(req) {
    return req.user.role === 'owner' || req.user.role === 'manager';
}

// Fetches the org's active employee list once, keyed by id -- used both to
// validate incoming user_id values belong to the org and to join names/
// departments onto shift rows for the frontend table.
async function loadOrgUsers(organizationId) {
    const { data, error } = await supabase
        .from('users')
        .select('id, full_name, department_id, is_active')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('full_name', { ascending: true });
    if (error) throw error;
    return data;
}

function validateShiftInput(body) {
    const { user_id, shift_date, status, start_time, end_time } = body || {};
    if (!user_id) return 'user_id is required';
    if (!DATE_PATTERN.test(shift_date || '')) return 'shift_date must be in YYYY-MM-DD format';
    if (status !== undefined && !VALID_STATUSES.has(status)) return 'status must be one of work, off, undefined';
    if (start_time !== undefined && start_time !== null && !TIME_PATTERN.test(start_time)) {
        return 'start_time must be in HH:MM format';
    }
    if (end_time !== undefined && end_time !== null && !TIME_PATTERN.test(end_time)) {
        return 'end_time must be in HH:MM format';
    }
    return null;
}

// Any authenticated user can see their own shift for today -- unlike the
// rest of this router, this isn't gated by canManageSchedule since it only
// ever exposes the caller's own row (used next to the check-in button so an
// employee knows what time they're expected).
router.get('/my-shift-today', async (req, res) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const { data: shift, error } = await supabase
        .from('schedule_shifts')
        .select('status, start_time, end_time')
        .eq('user_id', req.user.id)
        .eq('shift_date', todayStr)
        .maybeSingle();
    if (error) return res.status(500).json({ error: 'Failed to load shift' });
    res.json({ shift });
});

router.get('/shifts', async (req, res) => {
    if (!canManageSchedule(req)) {
        return res.status(403).json({ error: 'Not allowed to view the shift schedule' });
    }

    const { from, to } = req.query;
    if (!DATE_PATTERN.test(from || '') || !DATE_PATTERN.test(to || '')) {
        return res.status(400).json({ error: 'from and to are required in YYYY-MM-DD format' });
    }

    try {
        const employees = await loadOrgUsers(req.user.organizationId);
        const employeeIds = employees.map((e) => e.id);

        const { data: shifts, error: shiftsError } = employeeIds.length
            ? await supabase
                  .from('schedule_shifts')
                  .select('*')
                  .in('user_id', employeeIds)
                  .gte('shift_date', from)
                  .lte('shift_date', to)
            : { data: [], error: null };
        if (shiftsError) return res.status(500).json({ error: 'Failed to load shifts' });

        res.json({ employees, shifts });
    } catch {
        res.status(500).json({ error: 'Failed to load shifts' });
    }
});

router.put('/shifts', async (req, res) => {
    if (!canManageSchedule(req)) {
        return res.status(403).json({ error: 'Not allowed to manage the shift schedule' });
    }

    const validationError = validateShiftInput(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const { user_id, shift_date, status, start_time, end_time, color_override } = req.body;

    const { data: user, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('id', user_id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (userError) return res.status(500).json({ error: 'Failed to look up user' });
    if (!user) return res.status(404).json({ error: 'User not found in this organization' });

    const { data, error } = await supabase
        .from('schedule_shifts')
        .upsert(
            {
                user_id,
                shift_date,
                status: status || 'undefined',
                start_time: start_time || null,
                end_time: end_time || null,
                color_override: color_override || null,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,shift_date' }
        )
        .select()
        .single();
    if (error) return res.status(500).json({ error: 'Failed to save shift' });
    res.json({ shift: data });
});

router.post('/shifts/bulk', async (req, res) => {
    if (!canManageSchedule(req)) {
        return res.status(403).json({ error: 'Not allowed to manage the shift schedule' });
    }

    const { shifts } = req.body || {};
    if (!Array.isArray(shifts) || shifts.length === 0) {
        return res.status(400).json({ error: 'shifts must be a non-empty array' });
    }

    for (const shift of shifts) {
        const validationError = validateShiftInput(shift);
        if (validationError) return res.status(400).json({ error: validationError });
    }

    const employees = await loadOrgUsers(req.user.organizationId);
    const employeeIds = new Set(employees.map((e) => e.id));
    const unknownUser = shifts.find((s) => !employeeIds.has(s.user_id));
    if (unknownUser) return res.status(404).json({ error: `User ${unknownUser.user_id} not found in this organization` });

    const rows = shifts.map((s) => ({
        user_id: s.user_id,
        shift_date: s.shift_date,
        status: s.status || 'undefined',
        start_time: s.start_time || null,
        end_time: s.end_time || null,
        color_override: s.color_override || null,
        updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
        .from('schedule_shifts')
        .upsert(rows, { onConflict: 'user_id,shift_date' })
        .select();
    if (error) return res.status(500).json({ error: 'Failed to save shifts' });
    res.json({ shifts: data });
});

router.get('/templates', async (req, res) => {
    if (!canManageSchedule(req)) {
        return res.status(403).json({ error: 'Not allowed to view schedule templates' });
    }

    const { data, error } = await supabase
        .from('schedule_week_templates')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Failed to load templates' });
    res.json({ templates: data });
});

router.post('/templates', async (req, res) => {
    if (!canManageSchedule(req)) {
        return res.status(403).json({ error: 'Not allowed to manage schedule templates' });
    }

    const { name, template_data } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
    if (!template_data || typeof template_data !== 'object' || Array.isArray(template_data)) {
        return res.status(400).json({ error: 'template_data must be an object' });
    }

    const { data, error } = await supabase
        .from('schedule_week_templates')
        .insert({ organization_id: req.user.organizationId, name: name.trim(), template_data })
        .select()
        .single();
    if (error) return res.status(500).json({ error: 'Failed to save template' });
    res.status(201).json({ template: data });
});

export default router;
