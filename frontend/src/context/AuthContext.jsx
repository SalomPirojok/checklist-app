import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import WebApp from '@twa-dev/sdk';
import { apiFetch } from '../api/client';

const TOKEN_STORAGE_KEY = 'checklist_app_token';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY));
    const [user, setUser] = useState(null);
    const [status, setStatus] = useState('loading'); // 'loading' | 'authenticated' | 'error'
    const [error, setError] = useState(null);
    const hasStarted = useRef(false);

    useEffect(() => {
        // Guards against React StrictMode's double-invoked effect (and any other
        // remount) firing this non-idempotent POST twice concurrently.
        if (hasStarted.current) return;
        hasStarted.current = true;

        async function authenticate() {
            try {
                WebApp.ready();
                WebApp.expand();
                // Telegram's native vertical swipe-to-close gesture otherwise steals
                // touch-move gestures from in-page elements (e.g. the signature pad),
                // so drawing a signature silently fails to register on a real device.
                WebApp.disableVerticalSwipes();
            } catch {
                // WebApp calls are safe no-ops outside a real Telegram client; ignore.
            }

            const initData = WebApp.initData;
            if (!initData) {
                setStatus('error');
                setError('Откройте это приложение через Telegram.');
                return;
            }

            try {
                const data = await apiFetch('/api/auth/telegram', { method: 'POST', body: { initData } });
                localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
                setToken(data.token);
                setUser(data.user);
                setStatus('authenticated');
            } catch (err) {
                setStatus('error');
                setError(err.message);
            }
        }

        authenticate();
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken(null);
        setUser(null);
        setStatus('error');
        setError('Вы вышли из системы.');
    }, []);

    return (
        <AuthContext.Provider value={{ token, user, status, error, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
    return ctx;
}
