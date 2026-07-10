import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.use(requireAuth);

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const VALID_DAYS_OF_WEEK = new Set([0, 1, 2, 3, 4, 5, 6]);

function canManageSchedule(req) {
    return req.user.role === 'owner' || req.user.role === 'manager';
}

// Everyone (any role) can view the schedule for every department, plus the
// org-wide default that applies to employees with no department.
router.get('/', async (req, res) => {
    const [
        { data: departments, error: departmentsError },
        { data: schedules, error: schedulesError },
        { data: org, error: orgError },
    ] = await Promise.all([
        supabase
            .from('departments')
            .select('id, name')
            .eq('organization_id', req.user.organizationId)
            .eq('is_archived', false)
            .order('name', { ascending: true }),
        supabase.from('department_schedules').select('*').eq('organization_id', req.user.organizationId),
        supabase.from('organizations').select('shift_start_time').eq('id', req.user.organizationId).single(),
    ]);
    if (departmentsError || schedulesError || orgError) {
        return res.status(500).json({ error: 'Failed to load schedules' });
    }

    const scheduleByDepartment = new Map(schedules.map((s) => [s.department_id, s]));
    const departmentSchedules = departments.map((d) => ({
        department: d,
        schedule: scheduleByDepartment.get(d.id) || null,
    }));

    res.json({ department_schedules: departmentSchedules, default_shift_start_time: org.shift_start_time });
});

router.put('/:departmentId', async (req, res) => {
    if (!canManageSchedule(req)) {
        return res.status(403).json({ error: 'Not allowed to manage schedules' });
    }

    const { data: department, error: departmentError } = await supabase
        .from('departments')
        .select('id')
        .eq('id', req.params.departmentId)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (departmentError) return res.status(500).json({ error: 'Failed to look up department' });
    if (!department) return res.status(404).json({ error: 'Department not found' });

    const { days_of_week, start_time, end_time } = req.body || {};
    if (!Array.isArray(days_of_week) || days_of_week.length === 0 || days_of_week.some((d) => !VALID_DAYS_OF_WEEK.has(d))) {
        return res.status(400).json({ error: 'days_of_week must be a non-empty array of integers 0-6' });
    }
    if (!TIME_PATTERN.test(start_time) || !TIME_PATTERN.test(end_time)) {
        return res.status(400).json({ error: 'start_time and end_time must be in HH:MM format' });
    }

    const { data, error } = await supabase
        .from('department_schedules')
        .upsert(
            {
                department_id: department.id,
                organization_id: req.user.organizationId,
                days_of_week,
                start_time,
                end_time,
            },
            { onConflict: 'department_id' }
        )
        .select()
        .single();
    if (error) return res.status(500).json({ error: 'Failed to save schedule' });
    res.json({ schedule: data });
});

// Clears the department's own schedule -- it then falls back to the org-wide default.
router.delete('/:departmentId', async (req, res) => {
    if (!canManageSchedule(req)) {
        return res.status(403).json({ error: 'Not allowed to manage schedules' });
    }

    const { data: department, error: departmentError } = await supabase
        .from('departments')
        .select('id')
        .eq('id', req.params.departmentId)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (departmentError) return res.status(500).json({ error: 'Failed to look up department' });
    if (!department) return res.status(404).json({ error: 'Department not found' });

    const { error } = await supabase.from('department_schedules').delete().eq('department_id', department.id);
    if (error) return res.status(500).json({ error: 'Failed to clear schedule' });
    res.json({ deleted: true });
});

export default router;
