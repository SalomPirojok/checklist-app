import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonRows } from '../../../components/Skeleton';
import { useCrm } from '../CrmContext';
import PeriodPicker, { presetRange } from '../components/PeriodPicker';
import ReasonModal from '../components/ReasonModal';
import { formatDateTime, formatMoney } from '../format';
import { t } from '../i18n';

const TYPE_FILTERS = [
    ['all', null],
    ['client_payment', 'client_payment,client_refund'],
    ['expense', 'expense'],
    ['payroll_payout', 'payroll_payout'],
    ['transfer_in', 'transfer_in,transfer_out'],
    ['other_income', 'other_income'],
];

export default function FinanceJournalPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { can, account, staffName, userName } = useCrm();

    const [period, setPeriod] = useState({ preset: 'month', ...presetRange('month') });
    const [type, setType] = useState('all');
    const [rows, setRows] = useState(null);
    const [total, setTotal] = useState(0);
    const [reversing, setReversing] = useState(null);
    const [categories, setCategories] = useState(new Map());
    const [error, setError] = useState(null);

    function path(offset = 0) {
        const params = new URLSearchParams({ from: period.from, to: period.to, offset: String(offset) });
        const filter = TYPE_FILTERS.find(([key]) => key === type)[1];
        if (filter) params.set('type', filter);
        return `/api/crm/finance/transactions?${params}`;
    }

    async function load() {
        try {
            const res = await api(path());
            setRows(res.transactions);
            setTotal(res.total);
            setError(null);
        } catch (err) {
            setError(err.message);
        }
    }

    useEffect(() => {
        setRows(null);
        load();
    }, [api, period.from, period.to, type]);

    useEffect(() => {
        api('/api/crm/finance/expense-categories')
            .then((res) => setCategories(new Map(res.categories.map((c) => [c.id, c.name]))))
            .catch(() => {});
    }, [api]);

    async function loadMore() {
        try {
            const res = await api(path(rows.length));
            setRows((prev) => [...prev, ...res.transactions]);
        } catch (err) {
            setError(err.message);
        }
    }

    function describe(tx) {
        if (tx.type === 'expense') return categories.get(tx.category_id) || t('txType.expense');
        if (tx.type === 'payroll_payout') return `${t('txType.payroll_payout')}: ${staffName(tx.staff_id) || ''}`;
        return t(`txType.${tx.type}`);
    }

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate(-1)}>
                {t('common.back')}
            </button>
            <div className="page-header">
                <h1>{t('journal.title')}</h1>
            </div>
            <PeriodPicker value={period} onChange={setPeriod} />
            <div className="crm-chips">
                {TYPE_FILTERS.map(([key]) => (
                    <button key={key} type="button" className={type === key ? 'crm-chip crm-chip--active' : 'crm-chip'} onClick={() => setType(key)}>
                        {key === 'all' ? t('journal.all') : key === 'transfer_in' ? t('finance.transfer') : t(`txType.${key}`)}
                    </button>
                ))}
            </div>

            {error && <p className="error-text">{error}</p>}
            {!rows ? (
                <SkeletonRows count={6} />
            ) : rows.length === 0 ? (
                <p className="hint">{t('journal.empty')}</p>
            ) : (
                <ul className="list">
                    {rows.map((tx) => (
                        <li key={tx.id} className={`list-row crm-line${tx.is_reversed || tx.reversal_of ? ' crm-row--muted' : ''}`}>
                            <div className="crm-row__main">
                                <div className="list-row__title">
                                    {describe(tx)}
                                    {tx.reversal_of && <span className="tag">{t('order.reversal')}</span>}
                                    {tx.is_reversed && <span className="tag">{t('order.reversed')}</span>}
                                </div>
                                <div className="hint">
                                    {[account(tx.account_id)?.name, formatDateTime(tx.occurred_at), userName(tx.created_by)].filter(Boolean).join(' · ')}
                                </div>
                                {tx.note && <div className="hint">{tx.note}</div>}
                                {tx.order_id && (
                                    <Link to={`/orders/${tx.order_id}`} className="hint">
                                        {t('nav.orders')} →
                                    </Link>
                                )}
                            </div>
                            <div className="crm-line__side">
                                <strong className={tx.direction < 0 ? 'crm-debt' : 'crm-income'}>
                                    {tx.direction > 0 ? '+' : '−'}
                                    {formatMoney(tx.amount, tx.currency)}
                                </strong>
                                {can('finance.manage') && !tx.is_reversed && !tx.reversal_of && (
                                    <button type="button" className="btn btn--ghost btn--danger" onClick={() => setReversing(tx)}>
                                        {t('order.reverse')}
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            {rows && rows.length < total && (
                <button type="button" className="btn btn--ghost btn--block" onClick={loadMore}>
                    {t('common.more')}
                </button>
            )}

            {reversing && (
                <ReasonModal
                    title={`${t('journal.reverseTitle')}: ${formatMoney(reversing.amount, reversing.currency)}`}
                    label={t('order.reverseReason')}
                    confirmLabel={t('order.reverse')}
                    danger
                    onClose={() => setReversing(null)}
                    onConfirm={async (reason) => {
                        await api(`/api/crm/finance/transactions/${reversing.id}/reverse`, { method: 'POST', body: { reason } });
                        setReversing(null);
                        await load();
                    }}
                />
            )}
        </div>
    );
}
