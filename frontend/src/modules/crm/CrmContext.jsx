import { createContext, useContext, useMemo } from 'react';

const CrmContext = createContext(null);

export function CrmProvider({ access, reference, reloadReference, children }) {
    const value = useMemo(() => {
        const userMap = new Map(reference.users.map((u) => [u.id, u]));
        const sourceMap = new Map(reference.sources.map((s) => [s.id, s]));
        const staffMap = new Map(reference.staff.map((s) => [s.id, s]));
        const accountMap = new Map(reference.accounts.map((a) => [a.id, a]));
        const categoryMap = new Map(reference.categories.map((c) => [c.id, c]));
        return {
            role: access.role,
            can: (permission) => access.permissions.includes(permission),
            reference,
            reloadReference,
            // Active people only, for "assign to" dropdowns.
            assignableUsers: reference.users.filter((u) => u.is_active),
            activeStaff: reference.staff.filter((s) => s.is_active),
            activeAccounts: reference.accounts.filter((a) => !a.is_archived),
            userName: (id) => userMap.get(id)?.full_name || null,
            sourceName: (id) => sourceMap.get(id)?.name || null,
            staffName: (id) => staffMap.get(id)?.full_name || null,
            account: (id) => accountMap.get(id) || null,
            categoryName: (id) => categoryMap.get(id)?.name || null,
        };
    }, [access, reference, reloadReference]);
    return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export function useCrm() {
    const ctx = useContext(CrmContext);
    if (!ctx) throw new Error('useCrm must be used within a CrmProvider');
    return ctx;
}
