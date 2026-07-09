import { useRef, useState } from 'react';
import { useApiUpload } from '../api/useApiClient';

function formatTime(isoString) {
    return new Date(isoString).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export default function AttendanceBar({ attendance, onCheckedOut }) {
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
            formData.append('type', 'check_out');
            formData.append('photo', file);
            await upload('/api/attendance', formData);
            onCheckedOut();
        } catch (err) {
            setError(err.message);
        } finally {
            setUploading(false);
        }
    }

    return (
        <div className="attendance-bar">
            <span className="hint">Пришли: {formatTime(attendance.check_in.created_at)}</span>
            {attendance.check_out ? (
                <span className="hint">Ушли: {formatTime(attendance.check_out.created_at)}</span>
            ) : (
                <>
                    <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={uploading}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        {uploading ? 'Загрузка...' : 'Отметить уход'}
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        capture="user"
                        hidden
                        onChange={handleFileChange}
                    />
                </>
            )}
            {error && <p className="error-text">{error}</p>}
        </div>
    );
}
