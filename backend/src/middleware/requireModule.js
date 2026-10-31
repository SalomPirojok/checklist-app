import { isModuleEnabled } from '../lib/modules.js';

// Must run after requireAuth.
export function requireModule(moduleKey) {
    return async (req, res, next) => {
        if (!req.user?.organizationId) {
            return res.status(403).json({ error: 'Module not available', code: 'MODULE_DISABLED' });
        }
        let enabled;
        try {
            enabled = await isModuleEnabled(req.user.organizationId, moduleKey);
        } catch {
            return res.status(500).json({ error: 'Failed to check module access' });
        }
        if (!enabled) {
            return res.status(403).json({ error: 'Module not available', code: 'MODULE_DISABLED' });
        }
        next();
    };
}
