import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';

export default function ReportSettingsPage() {
    const api = useApiClient();
    const navigate = useNavigate();

    const [dailyReportTime, setDailyReportTime] = useState('22:00');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        api('/api/reports/settings')
            .then((res) => setDailyReportTime((res.settings.daily_report_time || '22:00').slice(0, 5)))
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [api]);

    async function handleSave(e) {
        e.preventDefault();
        setError(null);
        setSaved(false);
        setSaving(true);
        try {
            await api('/api/reports/settings', { method: 'PATCH', body: { daily_report_time: dailyReportTime } });
            setSaved(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <p>Загрузка...</p>;

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate('/reports')}>
                ← Назад
            </button>
            <div className="page-header">
                <h1>Настройки отчёта</h1>
            </div>

            <form onSubmit={handleSave} className="form">
                <label className="field">
                    <span>Время ежедневной отправки отчёта</span>
                    <input type="time" value={dailyReportTime} onChange={(e) => setDailyReportTime(e.target.value)} required />
                    <span className="hint">Владелец получит сводку в Telegram в это время, если за день была активность.</span>
                </label>

                {saved && <p className="success-text">Настройки сохранены.</p>}
                {error && <p className="error-text">{error}</p>}

                <div className="form-actions">
                    <button type="submit" className="btn" disabled={saving}>
                        {saving ? 'Сохранение...' : 'Сохранить'}
                    </button>
                </div>
            </form>
        </div>
    );
}
