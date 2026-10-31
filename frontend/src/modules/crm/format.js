// Display helpers shared by CRM screens.

export function clientName(client) {
    if (!client) return '—';
    return [client.first_name, client.last_name].filter(Boolean).join(' ');
}

export function formatPhone(phone) {
    if (!phone) return '';
    const m = phone.match(/^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/);
    return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}

export function formatDateTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatMoney(amount, currency) {
    if (amount === null || amount === undefined) return '';
    const value = Number(amount).toLocaleString('ru-RU', { maximumFractionDigits: currency === 'UZS' ? 0 : 2 });
    return `${value} ${currency === 'UZS' ? 'сум' : currency}`;
}

// <input type="datetime-local"> works in local wall-clock time without a zone.
export function toLocalInputValue(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInputValue(value) {
    return value ? new Date(value).toISOString() : null;
}
