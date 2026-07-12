import { useState } from 'react';
import { useApiUpload } from '../api/useApiClient';
import CameraCapture from '../components/CameraCapture';
import { hapticError, hapticSuccess } from '../lib/haptics';

export default function CheckInScreen({ onCheckedIn }) {
    const upload = useApiUpload();
    const [cameraOpen, setCameraOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);

    async function handleCapture(blob) {
        setCameraOpen(false);
        setUploading(true);
        setError(null);
        try {
            const formData = new FormData();
            formData.append('type', 'check_in');
            formData.append('photo', blob, 'check-in.jpg');
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
                    onClick={() => setCameraOpen(true)}
                >
                    {uploading ? 'Загрузка...' : '📸 Сделать селфи'}
                </button>

                {error && <p className="error-text">{error}</p>}
            </div>

            {cameraOpen && (
                <CameraCapture facingMode="user" onCapture={handleCapture} onClose={() => setCameraOpen(false)} />
            )}
        </div>
    );
}
