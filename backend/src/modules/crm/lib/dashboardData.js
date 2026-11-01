import { supabase } from '../../../lib/supabase.js';
import { periodRange } from '../../../lib/time.js';
import { orgTimezone } from './period.js';
import { profitAndLoss, staffBalances } from './report.js';

const ACTIVE = ['pending', 'accepted', 'in_progress', 'waiting_parts', 'quality_check', 'ready'];
const OPEN_LEADS = ['new', 'in_progress', 'waiting_reply', 'booked', 'arrived'];
const round2 = (n) => Math.round(n * 100) / 100;

function check(results) {
    const failed = results.find((r) => r.error);
    if (failed) throw new Error(failed.error.message);
}

// Owner's home-screen numbers for today / this week / this month in the
// organization's timezone. Shared by GET /dashboard and the evening summary.
export async function buildDashboard(orgId, now = new Date()) {
    const tz = await orgTimezone(orgId);
    const day = periodRange('day', now, tz);
    const week = periodRange('week', now, tz);
    const month = periodRange('month', now, tz);
    const earliest = week.from < month.from ? week.from : month.from;

    const results = await Promise.all([
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
        supabase.from('crm_leads').select('id, source_id, order_id, created_at').eq('organization_id', orgId).gte('created_at', month.from),
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
        supabase
            .from('crm_transactions')
            .select('direction, amount_base')
            .eq('organization_id', orgId)
            .in('type', ['client_payment', 'client_refund'])
            .gte('occurred_at', day.from)
            .lt('occurred_at', day.to),
    ]);
    check(results);
    const [issued, active, leadsOpen, leadsMonth, expensesMonth, payrollMonth, categories, unpaid, staff, entries, payouts, paymentsToday] = results;

    const inRange = (range) => issued.data.filter((o) => o.issued_at >= range.from && o.issued_at < range.to);
    const revenueOf = (orders) => round2(orders.reduce((s, o) => s + Number(o.revenue_base), 0));
    const kindOf = new Map(categories.data.map((c) => [c.id, c.kind]));
    const monthOrders = inRange(month);
    const pnl = profitAndLoss({
        orders: monthOrders,
        expenses: expensesMonth.data.map((e) => ({ ...e, category_kind: kindOf.get(e.category_id) })),
        payrollEntries: payrollMonth.data,
    });

    const nowIso = now.toISOString();
    const statusCounts = {};
    for (const o of active.data) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    const overdue = active.data.filter((o) => o.planned_ready_at && o.planned_ready_at < nowIso);

    const leadStatusCounts = {};
    for (const l of leadsOpen.data) leadStatusCounts[l.status] = (leadStatusCounts[l.status] || 0) + 1;
    const leadsBySource = {};
    for (const l of leadsMonth.data) leadsBySource[l.source_id || 'none'] = (leadsBySource[l.source_id || 'none'] || 0) + 1;
    const convertedMonth = leadsMonth.data.filter((l) => l.order_id).length;

    const debts = {};
    for (const o of unpaid.data) {
        const due = Number(o.total) - Number(o.paid_amount);
        if (due > 0) debts[o.currency] = round2((debts[o.currency] || 0) + due);
    }
    const staffOwed = round2(staffBalances(staff.data, entries.data, payouts.data).reduce((s, b) => s + Math.max(b.owed, 0), 0));

    const shortlist = active.data.slice(0, 8);
    const clientIds = [...new Set(shortlist.map((o) => o.client_id))];
    const vehicleIds = [...new Set(shortlist.map((o) => o.vehicle_id).filter(Boolean))];
    const names = await Promise.all([
        clientIds.length ? supabase.from('crm_clients').select('id, first_name, last_name').in('id', clientIds) : { data: [], error: null },
        vehicleIds.length ? supabase.from('crm_vehicles').select('id, make, model, plate').in('id', vehicleIds) : { data: [], error: null },
    ]);
    check(names);
    const clientMap = new Map(names[0].data.map((c) => [c.id, c]));
    const vehicleMap = new Map(names[1].data.map((v) => [v.id, v]));

    return {
        dates: { today: day.startDate, week_from: week.startDate, month_from: month.startDate },
        revenue: { today: revenueOf(inRange(day)), week: revenueOf(inRange(week)), month: pnl.revenue },
        issued: { today: inRange(day).length, week: inRange(week).length, month: monthOrders.length },
        cash_in_today: round2(paymentsToday.data.reduce((s, t) => s + t.direction * Number(t.amount_base), 0)),
        month: pnl,
        orders: {
            in_work: active.data.length,
            by_status: statusCounts,
            overdue: overdue.length,
            list: shortlist.map((o) => ({
                ...o,
                client: clientMap.get(o.client_id) || null,
                vehicle: vehicleMap.get(o.vehicle_id) || null,
                is_overdue: !!(o.planned_ready_at && o.planned_ready_at < nowIso),
            })),
        },
        leads: {
            new: leadStatusCounts.new || 0,
            open: leadsOpen.data.length,
            by_status: leadStatusCounts,
            today: leadsMonth.data.filter((l) => l.created_at >= day.from).length,
            month: leadsMonth.data.length,
            converted_month: convertedMonth,
            conversion_month: leadsMonth.data.length ? round2((convertedMonth / leadsMonth.data.length) * 100) : null,
            by_source_month: leadsBySource,
        },
        client_debts: debts,
        staff_owed: staffOwed,
    };
}
