import { useState } from 'react';
import { useCrm } from '../CrmContext';
import { formatMoney } from '../format';
import { t } from '../i18n';
import Modal from './Modal';
import { useFxRate } from './useFxRate';

// Payment from the client (kind 'payment') or refund to them ('refund').
export default function PaymentModal({ order, kind, onSave, onClose }) {
    const { reference } = useCrm();
    const due = Number(order.total) - Number(order.paid_amount);
    const defaultAccount =
        reference.accounts.find((a) => a.currency === order.currency && a.kind === 'cash') ||
        reference.accounts.find((a) => a.currency === order.currency) ||
        reference.accounts[0];

    const [accountId, setAccountId] = useState(defaultAccount?.id || '');
    const account = reference.accounts.find((a) => a.id === accountId);
    const sameCurrency = account?.currency === order.currency;
    const [amount, setAmount] = useState(kind === 'payment' && sameCurrency && due > 0 ? String(due) : '');
    const [note, setNote] = useState('');
    const [accountRate, setAccountRate] = useFxRate(account?.currency);
    const [orderRate, setOrderRate] = useFxRate(sameCurrency ? null : order.currency);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    // Preview of what reaches the order when currencies differ.
    let credited = null;
    if (account && !sameCurrency && Number(amount) > 0) {
        const toBase = account.currency === 'UZS' ? 1 : Number(accountRate);
        const orderToBase = order.currency === 'UZS' ? 1 : Number(orderRate);
        if (toBase > 0 && orderToBase > 0) credited = (Number(amount) * toBase) / orderToBase;
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            await onSave({
                kind,
                account_id: accountId,
                amount: Number(amount),
                fx_rate: account.currency === 'UZS' ? null : Number(accountRate) || null,
                order_fx_rate: sameCurrency || order.currency === 'UZS' ? null : Number(orderRate) || null,
                note,
            });
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    }

    return (
        <Modal title={kind === 'refund' ? t('payment.refundTitle') : t('payment.title')} onClose={onClose}>
            <form className="form" onSubmit={handleSubmit}>
                <label className="field">
                    <span>{t('payment.account')}</span>
                    <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                        {reference.accounts.map((a) => (
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
                        <input type="number" inputMode="decimal" min="0" step="any" required value={accountRate} onChange={(e) => setAccountRate(e.target.value)} />
                    </label>
                )}
                {account && !sameCurrency && order.currency !== 'UZS' && (
                    <label className="field">
                        <span>{t('payment.orderRate', { currency: order.currency })}</span>
                        <input type="number" inputMode="decimal" min="0" step="any" required value={orderRate} onChange={(e) => setOrderRate(e.target.value)} />
                    </label>
                )}
                {credited !== null && <p className="hint">{t('payment.willCredit', { amount: formatMoney(credited, order.currency) })}</p>}
                <label className="field">
                    <span>{t('payment.note')}</span>
                    <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
                {error && <p className="error-text">{error}</p>}
                <div className="form-actions">
                    <button type="submit" className="btn btn--block" disabled={saving || !Number(amount)}>
                        {saving ? t('common.saving') : t('payment.submit')}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
