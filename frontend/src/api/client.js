const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function apiFetch(path, { method = 'GET', body, token } = {}) {
    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `Request failed with status ${res.status}`);
    }
    return data;
}

// No Content-Type header here on purpose: the browser sets multipart/form-data
// with the correct boundary itself when the body is a FormData instance.
export async function apiUpload(path, { formData, token, method = 'POST' }) {
    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: formData,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `Upload failed with status ${res.status}`);
    }
    return data;
}
