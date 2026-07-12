import { supabase } from './supabase.js';

// checklist_assignments carries no organization_id of its own -- historically
// every query scoped assignments through the ASSIGNEE's current organization
// instead, which quietly assumed a user never changes organizations. Once a
// platform admin can reassign someone to a different org (keeping their user
// row/id), that assumption breaks: their old assignments -- tied to a
// template that still belongs to the OLD org -- would otherwise keep
// showing up (and stay writable) in their new org. Scoping through the
// template's organization_id instead is the actual source of truth.
export async function getOrgTemplateIds(organizationId) {
    const { data, error } = await supabase.from('checklist_templates').select('id').eq('organization_id', organizationId);
    if (error) throw new Error('failed to load organization templates');
    return data.map((t) => t.id);
}
