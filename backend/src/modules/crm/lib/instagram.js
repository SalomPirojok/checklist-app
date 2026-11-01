import crypto from 'node:crypto';

// Official Instagram API with Instagram Login (graph.instagram.com).
// META_GRAPH_VERSION (e.g. "v23.0") pins an API version; unset uses the
// app's default version.
function graphUrl(path) {
    const version = process.env.META_GRAPH_VERSION;
    return `https://graph.instagram.com/${version ? `${version}/` : ''}${path}`;
}

// Meta signs every webhook POST: X-Hub-Signature-256 = "sha256=" +
// HMAC-SHA256(raw body, app secret).
export function verifySignature(rawBody, header, appSecret) {
    if (!rawBody || !header || !appSecret || !header.startsWith('sha256=')) return false;
    const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
    let given;
    try {
        given = Buffer.from(header.slice('sha256='.length), 'hex');
    } catch {
        return false;
    }
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// Flattens a webhook body into one item per Direct message.
// Ad clicks ("Click to Instagram Direct") carry a referral with the ad id,
// either on the messaging event or inside the message.
export function parseWebhook(body) {
    if (body?.object !== 'instagram' || !Array.isArray(body.entry)) return [];
    const out = [];
    for (const entry of body.entry) {
        for (const m of entry.messaging || []) {
            if (!m.message?.mid) continue;
            const referral = m.referral || m.message.referral || null;
            out.push({
                accountId: String(entry.id),
                senderId: String(m.sender?.id),
                recipientId: String(m.recipient?.id),
                timestamp: m.timestamp ? new Date(Number(m.timestamp)).toISOString() : new Date().toISOString(),
                mid: m.message.mid,
                text: m.message.text || null,
                attachments: (m.message.attachments || []).map((a) => ({ type: a.type, url: a.payload?.url || null })),
                isEcho: !!m.message.is_echo,
                referral: referral
                    ? {
                          ad_id: referral.ad_id ? String(referral.ad_id) : null,
                          source: referral.source || null,
                          type: referral.type || null,
                          ad_title: referral.ads_context_data?.ad_title || null,
                      }
                    : null,
            });
        }
    }
    return out;
}

async function graph(path, { method = 'GET', token, body, fetchImpl = fetch } = {}) {
    const url = new URL(graphUrl(path));
    if (method === 'GET') url.searchParams.set('access_token', token);
    const res = await fetchImpl(url, {
        method,
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: method === 'GET' ? undefined : JSON.stringify(body || {}),
        signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
        const err = new Error(data.error?.message || `Instagram API error ${res.status}`);
        err.code = data.error?.code;
        err.subcode = data.error?.error_subcode;
        throw err;
    }
    return data;
}

// The connected professional account: { user_id, username }.
export const getMe = (token) => graph('me?fields=user_id,username', { token });

// Name/username of someone who messaged the account.
export async function getProfile(igsid, token) {
    try {
        return await graph(`${igsid}?fields=name,username`, { token });
    } catch {
        return {};
    }
}

export async function sendText(accountId, recipientId, text, token) {
    const data = await graph(`${accountId}/messages`, {
        method: 'POST',
        token,
        body: { recipient: { id: recipientId }, message: { text } },
    });
    return data.message_id || null;
}

// Webhooks only arrive once the app is subscribed for this account.
export const subscribeToMessages = (token) => graph('me/subscribed_apps?subscribed_fields=messages', { method: 'POST', token });

// Long-lived tokens last 60 days; refreshing returns a new 60-day token.
export const refreshToken = (token) =>
    graph(`refresh_access_token?grant_type=ig_refresh_token`, { token }).then((d) => ({ token: d.access_token, expiresIn: d.expires_in }));

// Meta error 10 / subcode 2534022: outside the 24-hour reply window.
export function isOutsideWindow(err) {
    return err?.code === 10 || err?.subcode === 2534022 || /outside of allowed window/i.test(err?.message || '');
}
