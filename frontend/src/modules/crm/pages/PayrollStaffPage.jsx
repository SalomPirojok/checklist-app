import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonBlocks } from '../../../components/Skeleton';
import { useCrm } from '../CrmContext';
import Modal from '../components/Modal';
import ReasonModal from '../components/ReasonModal';
import { useFxRate } from '../components/useFxRate';
import { formatDate, formatDateTime, formatMoney } from '../format';
import { t } from '../i18n';

const uzs = (n) => formatMoney(n, 'UZS');

function PayoutModal({ owed, onSave, onClose }) {
    const { activeAccounts } = useCrm();
    const [accountId, setAccountId] = useState(activeAccounts.find((a) => a.currency === 'UZS')?.id || activeAccounts[0]?.id || '');
    const account = activeAccounts.find((a) => a.id === accountId);
    const [amount, setAmount] = useState(account?.currency === 'UZS' && owed > 0 ? String(owed) : '');
    const [note, setNote] = useState('');
    const [rate, setRate] = useFxRate(account?.currency);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    async function submit(e) {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            await onSave({ account_id: accountId, amount: Number(amount), fx_rate: account?.currency === 'UZS' ? null : Number(rate) || null, note });
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    }

    return (
        <Modal title={t('payroll.payoutTitle')} onClose={onClose}>
            <form className="form" onSubmit={submit}>
                <label className="field">
                    <span>{t('payment.account')}</span>
                    <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                        {activeAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                                {a.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="field">
                    <span>
                        {t('payment.amount')}, {account?.currency}
                    </span>
                    <input type="number" inputMode="decimal" min="0" step="any" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
                {account && account.currency !== 'UZS' && (
                    <label className="field">
                        <span>{t('payment.rate', { currency: account.currency })}</span>
                        <input type="number" inputMode="decimal" min="0" step="any" required value={rate} onChange={(e) => setRate(e.target.value)} />
                    </label>
                )}
                <label className="field">
                    <span>{t('payment.note')}</span>
                    <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
                {error && <p className="error-text">{error}</p>}
                <button type="submit" className="btn btn--block" disabled={saving || !Number(amount)}>
                    {saving ? t('common.saving') : t('payroll.payout')}
                </button>
            </form>
        </Modal>
    );
}

function EntryModal({ kind, onSave, onClose }) {
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    async function submit(e) {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            await onSave({ kind, amount: Number(amount), note });
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    }

    return (
        <Modal title={t(kind === 'bonus' ? 'payroll.bonusTitle' : 'payroll.deductionTitle')} onClose={onClose}>
            <form className="form" onSubmit={submit}>
                <label className="field">
                    <span>{t('payment.amount')}, UZS</span>
                    <input type="number" inputMode="decimal" min="0" step="any" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
                <label className="field">
                    <span>{t('payment.note')}</span>
                    <input type="text" required value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
                {error && <p className="error-text">{error}</p>}
                <button type="submit" className="btn btn--block" disabled={saving || !Number(amount) || !note.trim()}>
                    {saving ? t('common.saving') : t('common.save')}
                </button>
            </form>
        </Modal>
    );
}

export default function PayrollStaffPage() {
    const { staffId } = useParams();
    const api = useApiClient();
    const navigate = useNavigate();
    const { can, account, userName } = useCrm();

    const [data, setData] = useState(null);
    const [modal, setModal] = useState(null);
    const [error, setError] = useState(null);

    async function load() {
        try {
            setData(await api(`/api/crm/payroll/staff/${staffId}`));
            setError(null);
        } catch (err) {
            setError(err.message);
        }
    }

    useEffect(() => {
        load();
    }, [api, staffId]);

    async function save(path, body) {
        await api(path, { method: 'POST', body });
        setModal(null);
        await load();
    }

    if (!data) return <div className="page">{error ? <p className="error-text">{error}</p> : <SkeletonBlocks count={3} />}</div>;

    const { staff, balance, entries, payouts } = data;
    const manage = can('payroll.manage');

    // One timeline: accruals (+) and payouts (−), newest first.
    const timeline = [
        ...entries.map((e) => ({ ...e, _type: 'entry', _at: e.created_at })),
        ...payouts.map((p) => ({ ...p, _type: 'payout', _at: p.occurred_at })),
    ].sort((a, b) => (a._at < b._at ? 1 : -1));

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate(-1)}>
                {t('common.back')}
            </button>
            <div className="page-header">
                <h1>{staff.full_name}</h1>
            </div>
            <p className="hint">
                {[staff.position, t(`payScheme.${staff.pay_scheme}`), Number(staff.base_salary) > 0 && uzs(staff.base_salary)].filter(Boolean).join(' · ')}
            </p>

            <div className="card crm-totals">
                <div>
                    <span>{t('payroll.accrued')}</span>
                    <span>{uzs(balance.accrued)}</span>
                </div>
                <div>
                    <span>{t('payroll.paid')}</span>
                    <span>{uzs(balance.paid)}</span>
                </div>
                <div className="crm-totals__strong">
                    <span>{balance.owed < 0 ? t('payroll.overpaid') : t('payroll.owed')}</span>
                    <strong className={balance.owed > 0 ? 'crm-debt' : undefined}>{uzs(Math.abs(balance.owed))}</strong>
                </div>
            </div>

            {manage && (
                <div className="crm-actions-row">
                    <button type="button" className="btn" onClick={() => setModal({ type: 'payout' })}>
                        {t('payroll.payout')}
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => setModal({ type: 'entry', kind: 'bonus' })}>
                        {t('payroll.bonus')}
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => setModal({ type: 'entry', kind: 'deduction' })}>
                        {t('payroll.deduction')}
                    </button>
                </div>
            )}
            {error && <p className="error-text">{error}</p>}

            <h3 className="crm-section-title">{t('payroll.history')}</h3>
            {timeline.length === 0 ? (
                <p className="hint">{t('payroll.noHistory')}</p>
            ) : (
                <ul className="list">
                    {timeline.map((row) => {
                        const isPayout = row._type === 'payout';
                        const muted = row.is_reversed || row.reversal_of;
                        const amount = isPayout ? formatMoney(row.amount, row.currency) : uzs(Math.abs(row.amount));
                        const sign = isPayout ? (row.direction < 0 ? '−' : '+') : Number(row.amount) < 0 ? '−' : '+';
                        return (
                            <li key={`${row._type}-${row.id}`} className={`list-row crm-line${muted ? ' crm-row--muted' : ''}`}>
                                <div className="crm-row__main">
                                    <div className="list-row__title">
                                        {isPayout ? t('entry.payout') : t(`entryKind.${row.kind}`)}
                                        {row.reversal_of && <span className="tag">{t('order.reversal')}</span>}
                                        {row.is_reversed && <span className="tag">{t('order.reversed')}</span>}
                                    </div>
                                    <div className="hint">
                                        {[
                                            formatDateTime(row._at),
                                            isPayout && account(row.account_id)?.name,
                                            !isPayout && row.details?.line_name,
                                            !isPayout && row.period_month && formatDate(row.period_month),
                                            userName(row.created_by),
                                        ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </div>
                                    {row.note && <div className="hint">{row.note}</div>}
                                    {row.order_id && (
                                        <Link to={`/orders/${row.order_id}`} className="hint">
                                            {t('order.title', { number: row.details?.order_number || '' })} →
                                        </Link>
                                    )}
                                </div>
                                <div className="crm-line__side">
                                    <strong className={isPayout ? undefined : 'crm-income'}>
                                        {sign}
                                        {amount}
                                    </strong>
                                    {manage && !muted && (isPayout || row.kind !== 'commission') && (
                                        <button type="button" className="btn btn--ghost btn--danger" onClick={() => setModal({ type: 'reverse', row })}>
                                            {t('order.reverse')}
                                        </button>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {modal?.type === 'payout' && (
                <PayoutModal
                    owed={balance.owed}
                    onClose={() => setModal(null)}
                    onSave={(body) => save('/api/crm/payroll/payouts', { ...body, staff_id: staff.id })}
                />
            )}
            {modal?.type === 'entry' && (
                <EntryModal kind={modal.kind} onClose={() => setModal(null)} onSave={(body) => save('/api/crm/payroll/entries', { ...body, staff_id: staff.id })} />
            )}
            {modal?.type === 'reverse' && (
                <ReasonModal
                    title={t('payroll.reverseTitle')}
                    label={t('order.reverseReason')}
                    confirmLabel={t('order.reverse')}
                    danger
                    onClose={() => setModal(null)}
                    onConfirm={(reason) =>
                        save(
                            modal.row._type === 'payout' ? `/api/crm/payroll/payouts/${modal.row.id}/reverse` : `/api/crm/payroll/entries/${modal.row.id}/reverse`,
                            { reason }
                        )
                    }
                />
            )}
        </div>
    );
}
