// Maps a PostgREST/Postgres error to an HTTP response. Business-rule errors
// raised by the CRM triggers/functions carry a Russian message meant for the
// user; 'crm: ...' messages are programming errors and stay generic.
export function sendDbError(res, error, fallback = 'Ошибка базы данных') {
    if (!error) return res.status(500).json({ error: fallback });
    if (error.code === '23505') {
        return res.status(409).json({ error: 'Такая запись уже существует', code: 'DUPLICATE' });
    }
    if (error.code === '23503') {
        return res.status(400).json({ error: 'Ссылка на несуществующую или чужую запись', code: 'INVALID_REFERENCE' });
    }
    if (error.code === '23514' || error.code === '22P02') {
        return res.status(400).json({ error: 'Неверное значение поля', code: 'INVALID_VALUE' });
    }
    if (error.code === 'P0001' && error.message && !error.message.startsWith('crm:')) {
        return res.status(400).json({ error: error.message, code: 'BUSINESS_RULE' });
    }
    console.error('CRM database error:', error.code, error.message);
    return res.status(500).json({ error: fallback });
}
