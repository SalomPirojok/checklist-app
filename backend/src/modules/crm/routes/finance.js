import crypto from 'node:crypto';
import { Router } from 'express';
import { supabase } from '../../../lib/supabase.js';
import { requirePermission } from '../middleware.js';
import { crmAudit } from '../lib/audit.js';
import { sendDbError } from '../lib/dbErrors.js';
import { getRate } from '../lib/fx.js';
import { cleanText } from '../lib/normalize.js';
import { resolvePeriod } from '../lib/period.js';
import { cashFlow, categoryBreakdown, profitAndLoss } from '../lib/report.js';
import { localDateString } from '../../../lib/time.js';

const router = Router();

const canView = requirePermission('finance.view');
const canManage = requirePermission('finance.manage');

const ACCOUNT_KINDS = ['cash', 'bank_transfer', 'card', 'other'];
const EXPENSE_KINDS = ['opex', 'marketing', 'materials'];
const CURRENCIES = ['UZS', 'USD'];
const TX_FIELDS = 'id, type, direction, account_id, amount, currency, fx_rate, amount_base, occurred_at, order_id, order_amount, client_id, staff_id, category_id, campaign_id, transfer_group_id, reversal_of, note, created_by, created_at';

function positive(value, field) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Неверное значение: ${field}`);
    return Math.round(n * 100) / 100;
}

function isoOrNow(value) {
    if (!value) return new Date().toISOString();
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new Error('Неверная дата');
    return d.toISOString();
}

async function accountOf(orgId, accountId) {
    const { data, error } = await supabase
        .from('crm_accounts')
        .select('id, name, currency, is_archived')
        .eq('id', accountId || '00000000-0000-0000-0000-000000000000')
        .eq('organization_id', orgId)
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Выберите кассу');
    if (data.is_archived) throw new Error(`Касса «${data.name}» в архиве`);
    return data;
}

async function rateFor(currency, given) {
    if (currency === 'UZS') return 1;
    if (given !== undefined && given !== null && given !== '') return positive(given, 'курс');
    const found = await getRate(currency, localDateString(new Date(), 'Asia/Tashkent'));
    if (!found) throw new Error(`Не удалось получить курс ${currency} — укажите его вручную`);
    return found.rate;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

router.get('/report', canView, async (req, res) => {
    const orgId = req.user.organizationId;
    let period;
    try {
        period = await resolvePeriod(req);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    const [orders, expenses, payroll, transactions, categories, openOrders, issuedAll] = await Promise.all([
        supabase
            .from('crm_orders')
            .select('id, subtotal, discount_amount, total, fx_rate_at_issue, revenue_base, materials_cost_base, labor_cost_base')
            .eq('organization_id', orgId)
            .eq('status', 'issued')
            .gte('issued_at', period.from)
            .lt('issued_at', period.to),
        supabase
            .from('crm_transactions')
            .select('direction, amount_base, category_id, campaign_id')
            .eq('organization_id', orgId)
            .eq('type', 'expense')
            .gte('occurred_at', period.from)
            .lt('occurred_at', period.to),
        supabase
            .from('crm_payroll_entries')
            .select('amount')
            .eq('organization_id', orgId)
            .neq('kind', 'commission')
            .gte('created_at', period.from)
            .lt('created_at', period.to),
        supabase
            .from('crm_transactions')
            .select('type, direction, amount_base')
            .eq('organization_id', orgId)
            .gte('occurred_at', period.from)
            .lt('occurred_at', period.to),
        supabase.from('crm_expense_categories').select('id, name, kind').eq('organization_id', orgId),
        // Advances: money already taken for cars not yet issued.
        supabase
            .from('crm_orders')
            .select('currency, paid_amount')
            .eq('organization_id', orgId)
            .in('status', ['pending', 'accepted', 'in_progress', 'waiting_parts', 'quality_check', 'ready'])
            .gt('paid_amount', 0),
        // Client debts: issued orders not fully paid (all time).
        supabase
            .from('crm_orders')
            .select('id, number, client_id, currency, total, paid_amount, issued_at')
            .eq('organization_id', orgId)
            .eq('status', 'issued'),
    ]);
    const failed = [orders, expenses, payroll, transactions, categories, openOrders, issuedAll].find((r) => r.error);
    if (failed) return sendDbError(res, failed.error, 'Не удалось построить отчёт');

    const orderIds = orders.data.map((o) => o.id);
    const [items, materials, commissions] = orderIds.length
        ? await Promise.all([
              supabase.from('crm_order_items').select('id, order_id, category_id, total').in('order_id', orderIds),
              supabase.from('crm_order_materials').select('order_id, order_item_id, total_cost_base').in('order_id', orderIds),
              supabase.from('crm_payroll_entries').select('order_item_id, amount').eq('kind', 'commission').in('order_id', orderIds),
          ])
        : [{ data: [] }, { data: [] }, { data: [] }];
    const failedLines = [items, materials, commissions].find((r) => r.error);
    if (failedLines) return sendDbError(res, failedLines.error, 'Не удалось построить отчёт');

    const categoryMap = new Map(categories.data.map((c) => [c.id, c]));
    const expenseRows = expenses.data.map((e) => ({ ...e, category_kind: categoryMap.get(e.category_id)?.kind }));

    const expensesByCategory = {};
    for (const e of expenseRows) {
        const amount = -e.direction * Number(e.amount_base);
        expensesByCategory[e.category_id] = Math.round(((expensesByCategory[e.category_id] || 0) + amount) * 100) / 100;
    }

    const debts = issuedAll.data
        .map((o) => ({ ...o, due: Math.round((Number(o.total) - Number(o.paid_amount)) * 100) / 100 }))
        .filter((o) => o.due > 0)
        .sort((a, b) => (a.issued_at < b.issued_at ? -1 : 1));
    const debtClientIds = [...new Set(debts.map((d) => d.client_id))];
    const { data: debtClients, error: debtClientsError } = debtClientIds.length
        ? await supabase.from('crm_clients').select('id, first_name, last_name, phone').in('id', debtClientIds)
        : { data: [], error: null };
    if (debtClientsError) return sendDbError(res, debtClientsError);
    const clientMap = new Map(debtClients.map((c) => [c.id, c]));

    const sumByCurrency = (rows, field) => {
        const out = {};
        for (const r of rows) out[r.currency] = Math.round(((out[r.currency] || 0) + Number(r[field])) * 100) / 100;
        return out;
    };

    res.json({
        period: { from: period.startDate, to: period.endDate, timezone: period.tz },
        profit: profitAndLoss({ orders: orders.data, expenses: expenseRows, payrollEntries: payroll.data }),
        by_category: categoryBreakdown(orders.data, items.data, materials.data, commissions.data),
        expenses_by_category: Object.entries(expensesByCategory)
            .map(([id, amount]) => ({ category_id: id, name: categoryMap.get(id)?.name, kind: categoryMap.get(id)?.kind, amount }))
            .sort((a, b) => b.amount - a.amount),
        cash_flow: cashFlow(transactions.data),
        advances: sumByCurrency(openOrders.data, 'paid_amount'),
        client_debts: {
            total: sumByCurrency(debts, 'due'),
            orders: debts.map((d) => ({ ...d, client: clientMap.get(d.client_id) || null })),
        },
    });
});

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

router.get('/accounts', canView, async (req, res) => {
    const orgId = req.user.organizationId;
    const [accounts, txs] = await Promise.all([
        supabase.from('crm_accounts').select('id, name, kind, currency, is_archived').eq('organization_id', orgId).order('created_at'),
        supabase.from('crm_transactions').select('account_id, direction, amount').eq('organization_id', orgId),
    ]);
    if (accounts.error || txs.error) return sendDbError(res, accounts.error || txs.error);
    const balance = new Map();
    for (const tx of txs.data) balance.set(tx.account_id, (balance.get(tx.account_id) || 0) + tx.direction * Number(tx.amount));
    res.json({
        accounts: accounts.data.map((a) => ({ ...a, balance: Math.round((balance.get(a.id) || 0) * 100) / 100 })),
    });
});

router.post('/accounts', canManage, async (req, res) => {
    const body = req.body || {};
    const name = cleanText(body.name, 60);
    if (!name) return res.status(400).json({ error: 'Укажите название кассы' });
    if (!ACCOUNT_KINDS.includes(body.kind)) return res.status(400).json({ error: 'Неверный тип кассы' });
    if (!CURRENCIES.includes(body.currency)) return res.status(400).json({ error: 'Неверная валюта' });
    const { data, error } = await supabase
        .from('crm_accounts')
        .insert({ organization_id: req.user.organizationId, name, kind: body.kind, currency: body.currency })
        .select()
        .single();
    if (error) return sendDbError(res, error, 'Не удалось создать кассу');
    await crmAudit(req, 'crm.account.create', 'crm_account', data.id, null, data);
    res.status(201).json({ account: data });
});

// Rename or archive; currency never changes once money went through it.
router.patch('/accounts/:id', canManage, async (req, res) => {
    const updates = {};
    if (req.body?.name !== undefined) {
        updates.name = cleanText(req.body.name, 60);
        if (!updates.name) return res.status(400).json({ error: 'Укажите название кассы' });
    }
    if (req.body?.is_archived !== undefined) updates.is_archived = !!req.body.is_archived;
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Нет полей для изменения' });
    const { data, error } = await supabase
        .from('crm_accounts')
        .update(updates)
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .select()
        .maybeSingle();
    if (error) return sendDbError(res, error, 'Не удалось сохранить кассу');
    if (!data) return res.status(404).json({ error: 'Касса не найдена' });
    await crmAudit(req, 'crm.account.update', 'crm_account', data.id, null, updates);
    res.json({ account: data });
});

// ---------------------------------------------------------------------------
// Expense categories
// ---------------------------------------------------------------------------

router.get('/expense-categories', requirePermission('finance.view', 'finance.manage'), async (req, res) => {
    const { data, error } = await supabase
        .from('crm_expense_categories')
        .select('id, key, name, kind, is_archived')
        .eq('organization_id', req.user.organizationId)
        .order('created_at');
    if (error) return sendDbError(res, error);
    res.json({ categories: data });
});

router.post('/expense-categories', canManage, async (req, res) => {
    const name = cleanText(req.body?.name, 60);
    if (!name) return res.status(400).json({ error: 'Укажите название' });
    if (!EXPENSE_KINDS.includes(req.body?.kind)) return res.status(400).json({ error: 'Неверный тип расхода' });
    const { data, error } = await supabase
        .from('crm_expense_categories')
        .insert({ organization_id: req.user.organizationId, name, kind: req.body.kind })
        .select()
        .single();
    if (error) return sendDbError(res, error, 'Не удалось создать категорию');
    res.status(201).json({ category: data });
});

router.patch('/expense-categories/:id', canManage, async (req, res) => {
    const updates = {};
    if (req.body?.name !== undefined) {
        updates.name = cleanText(req.body.name, 60);
        if (!updates.name) return res.status(400).json({ error: 'Укажите название' });
    }
    if (req.body?.is_archived !== undefined) updates.is_archived = !!req.body.is_archived;
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Нет полей для изменения' });
    const { data, error } = await supabase
        .from('crm_expense_categories')
        .update(updates)
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .select()
        .maybeSingle();
    if (error) return sendDbError(res, error);
    if (!data) return res.status(404).json({ error: 'Категория не найдена' });
    res.json({ category: data });
});

// ---------------------------------------------------------------------------
// Money operations (each is a single INSERT statement = atomic)
// ---------------------------------------------------------------------------

router.post('/expenses', canManage, async (req, res) => {
    const orgId = req.user.organizationId;
    const body = req.body || {};
    let row;
    try {
        const account = await accountOf(orgId, body.account_id);
        if (!body.category_id) throw new Error('Выберите категорию расхода');
        row = {
            organization_id: orgId,
            type: 'expense',
            direction: -1,
            account_id: account.id,
            amount: positive(body.amount, 'сумма'),
            currency: account.currency,
            fx_rate: await rateFor(account.currency, body.fx_rate),
            occurred_at: isoOrNow(body.occurred_at),
            category_id: body.category_id,
            campaign_id: body.campaign_id || null,
            note: cleanText(body.note, 500),
            created_by: req.user.id,
        };
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const { data, error } = await supabase.from('crm_transactions').insert(row).select(TX_FIELDS).single();
    if (error) return sendDbError(res, error, 'Не удалось провести расход');
    await crmAudit(req, 'crm.expense.create', 'crm_transaction', data.id, null, data);
    res.status(201).json({ transaction: data });
});

router.post('/income', canManage, async (req, res) => {
    const orgId = req.user.organizationId;
    const body = req.body || {};
    let row;
    try {
        const account = await accountOf(orgId, body.account_id);
        const note = cleanText(body.note, 500);
        if (!note) throw new Error('Укажите, что это за поступление');
        row = {
            organization_id: orgId,
            type: 'other_income',
            direction: 1,
            account_id: account.id,
            amount: positive(body.amount, 'сумма'),
            currency: account.currency,
            fx_rate: await rateFor(account.currency, body.fx_rate),
            occurred_at: isoOrNow(body.occurred_at),
            note,
            created_by: req.user.id,
        };
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const { data, error } = await supabase.from('crm_transactions').insert(row).select(TX_FIELDS).single();
    if (error) return sendDbError(res, error, 'Не удалось провести поступление');
    await crmAudit(req, 'crm.income.create', 'crm_transaction', data.id, null, data);
    res.status(201).json({ transaction: data });
});

// Between own accounts, incl. currency exchange (e.g. 500 USD -> 6 400 000 UZS).
router.post('/transfers', canManage, async (req, res) => {
    const orgId = req.user.organizationId;
    const body = req.body || {};
    let rows;
    try {
        const from = await accountOf(orgId, body.from_account_id);
        const to = await accountOf(orgId, body.to_account_id);
        if (from.id === to.id) throw new Error('Выберите разные кассы');
        const amountFrom = positive(body.amount_from, 'сумма списания');
        const amountTo = from.currency === to.currency ? amountFrom : positive(body.amount_to, 'сумма зачисления');
        const group = crypto.randomUUID();
        const occurredAt = isoOrNow(body.occurred_at);
        const note = cleanText(body.note, 500);
        const base = { organization_id: orgId, transfer_group_id: group, occurred_at: occurredAt, note, created_by: req.user.id };
        rows = [
            { ...base, type: 'transfer_out', direction: -1, account_id: from.id, amount: amountFrom, currency: from.currency, fx_rate: await rateFor(from.currency, body.from_fx_rate) },
            { ...base, type: 'transfer_in', direction: 1, account_id: to.id, amount: amountTo, currency: to.currency, fx_rate: await rateFor(to.currency, body.to_fx_rate) },
        ];
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const { data, error } = await supabase.from('crm_transactions').insert(rows).select(TX_FIELDS);
    if (error) return sendDbError(res, error, 'Не удалось провести перевод');
    await crmAudit(req, 'crm.transfer.create', 'crm_transaction', data[0].id, null, data);
    res.status(201).json({ transactions: data });
});

router.get('/transactions', canView, async (req, res) => {
    const orgId = req.user.organizationId;
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    let period;
    try {
        period = await resolvePeriod(req);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    let query = supabase
        .from('crm_transactions')
        .select(TX_FIELDS, { count: 'exact' })
        .eq('organization_id', orgId)
        .gte('occurred_at', period.from)
        .lt('occurred_at', period.to)
        .order('occurred_at', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + 99);
    if (req.query.type) query = query.in('type', String(req.query.type).split(','));
    if (req.query.account_id) query = query.eq('account_id', req.query.account_id);
    const { data, error, count } = await query;
    if (error) return sendDbError(res, error, 'Не удалось загрузить операции');

    // Which of these were reversed later (the reversal may be outside the period).
    const ids = data.map((t) => t.id);
    const { data: reversals, error: revError } = ids.length
        ? await supabase.from('crm_transactions').select('reversal_of').in('reversal_of', ids)
        : { data: [], error: null };
    if (revError) return sendDbError(res, revError);
    const reversed = new Set(reversals.map((r) => r.reversal_of));

    res.json({
        period: { from: period.startDate, to: period.endDate },
        transactions: data.map((t) => ({ ...t, is_reversed: reversed.has(t.id) })),
        total: count,
    });
});

router.post('/transactions/:id/reverse', canManage, async (req, res) => {
    const reason = cleanText(req.body?.reason, 500);
    if (!reason) return res.status(400).json({ error: 'Укажите причину сторно' });
    const { data: tx, error: txError } = await supabase
        .from('crm_transactions')
        .select('id')
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (txError) return sendDbError(res, txError);
    if (!tx) return res.status(404).json({ error: 'Операция не найдена' });

    const { data, error } = await supabase.rpc('crm_reverse_transaction', { p_transaction_id: tx.id, p_actor: req.user.id, p_reason: reason });
    if (error) return sendDbError(res, error, 'Не удалось сторнировать операцию');
    await crmAudit(req, 'crm.transaction.reverse', 'crm_transaction', tx.id, null, data);
    res.status(201).json({ transaction: data });
});

export default router;
