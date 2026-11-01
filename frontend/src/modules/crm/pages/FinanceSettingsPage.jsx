import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonRows } from '../../../components/Skeleton';
import { useCrm } from '../CrmContext';
import Modal from '../components/Modal';
import { formatMoney } from '../format';
import { CURRENCIES, t } from '../i18n';

const ACCOUNT_KINDS = ['cash', 'bank_transfer', 'card', 'other'];
const EXPENSE_KINDS = ['opex', 'marketing', 'materials'];

export default function FinanceSettingsPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { reloadReference } = useCrm();

    const [accounts, setAccounts] = useState(null);
    const [categories, setCategories] = useState(null);
    const [modal, setModal] = useState(null);
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    async function load() {
        try {
            const [a, c] = await Promise.all([api('/api/crm/finance/accounts'), api('/api/crm/finance/expense-categories')]);
            setAccounts(a.accounts);
            setCategories(c.categories);
        } catch (err) {
            setError(err.message);
        }
    }

    useEffect(() => {
        load();
    }, [api]);

    async function run(fn) {
        setSaving(true);
        setError(null);
        try {
            await fn();
            setModal(null);
            await Promise.all([load(), reloadReference()]);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    const toggleAccount = (a) => run(() => api(`/api/crm/finance/accounts/${a.id}`, { method: 'PATCH', body: { is_archived: !a.is_archived } }));
    const toggleCategory = (c) =>
        run(() => api(`/api/crm/finance/expense-categories/${c.id}`, { method: 'PATCH', body: { is_archived: !c.is_archived } }));
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate(-1)}>
                {t('common.back')}
            </button>
            {error && !modal && <p className="error-text">{error}</p>}

            <div className="page-header">
                <h1>{t('settings.accounts')}</h1>
                <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                        setForm({ name: '', kind: 'cash', currency: 'UZS' });
                        setError(null);
                        setModal('account');
                    }}
                >
                    {t('settings.addAccount')}
                </button>
            </div>
            {!accounts ? (
                <SkeletonRows count={3} />
            ) : (
                <ul className="list">
                    {accounts.map((a) => (
                        <li key={a.id} className={`list-row crm-line${a.is_archived ? ' crm-row--muted' : ''}`}>
                            <div className="crm-row__main">
                                <div className="list-row__title">
                                    {a.name}
                                    {a.is_archived && <span className="tag">{t('settings.archived')}</span>}
                                </div>
                                <div className="hint">
                                    {t(`accountKind.${a.kind}`)} · {formatMoney(a.balance, a.currency)}
                                </div>
                            </div>
                            <button type="button" className="btn btn--ghost" onClick={() => toggleAccount(a)} disabled={saving}>
                                {a.is_archived ? t('settings.restore') : t('settings.archive')}
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <div className="page-header crm-subheader">
                <h3>{t('settings.categories')}</h3>
                <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                        setForm({ name: '', kind: 'opex' });
                        setError(null);
                        setModal('category');
                    }}
                >
                    {t('settings.addCategory')}
                </button>
            </div>
            {categories && (
                <ul className="list">
                    {categories.map((c) => (
                        <li key={c.id} className={`list-row crm-line${c.is_archived ? ' crm-row--muted' : ''}`}>
                            <div className="crm-row__main">
                                <div className="list-row__title">{c.name}</div>
                                <div className="hint">{t(`expenseKind.${c.kind}`)}</div>
                            </div>
                            <button type="button" className="btn btn--ghost" onClick={() => toggleCategory(c)} disabled={saving}>
                                {c.is_archived ? t('settings.restore') : t('settings.archive')}
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {modal === 'account' && (
                <Modal title={t('settings.addAccount')} onClose={() => setModal(null)}>
                    <form
                        className="form"
                        onSubmit={(e) => {
                            e.preventDefault();
                            run(() => api('/api/crm/finance/accounts', { method: 'POST', body: form }));
                        }}
                    >
                        <label className="field">
                            <span>{t('settings.accountName')}</span>
                            <input type="text" required autoFocus value={form.name} onChange={set('name')} placeholder="Payme" />
                        </label>
                        <div className="crm-field-pair">
                            <label className="field">
                                <span>{t('settings.accountKind')}</span>
                                <select value={form.kind} onChange={set('kind')}>
                                    {ACCOUNT_KINDS.map((k) => (
                                        <option key={k} value={k}>
                                            {t(`accountKind.${k}`)}
                                        </option>
                                    ))}
                                </select>
                            </label>
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
                        </div>
                        {error && <p className="error-text">{error}</p>}
                        <button type="submit" className="btn btn--block" disabled={saving}>
                            {t('common.add')}
                        </button>
                    </form>
                </Modal>
            )}
            {modal === 'category' && (
                <Modal title={t('settings.addCategory')} onClose={() => setModal(null)}>
                    <form
                        className="form"
                        onSubmit={(e) => {
                            e.preventDefault();
                            run(() => api('/api/crm/finance/expense-categories', { method: 'POST', body: form }));
                        }}
                    >
                        <label className="field">
                            <span>{t('settings.accountName')}</span>
                            <input type="text" required autoFocus value={form.name} onChange={set('name')} />
                        </label>
                        <label className="field">
                            <span>{t('settings.categoryKind')}</span>
                            <select value={form.kind} onChange={set('kind')}>
                                {EXPENSE_KINDS.map((k) => (
                                    <option key={k} value={k}>
                                        {t(`expenseKind.${k}`)}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {error && <p className="error-text">{error}</p>}
                        <button type="submit" className="btn btn--block" disabled={saving}>
                            {t('common.add')}
                        </button>
                    </form>
                </Modal>
            )}
        </div>
    );
}
