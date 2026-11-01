import { supabase } from './supabase.js';

// organizations.timezone (default Asia/Tashkent), cached briefly: it is read
// on every check-in and almost never changes.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

export async function getOrgTimezone(organizationId) {
    const hit = cache.get(organizationId);
    if (hit && hit.expiresAt > Date.now()) return hit.timezone;
    const { data, error } = await supabase.from('organizations').select('timezone').eq('id', organizationId).single();
    if (error) throw new Error(error.message);
    const timezone = data.timezone || 'Asia/Tashkent';
    cache.set(organizationId, { timezone, expiresAt: Date.now() + CACHE_TTL_MS });
    return timezone;
}
