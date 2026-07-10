import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { buildDailyReport } from '../lib/dailyReport.js';

const router = Router();

router.use(requireAuth, requireRole('owner', 'manager'));

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 31;

router.get('/settings', async (req, res) => {
    const { data, error } = await supabase
        .from('organizations')
        .select('daily_report_time')
        .eq('id', req.user.organizationId)
        .single();
    if (error) return res.status(500).json({ error: 'Failed to load report settings' });
    res.json({ settings: data });
});

router.patch('/settings', async (req, res) => {
    const { daily_report_time } = req.body || {};
    if (!daily_report_time || !TIME_PATTERN.test(daily_report_time)) {
        return res.status(400).json({ error: 'daily_report_time must be in HH:MM format' });
    }

    const { data, error } = await supabase
        .from('organizations')
        .update({ daily_report_time })
        .eq('id', req.user.organizationId)
        .select('daily_report_time')
        .single();
    if (error) return res.status(500).json({ error: 'Failed to update report settings' });
    res.json({ settings: data });
});

router.get('/', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to || !DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
        return res.status(400).json({ error: 'from and to are required, in YYYY-MM-DD format' });
    }

    const fromDate = new Date(`${from}T00:00:00Z`);
    const toDate = new Date(`${to}T00:00:00Z`);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
        return res.status(400).json({ error: 'from must be a valid date on or before to' });
    }

    const dayCount = Math.round((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (dayCount > MAX_RANGE_DAYS) {
        return res.status(400).json({ error: `Range too large — max ${MAX_RANGE_DAYS} days` });
    }

    try {
        const days = Array.from({ length: dayCount }, (_, i) => new Date(fromDate.getTime() + i * 24 * 60 * 60 * 1000));
        const reports = await Promise.all(days.map((day) => buildDailyReport(req.user.organizationId, day)));
        res.json({ reports });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Failed to build reports' });
    }
});

export default router;
