import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonBlocks } from '../../../components/Skeleton';
import { hapticSuccess } from '../../../lib/haptics';
import { useCrm } from '../CrmContext';
import { PAY_SCHEMES, t } from '../i18n';

const emptyForm = {
    full_name: '',
    phone: '',
    position: '',
    specialization: '',
    pay_scheme: 'commission',
    base_salary: '',
    is_active: true,
    notes: '',
};

export default function StaffFormPage() {
    const { id } = useParams();
    const api = useApiClient();
    const navigate = useNavigate();
    const { reloadReference } = useCrm();

    const [form, setForm] = useState(id ? null : emptyForm);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!id) return;
        api(`/api/crm/staff/${id}`)
            .then(({ staff }) =>
                setForm({
                    full_name: staff.full_name,
                    phone: staff.phone || '',
                    position: staff.position || '',
                    specialization: staff.specialization || '',
                    pay_scheme: staff.pay_scheme,
                    base_salary: Number(staff.base_salary) ? String(Number(staff.base_salary)) : '',
                    is_active: staff.is_active,
                    notes: staff.notes || '',
                })
            )
            .catch((err) => setError(err.message));
    }, [api, id]);

    async function handleSubmit(e) {
        e.preventDefault();
        setSaving(true);
        setError(null);
        const body = { ...form, base_salary: form.pay_scheme === 'commission' ? 0 : Number(form.base_salary || 0) };
        try {
            if (id) await api(`/api/crm/staff/${id}`, { method: 'PATCH', body });
            else await api('/api/crm/staff', { method: 'POST', body });
            await reloadReference();
            hapticSuccess();
            navigate('/staff', { replace: true });
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    if (!form) return <div className="page">{error ? <p className="error-text">{error}</p> : <SkeletonBlocks count={3} />}</div>;

    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate(-1)}>
                {t('common.back')}
            </button>
            <div className="page-header">
                <h1>{id ? t('staff.editTitle') : t('staff.newTitle')}</h1>
            </div>

            <form className="form" onSubmit={handleSubmit}>
                <label className="field">
                    <span>{t('staff.fullName')} *</span>
                    <input type="text" value={form.full_name} onChange={set('full_name')} required />
                </label>
                <label className="field">
                    <span>{t('staff.phone')}</span>
                    <input type="tel" inputMode="tel" placeholder={t('client.phonePlaceholder')} value={form.phone} onChange={set('phone')} />
                </label>
                <div className="crm-field-pair">
                    <label className="field">
                        <span>{t('staff.position')}</span>
                        <input type="text" value={form.position} onChange={set('position')} />
                    </label>
                    <label className="field">
                        <span>{t('staff.specialization')}</span>
                        <input
                            type="text"
                            placeholder={t('staff.specializationPlaceholder')}
                            value={form.specialization}
                            onChange={set('specialization')}
                        />
                    </label>
                </div>
                <div className="crm-field-pair">
                    <label className="field">
                        <span>{t('staff.payScheme')}</span>
                        <select value={form.pay_scheme} onChange={set('pay_scheme')}>
                            {PAY_SCHEMES.map((p) => (
                                <option key={p} value={p}>
                                    {t(`payScheme.${p}`)}
                                </option>
                            ))}
                        </select>
                    </label>
                    {form.pay_scheme !== 'commission' && (
                        <label className="field">
                            <span>{t('staff.baseSalary')}</span>
                            <input type="number" inputMode="numeric" min="0" value={form.base_salary} onChange={set('base_salary')} />
                        </label>
                    )}
                </div>
                <p className="hint">{t('staff.ratesLater')}</p>
                <label className="checkbox-field">
                    <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                    <span>{t('staff.active')}</span>
                </label>
                <label className="field">
                    <span>{t('staff.notes')}</span>
                    <textarea value={form.notes} onChange={set('notes')} />
                </label>

                {error && <p className="error-text">{error}</p>}
                <div className="form-actions">
                    <button type="submit" className="btn btn--block" disabled={saving}>
                        {saving ? t('common.saving') : t('common.save')}
                    </button>
                </div>
            </form>
        </div>
    );
}
