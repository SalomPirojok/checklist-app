import { describe, expect, it } from 'vitest';
import {
    dailySummaryText,
    leadNewText,
    money,
    orderIssuedText,
    orderStatusText,
    paymentText,
} from '../../src/modules/crm/lib/notifyText.js';

const client = { first_name: 'Азиз', last_name: 'Каримов', phone: '+998901234567', instagram_username: 'aziz' };
const vehicle = { make: 'Chevrolet', model: 'Malibu', plate: '01A123BC' };

describe('money', () => {
    it('formats UZS without decimals and USD with', () => {
        expect(money(12800000)).toBe('12 800 000 сум');
        expect(money(150.5, 'USD')).toBe('150,5 USD');
    });
});

describe('notification texts', () => {
    it('new lead shows contact, channel and source', () => {
        const text = leadNewText({ lead: { number: 7, channel: 'instagram', notes: 'Хочу PPF' }, client, sourceName: 'Instagram реклама' });
        expect(text).toBe('🆕 Новая заявка №7\nАзиз Каримов\n+998901234567 · @aziz\nInstagram · Instagram реклама\n«Хочу PPF»');
    });

    it('status change and ready', () => {
        expect(orderStatusText({ order: { number: 3, status: 'in_progress' }, client, vehicle, fromStatus: 'accepted' })).toBe(
            '🔄 Заказ №3: В работе\nАзиз Каримов · Chevrolet Malibu 01A123BC\nБыло: Принят'
        );
        expect(orderStatusText({ order: { number: 3, status: 'ready' }, client, vehicle, fromStatus: 'quality_check' })).toMatch(/^✅ Готов к выдаче/);
    });

    it('issue warns about debt', () => {
        const text = orderIssuedText({ order: { number: 3, total: '1000000', paid_amount: '600000', currency: 'UZS' }, client, vehicle });
        expect(text).toContain('Долг клиента: 400 000 сум');
    });

    it('payment shows remaining or fully paid', () => {
        const order = { number: 3, total: '1000000', paid_amount: '1000000', currency: 'UZS' };
        expect(paymentText({ order, client, transaction: { type: 'client_payment', amount: '400000', currency: 'UZS' } })).toContain('оплачен полностью');
        const partial = paymentText({
            order: { ...order, paid_amount: '200000' },
            client,
            transaction: { type: 'client_payment', amount: '50', currency: 'USD' },
        });
        expect(partial).toContain('💰 Оплата 50 USD');
        expect(partial).toContain('Остаток: 800 000 сум');
    });

    it('daily summary skips empty lines', () => {
        const text = dailySummaryText({
            dates: { today: '2026-11-01' },
            revenue: { today: 5000000 },
            issued: { today: 2 },
            cash_in_today: 3000000,
            leads: { today: 4 },
            orders: { in_work: 6, by_status: { ready: 1 }, overdue: 0 },
            month: { revenue: 20000000, operating_profit: 7000000 },
            client_debts: {},
            staff_owed: 0,
        });
        expect(text).toContain('📊 Итоги дня 01.11.2026');
        expect(text).toContain('В работе: 6, готовы к выдаче: 1');
        expect(text).not.toContain('Просрочено');
        expect(text).not.toContain('Клиенты должны');
        expect(text).not.toMatch(/\n{3}/);
    });
});
