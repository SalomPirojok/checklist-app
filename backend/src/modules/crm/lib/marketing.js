// Marketing math: funnel per source/campaign and the money each one brought.
// Pure functions, unit-tested.
//
// Two complementary views per source:
// * funnel -- leads created in the period and how far each one got
// * money -- orders issued in the period, attributed to the source of the
//   lead they came from (or the client's first-touch source when the order
//   wasn't created from a lead)

const round2 = (n) => Math.round(n * 100) / 100;

const FUNNEL = ['new', 'in_progress', 'waiting_reply', 'booked', 'arrived', 'order_created', 'completed'];
const stageIndex = (status) => FUNNEL.indexOf(status);

// Furthest funnel stage each lead ever reached (a lead marked lost after
// arriving still counts as having arrived).
export function furthestStage(leads, events) {
    const best = new Map(leads.map((l) => [l.id, Math.max(stageIndex(l.status), l.order_id ? stageIndex('order_created') : -1)]));
    for (const e of events) {
        if (!best.has(e.lead_id)) continue;
        best.set(e.lead_id, Math.max(best.get(e.lead_id), stageIndex(e.to_status)));
    }
    return best;
}

function emptyRow(key) {
    return {
        key,
        leads: 0,
        booked: 0,
        arrived: 0,
        orders: 0,
        lost: 0,
        issued_orders: 0,
        revenue: 0,
        gross_profit: 0,
        spend: 0,
    };
}

// keyOf(lead|order) -> grouping key (source_id or campaign_id; null = none).
export function marketingTable({ leads, events, issuedOrders, spend, keyOfLead, keyOfOrder }) {
    const rows = new Map();
    const row = (key) => {
        if (!rows.has(key)) rows.set(key, emptyRow(key));
        return rows.get(key);
    };

    const stages = furthestStage(leads, events);
    for (const lead of leads) {
        const r = row(keyOfLead(lead));
        const stage = stages.get(lead.id);
        r.leads += 1;
        if (stage >= stageIndex('booked')) r.booked += 1;
        if (stage >= stageIndex('arrived')) r.arrived += 1;
        if (stage >= stageIndex('order_created')) r.orders += 1;
        if (lead.status === 'lost') r.lost += 1;
    }

    for (const order of issuedOrders) {
        const r = row(keyOfOrder(order));
        r.issued_orders += 1;
        r.revenue += Number(order.revenue_base);
        r.gross_profit += Number(order.revenue_base) - Number(order.materials_cost_base) - Number(order.labor_cost_base);
    }

    for (const s of spend) row(s.key).spend += Number(s.amount);

    return [...rows.values()]
        .map((r) => {
            const revenue = round2(r.revenue);
            const grossProfit = round2(r.gross_profit);
            const spent = round2(r.spend);
            return {
                ...r,
                revenue,
                gross_profit: grossProfit,
                spend: spent,
                conversion: r.leads ? round2((r.orders / r.leads) * 100) : null,
                // Cost to win one paying order, and what's left after paying for ads.
                cost_per_lead: spent && r.leads ? round2(spent / r.leads) : null,
                cost_per_order: spent && r.issued_orders ? round2(spent / r.issued_orders) : null,
                profit_after_ads: round2(grossProfit - spent),
                romi: spent ? round2(((grossProfit - spent) / spent) * 100) : null,
            };
        })
        .sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);
}
