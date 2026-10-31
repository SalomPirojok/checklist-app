import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonRows } from '../../../components/Skeleton';
import { useCrm } from '../CrmContext';
import LeadStatusBadge from '../components/LeadStatusBadge';
import SearchInput from '../components/SearchInput';
import { clientName, formatDateTime, formatPhone } from '../format';
import { OPEN_LEAD_STATUSES, t } from '../i18n';

// Filter chips: "open" = every not-yet-closed status, then each status.
const FILTERS = ['open', ...OPEN_LEAD_STATUSES, 'lost', 'all'];

function filterToQuery(filter) {
    if (filter === 'all') return '';
    if (filter === 'open') return OPEN_LEAD_STATUSES.join(',');
    return filter;
}

export default function LeadsPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { sourceName } = useCrm();

    const [filter, setFilter] = useState('open');
    const [q, setQ] = useState('');
    const [leads, setLeads] = useState([]);
    const [total, setTotal] = useState(0);
    const [counts, setCounts] = useState({});
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState(null);

    function buildPath(offset) {
        const params = new URLSearchParams();
        const status = filterToQuery(filter);
        if (status) params.set('status', status);
        if (q) params.set('q', q);
        if (offset) params.set('offset', String(offset));
        return `/api/crm/leads?${params}`;
    }

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api(buildPath(0))
            .then((res) => {
                if (cancelled) return;
                setLeads(res.leads);
                setTotal(res.total);
                setError(null);
            })
            .catch((err) => !cancelled && setError(err.message))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [api, filter, q]);

    useEffect(() => {
        api('/api/crm/leads/summary')
            .then((res) => setCounts(res.counts))
            .catch(() => {});
    }, [api]);

    async function loadMore() {
        setLoadingMore(true);
        try {
            const res = await api(buildPath(leads.length));
            setLeads((prev) => [...prev, ...res.leads]);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoadingMore(false);
        }
    }

    const openCount = OPEN_LEAD_STATUSES.reduce((sum, s) => sum + (counts[s] || 0), 0);
    function chipLabel(f) {
        if (f === 'open') return `${t('leads.filter.open')}${openCount ? ` · ${openCount}` : ''}`;
        if (f === 'all') return t('leads.filter.all');
        const count = counts[f];
        return `${t(`leadStatus.${f}`)}${count ? ` · ${count}` : ''}`;
    }

    return (
        <div className="page">
            <div className="page-header">
                <h1>{t('leads.title')}</h1>
                <button type="button" className="btn" onClick={() => navigate('/leads/new')}>
                    {t('leads.new')}
                </button>
            </div>

            <SearchInput value={q} onChange={setQ} />

            <div className="crm-chips" role="tablist">
                {FILTERS.map((f) => (
                    <button
                        key={f}
                        type="button"
                        role="tab"
                        aria-selected={filter === f}
                        className={filter === f ? 'crm-chip crm-chip--active' : 'crm-chip'}
                        onClick={() => setFilter(f)}
                    >
                        {chipLabel(f)}
                    </button>
                ))}
            </div>

            {error && <p className="error-text">{error}</p>}
            {loading ? (
                <SkeletonRows count={5} />
            ) : leads.length === 0 ? (
                <p className="hint">{q || filter !== 'open' ? t('leads.emptyFiltered') : t('leads.empty')}</p>
            ) : (
                <ul className="list">
                    {leads.map((lead) => (
                        <li key={lead.id}>
                            <Link to={`/leads/${lead.id}`} className="list-row crm-row">
                                <div className="crm-row__main">
                                    <div className="list-row__title">{clientName(lead.client)}</div>
                                    <div className="hint">
                                        {[
                                            formatPhone(lead.client?.phone),
                                            lead.client?.instagram_username && `@${lead.client.instagram_username}`,
                                        ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </div>
                                    <div className="hint">
                                        №{lead.number} · {t(`channel.${lead.channel}`)}
                                        {lead.source_id && ` · ${sourceName(lead.source_id)}`} · {formatDateTime(lead.created_at)}
                                    </div>
                                </div>
                                <LeadStatusBadge status={lead.status} />
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {!loading && leads.length < total && (
                <button type="button" className="btn btn--ghost btn--block" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? t('common.loading') : t('common.more')}
                </button>
            )}
        </div>
    );
}
