import { supabase } from '../lib/supabase.js';

function startOfDayUTC(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function endOfDayUTC(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
}

// Runs on the same periodic-poll model as the overdue checker (Step 7): every
// tick just re-derives "should this exist yet today?" rather than trying to
// fire exactly once at auto_assign_time. Idempotency comes from checking
// whether an assignment already exists for (template, employee, today) —
// re-running later the same day, or multiple times past the threshold, never
// creates duplicates.
export async function runAutoAssignChecklists() {
    const now = new Date();
    const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;

    const { data: allTemplates, error: templatesError } = await supabase
        .from('checklist_templates')
        .select('*')
        .eq('auto_assign_enabled', true)
        .eq('is_archived', false)
        .lte('auto_assign_time', currentTime);
    if (templatesError) throw new Error(`Failed to load auto-assign templates: ${templatesError.message}`);

    // NULL/empty auto_assign_days_of_week means "every day" (legacy templates
    // created before this field existed keep behaving exactly as before).
    const todayDow = now.getUTCDay();
    const templates = allTemplates.filter(
        (t) => !t.auto_assign_days_of_week || t.auto_assign_days_of_week.length === 0 || t.auto_assign_days_of_week.includes(todayDow)
    );
    if (templates.length === 0) return { templatesChecked: 0, assignmentsCreated: 0 };

    const todayStart = startOfDayUTC(now);
    const todayEnd = endOfDayUTC(now);
    let assignmentsCreated = 0;

    for (const template of templates) {
        try {
            let employeesQuery = supabase
                .from('users')
                .select('id')
                .eq('organization_id', template.organization_id)
                .eq('is_active', true)
                .in('role', ['employee', 'manager']);
            // A template with no department is "for everyone" (unchanged legacy
            // behavior); a department-restricted template only reaches employees
            // in that exact department.
            if (template.department_id) employeesQuery = employeesQuery.eq('department_id', template.department_id);
            const { data: employees, error: employeesError } = await employeesQuery;
            if (employeesError) throw new Error(employeesError.message);
            if (!employees.length) continue;

            const { data: templateItems, error: itemsError } = await supabase
                .from('checklist_template_items')
                .select('id')
                .eq('template_id', template.id);
            if (itemsError) throw new Error(itemsError.message);
            if (!templateItems.length) continue; // nothing to hand out

            const employeeIds = employees.map((e) => e.id);
            // Keyed off created_at (not due_at) so this works the same whether
            // or not the template has a deadline -- a no-deadline assignment
            // has due_at null and would never match a due_at range filter.
            const { data: existingAssignments, error: existingError } = await supabase
                .from('checklist_assignments')
                .select('assigned_to')
                .eq('template_id', template.id)
                .in('assigned_to', employeeIds)
                .gte('created_at', todayStart)
                .lt('created_at', todayEnd);
            if (existingError) throw new Error(existingError.message);
            const alreadyAssigned = new Set(existingAssignments.map((a) => a.assigned_to));

            let dueAt = null;
            if (template.due_offset_minutes !== null && template.due_offset_minutes !== undefined) {
                const [hours, minutes] = template.auto_assign_time.split(':').map(Number);
                dueAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes));
                dueAt.setUTCMinutes(dueAt.getUTCMinutes() + template.due_offset_minutes);
            }

            for (const employee of employees) {
                if (alreadyAssigned.has(employee.id)) continue;

                const { data: assignment, error: assignmentError } = await supabase
                    .from('checklist_assignments')
                    .insert({
                        template_id: template.id,
                        assigned_to: employee.id,
                        assigned_by: template.created_by,
                        due_at: dueAt ? dueAt.toISOString() : null,
                        status: 'not_started',
                    })
                    .select()
                    .single();
                if (assignmentError) {
                    console.error(`Auto-assign failed for template ${template.id}, employee ${employee.id}:`, assignmentError.message);
                    continue;
                }

                const { error: assignmentItemsError } = await supabase
                    .from('checklist_assignment_items')
                    .insert(templateItems.map((item) => ({ assignment_id: assignment.id, template_item_id: item.id })));
                if (assignmentItemsError) {
                    console.error(`Auto-assign items failed for assignment ${assignment.id}:`, assignmentItemsError.message);
                    await supabase.from('checklist_assignments').delete().eq('id', assignment.id);
                    continue;
                }

                assignmentsCreated += 1;
            }
        } catch (err) {
            console.error(`Auto-assign failed for template ${template.id}:`, err.message);
        }
    }

    return { templatesChecked: templates.length, assignmentsCreated };
}
