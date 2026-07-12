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

// Same "pre-add by username" pattern already used for inviting employees, just
// with role=owner and a brand-new organization instead of an existing one.
router.post('/organizations', async (req, res) => {
    const { organization_name, owner_username, owner_full_name } = req.body || {};
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

    const { data: pending, error: pendingError } = await supabase
        .from('users')
        .select('id')
        .is('telegram_id', null)
        .ilike('username', username)
        .maybeSingle();
    if (pendingError) return res.status(500).json({ error: 'Failed to check existing invites' });
    if (pending) return res.status(409).json({ error: 'This username has already been invited' });

    const { data: newOrg, error: orgError } = await supabase
        .from('organizations')
        .insert({ name: organization_name.trim() })
        .select()
        .single();
    if (orgError) return res.status(500).json({ error: 'Failed to create organization' });

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
