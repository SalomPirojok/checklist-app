import { useState } from 'react';
import { CURRENCIES, t } from '../i18n';
import Modal from './Modal';
import { useFxRate } from './useFxRate';

export default function MaterialModal({ items, onSave, onClose }) {
    const [form, setForm] = useState({ name: '', quantity: '1', unit: '', unit_cost: '', currency: 'UZS', order_item_id: '' });
    const [rate, setRate] = useFxRate(form.currency);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    async function handleSubmit(e) {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            await onSave({
                ...form,
                quantity: Number(form.quantity || 1),
                unit_cost: Number(form.unit_cost || 0),
                fx_rate: form.currency === 'UZS' ? null : Number(rate) || null,
                order_item_id: form.order_item_id || null,
            });
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    }

    return (
        <Modal title={t('material.title')} onClose={onClose}>
            <form className="form" onSubmit={handleSubmit}>
                <label className="field">
                    <span>{t('material.name')} *</span>
                    <input type="text" required autoFocus value={form.name} onChange={set('name')} placeholder="Плёнка XPEL Ultimate" />
                </label>
                <div className="crm-field-triple">
                    <label className="field">
                        <span>{t('material.quantity')}</span>
                        <input type="number" inputMode="decimal" min="0.001" step="any" value={form.quantity} onChange={set('quantity')} />
                    </label>
                    <label className="field">
                        <span>{t('material.unit')}</span>
                        <input type="text" value={form.unit} onChange={set('unit')} placeholder="м" />
                    </label>
                    <label className="field">
                        <span>{t('material.unitCost')}</span>
                        <input type="number" inputMode="decimal" min="0" step="any" required value={form.unit_cost} onChange={set('unit_cost')} />
                    </label>
                </div>
                <div className="crm-field-pair">
                    <label className="field">
                        <span>{t('material.currency')}</span>
                        <select value={form.currency} onChange={set('currency')}>
                            {CURRENCIES.map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </select>
                    </label>
                    {form.currency !== 'UZS' && (
                        <label className="field">
                            <span>{t('material.rate')}</span>
                            <input type="number" inputMode="decimal" min="0" step="any" required value={rate} onChange={(e) => setRate(e.target.value)} />
                        </label>
                    )}
                </div>
                {items.length > 0 && (
                    <label className="field">
                        <span>{t('material.forService')}</span>
                        <select value={form.order_item_id} onChange={set('order_item_id')}>
                            <option value="">{t('material.wholeOrder')}</option>
                            {items.map((i) => (
                                <option key={i.id} value={i.id}>
                                    {i.name}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                {error && <p className="error-text">{error}</p>}
                <div className="form-actions">
                    <button type="submit" className="btn btn--block" disabled={saving}>
                        {saving ? t('common.saving') : t('common.add')}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
