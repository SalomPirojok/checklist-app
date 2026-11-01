import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonBlocks } from '../../../components/Skeleton';
import { useCrm } from '../CrmContext';
import { ExpenseModal, IncomeModal, TransferModal } from '../components/MoneyOperationModals';
import PeriodPicker, { presetRange } from '../components/PeriodPicker';
import { clientName, formatDate, formatMoney } from '../format';
import { t } from '../i18n';

const uzs = (n) => formatMoney(n, 'UZS');
const byCurrency = (totals) =>
    Object.entries(totals)
        .filter(([, v]) => v)
        .map(([cur, v]) => formatMoney(v, cur))
        .join(' + ') || uzs(0);

function Row({ label, value, strong, negative, hint }) {
    return (
        <div className={strong ? 'crm-totals__strong' : undefined}>
            <span>
                {label}
                {hint && <span className="hint"> · {hint}</span>}
            </span>
            {strong ? <strong className={negative ? 'crm-debt' : undefined}>{value}</strong> : <span>{value}</span>}
        </div>
    );
}

export default function FinancePage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { can, categoryName } = useCrm();

    const [period, setPeriod] = useState({ preset: 'month', ...presetRange('month') });
    const [report, setReport] = useState(null);
    const [accounts, setAccounts] = useState([]);
    const [expenseCategories, setExpenseCategories] = useState([]);
    const [modal, setModal] = useState(null);
    const [error, setError] = useState(null);

    async function load() {
        try {
            const [r, a] = await Promise.all([
                api(`/api/crm/finance/report?from=${period.from}&to=${period.to}`),
                api('/api/crm/finance/accounts'),
            ]);
            setReport(r);
            setAccounts(a.accounts.filter((acc) => !acc.is_archived || acc.balance));
            setError(null);
        } catch (err) {
            setError(err.message);
        }
    }

    useEffect(() => {
        setReport(null);
        load();
    }, [api, period.from, period.to]);

    useEffect(() => {
        if (!can('finance.manage')) return;
        api('/api/crm/finance/expense-categories')
            .then((res) => setExpenseCategories(res.categories))
            .catch(() => {});
    }, [api]);

    async function save(path, body) {
        await api(path, { method: 'POST', body });
        setModal(null);
        await load();
    }

    const p = report?.profit;

    return (
        <div className="page">
            <div className="page-header">
                <h1>{t('finance.title')}</h1>
            </div>

            {can('finance.manage') && (
                <div className="crm-actions-row">
                    <button type="button" className="btn" onClick={() => setModal('expense')}>
                        {t('finance.expense')}
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => setModal('income')}>
                        {t('finance.income')}
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => setModal('transfer')}>
                        {t('finance.transfer')}
                    </button>
                </div>
            )}

            <PeriodPicker value={period} onChange={setPeriod} />
            {error && <p className="error-text">{error}</p>}

            {!report ? (
                <SkeletonBlocks count={4} />
            ) : (
                <>
                    <div className="kpi-row crm-kpis">
                        <div className="stat-tile">
                            <div className="stat-tile__value">{uzs(p.revenue)}</div>
                            <div className="stat-tile__label">{t('finance.revenue')}</div>
                        </div>
                        <div className="stat-tile">
                            <div className={`stat-tile__value${p.operating_profit < 0 ? ' crm-debt' : ''}`}>{uzs(p.operating_profit)}</div>
                            <div className="stat-tile__label">{t('finance.operatingProfit')}</div>
                        </div>
                        <div className="stat-tile">
                            <div className="stat-tile__value">{p.orders_count}</div>
                            <div className="stat-tile__label">{t('finance.ordersCount')}</div>
                        </div>
                        <div className="stat-tile">
                            <div className="stat-tile__value">{uzs(p.average_check)}</div>
                            <div className="stat-tile__label">{t('finance.averageCheck')}</div>
                        </div>
                    </div>

                    <h3 className="crm-section-title">{t('finance.profitTitle')}</h3>
                    <div className="card crm-totals">
                        <Row label={t('finance.revenue')} value={uzs(p.revenue)} />
                        <Row label={t('finance.costMaterials')} value={`−${uzs(p.cost_materials)}`} />
                        <Row label={t('finance.costLabor')} value={`−${uzs(p.cost_labor)}`} />
                        <Row
                            label={t('finance.grossProfit')}
                            hint={p.revenue ? t('finance.margin', { value: p.gross_margin }) : null}
                            value={uzs(p.gross_profit)}
                            strong
                            negative={p.gross_profit < 0}
                        />
                        <Row label={t('finance.opex')} value={`−${uzs(p.expenses_opex)}`} />
                        <Row label={t('finance.marketing')} value={`−${uzs(p.expenses_marketing)}`} />
                        <Row label={t('finance.salaries')} value={`−${uzs(p.expenses_salaries)}`} />
                        <Row label={t('finance.operatingProfit')} value={uzs(p.operating_profit)} strong negative={p.operating_profit < 0} />
                    </div>
                    <p className="hint">{t('finance.profitHint')}</p>
                    {p.material_purchases > 0 && <p className="hint">{t('finance.materialPurchases', { amount: uzs(p.material_purchases) })}</p>}

                    <h3 className="crm-section-title">{t('finance.byCategory')}</h3>
                    {report.by_category.length === 0 ? (
                        <p className="hint">{t('finance.byCategoryEmpty')}</p>
                    ) : (
                        <ul className="list">
                            {report.by_category.map((c) => (
                                <li key={c.category_id} className="list-row crm-line">
                                    <div className="crm-row__main">
                                        <div className="list-row__title">{categoryName(c.category_id) || '—'}</div>
                                        <div className="hint">
                                            {t('finance.revenue')} {uzs(c.revenue)} · {t('order.materialsCost')} {uzs(c.materials)} · {t('order.laborCost')}{' '}
                                            {uzs(c.labor)}
                                        </div>
                                    </div>
                                    <div className="crm-line__side">
                                        <strong className={c.gross_profit < 0 ? 'crm-debt' : undefined}>{uzs(c.gross_profit)}</strong>
                                        <span className="hint">{t('finance.category.lines', { count: c.lines })}</span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}

                    <h3 className="crm-section-title">{t('finance.expensesTitle')}</h3>
                    {report.expenses_by_category.length === 0 ? (
                        <p className="hint">{t('finance.noExpenses')}</p>
                    ) : (
                        <div className="card crm-totals">
                            {report.expenses_by_category.map((e) => (
                                <Row key={e.category_id} label={e.name} value={uzs(e.amount)} />
                            ))}
                        </div>
                    )}

                    <h3 className="crm-section-title">{t('finance.cashTitle')}</h3>
                    <div className="card crm-totals">
                        <Row label={t('finance.inflow')} value={uzs(report.cash_flow.inflow)} />
                        <Row label={t('finance.outflow')} value={`−${uzs(report.cash_flow.outflow)}`} />
                        {Object.entries(report.cash_flow.by_type).map(([type, amount]) => (
                            <div key={type} className="crm-totals__sub">
                                <span className="hint">{t(`txType.${type}`)}</span>
                                <span className="hint">{uzs(amount)}</span>
                            </div>
                        ))}
                        <Row label={t('finance.net')} value={uzs(report.cash_flow.net)} strong negative={report.cash_flow.net < 0} />
                    </div>
                    <p className="hint">{t('finance.cashHint')}</p>

                    <h3 className="crm-section-title">{t('finance.accountsTitle')}</h3>
                    <div className="card crm-totals">
                        {accounts.map((a) => (
                            <Row key={a.id} label={a.name} value={formatMoney(a.balance, a.currency)} />
                        ))}
                    </div>

                    <h3 className="crm-section-title">{t('finance.debtsTitle')}</h3>
                    {Object.keys(report.advances).length > 0 && <p className="hint">{t('finance.advances', { amount: byCurrency(report.advances) })}</p>}
                    {report.client_debts.orders.length === 0 ? (
                        <p className="hint">{t('finance.noDebts')}</p>
                    ) : (
                        <>
                            <p className="crm-debt">
                                <strong>{byCurrency(report.client_debts.total)}</strong>
                            </p>
                            <ul className="list">
                                {report.client_debts.orders.map((d) => (
                                    <li key={d.id}>
                                        <Link to={`/orders/${d.id}`} className="list-row crm-row">
                                            <div className="crm-row__main">
                                                <div className="list-row__title">{clientName(d.client)}</div>
                                                <div className="hint">
                                                    {t('order.title', { number: d.number })} · {formatDate(d.issued_at)}
                                                </div>
                                            </div>
                                            <strong className="crm-debt">{formatMoney(d.due, d.currency)}</strong>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}

                    <div className="crm-actions-row crm-actions-row--footer">
                        <button type="button" className="btn btn--ghost" onClick={() => navigate('/finance/journal')}>
                            {t('finance.journal')}
                        </button>
                        {can('finance.manage') && (
                            <button type="button" className="btn btn--ghost" onClick={() => navigate('/finance/settings')}>
                                {t('finance.settings')}
                            </button>
                        )}
                    </div>
                </>
            )}

            {modal === 'expense' && (
                <ExpenseModal categories={expenseCategories} onClose={() => setModal(null)} onSave={(body) => save('/api/crm/finance/expenses', body)} />
            )}
            {modal === 'income' && <IncomeModal onClose={() => setModal(null)} onSave={(body) => save('/api/crm/finance/income', body)} />}
            {modal === 'transfer' && <TransferModal onClose={() => setModal(null)} onSave={(body) => save('/api/crm/finance/transfers', body)} />}
        </div>
    );
}
