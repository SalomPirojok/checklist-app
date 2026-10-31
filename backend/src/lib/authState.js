import { supabase } from './supabase.js';

// The JWT is valid for 30 days, so its role/org/active claims can be stale.
// Each request re-reads the user's current state instead, cached briefly so
// a burst of requests from one screen costs a single lookup.
const CACHE_TTL_MS = 30 * 1000;
const cache = new Map();

export async function loadAuthState(userId) {
    const cached = cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.state;

    const { data, error } = await supabase
        .from('users')
        .select('id, role, organization_id, is_active, organization:organizations(is_suspended)')
        .eq('id', userId)
        .maybeSingle();
    if (error) throw new Error(error.message);

    const state = data
        ? {
              role: data.role,
              organizationId: data.organization_id,
              isActive: data.is_active,
              isOrgSuspended: !!data.organization?.is_suspended,
          }
        : null;
    cache.set(userId, { state, expiresAt: Date.now() + CACHE_TTL_MS });
    return state;
}

export function clearAuthStateCache() {
    cache.clear();
}
