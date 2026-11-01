import { describe, expect, it } from 'vitest';
import { furthestStage, marketingTable } from '../../src/modules/crm/lib/marketing.js';

const leads = [
    { id: 'l1', source_id: 'ads', status: 'completed', order_id: 'o1' },
    { id: 'l2', source_id: 'ads', status: 'lost', order_id: null },
    { id: 'l3', source_id: 'ads', status: 'new', order_id: null },
    { id: 'l4', source_id: 'organic', status: 'booked', order_id: null },
];
const events = [
    { lead_id: 'l2', to_status: 'booked' },
    { lead_id: 'l2', to_status: 'arrived' },
    { lead_id: 'l2', to_status: 'lost' },
];

describe('furthestStage', () => {
    it('keeps the furthest stage even after the lead was lost', () => {
        const stages = furthestStage(leads, events);
        expect(stages.get('l2')).toBe(4); // arrived
        expect(stages.get('l1')).toBe(6); // completed
    });
});

describe('marketingTable', () => {
    const table = marketingTable({
        leads,
        events,
        issuedOrders: [
            { id: 'o1', source: 'ads', revenue_base: '10000000', materials_cost_base: '2000000', labor_cost_base: '1000000' },
            { id: 'o9', source: null, revenue_base: '500000', materials_cost_base: '0', labor_cost_base: '0' },
        ],
        spend: [{ key: 'ads', amount: '1500000' }],
        keyOfLead: (l) => l.source_id,
        keyOfOrder: (o) => o.source,
    });
    const ads = table.find((r) => r.key === 'ads');

    it('builds the funnel from leads', () => {
        expect(ads).toMatchObject({ leads: 3, booked: 2, arrived: 2, orders: 1, lost: 1 });
        expect(ads.conversion).toBe(33.33);
    });

    it('measures money against ad spend', () => {
        expect(ads).toMatchObject({ issued_orders: 1, revenue: 10000000, gross_profit: 7000000, spend: 1500000 });
        expect(ads.cost_per_lead).toBe(500000);
        expect(ads.cost_per_order).toBe(1500000);
        expect(ads.profit_after_ads).toBe(5500000);
        expect(ads.romi).toBe(366.67);
    });

    it('keeps unattributed orders and sources without spend', () => {
        const none = table.find((r) => r.key === null);
        expect(none.revenue).toBe(500000);
        const organic = table.find((r) => r.key === 'organic');
        expect(organic.romi).toBeNull();
        expect(organic.cost_per_lead).toBeNull();
    });

    it('flags a campaign that only brings inquiries', () => {
        const [row] = marketingTable({
            leads: [{ id: 'x', status: 'lost', order_id: null, c: 'camp' }],
            events: [],
            issuedOrders: [],
            spend: [{ key: 'camp', amount: '2000000' }],
            keyOfLead: (l) => l.c,
            keyOfOrder: () => 'camp',
        });
        expect(row.profit_after_ads).toBe(-2000000);
        expect(row.romi).toBe(-100);
    });
});
