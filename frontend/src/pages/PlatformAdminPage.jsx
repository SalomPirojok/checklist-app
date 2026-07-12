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

function EditOwnerModal({ org, onSave, onClose }) {
    const [username, setUsername] = useState(org.owner?.username || '');
    const [fullName, setFullName] = useState(org.owner?.full_name || '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        setSaving(true);
        try {
            await onSave({ username: username.trim(), full_name: fullName.trim() });
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
                <h2>Исправить владельца</h2>
                <p className="hint">«{org.name}» — владелец ещё не подключил Telegram, можно поправить данные.</p>
                <form onSubmit={handleSubmit} className="form">
                    <label className="field">
                        <span>Имя владельца</span>
                        <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                    </label>
                    <label className="field">
                        <span>Telegram username (без @)</span>
                        <input type="text" required value={username} onChange={(e) => setUsername(e.target.value)} />
                    </label>

                    {error && <p className="error-text">{error}</p>}

                    <div className="form-actions">
                        <button type="button" className="btn btn--ghost" onClick={onClose}>
                            Отмена
                        </button>
                        <button type="submit" className="btn" disabled={saving}>
                            {saving ? 'Сохранение...' : 'Сохранить'}
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
    const [editingOwnerOrg, setEditingOwnerOrg] = useState(null);
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

    async function handleSaveOwner(org, payload) {
        await api(`/api/platform-admin/organizations/${org.id}/owner`, { method: 'PATCH', body: payload });
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
                                    {org.owner && (
                                        <div className="hint">
                                            Владелец: {org.owner.full_name}
                                            {org.owner.username && ` · @${org.owner.username}`}
                                            {!org.owner.telegram_id && <span className="tag tag--pending">не подключён</span>}
                                        </div>
                                    )}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                                    <button
                                        type="button"
                                        className={org.is_suspended ? 'btn btn--ghost' : 'btn btn--ghost btn--danger'}
                                        onClick={() => handleToggleSuspend(org)}
                                        disabled={togglingId === org.id}
                                    >
                                        {togglingId === org.id ? '...' : org.is_suspended ? 'Активировать' : 'Приостановить'}
                                    </button>
                                    {org.owner && !org.owner.telegram_id && (
                                        <button type="button" className="btn btn--ghost" onClick={() => setEditingOwnerOrg(org)}>
                                            Исправить владельца
                                        </button>
                                    )}
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {showCreateModal && <CreateOrgModal onCreate={handleCreate} onClose={() => setShowCreateModal(false)} />}
            {editingOwnerOrg && (
                <EditOwnerModal
                    org={editingOwnerOrg}
                    onSave={(payload) => handleSaveOwner(editingOwnerOrg, payload)}
                    onClose={() => setEditingOwnerOrg(null)}
                />
            )}
        </div>
    );
}
