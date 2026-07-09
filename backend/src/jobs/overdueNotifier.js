import { supabase } from '../lib/supabase.js';
import { sendTelegramMessage } from '../lib/telegramNotify.js';
import { flipOverdueAssignments } from '../lib/overdueSync.js';

async function notifyOwners(botToken) {
    const { data: pending, error } = await supabase
        .from('checklist_assignments')
        .select('id, due_at, assigned_to, template_id')
        .eq('status', 'overdue')
        .is('overdue_notified_at', null);

    if (error) throw new Error(`Failed to load pending overdue notifications: ${error.message}`);
    if (pending.length === 0) return { notified: 0, pending: 0 };

    const assignedToIds = [...new Set(pending.map((a) => a.assigned_to))];
    const templateIds = [...new Set(pending.map((a) => a.template_id))];

    const [{ data: assignees, error: assigneesError }, { data: templates, error: templatesError }] = await Promise.all([
        supabase.from('users').select('id, full_name, organization_id').in('id', assignedToIds),
        supabase.from('checklist_templates').select('id, title').in('id', templateIds),
    ]);
    if (assigneesError || templatesError) throw new Error('Failed to load assignment context');

    const assigneeMap = new Map(assignees.map((u) => [u.id, u]));
    const templateMap = new Map(templates.map((t) => [t.id, t]));

    const organizationIds = [...new Set(assignees.map((u) => u.organization_id))];
    const { data: owners, error: ownersError } = await supabase
        .from('users')
        .select('organization_id, telegram_id')
        .eq('role', 'owner')
        .in('organization_id', organizationIds);
    if (ownersError) throw new Error('Failed to load organization owners');
    const ownerMap = new Map(owners.map((o) => [o.organization_id, o.telegram_id]));

    const notifiedIds = [];
    for (const assignment of pending) {
        const assignee = assigneeMap.get(assignment.assigned_to);
        const template = templateMap.get(assignment.template_id);
        const ownerTelegramId = assignee && ownerMap.get(assignee.organization_id);
        if (!assignee || !template || !ownerTelegramId) continue;

        const dueAtFormatted = new Date(assignment.due_at).toLocaleString('ru-RU');
        const text = `⚠️ Чек-лист просрочен\n«${template.title}» — ${assignee.full_name}\nДедлайн был: ${dueAtFormatted}`;

        try {
            await sendTelegramMessage(botToken, ownerTelegramId, text);
            notifiedIds.push(assignment.id);
        } catch (err) {
            console.error(`Failed to notify owner for assignment ${assignment.id}:`, err.message);
        }
    }

    if (notifiedIds.length > 0) {
        const { error: markError } = await supabase
            .from('checklist_assignments')
            .update({ overdue_notified_at: new Date().toISOString() })
            .in('id', notifiedIds);
        if (markError) console.error('Failed to mark assignments as notified:', markError.message);
    }

    return { notified: notifiedIds.length, pending: pending.length };
}

export async function runOverdueCheck(botToken) {
    await flipOverdueAssignments();
    return notifyOwners(botToken);
}
