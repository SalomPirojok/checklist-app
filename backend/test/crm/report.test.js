import { describe, expect, it } from 'vitest';
import { cashFlow, categoryBreakdown, profitAndLoss, staffBalances } from '../../src/modules/crm/lib/report.js';

// One issued UZS order: PPF 10 000 000 + polishing 2 000 000, order discount
// 1 200 000; film 2 560 000 linked to PPF, 120 000 of unlinked consumables.
const order = {
    id: 'o1',
    subtotal: '12000000',
    discount_amount: '1200000',
    total: '10800000',
    fx_rate_at_issue: '1',
    revenue_base: '10800000',
    materials_cost_base: '2680000',
    labor_cost_base: '1300000',
};
const items = [
    { id: 'i1', order_id: 'o1', category_id: 'ppf', total: '10000000' },
    { id: 'i2', order_id: 'o1', category_id: 'polish', total: '2000000' },
];
const materials = [
    { order_id: 'o1', order_item_id: 'i1', total_cost_base: '2560000' },
    { order_id: 'o1', order_item_id: null, total_cost_base: '120000' },
];
const commissions = [
    { order_item_id: 'i1', amount: '1100000' },
    { order_item_id: 'i2', amount: '200000' },
];

describe('categoryBreakdown', () => {
    const rows = categoryBreakdown([order], items, materials, commissions);
    const ppf = rows.find((r) => r.category_id === 'ppf');
    const polish = rows.find((r) => r.category_id === 'polish');

    it('spreads the order discount and unlinked materials by line share', () => {
        expect(ppf.revenue).toBe(9000000);
        expect(polish.revenue).toBe(1800000);
        expect(ppf.materials).toBe(2660000);
        expect(polish.materials).toBe(20000);
    });

    it('assigns commissions to their line category and computes gross profit', () => {
        expect(ppf.labor).toBe(1100000);
        expect(ppf.gross_profit).toBe(9000000 - 2660000 - 1100000);
    });

    it('adds up exactly to the order totals', () => {
        const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
        expect(sum('revenue')).toBe(10800000);
        expect(sum('materials')).toBe(2680000);
        expect(sum('labor')).toBe(1300000);
    });

    it('converts USD orders with the issue-day rate', () => {
        const usd = { ...order, id: 'o2', subtotal: '100', discount_amount: '0', fx_rate_at_issue: '12800', revenue_base: '1280000', materials_cost_base: '0' };
        const [row] = categoryBreakdown([usd], [{ id: 'i3', order_id: 'o2', category_id: 'ppf', total: '100' }], [], []);
        expect(row.revenue).toBe(1280000);
    });
});

describe('profitAndLoss', () => {
    const expenses = [
        { type: 'expense', direction: -1, amount_base: '5000000', category_kind: 'opex' }, // rent
        { type: 'expense', direction: -1, amount_base: '1000000', category_kind: 'marketing' },
        { type: 'expense', direction: -1, amount_base: '3000000', category_kind: 'materials' }, // stock purchase
        { type: 'expense', direction: -1, amount_base: '200000', category_kind: 'opex' },
        { type: 'expense', direction: 1, amount_base: '200000', category_kind: 'opex' }, // reversal of the above
    ];
    const pnl = profitAndLoss({ orders: [order], expenses, payrollEntries: [{ amount: '2000000' }] });

    it('separates revenue, cost of sales and gross profit', () => {
        expect(pnl.revenue).toBe(10800000);
        expect(pnl.cost_materials).toBe(2680000);
        expect(pnl.cost_labor).toBe(1300000);
        expect(pnl.gross_profit).toBe(6820000);
        expect(pnl.average_check).toBe(10800000);
    });

    it('nets reversals and keeps stock purchases out of profit', () => {
        expect(pnl.expenses_opex).toBe(5000000);
        expect(pnl.expenses_marketing).toBe(1000000);
        expect(pnl.material_purchases).toBe(3000000);
        expect(pnl.operating_profit).toBe(6820000 - 5000000 - 1000000 - 2000000);
    });

    it('handles an empty period', () => {
        const empty = profitAndLoss({ orders: [], expenses: [], payrollEntries: [] });
        expect(empty.revenue).toBe(0);
        expect(empty.average_check).toBe(0);
        expect(empty.gross_margin).toBe(0);
    });
});

describe('cashFlow', () => {
    it('counts real money movement and ignores transfers between own accounts', () => {
        const flow = cashFlow([
            { type: 'client_payment', direction: 1, amount_base: '3000000' },
            { type: 'client_refund', direction: -1, amount_base: '500000' },
            { type: 'expense', direction: -1, amount_base: '1000000' },
            { type: 'payroll_payout', direction: -1, amount_base: '700000' },
            { type: 'transfer_out', direction: -1, amount_base: '1280000' },
            { type: 'transfer_in', direction: 1, amount_base: '1280000' },
        ]);
        expect(flow).toEqual({
            inflow: 3000000,
            outflow: 2200000,
            net: 800000,
            by_type: { client_payment: 3000000, client_refund: -500000, expense: -1000000, payroll_payout: -700000 },
        });
    });
});

describe('staffBalances', () => {
    it('owed = accrued - paid, reversals included', () => {
        const [b] = staffBalances(
            [{ id: 's1' }],
            [{ staff_id: 's1', amount: '1000000' }, { staff_id: 's1', amount: '-100000' }],
            [
                { staff_id: 's1', direction: -1, amount_base: '600000' },
                { staff_id: 's1', direction: -1, amount_base: '50000' },
                { staff_id: 's1', direction: 1, amount_base: '50000' },
            ]
        );
        expect(b).toEqual({ staff_id: 's1', accrued: 900000, paid: 600000, owed: 300000 });
    });
});
