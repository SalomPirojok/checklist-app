import { useState } from 'react';
import { useCrm } from '../CrmContext';
import Modal from './Modal';
import { t } from '../i18n';

function evenShares(count) {
    if (!count) return [];
    const base = Math.floor((100 / count) * 100) / 100;
    const shares = Array(count).fill(base);
    shares[0] = Math.round((100 - base * (count - 1)) * 100) / 100;
    return shares;
}

// Add/edit an order line with its masters. `item` is null for a new line.
export default function ItemModal({ item, onSave, onClose }) {
    const { reference, activeStaff, staffName } = useCrm();
    const [form, setForm] = useState({
        category_id: item?.category_id || reference.categories[0]?.id || '',
        name: item?.name || '',
        quantity: item ? String(Number(item.quantity)) : '1',
        unit_price: item ? String(Number(item.unit_price)) : '',
        discount_amount: item && Number(item.discount_amount) ? String(Number(item.discount_amount)) : '',
    });
    const [staff, setStaff] = useState(item?.staff.map((s) => ({ staff_id: s.staff_id, share_percent: String(Number(s.share_percent)) })) || []);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
    const categoryName = reference.categories.find((c) => c.id === form.category_id)?.name || '';

    function addMaster() {
        const next = [...staff, { staff_id: '', share_percent: '' }];
        const shares = evenShares(next.length);
        setStaff(next.map((s, i) => ({ ...s, share_percent: String(shares[i]) })));
    }

    function updateMaster(index, patch) {
        setStaff(staff.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    }

    function removeMaster(index) {
        const next = staff.filter((_, i) => i !== index);
        const shares = evenShares(next.length);
        setStaff(next.map((s, i) => ({ ...s, share_percent: String(shares[i]) })));
    }

    const shareSum = staff.reduce((sum, s) => sum + Number(s.share_percent || 0), 0);
    const sharesOk = staff.length === 0 || Math.abs(shareSum - 100) < 0.001;

    async function handleSubmit(e) {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            await onSave({
                category_id: form.category_id,
                name: form.name.trim() || categoryName,
                quantity: Number(form.quantity || 1),
                unit_price: Number(form.unit_price || 0),
                discount_amount: Number(form.discount_amount || 0),
                staff: staff.filter((s) => s.staff_id).map((s) => ({ staff_id: s.staff_id, share_percent: Number(s.share_percent) })),
            });
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    }

    // Keep a master who has since left visible on an old line.
    const staffOptions = (current) => {
        const options = [...activeStaff];
        if (current && !options.some((s) => s.id === current)) options.push({ id: current, full_name: staffName(current) || '—' });
        return options;
    };

    return (
        <Modal title={t('item.title')} onClose={onClose}>
            <form className="form" onSubmit={handleSubmit}>
                <label className="field">
                    <span>{t('item.category')}</span>
                    <select value={form.category_id} onChange={set('category_id')}>
                        {reference.categories.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="field">
                    <span>{t('item.name')}</span>
                    <input type="text" value={form.name} onChange={set('name')} placeholder={categoryName} />
                </label>
                <div className="crm-field-triple">
                    <label className="field">
                        <span>{t('item.unitPrice')}</span>
                        <input type="number" inputMode="decimal" min="0" step="any" required value={form.unit_price} onChange={set('unit_price')} />
                    </label>
                    <label className="field">
                        <span>{t('item.quantity')}</span>
                        <input type="number" inputMode="decimal" min="0.001" step="any" value={form.quantity} onChange={set('quantity')} />
                    </label>
                    <label className="field">
                        <span>{t('item.discount')}</span>
                        <input type="number" inputMode="decimal" min="0" step="any" value={form.discount_amount} onChange={set('discount_amount')} />
                    </label>
                </div>

                <div className="field">
                    <span>{t('item.masters')}</span>
                    {staff.map((s, i) => (
                        <div key={i} className="crm-master-row">
                            <select value={s.staff_id} onChange={(e) => updateMaster(i, { staff_id: e.target.value })}>
                                <option value="">—</option>
                                {staffOptions(s.staff_id).map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.full_name}
                                    </option>
                                ))}
                            </select>
                            <input
                                type="number"
                                inputMode="decimal"
                                min="1"
                                max="100"
                                step="any"
                                aria-label={t('item.share')}
                                value={s.share_percent}
                                onChange={(e) => updateMaster(i, { share_percent: e.target.value })}
                            />
                            <span className="hint">%</span>
                            <button type="button" className="btn btn--ghost btn--danger" onClick={() => removeMaster(i)} aria-label={t('common.delete')}>
                                ✕
                            </button>
                        </div>
                    ))}
                    {activeStaff.length > 0 && (
                        <button type="button" className="btn btn--ghost crm-inline-link" onClick={addMaster}>
                            {t('item.addMaster')}
                        </button>
                    )}
                    {staff.length > 1 && <span className={sharesOk ? 'hint' : 'error-text'}>{t('item.sharesHint')}</span>}
                </div>

                {error && <p className="error-text">{error}</p>}
                <div className="form-actions">
                    <button type="submit" className="btn btn--block" disabled={saving || !sharesOk || form.unit_price === ''}>
                        {saving ? t('common.saving') : t('common.save')}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
