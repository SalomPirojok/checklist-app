import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonBlocks } from '../../../components/Skeleton';
import { useCrm } from '../CrmContext';
import OrderStatusBadge from '../components/OrderStatusBadge';
import { clientName, formatDate, formatMoney, vehicleTitle } from '../format';
import { t } from '../i18n';

const uzs = (n) => formatMoney(n, 'UZS');

function Tile({ value, label, tone, to }) {
    const body = (
        <>
            <div className={`stat-tile__value${tone ? ` crm-${tone}` : ''}`}>{value}</div>
            <div className="stat-tile__label">{label}</div>
        </>
    );
    return to ? (
        <Link to={to} className="stat-tile crm-tile-link">
            {body}
        </Link>
    ) : (
        <div className="stat-tile">{body}</div>
    );
}

export default function DashboardPage() {
    const api = useApiClient();
    const { can, sourceName } = useCrm();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        api('/api/crm/dashboard')
            .then(setData)
            .catch((err) => setError(err.message));
    }, [api]);

    if (!data) return <div className="page">{error ? <p className="error-text">{error}</p> : <SkeletonBlocks count={5} />}</div>;

    const m = data.month;
    const debts = Object.entries(data.client_debts);
    const sources = Object.entries(data.leads.by_source_month).sort((a, b) => b[1] - a[1]);

    return (
        <div className="page">
            <div className="page-header">
                <h1>{t('dash.title')}</h1>
            </div>

            <h3 className="crm-section-title">{t('dash.revenue')}</h3>
            <div className="kpi-row crm-kpis crm-kpis--3">
                <Tile value={uzs(data.revenue.today)} label={t('dash.today', { count: data.issued.today })} />
                <Tile value={uzs(data.revenue.week)} label={t('dash.week', { count: data.issued.week })} />
                <Tile value={uzs(data.revenue.month)} label={t('dash.month', { count: data.issued.month })} to={can('finance.view') ? '/finance' : null} />
            </div>

            <h3 className="crm-section-title">{t('dash.monthTitle')}</h3>
            <div className="card crm-totals">
                <div>
                    <span>{t('finance.costMaterials')}</span>
                    <span>−{uzs(m.cost_materials)}</span>
                </div>
                <div>
                    <span>{t('finance.costLabor')}</span>
                    <span>−{uzs(m.cost_labor)}</span>
                </div>
                <div className="crm-totals__strong">
                    <span>{t('finance.grossProfit')}</span>
                    <strong>{uzs(m.gross_profit)}</strong>
                </div>
                <div>
                    <span>{t('dash.expenses')}</span>
                    <span>−{uzs(m.expenses_opex + m.expenses_marketing + m.expenses_salaries)}</span>
                </div>
                <div className="crm-totals__strong">
                    <span>{t('finance.operatingProfit')}</span>
                    <strong className={m.operating_profit < 0 ? 'crm-debt' : undefined}>{uzs(m.operating_profit)}</strong>
                </div>
                <div>
                    <span>{t('finance.averageCheck')}</span>
                    <span>{uzs(m.average_check)}</span>
                </div>
            </div>

            <h3 className="crm-section-title">{t('dash.work')}</h3>
            <div className="kpi-row crm-kpis">
                <Tile value={data.leads.new} label={t('dash.newLeads')} tone={data.leads.new ? 'serious' : null} to="/leads" />
                <Tile value={data.orders.in_work} label={t('dash.inWork')} to="/orders" />
                <Tile value={data.orders.by_status.ready || 0} label={t('dash.ready')} tone={data.orders.by_status.ready ? 'income' : null} to="/orders" />
                <Tile value={data.orders.overdue} label={t('dash.overdue')} tone={data.orders.overdue ? 'debt' : null} to="/orders" />
            </div>

            {data.orders.list.length > 0 && (
                <ul className="list">
                    {data.orders.list.map((o) => (
                        <li key={o.id}>
                            <Link to={`/orders/${o.id}`} className="list-row crm-row">
                                <div className="crm-row__main">
                                    <div className="list-row__title">
                                        №{o.number} · {clientName(o.client)}
                                    </div>
                                    <div className="hint">
                                        {[o.vehicle && vehicleTitle({ make: o.vehicle.make, model: o.vehicle.model }), o.vehicle?.plate].filter(Boolean).join(' · ')}
                                        {o.planned_ready_at && (
                                            <span className={o.is_overdue ? 'crm-debt' : undefined}> · {t('orders.readyBy', { date: formatDate(o.planned_ready_at) })}</span>
                                        )}
                                    </div>
                                </div>
                                <OrderStatusBadge status={o.status} />
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            <h3 className="crm-section-title">{t('dash.leadsTitle')}</h3>
            <div className="card crm-totals">
                <div>
                    <span>{t('dash.leadsToday')}</span>
                    <span>{data.leads.today}</span>
                </div>
                <div>
                    <span>{t('dash.leadsMonth')}</span>
                    <span>{data.leads.month}</span>
                </div>
                <div>
                    <span>{t('dash.conversion')}</span>
                    <span>{data.leads.conversion_month === null ? '—' : `${data.leads.conversion_month}% (${data.leads.converted_month})`}</span>
                </div>
                {sources.map(([id, count]) => (
                    <div key={id} className="crm-totals__sub">
                        <span className="hint">{id === 'none' ? t('dash.noSource') : sourceName(id) || '—'}</span>
                        <span className="hint">{count}</span>
                    </div>
                ))}
            </div>

            <h3 className="crm-section-title">{t('dash.debts')}</h3>
            <div className="card crm-totals">
                <div>
                    <span>{t('dash.clientsOwe')}</span>
                    <strong className={debts.length ? 'crm-debt' : undefined}>
                        {debts.length ? debts.map(([cur, v]) => formatMoney(v, cur)).join(' + ') : uzs(0)}
                    </strong>
                </div>
                <div>
                    <span>{t('dash.weOweStaff')}</span>
                    <strong>{uzs(data.staff_owed)}</strong>
                </div>
            </div>
        </div>
    );
}
