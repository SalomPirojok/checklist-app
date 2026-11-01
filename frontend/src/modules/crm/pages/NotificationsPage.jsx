import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonRows } from '../../../components/Skeleton';
import { hapticSelect } from '../../../lib/haptics';
import { t } from '../i18n';

export default function NotificationsPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [userId, setUserId] = useState(null);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        api('/api/crm/notifications')
            .then((res) => {
                setData(res);
                setUserId((res.users.find((u) => u.is_me) || res.users[0])?.id || null);
            })
            .catch((err) => setError(err.message));
    }, [api]);

    const user = data?.users.find((u) => u.id === userId);

    async function save(events) {
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            await api(`/api/crm/notifications/${userId}`, { method: 'PUT', body: { events } });
            setData((prev) => ({ ...prev, users: prev.users.map((u) => (u.id === userId ? { ...u, events } : u)) }));
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    function toggle(event) {
        hapticSelect();
        save(user.events.includes(event) ? user.events.filter((e) => e !== event) : [...user.events, event]);
    }

    async function sendTest() {
        setError(null);
        setMessage(null);
        try {
            await api('/api/crm/notifications/test', { method: 'POST' });
            setMessage(t('notif.testSent'));
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate(-1)}>
                {t('common.back')}
            </button>
            <div className="page-header">
                <h1>{t('notif.title')}</h1>
            </div>
            <p className="hint">{t('notif.hint')}</p>

            {!data ? (
                <SkeletonRows count={6} />
            ) : (
                <>
                    {data.users.length > 1 && (
                        <label className="field">
                            <span>{t('notif.forUser')}</span>
                            <select value={userId || ''} onChange={(e) => setUserId(e.target.value)}>
                                {data.users.map((u) => (
                                    <option key={u.id} value={u.id}>
                                        {u.full_name}
                                        {u.is_me ? ` (${t('access.you').toLowerCase()})` : ''}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                    {user && !user.has_telegram && <p className="crm-warning">{t('notif.noTelegram')}</p>}
                    {user && (
                        <ul className="list crm-toggles">
                            {data.events.map((event) => (
                                <li key={event}>
                                    <label className="list-row crm-toggle">
                                        <div className="crm-row__main">
                                            <div className="list-row__title">{t(`notif.event.${event}`)}</div>
                                            <div className="hint">{t(`notif.eventHint.${event}`)}</div>
                                        </div>
                                        <input type="checkbox" checked={user.events.includes(event)} disabled={saving} onChange={() => toggle(event)} />
                                    </label>
                                </li>
                            ))}
                        </ul>
                    )}
                    {user && (
                        <div className="crm-actions-row crm-actions-row--footer">
                            <button type="button" className="btn btn--ghost" disabled={saving} onClick={() => save(data.events)}>
                                {t('notif.all')}
                            </button>
                            <button type="button" className="btn btn--ghost" disabled={saving} onClick={() => save([])}>
                                {t('notif.none')}
                            </button>
                            {user.is_me && user.has_telegram && (
                                <button type="button" className="btn btn--ghost" onClick={sendTest}>
                                    {t('notif.test')}
                                </button>
                            )}
                        </div>
                    )}
                </>
            )}
            {message && <p className="success-text">{message}</p>}
            {error && <p className="error-text">{error}</p>}
        </div>
    );
}
