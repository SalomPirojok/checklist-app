import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getEnabledModules } from '../lib/modules.js';

const router = Router();

router.use(requireAuth);

// Lets the client decide which module navigation to show. The server still
// enforces access on every module route via requireModule().
router.get('/', async (req, res) => {
    if (!req.user.organizationId) return res.json({ modules: [] });
    try {
        res.json({ modules: await getEnabledModules(req.user.organizationId) });
    } catch {
        res.status(500).json({ error: 'Failed to load modules' });
    }
});

export default router;
