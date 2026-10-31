import { supabase } from './supabase.js';

// Optional per-organization modules. Existing Kontrolla features are not
// listed here: they stay on for every organization, exactly as before.
export const MODULE_KEYS = ['crm'];

export async function getEnabledModules(organizationId) {
    const { data, error } = await supabase
        .from('organization_modules')
        .select('module_key')
        .eq('organization_id', organizationId)
        .eq('enabled', true);
    if (error) throw new Error(error.message);
    return data.map((m) => m.module_key);
}

export async function isModuleEnabled(organizationId, moduleKey) {
    const { data, error } = await supabase
        .from('organization_modules')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('module_key', moduleKey)
        .eq('enabled', true)
        .maybeSingle();
    if (error) throw new Error(error.message);
    return !!data;
}
