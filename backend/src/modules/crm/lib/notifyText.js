// Telegram message texts for CRM events. Pure functions (unit-tested).

export const NOTIFICATION_EVENTS = [
    'lead_new',
    'lead_booked',
    'order_new',
    'order_status',
    'order_ready',
    'payment',
    'client_debt',
    'daily_summary',
];

const ORDER_STATUS = {
    pending: 'Ожидает приёма',
    accepted: 'Принят',
    in_progress: 'В работе',
    waiting_parts: 'Ждёт материалов',
    quality_check: 'Контроль качества',
    ready: 'Готов к выдаче',
    issued: 'Выдан',
    cancelled: 'Отменён',
};

const CHANNEL = {
    instagram: 'Instagram',
    telegram: 'Telegram',
    phone: 'звонок',
    walk_in: 'пришёл сам',
    website: 'сайт',
    other: 'другое',
};

export function money(amount, currency = 'UZS') {
    const n = Number(amount) || 0;
    const value = n.toLocaleString('ru-RU', { maximumFractionDigits: currency === 'UZS' ? 0 : 2 }).replace(/ /g, ' ');
    return `${value} ${currency === 'UZS' ? 'сум' : currency}`;
}

const name = (client) => [client?.first_name, client?.last_name].filter(Boolean).join(' ') || 'Клиент';
const car = (vehicle) => (vehicle ? [vehicle.make, vehicle.model, vehicle.plate].filter(Boolean).join(' ') : null);
const contact = (client) => [client?.phone, client?.instagram_username && `@${client.instagram_username}`].filter(Boolean).join(' · ');
const lines = (...parts) => parts.filter(Boolean).join('\n');

function dateTime(iso, timeZone = 'Asia/Tashkent') {
    if (!iso) return null;
    return new Date(iso).toLocaleString('ru-RU', { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function leadNewText({ lead, client, sourceName }) {
    return lines(
        `🆕 Новая заявка №${lead.number}`,
        name(client),
        contact(client),
        [CHANNEL[lead.channel], sourceName].filter(Boolean).join(' · '),
        lead.notes && `«${lead.notes}»`
    );
}

export function leadBookedText({ lead, client }) {
    return lines(`📅 Запись: ${name(client)}`, lead.booked_for && `На ${dateTime(lead.booked_for)}`, contact(client), `Заявка №${lead.number}`);
}

export function orderNewText({ order, client, vehicle }) {
    return lines(
        `🚗 Новый заказ №${order.number}`,
        name(client),
        car(vehicle),
        order.planned_ready_at && `Плановая выдача: ${dateTime(order.planned_ready_at)}`
    );
}

export function orderStatusText({ order, client, vehicle, fromStatus }) {
    const head = order.status === 'ready' ? `✅ Готов к выдаче: заказ №${order.number}` : `🔄 Заказ №${order.number}: ${ORDER_STATUS[order.status]}`;
    return lines(head, [name(client), car(vehicle)].filter(Boolean).join(' · '), fromStatus && order.status !== 'ready' && `Было: ${ORDER_STATUS[fromStatus]}`);
}

export function orderIssuedText({ order, client, vehicle }) {
    const due = Number(order.total) - Number(order.paid_amount);
    return lines(
        `🏁 Выдан заказ №${order.number}`,
        [name(client), car(vehicle)].filter(Boolean).join(' · '),
        `Сумма: ${money(order.total, order.currency)}`,
        due > 0 && `⚠️ Долг клиента: ${money(due, order.currency)}`
    );
}

export function paymentText({ order, client, transaction }) {
    const refund = transaction.type === 'client_refund';
    const due = Number(order.total) - Number(order.paid_amount);
    return lines(
        `${refund ? '↩️ Возврат' : '💰 Оплата'} ${money(transaction.amount, transaction.currency)}`,
        `Заказ №${order.number} · ${name(client)}`,
        due > 0 ? `Остаток: ${money(due, order.currency)}` : !refund && 'Заказ оплачен полностью'
    );
}

export function debtText({ order, client }) {
    const due = Number(order.total) - Number(order.paid_amount);
    return lines(`⚠️ Выдан с долгом: заказ №${order.number}`, `${name(client)}: ${money(due, order.currency)}`, contact(client));
}

// d: buildDashboard() result.
export function dailySummaryText(d) {
    const debts = Object.entries(d.client_debts)
        .map(([cur, v]) => money(v, cur))
        .join(' + ');
    return lines(
        `📊 Итоги дня ${d.dates.today.split('-').reverse().join('.')}`,
        '',
        `Выручка: ${money(d.revenue.today)} (выдано авто: ${d.issued.today})`,
        `Поступило денег: ${money(d.cash_in_today)}`,
        `Новых заявок: ${d.leads.today}`,
        '',
        `В работе: ${d.orders.in_work}${d.orders.by_status.ready ? `, готовы к выдаче: ${d.orders.by_status.ready}` : ''}`,
        d.orders.overdue > 0 && `⚠️ Просрочено: ${d.orders.overdue}`,
        '',
        `Месяц: выручка ${money(d.month.revenue)}, чистая прибыль ${money(d.month.operating_profit)}`,
        debts && `Клиенты должны: ${debts}`,
        d.staff_owed > 0 && `К выплате сотрудникам: ${money(d.staff_owed)}`
    ).replace(/\n{3,}/g, '\n\n');
}
