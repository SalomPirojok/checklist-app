import { useEffect, useState } from 'react';
import { useApiClient } from '../api/useApiClient';
import { SkeletonRows } from '../components/Skeleton';

function formatDate(iso) {
    if (!iso) return 'нет активности';
    return new Date(iso).toLocaleString('ru-RU');
}

function CreateOrgModal({ onCreate, onClose }) {
    const [orgName, setOrgName] = useState('');
    const [ownerUsername, setOwnerUsername] = useState('');
    const [ownerFullName, setOwnerFullName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        setSaving(true);
        try {
            await onCreate({
                organization_name: orgName.trim(),
                owner_username: ownerUsername.trim(),
                owner_full_name: ownerFullName.trim(),
            });
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h2>Создать организацию</h2>
                <form onSubmit={handleSubmit} className="form">
                    <label className="field">
                        <span>Название организации</span>
                        <input type="text" required value={orgName} onChange={(e) => setOrgName(e.target.value)} />
                    </label>
                    <label className="field">
                        <span>Имя владельца</span>
                        <input type="text" required value={ownerFullName} onChange={(e) => setOwnerFullName(e.target.value)} />
                    </label>
                    <label className="field">
                        <span>Telegram username владельца (без @)</span>
                        <input type="text" required value={ownerUsername} onChange={(e) => setOwnerUsername(e.target.value)} />
                        <span className="hint">Владелец привяжется сам при первом открытии приложения.</span>
                    </label>

                    {error && <p className="error-text">{error}</p>}

                    <div className="form-actions">
                        <button type="button" className="btn btn--ghost" onClick={onClose}>
                            Отмена
                        </button>
                        <button type="submit" className="btn" disabled={saving}>
                            {saving ? 'Создание...' : 'Создать'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function PlatformAdminPage() {
    const api = useApiClient();
    const [organizations, setOrganizations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [togglingId, setTogglingId] = useState(null);

    async function load() {
        setLoading(true);
        try {
            const res = await api('/api/platform-admin/organizations');
            setOrganizations(res.organizations);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api]);

    async function handleToggleSuspend(org) {
        const nextSuspended = !org.is_suspended;
        if (nextSuspended && !confirm(`Приостановить организацию «${org.name}»? Все её пользователи потеряют доступ.`)) return;
        setTogglingId(org.id);
        try {
            await api(`/api/platform-admin/organizations/${org.id}`, {
                method: 'PATCH',
                body: { is_suspended: nextSuspended },
            });
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setTogglingId(null);
        }
    }

    async function handleCreate(payload) {
        await api('/api/platform-admin/organizations', { method: 'POST', body: payload });
        await load();
    }

    return (
        <div className="page">
            <div className="page-header">
                <h1>Организации</h1>
                <button type="button" className="btn" onClick={() => setShowCreateModal(true)}>
                    + Создать организацию
                </button>
            </div>

            {loading && <SkeletonRows count={4} />}
            {error && <p className="error-text">{error}</p>}

            {!loading && !error && (
                <ul className="list">
                    {organizations.length === 0 && <p className="hint">Организаций пока нет.</p>}
                    {organizations.map((org) => (
                        <li key={org.id} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: '8px' }}>
                                <div>
                                    <div className="list-row__title">
                                        {org.name}
                                        {org.is_suspended && <span className="tag tag--pending">приостановлена</span>}
                                    </div>
                                    <div className="hint">Создана: {formatDate(org.created_at)}</div>
                                    <div className="hint">Сотрудников: {org.employee_count}</div>
                                    <div className="hint">Последняя активность: {formatDate(org.last_activity_at)}</div>
                                </div>
                                <button
                                    type="button"
                                    className={org.is_suspended ? 'btn btn--ghost' : 'btn btn--ghost btn--danger'}
                                    onClick={() => handleToggleSuspend(org)}
                                    disabled={togglingId === org.id}
                                >
                                    {togglingId === org.id ? '...' : org.is_suspended ? 'Активировать' : 'Приостановить'}
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {showCreateModal && <CreateOrgModal onCreate={handleCreate} onClose={() => setShowCreateModal(false)} />}
        </div>
    );
}
