import { useRef, useState } from 'react';
import { useApiUpload } from '../api/useApiClient';
import { hapticError, hapticSuccess } from '../lib/haptics';

export default function CheckInScreen({ onCheckedIn }) {
    const upload = useApiUpload();
    const fileInputRef = useRef(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);

    async function handleFileChange(e) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        setUploading(true);
        setError(null);
        try {
            const formData = new FormData();
            formData.append('type', 'check_in');
            formData.append('photo', file);
            await upload('/api/attendance', formData);
            hapticSuccess();
            onCheckedIn();
        } catch (err) {
            setError(err.message);
            hapticError();
        } finally {
            setUploading(false);
        }
    }

    return (
        <div className="screen screen-center">
            <div className="card">
                <h1>Отметить приход</h1>
                <p className="hint">Сначала отметьте приход — сделайте селфи, чтобы получить доступ к чек-листам.</p>

                <button
                    type="button"
                    className="btn btn--large btn--block"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                >
                    {uploading ? 'Загрузка...' : '📸 Сделать селфи'}
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="user"
                    hidden
                    onChange={handleFileChange}
                />

                {error && <p className="error-text">{error}</p>}
            </div>
        </div>
    );
}
