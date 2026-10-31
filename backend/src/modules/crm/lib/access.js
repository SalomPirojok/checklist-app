import { supabase } from '../../../lib/supabase.js';

// Every CRM permission. Roles (crm_roles.permissions) hold subsets of these;
// the organization owner implicitly has all of them.
export const CRM_PERMISSIONS = [
    'dashboard.view',
    'leads.manage',
    'clients.manage',
    'vehicles.manage',
    'orders.manage',
    'orders.issue',
    'payments.record',
    'finance.view',
    'finance.manage',
    'staff.manage',
    'payroll.view',
    'payroll.manage',
    'marketing.view',
    'messages.send',
    'settings.manage',
];

// Returns { role, permissions } for the user, or null if they have no CRM
// access in their organization.
export async function loadCrmAccess(user) {
    if (user.role === 'owner') {
        return { role: { key: 'owner', name: 'Владелец' }, permissions: CRM_PERMISSIONS };
    }
    const { data, error } = await supabase
        .from('crm_user_roles')
        .select('role:crm_roles(id, key, name, permissions)')
        .eq('user_id', user.id)
        .eq('organization_id', user.organizationId)
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.role) return null;
    const { permissions, ...role } = data.role;
    return { role, permissions: permissions.filter((p) => CRM_PERMISSIONS.includes(p)) };
}
