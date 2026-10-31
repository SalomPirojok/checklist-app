import { beforeAll, describe, expect, it } from 'vitest';
import { createCrmOrg, createMigratedDb, one } from './pglite.js';

let db;
let ctx;

beforeAll(async () => {
    db = await createMigratedDb();
    ctx = await createCrmOrg(db);
}, 60000);

async function createOrder({ currency = 'UZS', discount = 0 } = {}) {
    const order = await one(
        db,
        'insert into crm_orders (organization_id, client_id, currency, created_by) values ($1, $2, $3, $4) returning *',
        [ctx.orgId, ctx.clientId, currency, ctx.ownerId]
    );
    if (discount) await db.query('update crm_orders set discount_amount = $1 where id = $2', [discount, order.id]);
    return order;
}

async function addItem(orderId, { category = 'ppf', price, qty = 1, discount = 0, name = 'Услуга' }) {
    return one(
        db,
        `insert into crm_order_items (organization_id, order_id, category_id, name, quantity, unit_price, discount_amount)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [ctx.orgId, orderId, ctx.category[category], name, qty, price, discount]
    );
}

async function addStaff(name, payScheme = 'commission') {
    return one(
        db,
        'insert into crm_staff (organization_id, full_name, pay_scheme) values ($1, $2, $3) returning *',
        [ctx.orgId, name, payScheme]
    );
}

const getOrder = (id) => one(db, 'select * from crm_orders where id = $1', [id]);
const pay = (orderId, account, amount, extra = {}) =>
    one(db, 'select * from crm_record_order_payment($1, $2, $3, $4, $5, $6)', [
        orderId,
        extra.kind || 'payment',
        ctx.account[account],
        amount,
        extra.fxRate ?? null,
        extra.orderFxRate ?? null,
    ]);
const num = (v) => (v === null ? null : Number(v));

describe('CRM schema', () => {
    it('applies all migrations and seeds defaults idempotently', async () => {
        await db.query('select crm_seed_organization($1)', [ctx.orgId]);
        const counts = await one(
            db,
            `select (select count(*) from crm_sources where organization_id = $1) as sources,
                    (select count(*) from crm_service_categories where organization_id = $1) as categories,
                    (select count(*) from crm_accounts where organization_id = $1) as accounts,
                    (select count(*) from crm_roles where organization_id = $1) as roles`,
            [ctx.orgId]
        );
        expect(counts).toEqual({ sources: 8, categories: 11, accounts: 4, roles: 4 });
    });

    it('numbers orders and leads sequentially per organization', async () => {
        const other = await createCrmOrg(db, 'Other business');
        const a = await createOrder();
        const b = await createOrder();
        const c = await one(
            db,
            'insert into crm_orders (organization_id, client_id) values ($1, $2) returning number',
            [other.orgId, other.clientId]
        );
        expect(b.number).toBe(a.number + 1);
        expect(c.number).toBe(1);
    });

    it('rejects a duplicate client phone within one organization', async () => {
        await expect(
            db.query("insert into crm_clients (organization_id, first_name, phone) values ($1, 'Дубль', '+998901234567')", [ctx.orgId])
        ).rejects.toThrow(/crm_clients_phone_uq/);
    });

    it('refuses to link rows across organizations', async () => {
        const other = await createCrmOrg(db, 'Foreign business');
        await expect(
            db.query('insert into crm_orders (organization_id, client_id) values ($1, $2)', [ctx.orgId, other.clientId])
        ).rejects.toThrow(/foreign key/);
    });

    it('records lead status transitions for the funnel', async () => {
        const lead = await one(
            db,
            "insert into crm_leads (organization_id, client_id, channel, created_by) values ($1, $2, 'instagram', $3) returning *",
            [ctx.orgId, ctx.clientId, ctx.ownerId]
        );
        await db.query("update crm_leads set status = 'booked', updated_by = $2 where id = $1", [lead.id, ctx.ownerId]);
        const { rows } = await db.query('select from_status, to_status from crm_lead_events where lead_id = $1 order by created_at', [lead.id]);
        expect(rows).toEqual([
            { from_status: null, to_status: 'new' },
            { from_status: 'new', to_status: 'booked' },
        ]);
    });
});

describe('order totals', () => {
    it('follows its lines, line discounts and the order discount', async () => {
        const order = await createOrder();
        await addItem(order.id, { price: 1000000, qty: 2, discount: 100000 });
        await addItem(order.id, { category: 'polishing', price: 500000 });
        await db.query('update crm_orders set discount_amount = 400000 where id = $1', [order.id]);
        const o = await getOrder(order.id);
        expect(num(o.subtotal)).toBe(2400000);
        expect(num(o.total)).toBe(2000000);
    });

    it('rejects a discount larger than the order', async () => {
        const order = await createOrder();
        await addItem(order.id, { price: 100 });
        await expect(db.query('update crm_orders set discount_amount = 101 where id = $1', [order.id])).rejects.toThrow(/Скидка больше/);
    });

    it('does not let the API write money fields or the issued status directly', async () => {
        const order = await createOrder();
        await expect(db.query('update crm_orders set paid_amount = 5 where id = $1', [order.id])).rejects.toThrow(/maintained by the system/);
        await expect(db.query("update crm_orders set status = 'issued' where id = $1", [order.id])).rejects.toThrow(/crm_issue_order/);
    });
});

describe('payments', () => {
    it('records a partial payment and the remaining debt', async () => {
        const order = await createOrder();
        await addItem(order.id, { price: 1000000 });
        await pay(order.id, 'Наличные UZS', 300000);
        const o = await getOrder(order.id);
        expect(num(o.paid_amount)).toBe(300000);
        expect(num(o.total) - num(o.paid_amount)).toBe(700000);
    });

    it('rejects overpayment', async () => {
        const order = await createOrder();
        await addItem(order.id, { price: 1000 });
        await expect(pay(order.id, 'Наличные UZS', 1001)).rejects.toThrow(/больше остатка/);
    });

    it('converts a USD payment into a UZS order at the given rate', async () => {
        const order = await createOrder();
        await addItem(order.id, { price: 12800000 });
        const tx = await pay(order.id, 'Наличные USD', 500, { fxRate: 12800 });
        expect(num(tx.amount_base)).toBe(6400000);
        expect(num(tx.order_amount)).toBe(6400000);
        expect(num((await getOrder(order.id)).paid_amount)).toBe(6400000);
    });

    it('requires a rate for foreign-currency money', async () => {
        const order = await createOrder();
        await addItem(order.id, { price: 1000000 });
        await expect(pay(order.id, 'Наличные USD', 10)).rejects.toThrow(/Укажите курс/);
    });

    it('settles a USD order paid in UZS, absorbing a one-cent rounding overshoot', async () => {
        const order = await createOrder({ currency: 'USD' });
        await addItem(order.id, { price: 333.33 });
        await pay(order.id, 'Наличные UZS', 4266666, { orderFxRate: 12800 }); // = 333.333 USD
        expect(num((await getOrder(order.id)).paid_amount)).toBe(333.33);
    });

    it('blocks direct inserts of order payments that would bypass paid_amount', async () => {
        const order = await createOrder();
        await expect(
            db.query(
                `insert into crm_transactions (organization_id, type, direction, account_id, amount, currency, fx_rate, order_id, order_amount)
                 values ($1, 'client_payment', 1, $2, 10, 'UZS', 1, $3, 10)`,
                [ctx.orgId, ctx.account['Наличные UZS'], order.id]
            )
        ).rejects.toThrow(/crm_record_order_payment/);
    });

    it('keeps the ledger append-only and undoes a payment by reversal, once', async () => {
        const order = await createOrder();
        await addItem(order.id, { price: 1000 });
        const tx = await pay(order.id, 'Наличные UZS', 600);
        await expect(db.query('update crm_transactions set amount = 1 where id = $1', [tx.id])).rejects.toThrow(/append-only/);
        await expect(db.query('delete from crm_transactions where id = $1', [tx.id])).rejects.toThrow(/append-only/);

        const reversal = await one(db, 'select * from crm_reverse_transaction($1, null, $2)', [tx.id, 'ошибка кассира']);
        expect(reversal.direction).toBe(-1);
        expect(num((await getOrder(order.id)).paid_amount)).toBe(0);
        await expect(one(db, 'select * from crm_reverse_transaction($1)', [tx.id])).rejects.toThrow(/уже сторнирована/);
    });

    it('refunds money and refuses to cancel an order that still holds payments', async () => {
        const order = await createOrder();
        await addItem(order.id, { price: 1000 });
        await pay(order.id, 'Наличные UZS', 400);
        await expect(db.query("update crm_orders set status = 'cancelled' where id = $1", [order.id])).rejects.toThrow(/оформите возврат/);
        await expect(pay(order.id, 'Наличные UZS', 401, { kind: 'refund' })).rejects.toThrow(/Возврат/);
        await pay(order.id, 'Наличные UZS', 400, { kind: 'refund' });
        await db.query("update crm_orders set status = 'cancelled' where id = $1", [order.id]);
        expect((await getOrder(order.id)).status).toBe('cancelled');
    });
});

describe('issuing an order', () => {
    it('recognizes revenue, costs and per-master commissions by the most specific rule', async () => {
        const alisher = await addStaff('Алишер');
        const bekzod = await addStaff('Бекзод');
        const salaried = await addStaff('Окладник', 'salary');

        // Default for PPF: 10% of price; Alisher personally on PPF: 15% of
        // price minus materials; anyone on polishing: fixed 50 000 per line.
        await db.query(
            `insert into crm_commission_rules (organization_id, staff_id, category_id, base, percent, fixed_amount) values
             ($1, null, $2, 'net_price', 10, null),
             ($1, $3, $2, 'net_minus_materials', 15, null),
             ($1, null, $4, 'fixed', null, 50000)`,
            [ctx.orgId, ctx.category.ppf, alisher.id, ctx.category.polishing]
        );

        const order = await createOrder();
        const ppf = await addItem(order.id, { category: 'ppf', price: 10000000, name: 'PPF капот' });
        const polish = await addItem(order.id, { category: 'polishing', price: 2000000, name: 'Полировка' });
        await db.query(
            `insert into crm_order_item_staff (order_item_id, organization_id, staff_id, share_percent) values
             ($1, $4, $2, 60), ($1, $4, $3, 40), ($5, $4, $2, 50), ($5, $4, $6, 50)`,
            [ppf.id, alisher.id, bekzod.id, ctx.orgId, polish.id, salaried.id]
        );
        // Film for the PPF line: 200 USD at 12 800.
        await db.query(
            `insert into crm_order_materials (organization_id, order_id, order_item_id, name, quantity, unit_cost, currency, fx_rate)
             values ($1, $2, $3, 'Плёнка', 1, 200, 'USD', 12800)`,
            [ctx.orgId, order.id, ppf.id]
        );

        const issued = await one(db, 'select * from crm_issue_order($1, null, null, $2)', [order.id, ctx.ownerId]);
        expect(issued.status).toBe('issued');
        expect(num(issued.revenue_base)).toBe(12000000);
        expect(num(issued.materials_cost_base)).toBe(2560000);

        const { rows } = await db.query(
            'select staff_id, amount from crm_payroll_entries where order_id = $1 order by amount desc',
            [order.id]
        );
        const byStaff = (id) => rows.filter((r) => r.staff_id === id).map((r) => num(r.amount));
        // Alisher on PPF: (10 000 000 - 2 560 000) * 15% * 60% = 669 600
        // Alisher on polishing: fixed 50 000 * his 50% share
        expect(byStaff(alisher.id).sort((a, b) => a - b)).toEqual([25000, 669600]);
        // Bekzod on PPF uses the category default: 10 000 000 * 10% * 40%
        expect(byStaff(bekzod.id)).toEqual([400000]);
        // Salary-only staff earn no commission.
        expect(byStaff(salaried.id)).toEqual([]);
        expect(num(issued.labor_cost_base)).toBe(1094600);

        // The order is now frozen.
        await expect(addItem(order.id, { price: 1 })).rejects.toThrow(/нельзя изменять/);
        await expect(db.query('update crm_orders set discount_amount = 1 where id = $1', [order.id])).rejects.toThrow(/нельзя изменять/);

        // Reopening reverses the commissions instead of deleting them.
        await one(db, 'select * from crm_reopen_order($1, $2, $3)', [order.id, ctx.ownerId, 'ошибка']);
        const net = await one(db, 'select sum(amount) as total, count(*) as n from crm_payroll_entries where order_id = $1', [order.id]);
        expect(num(net.total)).toBe(0);
        expect(Number(net.n)).toBe(6);
        const reopened = await getOrder(order.id);
        expect(reopened.status).toBe('ready');
        expect(reopened.revenue_base).toBeNull();
    });

    it('freezes a USD order in base currency at the issue-date rate', async () => {
        const order = await createOrder({ currency: 'USD' });
        await addItem(order.id, { price: 1500 });
        await expect(one(db, 'select * from crm_issue_order($1)', [order.id])).rejects.toThrow(/Укажите курс/);
        const issued = await one(db, 'select * from crm_issue_order($1, $2)', [order.id, 12750]);
        expect(num(issued.revenue_base)).toBe(19125000);
    });

    it('requires master shares on a line to add up to 100%', async () => {
        const master = await addStaff('Мастер');
        const order = await createOrder();
        const line = await addItem(order.id, { price: 1000, name: 'Химчистка' });
        await db.query(
            'insert into crm_order_item_staff (order_item_id, organization_id, staff_id, share_percent) values ($1, $2, $3, 50)',
            [line.id, ctx.orgId, master.id]
        );
        await expect(one(db, 'select * from crm_issue_order($1)', [order.id])).rejects.toThrow(/Химчистка/);
    });

    it('rejects an empty order', async () => {
        const order = await createOrder();
        await expect(one(db, 'select * from crm_issue_order($1)', [order.id])).rejects.toThrow(/нет услуг/);
    });
});
