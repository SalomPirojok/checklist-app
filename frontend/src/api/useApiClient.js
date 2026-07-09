import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch, apiUpload } from './client';

export function useApiClient() {
    const { token } = useAuth();
    return useCallback((path, options) => apiFetch(path, { ...options, token }), [token]);
}

export function useApiUpload() {
    const { token } = useAuth();
    return useCallback((path, formData) => apiUpload(path, { formData, token }), [token]);
}
