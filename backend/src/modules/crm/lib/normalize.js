// Input normalization shared by CRM routes, so the same phone or Instagram
// account typed differently still hits the database's duplicate protection.

// Returns E.164 ("+998901234567"), null for empty input, or throws for input
// that can't be a phone number. A bare 9-digit number is treated as Uzbek.
export function normalizePhone(input) {
    if (input === undefined || input === null) return null;
    const raw = String(input).trim();
    if (!raw) return null;
    if (/[^\d\s()+-]/.test(raw)) throw new Error('Телефон может содержать только цифры');
    const digits = raw.replace(/\D/g, '');
    const e164 = digits.length === 9 ? `+998${digits}` : `+${digits}`;
    if (!/^\+[0-9]{7,15}$/.test(e164)) throw new Error('Неверный номер телефона');
    return e164;
}

// "@Kamo.Auto " or "https://instagram.com/kamo.auto/" -> "kamo.auto"
export function normalizeInstagram(input) {
    if (input === undefined || input === null) return null;
    let value = String(input).trim();
    if (!value) return null;
    const urlMatch = value.match(/instagram\.com\/([^/?#]+)/i);
    if (urlMatch) value = urlMatch[1];
    value = value.replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(value)) throw new Error('Неверный Instagram username');
    return value;
}

export function normalizeTelegram(input) {
    if (input === undefined || input === null) return null;
    let value = String(input).trim();
    if (!value) return null;
    const urlMatch = value.match(/t\.me\/([^/?#]+)/i);
    if (urlMatch) value = urlMatch[1];
    value = value.replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{4,32}$/.test(value)) throw new Error('Неверный Telegram username');
    return value;
}

// Plain-text search term safe to embed in a PostgREST or() filter: keeps
// letters, digits, spaces and the few symbols found in names/handles.
export function searchTerm(input) {
    if (!input) return '';
    return String(input)
        .replace(/[^\p{L}\p{N}\s@+._-]/gu, '')
        .trim()
        .slice(0, 64);
}

export function cleanText(input, maxLength = 2000) {
    if (input === undefined || input === null) return null;
    const value = String(input).trim();
    return value ? value.slice(0, maxLength) : null;
}
