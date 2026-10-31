import { createContext, useContext, useMemo } from 'react';

const CrmContext = createContext(null);

export function CrmProvider({ access, reference, children }) {
    const value = useMemo(() => {
        const userMap = new Map(reference.users.map((u) => [u.id, u]));
        const sourceMap = new Map(reference.sources.map((s) => [s.id, s]));
        return {
            role: access.role,
            can: (permission) => access.permissions.includes(permission),
            reference,
            // Active users only, for "assign to" dropdowns.
            assignableUsers: reference.users.filter((u) => u.is_active),
            userName: (id) => userMap.get(id)?.full_name || null,
            sourceName: (id) => sourceMap.get(id)?.name || null,
        };
    }, [access, reference]);
    return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export function useCrm() {
    const ctx = useContext(CrmContext);
    if (!ctx) throw new Error('useCrm must be used within a CrmProvider');
    return ctx;
}
