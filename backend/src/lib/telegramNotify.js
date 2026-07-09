export async function sendTelegramMessage(botToken, chatId, text) {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = await res.json();
    if (!data.ok) {
        throw new Error(`Telegram sendMessage failed: ${data.description || res.status}`);
    }
    return data;
}
