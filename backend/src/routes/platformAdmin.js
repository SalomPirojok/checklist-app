import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requirePlatformAdmin } from '../middleware/requirePlatformAdmin.js';

const router = Router();

router.use(requireAuth, requirePlatformAdmin);

async function loadOrgActivity(org) {
    const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, is_active, role, full_name, username, telegram_id')
        .eq('organization_id', org.id);
    if (usersError) throw new Error(usersError.message);

    const employeeCount = users.filter((u) => u.is_active).length;
    const userIds = users.map((u) => u.id);
    const owner = users.find((u) => u.role === 'owner') || null;

    const [{ data: lastAttendance }, { data: lastAssignment }] = await Promise.all([
        supabase
            .from('attendance_records')
            .select('created_at')
            .eq('organization_id', org.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        userIds.length
            ? supabase
                  .from('checklist_assignments')
                  .select('completed_at')
                  .in('assigned_to', userIds)
                  .eq('status', 'completed')
                  .order('completed_at', { ascending: false })
                  .limit(1)
                  .maybeSingle()
            : Promise.resolve({ data: null }),
    ]);

    const activityDates = [lastAttendance?.created_at, lastAssignment?.completed_at].filter(Boolean).sort();
    const lastActivityAt = activityDates.length ? activityDates[activityDates.length - 1] : null;

    return {
        id: org.id,
        name: org.name,
        created_at: org.created_at,
        is_suspended: org.is_suspended,
        employee_count: employeeCount,
        last_activity_at: lastActivityAt,
        owner: owner
            ? { id: owner.id, full_name: owner.full_name, username: owner.username, telegram_id: owner.telegram_id }
            : null,
    };
}

router.get('/organizations', async (req, res) => {
    const { data: orgs, error } = await supabase
        .from('organizations')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Failed to load organizations' });

    try {
        const organizations = await Promise.all(orgs.map(loadOrgActivity));
        res.json({ organizations });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Failed to load organization activity' });
    }
});

router.patch('/organizations/:id', async (req, res) => {
    const { is_suspended } = req.body || {};
    if (typeof is_suspended !== 'boolean') {
        return res.status(400).json({ error: 'is_suspended must be a boolean' });
    }

    const { data, error } = await supabase
        .from('organizations')
        .update({ is_suspended })
        .eq('id', req.params.id)
        .select()
        .maybeSingle();
    if (error) return res.status(500).json({ error: 'Failed to update organization' });
    if (!data) return res.status(404).json({ error: 'Organization not found' });
    res.json({ organization: data });
});

// Corrects a typo'd username for an owner who hasn't opened the bot yet
// (telegram_id still null). Once someone has actually claimed the account,
// their identity can no longer be edited this way.
router.patch('/organizations/:id/owner', async (req, res) => {
    const { username, full_name } = req.body || {};
    if (username === undefined && full_name === undefined) {
        return res.status(400).json({ error: 'Provide username and/or full_name to update' });
    }

    const { data: owner, error: ownerError } = await supabase
        .from('users')
        .select('*')
        .eq('organization_id', req.params.id)
        .eq('role', 'owner')
        .maybeSingle();
    if (ownerError) return res.status(500).json({ error: 'Failed to look up owner' });
    if (!owner) return res.status(404).json({ error: 'Owner not found for this organization' });
    if (owner.telegram_id !== null) {
        return res.status(409).json({ error: 'This owner has already connected their Telegram account and can no longer be edited here' });
    }

    const updates = {};
    if (username !== undefined) {
        if (!username || !username.trim()) return res.status(400).json({ error: 'username cannot be empty' });
        const cleanUsername = username.trim().replace(/^@/, '');

        const { data: pending, error: pendingError } = await supabase
            .from('users')
            .select('id')
            .is('telegram_id', null)
            .ilike('username', cleanUsername)
            .neq('id', owner.id)
            .maybeSingle();
        if (pendingError) return res.status(500).json({ error: 'Failed to check existing invites' });
        if (pending) return res.status(409).json({ error: 'This username has already been invited' });

        updates.username = cleanUsername;
    }
    if (full_name !== undefined) {
        if (!full_name || !full_name.trim()) return res.status(400).json({ error: 'full_name cannot be empty' });
        updates.full_name = full_name.trim();
    }

    const { data, error } = await supabase.from('users').update(updates).eq('id', owner.id).select().single();
    if (error) return res.status(500).json({ error: 'Failed to update owner' });
    res.json({ owner: data });
});

// Permanently erases an organization and every row that belongs to it.
// checklist_assignment_items/checklist_assignments and the training-test
// chain reference users(id) (created_by/assigned_by) with no cascade -- a
// plain `delete from organizations` hits a foreign-key violation the moment
// Postgres tries to cascade-delete a user before the row that still
// references them, so each dependent table is cleared explicitly in
// dependency order first.
async function deleteOrganizationCascade(organizationId) {
    const { data: users, error: usersError } = await supabase.from('users').select('id').eq('organization_id', organizationId);
    if (usersError) throw new Error(usersError.message);
    const userIds = users.map((u) => u.id);

    const { data: templates, error: templatesError } = await supabase
        .from('checklist_templates')
        .select('id')
        .eq('organization_id', organizationId);
    if (templatesError) throw new Error(templatesError.message);
    const templateIds = templates.map((t) => t.id);

    if (templateIds.length) {
        const { data: assignments, error: assignmentsError } = await supabase
            .from('checklist_assignments')
            .select('id')
            .in('template_id', templateIds);
        if (assignmentsError) throw new Error(assignmentsError.message);
        const assignmentIds = assignments.map((a) => a.id);
        if (assignmentIds.length) {
            const r1 = await supabase.from('checklist_assignment_items').delete().in('assignment_id', assignmentIds);
            if (r1.error) throw new Error(r1.error.message);
            const r2 = await supabase.from('checklist_assignments').delete().in('id', assignmentIds);
            if (r2.error) throw new Error(r2.error.message);
        }
    }

    const { data: materials, error: materialsError } = await supabase
        .from('training_materials')
        .select('id')
        .eq('organization_id', organizationId);
    if (materialsError) throw new Error(materialsError.message);
    const materialIds = materials.map((m) => m.id);

    if (materialIds.length) {
        const { data: tests, error: testsError } = await supabase.from('training_tests').select('id').in('material_id', materialIds);
        if (testsError) throw new Error(testsError.message);
        const testIds = tests.map((t) => t.id);

        if (testIds.length) {
            const { data: attempts, error: attemptsError } = await supabase
                .from('training_test_attempts')
                .select('id')
                .in('test_id', testIds);
            if (attemptsError) throw new Error(attemptsError.message);
            const attemptIds = attempts.map((a) => a.id);
            if (attemptIds.length) {
                const r3 = await supabase.from('training_test_attempt_answers').delete().in('attempt_id', attemptIds);
                if (r3.error) throw new Error(r3.error.message);
            }
            const r4 = await supabase.from('training_test_attempts').delete().in('test_id', testIds);
            if (r4.error) throw new Error(r4.error.message);

            const { data: questions, error: questionsError } = await supabase
                .from('training_test_questions')
                .select('id')
                .in('test_id', testIds);
            if (questionsError) throw new Error(questionsError.message);
            const questionIds = questions.map((q) => q.id);
            if (questionIds.length) {
                const r5 = await supabase.from('training_test_options').delete().in('question_id', questionIds);
                if (r5.error) throw new Error(r5.error.message);
            }
            const r6 = await supabase.from('training_test_questions').delete().in('test_id', testIds);
            if (r6.error) throw new Error(r6.error.message);
            const r7 = await supabase.from('training_tests').delete().in('id', testIds);
            if (r7.error) throw new Error(r7.error.message);
        }
    }

    if (templateIds.length) {
        const r8 = await supabase.from('checklist_template_items').delete().in('template_id', templateIds);
        if (r8.error) throw new Error(r8.error.message);
        const r9 = await supabase.from('checklist_templates').delete().in('id', templateIds);
        if (r9.error) throw new Error(r9.error.message);
    }

    const deletesByOrgId = [
        'training_materials',
        'attendance_records',
        'penalties',
        'schedule_week_templates',
        'department_schedule_days',
        'department_schedules',
    ];
    for (const table of deletesByOrgId) {
        const { error } = await supabase.from(table).delete().eq('organization_id', organizationId);
        if (error) throw new Error(error.message);
    }

    // A user being deleted can carry history from a DIFFERENT organization
    // they used to belong to (the platform admin's "reassign owner" flow
    // moves organization_id but leaves their past checklist/training/
    // attendance/penalty history in place, tied to whatever org it actually
    // happened under). None of that gets caught by the organization_id-scoped
    // deletes above, but it still references this user_id with no cascade --
    // clear it explicitly or the user delete below fails with an FK error.
    if (userIds.length) {
        const { data: residualAssignments, error: residualAssignmentsError } = await supabase
            .from('checklist_assignments')
            .select('id')
            .in('assigned_to', userIds);
        if (residualAssignmentsError) throw new Error(residualAssignmentsError.message);
        const residualAssignmentIds = residualAssignments.map((a) => a.id);
        if (residualAssignmentIds.length) {
            const rA1 = await supabase.from('checklist_assignment_items').delete().in('assignment_id', residualAssignmentIds);
            if (rA1.error) throw new Error(rA1.error.message);
            const rA2 = await supabase.from('checklist_assignments').delete().in('id', residualAssignmentIds);
            if (rA2.error) throw new Error(rA2.error.message);
        }

        const { data: residualAttempts, error: residualAttemptsError } = await supabase
            .from('training_test_attempts')
            .select('id')
            .in('user_id', userIds);
        if (residualAttemptsError) throw new Error(residualAttemptsError.message);
        const residualAttemptIds = residualAttempts.map((a) => a.id);
        if (residualAttemptIds.length) {
            const rT1 = await supabase.from('training_test_attempt_answers').delete().in('attempt_id', residualAttemptIds);
            if (rT1.error) throw new Error(rT1.error.message);
            const rT2 = await supabase.from('training_test_attempts').delete().in('id', residualAttemptIds);
            if (rT2.error) throw new Error(rT2.error.message);
        }

        const rResidualAttendance = await supabase.from('attendance_records').delete().in('user_id', userIds);
        if (rResidualAttendance.error) throw new Error(rResidualAttendance.error.message);

        const rResidualPenaltiesSubject = await supabase.from('penalties').delete().in('user_id', userIds);
        if (rResidualPenaltiesSubject.error) throw new Error(rResidualPenaltiesSubject.error.message);

        // created_by is nullable -- a penalty someone else (in another org)
        // still owns just loses the "who issued it" attribution instead of
        // being deleted out from under that org.
        const rResidualPenaltiesCreator = await supabase.from('penalties').update({ created_by: null }).in('created_by', userIds);
        if (rResidualPenaltiesCreator.error) throw new Error(rResidualPenaltiesCreator.error.message);

        const rShifts = await supabase.from('schedule_shifts').delete().in('user_id', userIds);
        if (rShifts.error) throw new Error(rShifts.error.message);
    }

    const rDepartments = await supabase.from('departments').delete().eq('organization_id', organizationId);
    if (rDepartments.error) throw new Error(rDepartments.error.message);

    const rUsers = await supabase.from('users').delete().eq('organization_id', organizationId);
    if (rUsers.error) throw new Error(rUsers.error.message);

    const rOrg = await supabase.from('organizations').delete().eq('id', organizationId);
    if (rOrg.error) throw new Error(rOrg.error.message);
}

router.delete('/organizations/:id', async (req, res) => {
    const { confirm_name } = req.body || {};

    const { data: org, error: orgLookupError } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('id', req.params.id)
        .maybeSingle();
    if (orgLookupError) return res.status(500).json({ error: 'Failed to look up organization' });
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    if (confirm_name !== org.name) {
        return res.status(400).json({ error: 'confirm_name must exactly match the organization name' });
    }

    try {
        await deleteOrganizationCascade(org.id);
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to delete organization' });
    }

    res.status(204).end();
});

// Same "pre-add by username" pattern already used for inviting employees, just
// with role=owner and a brand-new organization instead of an existing one.
//
// A username can also belong to someone who's *already* connected to Telegram
// (e.g. a former employee elsewhere in the system) -- login always matches by
// telegram_id first, so a fresh telegram_id:null row under that username
// could never actually be claimed by them. In that case this asks for
// confirmation (409 + existing_user details) and, once confirmed via
// confirm_reassign, moves that exact user into the new org as its owner
// instead of creating a duplicate identity.
router.post('/organizations', async (req, res) => {
    const { organization_name, owner_username, owner_full_name, confirm_reassign } = req.body || {};
    if (!organization_name || !organization_name.trim()) {
        return res.status(400).json({ error: 'organization_name is required' });
    }
    if (!owner_username || !owner_username.trim()) {
        return res.status(400).json({ error: 'owner_username is required' });
    }
    if (!owner_full_name || !owner_full_name.trim()) {
        return res.status(400).json({ error: 'owner_full_name is required' });
    }

    const username = owner_username.trim().replace(/^@/, '');

    const { data: existing, error: existingError } = await supabase
        .from('users')
        .select('id, full_name, telegram_id, organization_id, organization:organizations(name)')
        .ilike('username', username)
        .maybeSingle();
    if (existingError) return res.status(500).json({ error: 'Failed to check existing users' });

    if (existing && existing.telegram_id === null) {
        return res.status(409).json({ error: 'This username has already been invited' });
    }

    if (existing && existing.telegram_id !== null && !confirm_reassign) {
        return res.status(409).json({
            error: 'This username already belongs to a connected user in another organization',
            code: 'EXISTING_USER_FOUND',
            existing_user: {
                id: existing.id,
                full_name: existing.full_name,
                current_organization_name: existing.organization?.name || null,
            },
        });
    }

    const { data: newOrg, error: orgError } = await supabase
        .from('organizations')
        .insert({ name: organization_name.trim() })
        .select()
        .single();
    if (orgError) return res.status(500).json({ error: 'Failed to create organization' });

    // Reassign path: move the existing connected user into the new org as owner.
    if (existing && existing.telegram_id !== null) {
        const { data: reassignedOwner, error: reassignError } = await supabase
            .from('users')
            .update({
                organization_id: newOrg.id,
                role: 'owner',
                full_name: owner_full_name.trim(),
                is_active: true,
                department_id: null,
                can_manage_training: false,
            })
            .eq('id', existing.id)
            .select()
            .single();
        if (reassignError) {
            await supabase.from('organizations').delete().eq('id', newOrg.id);
            return res.status(500).json({ error: 'Failed to reassign owner' });
        }
        return res.status(201).json({ organization: newOrg, owner: reassignedOwner, reassigned: true });
    }

    const { data: newOwner, error: ownerError } = await supabase
        .from('users')
        .insert({
            username,
            full_name: owner_full_name.trim(),
            role: 'owner',
            organization_id: newOrg.id,
        })
        .select()
        .single();
    if (ownerError) {
        await supabase.from('organizations').delete().eq('id', newOrg.id);
        if (ownerError.code === '23505') {
            return res.status(409).json({ error: 'A user with this telegram_id already exists' });
        }
        return res.status(500).json({ error: 'Failed to create owner' });
    }

    res.status(201).json({ organization: newOrg, owner: newOwner });
});

export default router;
