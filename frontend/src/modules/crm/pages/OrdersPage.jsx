import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonRows } from '../../../components/Skeleton';
import { useCrm } from '../CrmContext';
import OrderStatusBadge from '../components/OrderStatusBadge';
import SearchInput from '../components/SearchInput';
import { clientName, formatDate, formatMoney, vehicleTitle } from '../format';
import { ORDER_STEPS, t } from '../i18n';

const FILTERS = ['active', ...ORDER_STEPS, 'issued', 'cancelled', 'all'];

function filterToQuery(filter) {
    if (filter === 'all') return '';
    if (filter === 'active') return ORDER_STEPS.join(',');
    return filter;
}

export default function OrdersPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { can } = useCrm();

    const [filter, setFilter] = useState('active');
    const [q, setQ] = useState('');
    const [orders, setOrders] = useState(null);
    const [total, setTotal] = useState(0);
    const [counts, setCounts] = useState({});
    const [error, setError] = useState(null);

    function path(offset) {
        const params = new URLSearchParams();
        const status = filterToQuery(filter);
        if (status) params.set('status', status);
        if (q) params.set('q', q);
        if (offset) params.set('offset', String(offset));
        return `/api/crm/orders?${params}`;
    }

    useEffect(() => {
        let cancelled = false;
        setOrders(null);
        api(path(0))
            .then((res) => {
                if (cancelled) return;
                setOrders(res.orders);
                setTotal(res.total);
                setError(null);
            })
            .catch((err) => !cancelled && setError(err.message));
        return () => {
            cancelled = true;
        };
    }, [api, filter, q]);

    useEffect(() => {
        api('/api/crm/orders/summary')
            .then((res) => setCounts(res.counts))
            .catch(() => {});
    }, [api]);

    async function loadMore() {
        try {
            const res = await api(path(orders.length));
            setOrders((prev) => [...prev, ...res.orders]);
        } catch (err) {
            setError(err.message);
        }
    }

    const activeCount = ORDER_STEPS.reduce((sum, s) => sum + (counts[s] || 0), 0);
    function chipLabel(f) {
        if (f === 'active') return `${t('orders.filter.active')}${activeCount ? ` · ${activeCount}` : ''}`;
        if (f === 'all') return t('orders.filter.all');
        return `${t(`orderStatus.${f}`)}${counts[f] ? ` · ${counts[f]}` : ''}`;
    }

    return (
        <div className="page">
            <div className="page-header">
                <h1>{t('orders.title')}</h1>
                {can('orders.manage') && (
                    <button type="button" className="btn" onClick={() => navigate('/orders/new')}>
                        {t('orders.new')}
                    </button>
                )}
            </div>
            <SearchInput value={q} onChange={setQ} placeholder={t('orders.search')} />

            <div className="crm-chips">
                {FILTERS.map((f) => (
                    <button
                        key={f}
                        type="button"
                        className={filter === f ? 'crm-chip crm-chip--active' : 'crm-chip'}
                        onClick={() => setFilter(f)}
                    >
                        {chipLabel(f)}
                    </button>
                ))}
            </div>

            {error && <p className="error-text">{error}</p>}
            {!orders ? (
                <SkeletonRows count={5} />
            ) : orders.length === 0 ? (
                <p className="hint">{q || filter !== 'active' ? t('leads.emptyFiltered') : t('orders.empty')}</p>
            ) : (
                <ul className="list">
                    {orders.map((o) => {
                        const due = Number(o.total) - Number(o.paid_amount);
                        return (
                            <li key={o.id}>
                                <Link to={`/orders/${o.id}`} className="list-row crm-row">
                                    <div className="crm-row__main">
                                        <div className="list-row__title">
                                            №{o.number} · {clientName(o.client)}
                                        </div>
                                        <div className="hint">
                                            {[vehicleTitle(o.vehicle && { make: o.vehicle.make, model: o.vehicle.model }), o.vehicle?.plate]
                                                .filter((x) => x && x !== '—')
                                                .join(' · ') || t('order.noVehicle')}
                                        </div>
                                        <div className="hint">
                                            {formatMoney(o.total, o.currency)}
                                            {due > 0 && o.status !== 'cancelled' && (
                                                <span className="crm-debt"> · {t('orders.debt', { amount: formatMoney(due, o.currency) })}</span>
                                            )}
                                            {o.planned_ready_at && ORDER_STEPS.includes(o.status) && ` · ${t('orders.readyBy', { date: formatDate(o.planned_ready_at) })}`}
                                        </div>
                                    </div>
                                    <OrderStatusBadge status={o.status} />
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}
            {orders && orders.length < total && (
                <button type="button" className="btn btn--ghost btn--block" onClick={loadMore}>
                    {t('common.more')}
                </button>
            )}
        </div>
    );
}
