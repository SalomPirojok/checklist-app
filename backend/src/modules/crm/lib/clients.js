import { supabase } from '../../../lib/supabase.js';
import { cleanText, normalizeInstagram, normalizePhone, normalizeTelegram } from './normalize.js';

export const CLIENT_LIST_FIELDS = 'id, first_name, last_name, phone, instagram_username, instagram_user_id, telegram_username, source_id, manager_id, first_contact_at, created_at';

// Validates and normalizes client fields from a request body. Only keys
// present in the body are returned, so it serves both create and PATCH.
// Throws Error with a user-facing message on invalid input.
export function parseClientInput(body, { requireName }) {
    const out = {};
    if (body.first_name !== undefined || requireName) {
        out.first_name = cleanText(body.first_name, 100);
        if (!out.first_name) throw new Error('Укажите имя клиента');
    }
    if (body.last_name !== undefined) out.last_name = cleanText(body.last_name, 100);
    if (body.phone !== undefined) out.phone = normalizePhone(body.phone);
    if (body.instagram_username !== undefined) out.instagram_username = normalizeInstagram(body.instagram_username);
    if (body.telegram_username !== undefined) out.telegram_username = normalizeTelegram(body.telegram_username);
    if (body.source_id !== undefined) out.source_id = body.source_id || null;
    if (body.campaign_id !== undefined) out.campaign_id = body.campaign_id || null;
    if (body.manager_id !== undefined) out.manager_id = body.manager_id || null;
    if (body.notes !== undefined) out.notes = cleanText(body.notes, 5000);
    return out;
}

// Finds an existing live client with the same phone or Instagram account.
export async function findDuplicateClient(organizationId, { phone, instagram_username }, excludeId = null) {
    const conditions = [];
    if (phone) conditions.push(`phone.eq.${phone}`);
    // Stored lowercased already; eq (not ilike) so "_" isn't a wildcard.
    if (instagram_username) conditions.push(`instagram_username.eq.${instagram_username}`);
    if (!conditions.length) return null;

    let query = supabase
        .from('crm_clients')
        .select(CLIENT_LIST_FIELDS)
        .eq('organization_id', organizationId)
        .is('merged_into_id', null)
        .or(conditions.join(','))
        .limit(1);
    if (excludeId) query = query.neq('id', excludeId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data[0] || null;
}

export function duplicateResponse(res, client) {
    return res.status(409).json({
        error: 'Клиент с таким телефоном или Instagram уже есть',
        code: 'DUPLICATE_CLIENT',
        client,
    });
}
