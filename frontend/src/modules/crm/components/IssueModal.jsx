import { useState } from 'react';
import { formatMoney } from '../format';
import { t } from '../i18n';
import Modal from './Modal';
import { useFxRate } from './useFxRate';

export default function IssueModal({ order, onConfirm, onClose }) {
    const due = Number(order.total) - Number(order.paid_amount);
    const [rate, setRate] = useFxRate(order.currency);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    async function confirmIssue() {
        setSaving(true);
        setError(null);
        try {
            await onConfirm({ fx_rate: order.currency === 'UZS' ? null : Number(rate) || null });
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    }

    return (
        <Modal title={t('order.issueTitle')} onClose={onClose}>
            <div className="form">
                <p>{t('order.issueHint')}</p>
                <div className="crm-totals">
                    <div>
                        <span>{t('order.total')}</span>
                        <strong>{formatMoney(order.total, order.currency)}</strong>
                    </div>
                    <div>
                        <span>{t('order.paid')}</span>
                        <span>{formatMoney(order.paid_amount, order.currency)}</span>
                    </div>
                </div>
                {due > 0 && <p className="crm-warning">{t('order.issueDebt', { amount: formatMoney(due, order.currency) })}</p>}
                {order.currency !== 'UZS' && (
                    <label className="field">
                        <span>{t('order.issueRate')}</span>
                        <input type="number" inputMode="decimal" min="0" step="any" value={rate} onChange={(e) => setRate(e.target.value)} />
                    </label>
                )}
                {error && <p className="error-text">{error}</p>}
                <div className="form-actions">
                    <button type="button" className="btn btn--block" disabled={saving || (order.currency !== 'UZS' && !Number(rate))} onClick={confirmIssue}>
                        {saving ? t('common.saving') : t('order.issueConfirm')}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
