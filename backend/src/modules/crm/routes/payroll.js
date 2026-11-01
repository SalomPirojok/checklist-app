import { Router } from 'express';
import { supabase } from '../../../lib/supabase.js';
import { localDateString } from '../../../lib/time.js';
import { requirePermission } from '../middleware.js';
import { crmAudit } from '../lib/audit.js';
import { sendDbError } from '../lib/dbErrors.js';
import { getRate } from '../lib/fx.js';
import { cleanText } from '../lib/normalize.js';
import { staffBalances } from '../lib/report.js';

const router = Router();

const canView = requirePermission('payroll.view');
const canManage = requirePermission('payroll.manage');

const RULE_BASES = ['net_price', 'net_minus_materials', 'fixed'];
// Manual accruals; commissions come only from issuing orders.
const MANUAL_KINDS = ['salary', 'bonus', 'deduction', 'adjustment'];
const RULE_FIELDS = 'id, staff_id, category_id, base, percent, fixed_amount, is_active, updated_at';
const ENTRY_FIELDS = 'id, staff_id, kind, amount, order_id, order_item_id, period_month, details, reversal_of, note, created_by, created_at';
const MONTH = /^\d{4}-\d{2}$/;

function parseRule(body, { partial }) {
    const out = {};
    if (body.base !== undefined || !partial) {
        if (!RULE_BASES.includes(body.base)) throw new Error('Выберите, от чего считать');
        out.base = body.base;
    }
    if (body.percent !== undefined) {
        if (body.percent === null || body.percent === '') out.percent = null;
        else {
            const p = Number(body.percent);
            if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('Процент должен быть от 0 до 100');
            out.percent = p;
        }
    }
    if (body.fixed_amount !== undefined) {
        if (body.fixed_amount === null || body.fixed_amount === '') out.fixed_amount = null;
        else {
            const f = Number(body.fixed_amount);
            if (!Number.isFinite(f) || f < 0) throw new Error('Неверная сумма');
            out.fixed_amount = f;
        }
    }
    if (body.is_active !== undefined) out.is_active = !!body.is_active;
    // Keep only the field the chosen base uses.
    if (out.base === 'fixed') out.percent = null;
    else if (out.base) out.fixed_amount = null;
    return out;
}

// ---------------------------------------------------------------------------
// Commission rules
// ---------------------------------------------------------------------------

router.get('/rules', canView, async (req, res) => {
    const { data, error } = await supabase
        .from('crm_commission_rules')
        .select(RULE_FIELDS)
        .eq('organization_id', req.user.organizationId)
        .order('created_at');
    if (error) return sendDbError(res, error);
    res.json({ rules: data });
});

router.post('/rules', canManage, async (req, res) => {
    let rule;
    try {
        rule = parseRule(req.body || {}, { partial: false });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const { data, error } = await supabase
        .from('crm_commission_rules')
        .insert({
            ...rule,
            organization_id: req.user.organizationId,
            staff_id: req.body.staff_id || null,
            category_id: req.body.category_id || null,
        })
        .select(RULE_FIELDS)
        .single();
    if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Для этого мастера и категории правило уже есть — измените его' });
        return sendDbError(res, error, 'Не удалось сохранить правило');
    }
    await crmAudit(req, 'crm.commission_rule.create', 'crm_commission_rule', data.id, null, data);
    res.status(201).json({ rule: data });
});

// Editing a rule affects only orders issued afterwards: every accrual keeps
// a snapshot of the rule it was computed with.
router.patch('/rules/:id', canManage, async (req, res) => {
    let updates;
    try {
        updates = parseRule(req.body || {}, { partial: true });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const { data: before, error: beforeError } = await supabase
        .from('crm_commission_rules')
        .select(RULE_FIELDS)
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (beforeError) return sendDbError(res, beforeError);
    if (!before) return res.status(404).json({ error: 'Правило не найдено' });

    const { data, error } = await supabase.from('crm_commission_rules').update(updates).eq('id', before.id).select(RULE_FIELDS).single();
    if (error) return sendDbError(res, error, 'Не удалось сохранить правило');
    await crmAudit(req, 'crm.commission_rule.update', 'crm_commission_rule', data.id, before, data);
    res.json({ rule: data });
});

router.delete('/rules/:id', canManage, async (req, res) => {
    const { data: before, error: beforeError } = await supabase
        .from('crm_commission_rules')
        .select(RULE_FIELDS)
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (beforeError) return sendDbError(res, beforeError);
    if (!before) return res.status(404).json({ error: 'Правило не найдено' });
    const { error } = await supabase.from('crm_commission_rules').delete().eq('id', before.id);
    if (error) return sendDbError(res, error);
    await crmAudit(req, 'crm.commission_rule.delete', 'crm_commission_rule', before.id, before, null);
    res.status(204).end();
});

// ---------------------------------------------------------------------------
// Balances and per-person ledger
// ---------------------------------------------------------------------------

router.get('/summary', canView, async (req, res) => {
    const orgId = req.user.organizationId;
    const [staff, entries, payouts] = await Promise.all([
        supabase.from('crm_staff').select('id, full_name, position, pay_scheme, base_salary, is_active').eq('organization_id', orgId).order('full_name'),
        supabase.from('crm_payroll_entries').select('staff_id, amount').eq('organization_id', orgId),
        supabase.from('crm_transactions').select('staff_id, direction, amount_base').eq('organization_id', orgId).eq('type', 'payroll_payout'),
    ]);
    const failed = [staff, entries, payouts].find((r) => r.error);
    if (failed) return sendDbError(res, failed.error);

    const balances = new Map(staffBalances(staff.data, entries.data, payouts.data).map((b) => [b.staff_id, b]));
    const rows = staff.data
        .map((s) => ({ ...s, ...balances.get(s.id) }))
        // Former staff disappear once settled.
        .filter((s) => s.is_active || s.owed !== 0);
    res.json({
        staff: rows,
        total_owed: Math.round(rows.reduce((sum, s) => sum + Math.max(s.owed, 0), 0) * 100) / 100,
    });
});

router.get('/staff/:staffId', canView, async (req, res) => {
    const orgId = req.user.organizationId;
    const { data: person, error } = await supabase
        .from('crm_staff')
        .select('id, full_name, position, pay_scheme, base_salary, is_active')
        .eq('id', req.params.staffId)
        .eq('organization_id', orgId)
        .maybeSingle();
    if (error) return sendDbError(res, error);
    if (!person) return res.status(404).json({ error: 'Сотрудник не найден' });

    const [entries, payouts] = await Promise.all([
        supabase.from('crm_payroll_entries').select(ENTRY_FIELDS).eq('staff_id', person.id).order('created_at', { ascending: false }),
        supabase
            .from('crm_transactions')
            .select('id, direction, account_id, amount, currency, fx_rate, amount_base, occurred_at, reversal_of, note, created_by')
            .eq('organization_id', orgId)
            .eq('type', 'payroll_payout')
            .eq('staff_id', person.id)
            .order('occurred_at', { ascending: false }),
    ]);
    if (entries.error || payouts.error) return sendDbError(res, entries.error || payouts.error);

    const [balance] = staffBalances([person], entries.data, payouts.data);
    const reversedEntries = new Set(entries.data.filter((e) => e.reversal_of).map((e) => e.reversal_of));
    const reversedPayouts = new Set(payouts.data.filter((p) => p.reversal_of).map((p) => p.reversal_of));
    res.json({
        staff: person,
        balance,
        entries: entries.data.map((e) => ({ ...e, is_reversed: reversedEntries.has(e.id) })),
        payouts: payouts.data.map((p) => ({ ...p, is_reversed: reversedPayouts.has(p.id) })),
    });
});

// ---------------------------------------------------------------------------
// Manual accruals: salary, bonus, deduction, adjustment
// ---------------------------------------------------------------------------

router.post('/entries', canManage, async (req, res) => {
    const orgId = req.user.organizationId;
    const body = req.body || {};
    let entry;
    try {
        if (!MANUAL_KINDS.includes(body.kind)) throw new Error('Неверный тип начисления');
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Укажите сумму больше нуля');
        if (body.period_month && !MONTH.test(body.period_month)) throw new Error('Неверный месяц');
        entry = {
            organization_id: orgId,
            staff_id: body.staff_id,
            kind: body.kind,
            // Deductions reduce what is owed; an adjustment can go either way.
            amount: Math.round((body.kind === 'deduction' || (body.kind === 'adjustment' && body.negative) ? -amount : amount) * 100) / 100,
            period_month: body.period_month ? `${body.period_month}-01` : null,
            note: cleanText(body.note, 500),
            created_by: req.user.id,
        };
        if (!entry.staff_id) throw new Error('Выберите сотрудника');
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const { data, error } = await supabase.from('crm_payroll_entries').insert(entry).select(ENTRY_FIELDS).single();
    if (error) return sendDbError(res, error, 'Не удалось сохранить начисление');
    await crmAudit(req, 'crm.payroll.entry', 'crm_payroll_entry', data.id, null, data);
    res.status(201).json({ entry: data });
});

// Monthly fixed salaries for everyone on a salary scheme. Idempotent: a
// person already accrued a salary for that month is skipped.
router.post('/salaries', canManage, async (req, res) => {
    const orgId = req.user.organizationId;
    const month = req.body?.period_month;
    if (!MONTH.test(month || '')) return res.status(400).json({ error: 'Укажите месяц' });
    const periodMonth = `${month}-01`;

    const [staff, existing] = await Promise.all([
        supabase
            .from('crm_staff')
            .select('id, full_name, base_salary')
            .eq('organization_id', orgId)
            .eq('is_active', true)
            .in('pay_scheme', ['salary', 'salary_plus_commission'])
            .gt('base_salary', 0),
        supabase
            .from('crm_payroll_entries')
            .select('staff_id, reversal_of')
            .eq('organization_id', orgId)
            .eq('kind', 'salary')
            .eq('period_month', periodMonth),
    ]);
    if (staff.error || existing.error) return sendDbError(res, staff.error || existing.error);

    // Count net salary entries per person (a reversed accrual doesn't count).
    const net = new Map();
    for (const e of existing.data) net.set(e.staff_id, (net.get(e.staff_id) || 0) + (e.reversal_of ? -1 : 1));
    const rows = staff.data
        .filter((s) => !(net.get(s.id) > 0))
        .map((s) => ({
            organization_id: orgId,
            staff_id: s.id,
            kind: 'salary',
            amount: Number(s.base_salary),
            period_month: periodMonth,
            note: `Оклад за ${month}`,
            created_by: req.user.id,
        }));
    if (!rows.length) return res.json({ created: 0, skipped: staff.data.length });

    const { error } = await supabase.from('crm_payroll_entries').insert(rows);
    if (error) return sendDbError(res, error, 'Не удалось начислить оклады');
    await crmAudit(req, 'crm.payroll.salaries', 'crm_payroll_entry', null, null, { period_month: periodMonth, count: rows.length });
    res.status(201).json({ created: rows.length, skipped: staff.data.length - rows.length });
});

router.post('/entries/:id/reverse', canManage, async (req, res) => {
    const reason = cleanText(req.body?.reason, 500);
    if (!reason) return res.status(400).json({ error: 'Укажите причину' });
    const { data: entry, error } = await supabase
        .from('crm_payroll_entries')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (error) return sendDbError(res, error);
    if (!entry) return res.status(404).json({ error: 'Начисление не найдено' });
    if (entry.reversal_of) return res.status(400).json({ error: 'Сторно нельзя сторнировать' });
    // Commissions follow their order: reopen the order instead.
    if (entry.kind === 'commission') return res.status(400).json({ error: 'Процент за заказ отменяется возвратом заказа в работу' });

    const { data, error: insertError } = await supabase
        .from('crm_payroll_entries')
        .insert({
            organization_id: entry.organization_id,
            staff_id: entry.staff_id,
            kind: entry.kind,
            amount: -Number(entry.amount),
            period_month: entry.period_month,
            details: entry.details,
            reversal_of: entry.id,
            note: reason,
            created_by: req.user.id,
        })
        .select(ENTRY_FIELDS)
        .single();
    if (insertError) {
        if (insertError.code === '23505') return res.status(409).json({ error: 'Начисление уже сторнировано' });
        return sendDbError(res, insertError);
    }
    await crmAudit(req, 'crm.payroll.reverse', 'crm_payroll_entry', entry.id, entry, data);
    res.status(201).json({ entry: data });
});

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

router.post('/payouts', canManage, async (req, res) => {
    const orgId = req.user.organizationId;
    const body = req.body || {};
    let row;
    try {
        if (!body.staff_id) throw new Error('Выберите сотрудника');
        const { data: account, error } = await supabase
            .from('crm_accounts')
            .select('id, name, currency, is_archived')
            .eq('id', body.account_id || '00000000-0000-0000-0000-000000000000')
            .eq('organization_id', orgId)
            .maybeSingle();
        if (error) throw new Error('Не удалось загрузить кассу');
        if (!account || account.is_archived) throw new Error('Выберите кассу');
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Укажите сумму больше нуля');
        let fxRate = 1;
        if (account.currency !== 'UZS') {
            if (body.fx_rate) fxRate = Number(body.fx_rate);
            else {
                const found = await getRate(account.currency, localDateString(new Date(), 'Asia/Tashkent'));
                if (!found) throw new Error(`Не удалось получить курс ${account.currency} — укажите его вручную`);
                fxRate = found.rate;
            }
            if (!Number.isFinite(fxRate) || fxRate <= 0) throw new Error('Неверный курс');
        }
        row = {
            organization_id: orgId,
            type: 'payroll_payout',
            direction: -1,
            account_id: account.id,
            amount: Math.round(amount * 100) / 100,
            currency: account.currency,
            fx_rate: fxRate,
            occurred_at: body.occurred_at ? new Date(body.occurred_at).toISOString() : new Date().toISOString(),
            staff_id: body.staff_id,
            note: cleanText(body.note, 500),
            created_by: req.user.id,
        };
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const { data, error } = await supabase.from('crm_transactions').insert(row).select().single();
    if (error) return sendDbError(res, error, 'Не удалось провести выплату');
    await crmAudit(req, 'crm.payroll.payout', 'crm_transaction', data.id, null, data);
    res.status(201).json({ transaction: data });
});

router.post('/payouts/:id/reverse', canManage, async (req, res) => {
    const reason = cleanText(req.body?.reason, 500);
    if (!reason) return res.status(400).json({ error: 'Укажите причину' });
    const { data: tx, error } = await supabase
        .from('crm_transactions')
        .select('id')
        .eq('id', req.params.id)
        .eq('type', 'payroll_payout')
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (error) return sendDbError(res, error);
    if (!tx) return res.status(404).json({ error: 'Выплата не найдена' });
    const { data, error: rpcError } = await supabase.rpc('crm_reverse_transaction', { p_transaction_id: tx.id, p_actor: req.user.id, p_reason: reason });
    if (rpcError) return sendDbError(res, rpcError, 'Не удалось сторнировать выплату');
    await crmAudit(req, 'crm.payroll.payout.reverse', 'crm_transaction', tx.id, null, data);
    res.status(201).json({ transaction: data });
});

export default router;
