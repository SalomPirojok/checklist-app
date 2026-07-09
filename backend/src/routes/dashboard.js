import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { flipOverdueAssignments } from '../lib/overdueSync.js';

const router = Router();

router.use(requireAuth, requireRole('owner', 'manager'));

function startOfDayUTC(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function endOfDayUTC(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
}

router.get('/today', async (req, res) => {
    try {
        await flipOverdueAssignments();
    } catch {
        return res.status(500).json({ error: 'Failed to refresh assignment statuses' });
    }

    const { data: orgUsers, error: orgUsersError } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('organization_id', req.user.organizationId);
    if (orgUsersError) return res.status(500).json({ error: 'Failed to load organization users' });

    const orgUserIds = orgUsers.map((u) => u.id);
    const userMap = new Map(orgUsers.map((u) => [u.id, u]));

    const now = new Date();
    const todayStart = startOfDayUTC(now);
    const todayEnd = endOfDayUTC(now);

    const [{ data: todaysAssignments, error: todaysError }, { data: overdueAssignments, error: overdueError }] = await Promise.all([
        orgUserIds.length
            ? supabase
                  .from('checklist_assignments')
                  .select('*')
                  .in('assigned_to', orgUserIds)
                  // A no-deadline assignment (due_at null) has no due-date range to
                  // match, so it's included instead by checking created_at is today.
                  .or(
                      `and(due_at.gte.${todayStart},due_at.lt.${todayEnd}),and(due_at.is.null,created_at.gte.${todayStart},created_at.lt.${todayEnd})`
                  )
                  .order('due_at', { ascending: true })
            : { data: [], error: null },
        orgUserIds.length
            ? supabase
                  .from('checklist_assignments')
                  .select('*')
                  .in('assigned_to', orgUserIds)
                  .eq('status', 'overdue')
                  .order('due_at', { ascending: true })
            : { data: [], error: null },
    ]);
    if (todaysError || overdueError) return res.status(500).json({ error: 'Failed to load assignments' });

    const templateIds = [...new Set([...todaysAssignments, ...overdueAssignments].map((a) => a.template_id))];
    const { data: templates, error: templatesError } = templateIds.length
        ? await supabase.from('checklist_templates').select('id, title').in('id', templateIds)
        : { data: [], error: null };
    if (templatesError) return res.status(500).json({ error: 'Failed to load templates' });
    const templateMap = new Map(templates.map((t) => [t.id, t]));

    const enrich = (assignment) => ({
        ...assignment,
        assignee: userMap.get(assignment.assigned_to) || null,
        template: templateMap.get(assignment.template_id) || null,
    });

    const todaysSummary = { not_started: 0, in_progress: 0, completed: 0, overdue: 0, total: todaysAssignments.length };
    for (const a of todaysAssignments) {
        todaysSummary[a.status] = (todaysSummary[a.status] || 0) + 1;
    }

    res.json({
        date: todayStart.slice(0, 10),
        todays_summary: todaysSummary,
        todays_assignments: todaysAssignments.map(enrich),
        overdue_total: overdueAssignments.length,
        overdue_assignments: overdueAssignments.map(enrich),
    });
});

export default router;
