import { supabase } from './supabase.js';

// Appends one row to audit_log. `actor` is req.user. Throws on failure so
// callers decide whether a missing journal entry should fail the request.
export async function writeAuditLog(actor, { organizationId, action, entityType, entityId = null, before = null, after = null }) {
    const isOrgUser = actor?.id && !String(actor.id).startsWith('platform-admin:');
    const { error } = await supabase.from('audit_log').insert({
        organization_id: organizationId ?? null,
        actor_user_id: isOrgUser ? actor.id : null,
        actor_telegram_id: actor?.telegramId ?? null,
        action,
        entity_type: entityType,
        entity_id: entityId,
        before,
        after,
    });
    if (error) throw new Error(error.message);
}
