import { Router } from 'express';
import { supabase } from '../../../lib/supabase.js';
import { periodRange } from '../../../lib/time.js';
import { requirePermission } from '../middleware.js';
import { sendDbError } from '../lib/dbErrors.js';
import { orgTimezone } from '../lib/period.js';
import { profitAndLoss, staffBalances } from '../lib/report.js';

const router = Router();

const ACTIVE = ['pending', 'accepted', 'in_progress', 'waiting_parts', 'quality_check', 'ready'];
const OPEN_LEADS = ['new', 'in_progress', 'waiting_reply', 'booked', 'arrived'];
const round2 = (n) => Math.round(n * 100) / 100;

// Everything for the owner's home screen in one request: today / this week /
// this month in the organization's timezone.
router.get('/', requirePermission('dashboard.view'), async (req, res) => {
    const orgId = req.user.organizationId;
    let tz;
    try {
        tz = await orgTimezone(orgId);
    } catch {
        return res.status(500).json({ error: 'Не удалось загрузить настройки' });
    }
    const now = new Date();
    const day = periodRange('day', now, tz);
    const week = periodRange('week', now, tz);
    const month = periodRange('month', now, tz);
    const earliest = week.from < month.from ? week.from : month.from;

    const [issued, active, leadsOpen, leadsMonth, expensesMonth, payrollMonth, categories, unpaid, staff, entries, payouts] = await Promise.all([
        supabase
            .from('crm_orders')
            .select('id, issued_at, revenue_base, materials_cost_base, labor_cost_base')
            .eq('organization_id', orgId)
            .eq('status', 'issued')
            .gte('issued_at', earliest),
        supabase
            .from('crm_orders')
            .select('id, number, status, client_id, vehicle_id, planned_ready_at, currency, total, paid_amount')
            .eq('organization_id', orgId)
            .in('status', ACTIVE)
            .order('planned_ready_at', { ascending: true, nullsFirst: false }),
        supabase.from('crm_leads').select('status').eq('organization_id', orgId).in('status', OPEN_LEADS),
        supabase
            .from('crm_leads')
            .select('id, source_id, order_id, created_at')
            .eq('organization_id', orgId)
            .gte('created_at', month.from),
        supabase
            .from('crm_transactions')
            .select('direction, amount_base, category_id')
            .eq('organization_id', orgId)
            .eq('type', 'expense')
            .gte('occurred_at', month.from),
        supabase.from('crm_payroll_entries').select('amount').eq('organization_id', orgId).neq('kind', 'commission').gte('created_at', month.from),
        supabase.from('crm_expense_categories').select('id, kind').eq('organization_id', orgId),
        supabase.from('crm_orders').select('currency, total, paid_amount').eq('organization_id', orgId).eq('status', 'issued'),
        supabase.from('crm_staff').select('id').eq('organization_id', orgId),
        supabase.from('crm_payroll_entries').select('staff_id, amount').eq('organization_id', orgId),
        supabase.from('crm_transactions').select('staff_id, direction, amount_base').eq('organization_id', orgId).eq('type', 'payroll_payout'),
    ]);
    const failed = [issued, active, leadsOpen, leadsMonth, expensesMonth, payrollMonth, categories, unpaid, staff, entries, payouts].find((r) => r.error);
    if (failed) return sendDbError(res, failed.error, 'Не удалось загрузить dashboard');

    const inRange = (range) => issued.data.filter((o) => o.issued_at >= range.from && o.issued_at < range.to);
    const revenueOf = (orders) => round2(orders.reduce((s, o) => s + Number(o.revenue_base), 0));
    const kindOf = new Map(categories.data.map((c) => [c.id, c.kind]));
    const monthOrders = inRange(month);
    const pnl = profitAndLoss({
        orders: monthOrders,
        expenses: expensesMonth.data.map((e) => ({ ...e, category_kind: kindOf.get(e.category_id) })),
        payrollEntries: payrollMonth.data,
    });

    const statusCounts = {};
    for (const o of active.data) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    const overdue = active.data.filter((o) => o.planned_ready_at && o.planned_ready_at < now.toISOString());

    const leadStatusCounts = {};
    for (const l of leadsOpen.data) leadStatusCounts[l.status] = (leadStatusCounts[l.status] || 0) + 1;
    const leadsBySource = {};
    for (const l of leadsMonth.data) leadsBySource[l.source_id || 'none'] = (leadsBySource[l.source_id || 'none'] || 0) + 1;
    const leadsToday = leadsMonth.data.filter((l) => l.created_at >= day.from).length;
    const convertedMonth = leadsMonth.data.filter((l) => l.order_id).length;

    const debts = {};
    for (const o of unpaid.data) {
        const due = Number(o.total) - Number(o.paid_amount);
        if (due > 0) debts[o.currency] = round2((debts[o.currency] || 0) + due);
    }
    const staffOwed = round2(staffBalances(staff.data, entries.data, payouts.data).reduce((s, b) => s + Math.max(b.owed, 0), 0));

    // A short "in work" list with names, soonest deadline first.
    const shortlist = active.data.slice(0, 8);
    const clientIds = [...new Set(shortlist.map((o) => o.client_id))];
    const vehicleIds = [...new Set(shortlist.map((o) => o.vehicle_id).filter(Boolean))];
    const [clients, vehicles] = await Promise.all([
        clientIds.length ? supabase.from('crm_clients').select('id, first_name, last_name').in('id', clientIds) : { data: [] },
        vehicleIds.length ? supabase.from('crm_vehicles').select('id, make, model, plate').in('id', vehicleIds) : { data: [] },
    ]);
    const clientMap = new Map((clients.data || []).map((c) => [c.id, c]));
    const vehicleMap = new Map((vehicles.data || []).map((v) => [v.id, v]));

    res.json({
        dates: { today: day.startDate, week_from: week.startDate, month_from: month.startDate },
        revenue: { today: revenueOf(inRange(day)), week: revenueOf(inRange(week)), month: pnl.revenue },
        issued: { today: inRange(day).length, week: inRange(week).length, month: monthOrders.length },
        month: pnl,
        orders: {
            in_work: active.data.length,
            by_status: statusCounts,
            overdue: overdue.length,
            list: shortlist.map((o) => ({
                ...o,
                client: clientMap.get(o.client_id) || null,
                vehicle: vehicleMap.get(o.vehicle_id) || null,
                is_overdue: !!(o.planned_ready_at && o.planned_ready_at < now.toISOString()),
            })),
        },
        leads: {
            new: leadStatusCounts.new || 0,
            open: leadsOpen.data.length,
            by_status: leadStatusCounts,
            today: leadsToday,
            month: leadsMonth.data.length,
            converted_month: convertedMonth,
            conversion_month: leadsMonth.data.length ? round2((convertedMonth / leadsMonth.data.length) * 100) : null,
            by_source_month: leadsBySource,
        },
        client_debts: debts,
        staff_owed: staffOwed,
    });
});

export default router;
