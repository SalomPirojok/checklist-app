import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonRows } from '../../../components/Skeleton';
import { useCrm } from '../CrmContext';
import Modal from '../components/Modal';
import { formatMoney } from '../format';
import { t } from '../i18n';

const BASES = ['net_price', 'net_minus_materials', 'fixed'];

export function describeRule(rule) {
    if (rule.base === 'fixed') return `${formatMoney(rule.fixed_amount, 'UZS')} — ${t('ruleBase.fixed')}`;
    return `${Number(rule.percent)}% ${t(`ruleBase.${rule.base}`)}`;
}

function RuleModal({ rule, onSave, onDelete, onClose }) {
    const { reference, activeStaff, staffName } = useCrm();
    const [form, setForm] = useState({
        staff_id: rule?.staff_id || '',
        category_id: rule?.category_id || '',
        base: rule?.base || 'net_price',
        percent: rule?.percent != null ? String(Number(rule.percent)) : '',
        fixed_amount: rule?.fixed_amount != null ? String(Number(rule.fixed_amount)) : '',
        is_active: rule ? rule.is_active : true,
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    async function submit(e) {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            await onSave({
                staff_id: form.staff_id || null,
                category_id: form.category_id || null,
                base: form.base,
                percent: form.base === 'fixed' ? null : Number(form.percent),
                fixed_amount: form.base === 'fixed' ? Number(form.fixed_amount) : null,
                is_active: form.is_active,
            });
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    }

    const valid = form.base === 'fixed' ? form.fixed_amount !== '' : form.percent !== '';

    return (
        <Modal title={rule ? t('common.edit') : t('rules.add')} onClose={onClose}>
            <form className="form" onSubmit={submit}>
                <div className="crm-field-pair">
                    <label className="field">
                        <span>{t('rules.master')}</span>
                        <select value={form.staff_id} onChange={set('staff_id')} disabled={!!rule}>
                            <option value="">{t('rules.allMasters')}</option>
                            {(rule?.staff_id && !activeStaff.some((s) => s.id === rule.staff_id)
                                ? [...activeStaff, { id: rule.staff_id, full_name: staffName(rule.staff_id) }]
                                : activeStaff
                            ).map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.full_name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span>{t('rules.category')}</span>
                        <select value={form.category_id} onChange={set('category_id')} disabled={!!rule}>
                            <option value="">{t('rules.allCategories')}</option>
                            {reference.categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <label className="field">
                    <span>{t('rules.base')}</span>
                    <select value={form.base} onChange={set('base')}>
                        {BASES.map((b) => (
                            <option key={b} value={b}>
                                {t(`ruleBase.${b}`)}
                            </option>
                        ))}
                    </select>
                </label>
                {form.base === 'fixed' ? (
                    <label className="field">
                        <span>{t('rules.fixed')}</span>
                        <input type="number" inputMode="decimal" min="0" step="any" required value={form.fixed_amount} onChange={set('fixed_amount')} />
                    </label>
                ) : (
                    <label className="field">
                        <span>{t('rules.percent')}, %</span>
                        <input type="number" inputMode="decimal" min="0" max="100" step="any" required value={form.percent} onChange={set('percent')} />
                    </label>
                )}
                <label className="checkbox-field">
                    <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                    <span>{t('rules.active')}</span>
                </label>
                {error && <p className="error-text">{error}</p>}
                <div className="form-actions">
                    <button type="submit" className="btn btn--block" disabled={saving || !valid}>
                        {saving ? t('common.saving') : t('common.save')}
                    </button>
                    {rule && onDelete && (
                        <button type="button" className="btn btn--ghost btn--danger" disabled={saving} onClick={() => confirm(t('common.confirmDelete')) && onDelete()}>
                            {t('common.delete')}
                        </button>
                    )}
                </div>
            </form>
        </Modal>
    );
}

export default function CommissionRulesPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { can, staffName, categoryName } = useCrm();
    const [rules, setRules] = useState(null);
    const [modal, setModal] = useState(null);
    const [error, setError] = useState(null);

    async function load() {
        try {
            const res = await api('/api/crm/payroll/rules');
            setRules(res.rules);
        } catch (err) {
            setError(err.message);
        }
    }

    useEffect(() => {
        load();
    }, [api]);

    async function save(body) {
        if (modal.rule) await api(`/api/crm/payroll/rules/${modal.rule.id}`, { method: 'PATCH', body });
        else await api('/api/crm/payroll/rules', { method: 'POST', body });
        setModal(null);
        await load();
    }

    async function remove() {
        await api(`/api/crm/payroll/rules/${modal.rule.id}`, { method: 'DELETE' });
        setModal(null);
        await load();
    }

    // Group: general rules first, then per master.
    const groups = new Map([[null, []]]);
    for (const r of rules || []) {
        if (!groups.has(r.staff_id)) groups.set(r.staff_id, []);
        groups.get(r.staff_id).push(r);
    }

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate(-1)}>
                {t('common.back')}
            </button>
            <div className="page-header">
                <h1>{t('rules.title')}</h1>
                {can('payroll.manage') && (
                    <button type="button" className="btn" onClick={() => setModal({ rule: null })}>
                        {t('rules.add')}
                    </button>
                )}
            </div>
            <p className="hint">{t('rules.hint')}</p>
            {error && <p className="error-text">{error}</p>}

            {!rules ? (
                <SkeletonRows count={4} />
            ) : rules.length === 0 ? (
                <p className="hint">{t('rules.empty')}</p>
            ) : (
                [...groups.entries()]
                    .filter(([, list]) => list.length)
                    .map(([staffId, list]) => (
                        <div key={staffId || 'general'}>
                            <h3 className="crm-section-title">{staffId ? staffName(staffId) : t('rules.general')}</h3>
                            <ul className="list">
                                {list.map((r) => (
                                    <li key={r.id}>
                                        <button
                                            type="button"
                                            className={`list-row crm-row crm-row--button${r.is_active ? '' : ' crm-row--muted'}`}
                                            disabled={!can('payroll.manage')}
                                            onClick={() => setModal({ rule: r })}
                                        >
                                            <div className="crm-row__main">
                                                <div className="list-row__title">{r.category_id ? categoryName(r.category_id) : t('rules.allCategories')}</div>
                                                <div className="hint">{describeRule(r)}</div>
                                            </div>
                                            {!r.is_active && <span className="tag">{t('rules.inactive')}</span>}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))
            )}

            {modal && <RuleModal rule={modal.rule} onSave={save} onDelete={remove} onClose={() => setModal(null)} />}
        </div>
    );
}
