import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';

export default function PenaltySettingsPage() {
    const api = useApiClient();
    const navigate = useNavigate();

    const [enabled, setEnabled] = useState(false);
    const [thresholdMinutes, setThresholdMinutes] = useState(15);
    const [penaltyAmount, setPenaltyAmount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        api('/api/penalties/settings')
            .then((res) => {
                setEnabled(res.settings.auto_penalty_enabled);
                setThresholdMinutes(res.settings.late_threshold_minutes);
                setPenaltyAmount(Number(res.settings.late_penalty_amount));
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [api]);

    async function handleSave(e) {
        e.preventDefault();
        setError(null);
        setSaved(false);
        setSaving(true);
        try {
            await api('/api/penalties/settings', {
                method: 'PATCH',
                body: {
                    auto_penalty_enabled: enabled,
                    late_threshold_minutes: Number(thresholdMinutes),
                    late_penalty_amount: Number(penaltyAmount),
                },
            });
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
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate('/penalties')}>
                ← Назад
            </button>
            <div className="page-header">
                <h1>Настройки автоштрафа</h1>
            </div>

            <form onSubmit={handleSave} className="form">
                <label className="checkbox-field">
                    <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                    <span>Автоматически штрафовать за опоздание</span>
                </label>

                <label className="field">
                    <span>Порог опоздания (минут)</span>
                    <input
                        type="number"
                        min="0"
                        value={thresholdMinutes}
                        onChange={(e) => setThresholdMinutes(e.target.value)}
                        required
                    />
                    <span className="hint">
                        Штраф начисляется, если приход позже личного времени начала смены сотрудника (см. «График») плюс
                        этот порог. Если на сегодня график не задан, штраф не начисляется.
                    </span>
                </label>

                <label className="field">
                    <span>Сумма штрафа</span>
                    <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={penaltyAmount}
                        onChange={(e) => setPenaltyAmount(e.target.value)}
                        required
                    />
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
