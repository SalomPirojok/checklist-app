import { loadCrmAccess } from './lib/access.js';

// Must run after requireAuth and requireModule('crm'). Attaches req.crm =
// { role, permissions } or rejects users without a CRM role.
export async function requireCrmAccess(req, res, next) {
    let access;
    try {
        access = await loadCrmAccess(req.user);
    } catch {
        return res.status(500).json({ error: 'Failed to load CRM access' });
    }
    if (!access) {
        return res.status(403).json({ error: 'Нет доступа к CRM', code: 'CRM_NO_ACCESS' });
    }
    req.crm = access;
    next();
}

// Passes when the user has at least one of the listed permissions.
export function requirePermission(...permissions) {
    return (req, res, next) => {
        if (!permissions.some((p) => req.crm?.permissions.includes(p))) {
            return res.status(403).json({ error: 'Недостаточно прав', code: 'CRM_FORBIDDEN' });
        }
        next();
    };
}
