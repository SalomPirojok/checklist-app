import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonRows } from '../../../components/Skeleton';
import LeadStatusBadge from '../components/LeadStatusBadge';
import SearchInput from '../components/SearchInput';
import { clientName, formatPhone } from '../format';
import { t } from '../i18n';

export default function ClientsPage() {
    const api = useApiClient();
    const navigate = useNavigate();

    const [q, setQ] = useState('');
    const [clients, setClients] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState(null);

    const path = (offset) => `/api/crm/clients?${new URLSearchParams({ q, offset: String(offset) })}`;

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api(path(0))
            .then((res) => {
                if (cancelled) return;
                setClients(res.clients);
                setTotal(res.total);
                setError(null);
            })
            .catch((err) => !cancelled && setError(err.message))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [api, q]);

    async function loadMore() {
        setLoadingMore(true);
        try {
            const res = await api(path(clients.length));
            setClients((prev) => [...prev, ...res.clients]);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoadingMore(false);
        }
    }

    return (
        <div className="page">
            <div className="page-header">
                <h1>{t('clients.title')}</h1>
                <button type="button" className="btn" onClick={() => navigate('/clients/new')}>
                    {t('clients.new')}
                </button>
            </div>

            <SearchInput value={q} onChange={setQ} />

            {error && <p className="error-text">{error}</p>}
            {loading ? (
                <SkeletonRows count={5} />
            ) : clients.length === 0 ? (
                <p className="hint">{q ? t('leads.emptyFiltered') : t('clients.empty')}</p>
            ) : (
                <ul className="list">
                    {clients.map((c) => (
                        <li key={c.id}>
                            <Link to={`/clients/${c.id}`} className="list-row crm-row">
                                <div className="crm-row__main">
                                    <div className="list-row__title">{clientName(c)}</div>
                                    <div className="hint">
                                        {[formatPhone(c.phone), c.instagram_username && `@${c.instagram_username}`]
                                            .filter(Boolean)
                                            .join(' · ') || t('common.none')}
                                    </div>
                                </div>
                                {c.latest_lead && <LeadStatusBadge status={c.latest_lead.status} />}
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {!loading && clients.length < total && (
                <button type="button" className="btn btn--ghost btn--block" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? t('common.loading') : t('common.more')}
                </button>
            )}
        </div>
    );
}
