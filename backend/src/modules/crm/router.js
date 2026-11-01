import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireModule } from '../../middleware/requireModule.js';
import { requireCrmAccess } from './middleware.js';
import clientsRouter from './routes/clients.js';
import leadsRouter from './routes/leads.js';
import referenceRouter from './routes/reference.js';
import accessRouter from './routes/access.js';
import staffRouter from './routes/staff.js';
import vehiclesRouter from './routes/vehicles.js';
import ordersRouter from './routes/orders.js';
import financeRouter from './routes/finance.js';
import payrollRouter from './routes/payroll.js';
import marketingRouter from './routes/marketing.js';
import dashboardRouter from './routes/dashboard.js';

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
router.use('/staff', staffRouter);
router.use('/vehicles', vehiclesRouter);
router.use('/orders', ordersRouter);
router.use('/finance', financeRouter);
router.use('/payroll', payrollRouter);
router.use('/marketing', marketingRouter);
router.use('/dashboard', dashboardRouter);

export default router;
