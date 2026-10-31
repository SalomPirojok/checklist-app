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

// Which top-level module the user is in ("kontrolla" checklists/staff, or
// "crm"). CRM is offered only when the organization has it enabled AND the
// user holds a CRM role; the server enforces both on every request anyway.
export function ModuleProvider({ children }) {
    const api = useApiClient();
    const [crmAccess, setCrmAccess] = useState(null);
    const [ready, setReady] = useState(false);
    const [mode, setModeState] = useState(readStoredModule);

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
        <ModuleContext.Provider value={{ ready, crmAccess, mode: activeMode, setMode }}>
            {children}
        </ModuleContext.Provider>
    );
}

export function useModule() {
    const ctx = useContext(ModuleContext);
    if (!ctx) throw new Error('useModule must be used within a ModuleProvider');
    return ctx;
}
