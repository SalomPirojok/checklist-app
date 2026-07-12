import { useEffect, useState } from 'react';
import { useApiClient, useApiUpload } from '../api/useApiClient';
import CameraCapture from '../components/CameraCapture';
import { hapticError, hapticSuccess } from '../lib/haptics';

function formatTimeShort(time) {
    return time ? time.slice(0, 5) : null;
}

export default function CheckInScreen({ onCheckedIn }) {
    const api = useApiClient();
    const upload = useApiUpload();
    const [cameraOpen, setCameraOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);
    const [todayShift, setTodayShift] = useState(null);

    useEffect(() => {
        let cancelled = false;
        api('/api/schedule/my-shift-today')
            .then((res) => {
                if (!cancelled) setTodayShift(res.shift);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [api]);

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

                {todayShift?.status === 'work' && todayShift.start_time && (
                    <p className="hint">
                        Ваше время сегодня: {formatTimeShort(todayShift.start_time)}
                        {todayShift.end_time ? ` – ${formatTimeShort(todayShift.end_time)}` : ''}
                    </p>
                )}
                {todayShift?.status === 'off' && <p className="hint">Сегодня у вас выходной по графику.</p>}

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
