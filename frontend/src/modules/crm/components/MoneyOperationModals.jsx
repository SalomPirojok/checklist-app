import { useState } from 'react';
import { useCrm } from '../CrmContext';
import { toLocalInputValue, fromLocalInputValue } from '../format';
import { t } from '../i18n';
import Modal from './Modal';
import { useFxRate } from './useFxRate';

function useSubmit(onSave) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    async function submit(body) {
        setSaving(true);
        setError(null);
        try {
            await onSave(body);
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    }
    return { saving, error, submit };
}

function AccountSelect({ value, onChange, label = t('payment.account') }) {
    const { activeAccounts } = useCrm();
    return (
        <label className="field">
            <span>{label}</span>
            <select value={value} onChange={(e) => onChange(e.target.value)}>
                {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                        {a.name}
                    </option>
                ))}
            </select>
        </label>
    );
}

function RateField({ currency, rate, setRate }) {
    if (!currency || currency === 'UZS') return null;
    return (
        <label className="field">
            <span>{t('payment.rate', { currency })}</span>
            <input type="number" inputMode="decimal" min="0" step="any" required value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
    );
}

export function ExpenseModal({ categories, onSave, onClose }) {
    const { activeAccounts, reference } = useCrm();
    const active = categories.filter((c) => !c.is_archived);
    const [form, setForm] = useState({
        category_id: active[0]?.id || '',
        account_id: activeAccounts[0]?.id || '',
        amount: '',
        campaign_id: '',
        occurred_at: toLocalInputValue(new Date().toISOString()),
        note: '',
    });
    const account = activeAccounts.find((a) => a.id === form.account_id);
    const category = active.find((c) => c.id === form.category_id);
    const [rate, setRate] = useFxRate(account?.currency);
    const { saving, error, submit } = useSubmit(onSave);
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    return (
        <Modal title={t('expense.title')} onClose={onClose}>
            <form
                className="form"
                onSubmit={(e) => {
                    e.preventDefault();
                    submit({
                        ...form,
                        amount: Number(form.amount),
                        fx_rate: account?.currency === 'UZS' ? null : Number(rate) || null,
                        campaign_id: category?.kind === 'marketing' ? form.campaign_id || null : null,
                        occurred_at: fromLocalInputValue(form.occurred_at),
                    });
                }}
            >
                <label className="field">
                    <span>{t('expense.category')}</span>
                    <select value={form.category_id} onChange={set('category_id')}>
                        {active.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                </label>
                {category?.kind === 'marketing' && reference.campaigns.length > 0 && (
                    <label className="field">
                        <span>{t('expense.campaign')}</span>
                        <select value={form.campaign_id} onChange={set('campaign_id')}>
                            <option value="">{t('expense.noCampaign')}</option>
                            {reference.campaigns.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                <AccountSelect value={form.account_id} onChange={(v) => setForm({ ...form, account_id: v })} />
                <label className="field">
                    <span>
                        {t('payment.amount')}, {account?.currency}
                    </span>
                    <input type="number" inputMode="decimal" min="0" step="any" required autoFocus value={form.amount} onChange={set('amount')} />
                </label>
                <RateField currency={account?.currency} rate={rate} setRate={setRate} />
                <label className="field">
                    <span>{t('expense.date')}</span>
                    <input type="datetime-local" value={form.occurred_at} onChange={set('occurred_at')} />
                </label>
                <label className="field">
                    <span>{t('payment.note')}</span>
                    <input type="text" value={form.note} onChange={set('note')} />
                </label>
                {error && <p className="error-text">{error}</p>}
                <div className="form-actions">
                    <button type="submit" className="btn btn--block" disabled={saving || !Number(form.amount) || !form.category_id}>
                        {saving ? t('common.saving') : t('payment.submit')}
                    </button>
                </div>
            </form>
        </Modal>
    );
}

export function IncomeModal({ onSave, onClose }) {
    const { activeAccounts } = useCrm();
    const [form, setForm] = useState({ account_id: activeAccounts[0]?.id || '', amount: '', note: '' });
    const account = activeAccounts.find((a) => a.id === form.account_id);
    const [rate, setRate] = useFxRate(account?.currency);
    const { saving, error, submit } = useSubmit(onSave);
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    return (
        <Modal title={t('income.title')} onClose={onClose}>
            <form
                className="form"
                onSubmit={(e) => {
                    e.preventDefault();
                    submit({ ...form, amount: Number(form.amount), fx_rate: account?.currency === 'UZS' ? null : Number(rate) || null });
                }}
            >
                <label className="field">
                    <span>{t('income.note')}</span>
                    <input type="text" required autoFocus value={form.note} onChange={set('note')} />
                </label>
                <AccountSelect value={form.account_id} onChange={(v) => setForm({ ...form, account_id: v })} />
                <label className="field">
                    <span>
                        {t('payment.amount')}, {account?.currency}
                    </span>
                    <input type="number" inputMode="decimal" min="0" step="any" required value={form.amount} onChange={set('amount')} />
                </label>
                <RateField currency={account?.currency} rate={rate} setRate={setRate} />
                {error && <p className="error-text">{error}</p>}
                <div className="form-actions">
                    <button type="submit" className="btn btn--block" disabled={saving || !Number(form.amount)}>
                        {saving ? t('common.saving') : t('payment.submit')}
                    </button>
                </div>
            </form>
        </Modal>
    );
}

export function TransferModal({ onSave, onClose }) {
    const { activeAccounts } = useCrm();
    const accounts = activeAccounts;
    const [form, setForm] = useState({
        from_account_id: accounts[0]?.id || '',
        to_account_id: accounts[1]?.id || '',
        amount_from: '',
        amount_to: '',
        note: '',
    });
    const from = accounts.find((a) => a.id === form.from_account_id);
    const to = accounts.find((a) => a.id === form.to_account_id);
    const exchange = from && to && from.currency !== to.currency;
    const [fromRate, setFromRate] = useFxRate(from?.currency);
    const [toRate, setToRate] = useFxRate(to?.currency);
    const { saving, error, submit } = useSubmit(onSave);
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    // Suggest the received amount from the rates when exchanging currency.
    const suggestedTo =
        exchange && Number(form.amount_from)
            ? Math.round(
                  ((Number(form.amount_from) * (from.currency === 'UZS' ? 1 : Number(fromRate))) / (to.currency === 'UZS' ? 1 : Number(toRate) || 1)) * 100
              ) / 100
            : '';

    return (
        <Modal title={t('transfer.title')} onClose={onClose}>
            <form
                className="form"
                onSubmit={(e) => {
                    e.preventDefault();
                    submit({
                        ...form,
                        amount_from: Number(form.amount_from),
                        amount_to: exchange ? Number(form.amount_to || suggestedTo) : Number(form.amount_from),
                        from_fx_rate: from?.currency === 'UZS' ? null : Number(fromRate) || null,
                        to_fx_rate: to?.currency === 'UZS' ? null : Number(toRate) || null,
                    });
                }}
            >
                <div className="crm-field-pair">
                    <AccountSelect label={t('transfer.from')} value={form.from_account_id} onChange={(v) => setForm({ ...form, from_account_id: v })} />
                    <AccountSelect label={t('transfer.to')} value={form.to_account_id} onChange={(v) => setForm({ ...form, to_account_id: v })} />
                </div>
                <label className="field">
                    <span>
                        {t('transfer.amountFrom')}, {from?.currency}
                    </span>
                    <input type="number" inputMode="decimal" min="0" step="any" required autoFocus value={form.amount_from} onChange={set('amount_from')} />
                </label>
                {exchange && (
                    <>
                        <RateField currency={from.currency} rate={fromRate} setRate={setFromRate} />
                        <RateField currency={to.currency} rate={toRate} setRate={setToRate} />
                        <label className="field">
                            <span>
                                {t('transfer.amountTo')}, {to.currency}
                            </span>
                            <input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="any"
                                placeholder={String(suggestedTo)}
                                value={form.amount_to}
                                onChange={set('amount_to')}
                            />
                        </label>
                    </>
                )}
                <label className="field">
                    <span>{t('payment.note')}</span>
                    <input type="text" value={form.note} onChange={set('note')} />
                </label>
                {error && <p className="error-text">{error}</p>}
                <div className="form-actions">
                    <button type="submit" className="btn btn--block" disabled={saving || !Number(form.amount_from) || form.from_account_id === form.to_account_id}>
                        {saving ? t('common.saving') : t('payment.submit')}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
