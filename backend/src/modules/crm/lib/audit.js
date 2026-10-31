import { writeAuditLog } from '../../../lib/auditLog.js';

// CRM routes never fail a request because the journal write failed; they log
// it instead (the business change itself already succeeded).
export async function crmAudit(req, action, entityType, entityId, before = null, after = null) {
    try {
        await writeAuditLog(req.user, {
            organizationId: req.user.organizationId,
            action,
            entityType,
            entityId,
            before,
            after,
        });
    } catch (err) {
        console.error('Audit log write failed:', err.message);
    }
}
