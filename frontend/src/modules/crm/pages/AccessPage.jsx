import { useEffect, useState } from 'react';
import { useApiClient } from '../../../api/useApiClient';
import { useAuth } from '../../../context/AuthContext';
import { SkeletonRows } from '../../../components/Skeleton';
import { ROLE_LABELS } from '../../../constants';
import { hapticSuccess } from '../../../lib/haptics';
import { t } from '../i18n';

export default function AccessPage() {
    const api = useApiClient();
    const { user: me } = useAuth();

    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        api('/api/crm/access')
            .then((res) => {
                setUsers(res.users);
                setRoles(res.roles);
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [api]);

    async function changeRole(userId, roleId) {
        setSavingId(userId);
        setError(null);
        try {
            await api(`/api/crm/access/${userId}`, { method: 'PUT', body: { role_id: roleId || null } });
            setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, crm_role_id: roleId || null } : u)));
            hapticSuccess();
        } catch (err) {
            setError(err.message);
        } finally {
            setSavingId(null);
        }
    }

    // Deactivated users without a role are just noise here.
    const visible = users.filter((u) => u.is_active || u.crm_role_id);

    return (
        <div className="page">
            <div className="page-header">
                <h1>{t('access.title')}</h1>
            </div>
            <p className="hint">{t('access.hint')}</p>

            {error && <p className="error-text">{error}</p>}
            {loading ? (
                <SkeletonRows count={4} />
            ) : (
                <ul className="list">
                    {visible.map((u) => (
                        <li key={u.id} className="list-row">
                            <div className="crm-row__main">
                                <div className="list-row__title">{u.full_name}</div>
                                <div className="hint">
                                    {[u.username && `@${u.username}`, ROLE_LABELS[u.role], !u.is_active && t('access.inactive')]
                                        .filter(Boolean)
                                        .join(' · ')}
                                </div>
                            </div>
                            {u.role === 'owner' ? (
                                <span className="hint">{t('access.owner')}</span>
                            ) : u.id === me.id ? (
                                <span className="hint">{t('access.you')}</span>
                            ) : (
                                <select
                                    className="crm-role-select"
                                    value={u.crm_role_id || ''}
                                    disabled={savingId === u.id}
                                    onChange={(e) => changeRole(u.id, e.target.value)}
                                >
                                    <option value="">{t('access.noAccess')}</option>
                                    {roles.map((r) => (
                                        <option key={r.id} value={r.id}>
                                            {r.name}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {roles.length > 0 && (
                <>
                    <h3 className="crm-section-title">{t('access.rolesTitle')}</h3>
                    <div className="crm-roles">
                        {roles.map((r) => (
                            <div key={r.id} className="card">
                                <div className="list-row__title">{r.name}</div>
                                <div className="hint">{r.permissions.map((p) => t(`permission.${p}`)).join(', ')}</div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
