import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireModule } from '../../middleware/requireModule.js';
import { requireCrmAccess } from './middleware.js';
import clientsRouter from './routes/clients.js';
import leadsRouter from './routes/leads.js';
import referenceRouter from './routes/reference.js';
import accessRouter from './routes/access.js';

// Every /api/crm route: signed in, CRM enabled for the organization, and the
// user holds a CRM role (the owner always does). Finer checks live per route.
const router = Router();

router.use(requireAuth, requireModule('crm'), requireCrmAccess);

router.get('/me', (req, res) => {
    res.json({ role: req.crm.role, permissions: req.crm.permissions });
});

router.use('/reference', referenceRouter);
router.use('/clients', clientsRouter);
router.use('/leads', leadsRouter);
router.use('/access', accessRouter);

export default router;
