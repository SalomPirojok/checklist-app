// `extra` is merged into the sendMessage payload, e.g. { reply_markup } for
// an inline button. Existing callers pass three arguments and are unaffected.
export async function sendTelegramMessage(botToken, chatId, text, extra = {}) {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, ...extra }),
    });
    const data = await res.json();
    if (!data.ok) {
        throw new Error(`Telegram sendMessage failed: ${data.description || res.status}`);
    }
    return data;
}
