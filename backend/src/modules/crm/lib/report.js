// Pure calculations behind the finance report. Everything is in the
// organization's base currency (UZS). Kept free of database calls so the
// money logic is unit-tested directly.
//
// Two separate views, never mixed:
// * profit (accrual): issued orders' revenue and costs + operating expenses
// * cash flow: money that actually moved through the accounts

const round2 = (n) => Math.round(n * 100) / 100;

// A ledger row's effect as an expense: positive for money out, negative for
// its reversal (direction is -1 for an expense, +1 for the reversal).
export const expenseAmount = (tx) => -tx.direction * Number(tx.amount_base);

// Order-level discount and unlinked materials are spread over lines in
// proportion to line totals -- the same rule crm_issue_order uses.
export function lineShares(order, items) {
    const subtotal = Number(order.subtotal);
    const discount = Number(order.discount_amount);
    const rate = Number(order.fx_rate_at_issue);
    return items.map((item) => {
        const total = Number(item.total);
        const share = subtotal > 0 ? total / subtotal : 0;
        const net = total - (subtotal > 0 ? round2(discount * share) : 0);
        return { item, share, revenueBase: round2(net * rate) };
    });
}

// Revenue, materials and master labor per service category for issued
// orders. Rounding differences between lines and the order total are put on
// the order's largest line so categories always add up to the totals.
export function categoryBreakdown(orders, items, materials, commissions) {
    const byCategory = new Map();
    const bucket = (id) => {
        if (!byCategory.has(id)) byCategory.set(id, { category_id: id, revenue: 0, materials: 0, labor: 0, lines: 0 });
        return byCategory.get(id);
    };
    const itemsByOrder = groupBy(items, 'order_id');
    const materialsByOrder = groupBy(materials, 'order_id');
    const itemCategory = new Map(items.map((i) => [i.id, i.category_id]));

    for (const order of orders) {
        const lines = lineShares(order, itemsByOrder.get(order.id) || []);
        if (!lines.length) continue;
        const largest = lines.reduce((a, b) => (Number(b.item.total) > Number(a.item.total) ? b : a));

        let revenueSum = 0;
        for (const line of lines) {
            bucket(line.item.category_id).revenue += line.revenueBase;
            bucket(line.item.category_id).lines += 1;
            revenueSum += line.revenueBase;
        }
        bucket(largest.item.category_id).revenue += round2(Number(order.revenue_base) - revenueSum);

        const orderMaterials = materialsByOrder.get(order.id) || [];
        const unlinked = orderMaterials.filter((m) => !m.order_item_id).reduce((s, m) => s + Number(m.total_cost_base), 0);
        let materialsSum = 0;
        for (const m of orderMaterials) {
            if (!m.order_item_id) continue;
            const cat = itemCategory.get(m.order_item_id) ?? largest.item.category_id;
            bucket(cat).materials += Number(m.total_cost_base);
            materialsSum += Number(m.total_cost_base);
        }
        for (const line of lines) {
            const part = round2(unlinked * line.share);
            bucket(line.item.category_id).materials += part;
            materialsSum += part;
        }
        bucket(largest.item.category_id).materials += round2(Number(order.materials_cost_base) - materialsSum);
    }

    for (const entry of commissions) {
        const cat = itemCategory.get(entry.order_item_id);
        if (cat) bucket(cat).labor += Number(entry.amount);
    }

    return [...byCategory.values()]
        .map((c) => ({
            ...c,
            revenue: round2(c.revenue),
            materials: round2(c.materials),
            labor: round2(c.labor),
            gross_profit: round2(c.revenue - c.materials - c.labor),
        }))
        .sort((a, b) => b.revenue - a.revenue);
}

// orders: issued in the period. expenses: ledger rows of type 'expense' in
// the period, each with `category_kind`. payrollEntries: non-commission
// accruals (salary/bonus/deduction/adjustment) created in the period.
export function profitAndLoss({ orders, expenses, payrollEntries }) {
    const revenue = round2(orders.reduce((s, o) => s + Number(o.revenue_base), 0));
    const materials = round2(orders.reduce((s, o) => s + Number(o.materials_cost_base), 0));
    const labor = round2(orders.reduce((s, o) => s + Number(o.labor_cost_base), 0));
    const grossProfit = round2(revenue - materials - labor);

    const sumKind = (kind) => round2(expenses.filter((e) => e.category_kind === kind).reduce((s, e) => s + expenseAmount(e), 0));
    const opex = sumKind('opex');
    const marketing = sumKind('marketing');
    // Purchases of stock: cash out now, cost recognized when used on orders.
    const materialPurchases = sumKind('materials');
    const salaries = round2(payrollEntries.reduce((s, e) => s + Number(e.amount), 0));
    const operatingProfit = round2(grossProfit - opex - marketing - salaries);

    return {
        revenue,
        orders_count: orders.length,
        average_check: orders.length ? round2(revenue / orders.length) : 0,
        cost_materials: materials,
        cost_labor: labor,
        gross_profit: grossProfit,
        gross_margin: revenue ? round2((grossProfit / revenue) * 100) : 0,
        expenses_opex: opex,
        expenses_marketing: marketing,
        expenses_salaries: salaries,
        operating_profit: operatingProfit,
        material_purchases: materialPurchases,
    };
}

// Money in/out by ledger type. Transfers between own accounts cancel out
// and are excluded.
export function cashFlow(transactions) {
    const byType = {};
    let inflow = 0;
    let outflow = 0;
    for (const tx of transactions) {
        if (tx.type === 'transfer_in' || tx.type === 'transfer_out') continue;
        const signed = tx.direction * Number(tx.amount_base);
        byType[tx.type] = round2((byType[tx.type] || 0) + signed);
        if (signed > 0) inflow += signed;
        else outflow -= signed;
    }
    return { inflow: round2(inflow), outflow: round2(outflow), net: round2(inflow - outflow), by_type: byType };
}

// Balance per staff member: earned (all accruals) minus paid out.
export function staffBalances(staff, entries, payouts) {
    return staff.map((s) => {
        const accrued = round2(entries.filter((e) => e.staff_id === s.id).reduce((sum, e) => sum + Number(e.amount), 0));
        // Payout rows are -1; their reversals +1.
        const paid = round2(payouts.filter((p) => p.staff_id === s.id).reduce((sum, p) => sum - p.direction * Number(p.amount_base), 0));
        return { staff_id: s.id, accrued, paid, owed: round2(accrued - paid) };
    });
}

function groupBy(rows, key) {
    const map = new Map();
    for (const row of rows) {
        if (!map.has(row[key])) map.set(row[key], []);
        map.get(row[key]).push(row);
    }
    return map;
}
