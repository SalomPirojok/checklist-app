import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.use(requireAuth);

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const VALID_STATUSES = new Set(['work', 'off', 'undefined']);

function canManageSchedule(req) {
    return req.user.role === 'owner' || req.user.role === 'manager';
}

// Everyone (any role) can view the weekly schedule grid for every department,
// plus the org-wide default that applies to days/departments with no explicit
// status set.
router.get('/', async (req, res) => {
    const [
        { data: departments, error: departmentsError },
        { data: scheduleDays, error: scheduleDaysError },
        { data: org, error: orgError },
    ] = await Promise.all([
        supabase
            .from('departments')
            .select('id, name')
            .eq('organization_id', req.user.organizationId)
            .eq('is_archived', false)
            .order('name', { ascending: true }),
        supabase.from('department_schedule_days').select('*').eq('organization_id', req.user.organizationId),
        supabase.from('organizations').select('shift_start_time').eq('id', req.user.organizationId).single(),
    ]);
    if (departmentsError || scheduleDaysError || orgError) {
        return res.status(500).json({ error: 'Failed to load schedules' });
    }

    res.json({ departments, schedule_days: scheduleDays, default_shift_start_time: org.shift_start_time });
});

// Upserts one department+day-of-week cell.
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

    const { day_of_week, status, start_time, end_time } = req.body || {};
    if (!Number.isInteger(day_of_week) || day_of_week < 0 || day_of_week > 6) {
        return res.status(400).json({ error: 'day_of_week must be an integer 0-6' });
    }
    if (status !== undefined && !VALID_STATUSES.has(status)) {
        return res.status(400).json({ error: 'status must be one of work, off, undefined' });
    }
    if (start_time !== undefined && start_time !== null && !TIME_PATTERN.test(start_time)) {
        return res.status(400).json({ error: 'start_time must be in HH:MM format' });
    }
    if (end_time !== undefined && end_time !== null && !TIME_PATTERN.test(end_time)) {
        return res.status(400).json({ error: 'end_time must be in HH:MM format' });
    }

    const { data, error } = await supabase
        .from('department_schedule_days')
        .upsert(
            {
                department_id: department.id,
                organization_id: req.user.organizationId,
                day_of_week,
                status: status || 'undefined',
                start_time: start_time || null,
                end_time: end_time || null,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'department_id,day_of_week' }
        )
        .select()
        .single();
    if (error) return res.status(500).json({ error: 'Failed to save schedule' });
    res.json({ schedule_day: data });
});

export default router;
