import { Router } from 'express';
import { requirePermission } from '../middleware.js';
import { buildDashboard } from '../lib/dashboardData.js';

const router = Router();

router.get('/', requirePermission('dashboard.view'), async (req, res) => {
    try {
        res.json(await buildDashboard(req.user.organizationId));
    } catch (err) {
        console.error('Dashboard failed:', err.message);
        res.status(500).json({ error: 'Не удалось загрузить dashboard' });
    }
});

export default router;
