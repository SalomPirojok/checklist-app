import { supabase } from '../lib/supabase.js';
import { decryptSecret, encryptSecret } from '../lib/secrets.js';
import { refreshToken } from '../modules/crm/lib/instagram.js';

// Long-lived Instagram tokens expire after 60 days unless refreshed; refresh
// any older than 30 days so a connection never silently dies.
const REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export async function runInstagramTokenRefresh(now = new Date()) {
    const { data, error } = await supabase
        .from('crm_integrations')
        .select('id, config, secrets_encrypted')
        .eq('provider', 'instagram')
        .eq('status', 'connected');
    if (error) throw new Error(error.message);

    let refreshed = 0;
    for (const row of data) {
        const last = Date.parse(row.config?.token_refreshed_at || 0);
        if (!row.secrets_encrypted || now - last < REFRESH_AFTER_MS) continue;
        try {
            const { token } = await refreshToken(decryptSecret(row.secrets_encrypted));
            await supabase
                .from('crm_integrations')
                .update({
                    secrets_encrypted: encryptSecret(token),
                    config: { ...row.config, token_refreshed_at: now.toISOString() },
                    last_error: null,
                })
                .eq('id', row.id);
            refreshed += 1;
        } catch (err) {
            await supabase.from('crm_integrations').update({ last_error: `Обновление токена: ${err.message}` }).eq('id', row.id);
            console.error(`Instagram token refresh failed for ${row.id}:`, err.message);
        }
    }
    return { refreshed };
}
