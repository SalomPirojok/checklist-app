import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useApiClient } from '../api/useApiClient';

const STORAGE_KEY = 'kontrolla_active_module';

const ModuleContext = createContext(null);

function readStoredModule() {
    try {
        return localStorage.getItem(STORAGE_KEY) || 'kontrolla';
    } catch {
        return 'kontrolla';
    }
}

// "?crm=orders/<uuid>" comes from the "Открыть в CRM" button in a bot
// notification. Read once, then removed from the address so a reload
// doesn't reopen it.
function readDeepLink() {
    try {
        const params = new URLSearchParams(window.location.search);
        const value = params.get('crm');
        if (!value) return null;
        params.delete('crm');
        const query = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
        return /^(orders|leads|clients|vehicles)\/[0-9a-f-]{36}$/.test(value) ? value : null;
    } catch {
        return null;
    }
}

// Module load = app start, before anything else can touch the address.
const initialDeepLink = readDeepLink();

// Which top-level module the user is in ("kontrolla" checklists/staff, or
// "crm"). CRM is offered only when the organization has it enabled AND the
// user holds a CRM role; the server enforces both on every request anyway.
export function ModuleProvider({ children }) {
    const api = useApiClient();
    const [crmAccess, setCrmAccess] = useState(null);
    const [ready, setReady] = useState(false);
    const deepLink = initialDeepLink;
    const [mode, setModeState] = useState(() => (deepLink ? 'crm' : readStoredModule()));

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const { modules } = await api('/api/modules');
                if (modules.includes('crm')) {
                    const access = await api('/api/crm/me');
                    if (!cancelled) setCrmAccess(access);
                }
            } catch {
                // No module or no CRM role: stay in Kontrolla.
            } finally {
                if (!cancelled) setReady(true);
            }
        }
        load();
        return () => {
            cancelled = true;
        };
    }, [api]);

    const setMode = useCallback((next) => {
        setModeState(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // Remembering the choice is a convenience only.
        }
    }, []);

    const activeMode = mode === 'crm' && crmAccess ? 'crm' : 'kontrolla';

    return (
        <ModuleContext.Provider value={{ ready, crmAccess, mode: activeMode, setMode, deepLink }}>
            {children}
        </ModuleContext.Provider>
    );
}

export function useModule() {
    const ctx = useContext(ModuleContext);
    if (!ctx) throw new Error('useModule must be used within a ModuleProvider');
    return ctx;
}
