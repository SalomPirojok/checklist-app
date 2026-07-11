import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { canActOnRole } from '../lib/roles.js';
import { computeLateness } from '../lib/lateness.js';
import { loadDepartmentScheduleDays, resolveScheduleForDay } from '../lib/schedule.js';

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

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Aggregates attendance, checklist completion, penalties, and training
// results for one employee over a period -- reuses the same underlying
// tables as the Reports screen, just scoped to a single user instead of
// the whole org.
router.get('/:id/profile', async (req, res) => {
    const { data: employee, error: employeeError } = await supabase
        .from('users')
        .select('*, department:departments(id, name)')
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (employeeError) return res.status(500).json({ error: 'Failed to fetch employee' });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const { from, to } = req.query;
    let periodStart;
    let periodEnd;
    if (from || to) {
        if (!from || !to || !DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
            return res.status(400).json({ error: 'from and to must both be provided in YYYY-MM-DD format' });
        }
        periodStart = new Date(`${from}T00:00:00Z`);
        periodEnd = new Date(`${to}T00:00:00Z`);
        periodEnd.setUTCDate(periodEnd.getUTCDate() + 1);
        if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodStart >= periodEnd) {
            return res.status(400).json({ error: 'from must be a valid date before to' });
        }
    } else {
        periodEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
        periodStart = new Date('2000-01-01T00:00:00Z');
    }
    const periodStartIso = periodStart.toISOString();
    const periodEndIso = periodEnd.toISOString();

    const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('shift_start_time')
        .eq('id', req.user.organizationId)
        .single();
    if (orgError) return res.status(500).json({ error: 'Failed to load organization settings' });

    const [
        { data: attendanceRecords, error: attendanceError },
        { data: assignments, error: assignmentsError },
        { data: penaltyRows, error: penaltiesError },
        { data: attemptRows, error: attemptsError },
    ] = await Promise.all([
        supabase
            .from('attendance_records')
            .select('*')
            .eq('user_id', employee.id)
            .gte('created_at', periodStartIso)
            .lt('created_at', periodEndIso)
            .order('created_at', { ascending: false }),
        supabase
            .from('checklist_assignments')
            .select('id, status')
            .eq('assigned_to', employee.id)
            .eq('is_standing', false)
            .gte('created_at', periodStartIso)
            .lt('created_at', periodEndIso),
        supabase
            .from('penalties')
            .select('*')
            .eq('user_id', employee.id)
            .gte('created_at', periodStartIso)
            .lt('created_at', periodEndIso)
            .order('created_at', { ascending: false }),
        supabase
            .from('training_test_attempts')
            .select('test_id, score_percent, passed, created_at')
            .eq('user_id', employee.id)
            .gte('created_at', periodStartIso)
            .lt('created_at', periodEndIso),
    ]);
    if (attendanceError || assignmentsError || penaltiesError || attemptsError) {
        return res.status(500).json({ error: 'Failed to load employee profile data' });
    }

    const scheduleDays = await loadDepartmentScheduleDays(employee.department_id);
    const checkIns = attendanceRecords.filter((r) => r.type === 'check_in');
    const lateCheckIns = checkIns.filter((r) => {
        const checkInAt = new Date(r.created_at);
        const schedule = resolveScheduleForDay(scheduleDays, checkInAt.getUTCDay(), org.shift_start_time);
        return computeLateness(checkInAt, schedule).isLate;
    });

    const penaltiesTotal = penaltyRows.reduce((sum, p) => sum + Number(p.amount), 0);

    let training = [];
    if (attemptRows.length > 0) {
        const testIds = [...new Set(attemptRows.map((a) => a.test_id))];
        const { data: tests, error: testsError } = await supabase
            .from('training_tests')
            .select('id, material_id')
            .in('id', testIds);
        if (testsError) return res.status(500).json({ error: 'Failed to load training tests' });

        const materialIds = [...new Set(tests.map((t) => t.material_id))];
        const { data: materials, error: materialsError } = await supabase
            .from('training_materials')
            .select('id, title')
            .in('id', materialIds);
        if (materialsError) return res.status(500).json({ error: 'Failed to load training materials' });

        const materialMap = new Map(materials.map((m) => [m.id, m]));
        const testMap = new Map(tests.map((t) => [t.id, t]));

        training = testIds.map((testId) => {
            const attempts = attemptRows.filter((a) => a.test_id === testId);
            const material = materialMap.get(testMap.get(testId)?.material_id);
            const bestScore = Math.max(...attempts.map((a) => a.score_percent));
            return {
                test_id: testId,
                material_title: material?.title || '—',
                attempt_count: attempts.length,
                best_score_percent: bestScore,
                passed: attempts.some((a) => a.passed),
                last_attempt_at: attempts.reduce((latest, a) => (a.created_at > latest ? a.created_at : latest), attempts[0].created_at),
            };
        });
    }

    res.json({
        employee: {
            id: employee.id,
            full_name: employee.full_name,
            role: employee.role,
            department: employee.department,
        },
        period: from && to ? { from, to } : { from: null, to: null },
        attendance: {
            check_ins: checkIns.length,
            late_check_ins: lateCheckIns.length,
        },
        checklists: {
            total: assignments.length,
            completed: assignments.filter((a) => a.status === 'completed').length,
            overdue: assignments.filter((a) => a.status === 'overdue').length,
        },
        penalties: {
            items: penaltyRows,
            total_amount: penaltiesTotal,
        },
        training,
    });
});

router.post('/', async (req, res) => {
    const { telegram_id, full_name, username, role = 'employee' } = req.body || {};

    if (!full_name) {
        return res.status(400).json({ error: 'full_name is required' });
    }
    // telegram_id may be unknown yet — the owner can invite someone by username
    // alone, and their telegram_id gets filled in on their first login.
    if (!telegram_id && !username) {
        return res.status(400).json({ error: 'Provide telegram_id, or at least a username to invite by' });
    }
    if (!ASSIGNABLE_ROLES.includes(role)) {
        return res.status(400).json({ error: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` });
    }
    if (!canActOnRole(req.user.role, role)) {
        return res.status(403).json({ error: 'Not allowed to assign this role' });
    }

    if (!telegram_id && username) {
        const { data: pending, error: pendingError } = await supabase
            .from('users')
            .select('id')
            .is('telegram_id', null)
            .ilike('username', username)
            .maybeSingle();
        if (pendingError) return res.status(500).json({ error: 'Failed to check existing invites' });
        if (pending) return res.status(409).json({ error: 'This username has already been invited' });
    }

    const { data, error } = await supabase
        .from('users')
        .insert({
            telegram_id: telegram_id || null,
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

    const { full_name, username, role, is_active, can_manage_training, department_id } = req.body || {};
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
    if (can_manage_training !== undefined) {
        // Only the owner grants/revokes training-management rights, even though
        // an owner can already edit managers more broadly via canActOnRole above.
        if (req.user.role !== 'owner') {
            return res.status(403).json({ error: 'Only the owner can manage training permissions' });
        }
        updates.can_manage_training = !!can_manage_training;
    }
    if (department_id !== undefined) {
        if (department_id !== null) {
            const { data: department, error: deptError } = await supabase
                .from('departments')
                .select('id')
                .eq('id', department_id)
                .eq('organization_id', req.user.organizationId)
                .eq('is_archived', false)
                .maybeSingle();
            if (deptError) return res.status(500).json({ error: 'Failed to look up department' });
            if (!department) return res.status(400).json({ error: 'department_id not found in your organization' });
        }
        updates.department_id = department_id;
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
