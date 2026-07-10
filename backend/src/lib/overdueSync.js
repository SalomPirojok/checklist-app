import { supabase } from './supabase.js';

// Flips any not_started/in_progress assignment past its deadline to 'overdue', organization-wide.
export async function flipOverdueAssignments() {
    const { error } = await supabase
        .from('checklist_assignments')
        .update({ status: 'overdue' })
        .in('status', ['not_started', 'in_progress'])
        .eq('is_standing', false)
        .lt('due_at', new Date().toISOString());

    if (error) throw new Error(`Failed to flip overdue assignments: ${error.message}`);
}
