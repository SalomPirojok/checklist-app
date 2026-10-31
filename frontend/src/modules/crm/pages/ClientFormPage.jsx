import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonBlocks } from '../../../components/Skeleton';
import { hapticSuccess } from '../../../lib/haptics';
import { useCrm } from '../CrmContext';
import ClientFields, { emptyClient } from '../components/ClientFields';
import FoundClientCard from '../components/FoundClientCard';
import { t } from '../i18n';

const emptyForm = { ...emptyClient, source_id: '', manager_id: '', notes: '' };

function formFrom(client) {
    return {
        first_name: client.first_name || '',
        last_name: client.last_name || '',
        phone: client.phone || '',
        instagram_username: client.instagram_username || '',
        telegram_username: client.telegram_username || '',
        source_id: client.source_id || '',
        manager_id: client.manager_id || '',
        notes: client.notes || '',
    };
}

// Create (/clients/new) or edit (/clients/:id/edit) a client card.
export default function ClientFormPage() {
    const { id } = useParams();
    const api = useApiClient();
    const navigate = useNavigate();
    const { reference, assignableUsers } = useCrm();

    const [form, setForm] = useState(id ? null : emptyForm);
    const [duplicate, setDuplicate] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!id) return;
        api(`/api/crm/clients/${id}`)
            .then((res) => setForm(formFrom(res.client)))
            .catch((err) => setError(err.message));
    }, [api, id]);

    async function lookup() {
        if (!form.phone.trim() && !form.instagram_username.trim()) return;
        const params = new URLSearchParams();
        if (form.phone.trim()) params.set('phone', form.phone.trim());
        if (form.instagram_username.trim()) params.set('instagram_username', form.instagram_username.trim());
        try {
            const res = await api(`/api/crm/clients/lookup?${params}`);
            setDuplicate(res.client && res.client.id !== id ? res.client : null);
        } catch {
            // Rechecked on save.
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSaving(true);
        setError(null);
        const body = {
            ...form,
            source_id: form.source_id || null,
            manager_id: form.manager_id || null,
        };
        try {
            const res = id
                ? await api(`/api/crm/clients/${id}`, { method: 'PATCH', body })
                : await api('/api/crm/clients', { method: 'POST', body });
            hapticSuccess();
            navigate(`/clients/${res.client.id}`, { replace: true });
        } catch (err) {
            if (err.code === 'DUPLICATE_CLIENT') setDuplicate(err.body.client);
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    if (!form) {
        return <div className="page">{error ? <p className="error-text">{error}</p> : <SkeletonBlocks count={3} />}</div>;
    }

    const setField = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate(-1)}>
                {t('common.back')}
            </button>
            <div className="page-header">
                <h1>{id ? t('client.editTitle') : t('client.newTitle')}</h1>
            </div>

            <form className="form" onSubmit={handleSubmit}>
                <ClientFields value={form} onChange={setForm} onContactBlur={lookup} />
                {duplicate && (
                    <FoundClientCard client={duplicate} title={t('client.duplicate')}>
                        <button type="button" className="btn btn--ghost" onClick={() => navigate(`/clients/${duplicate.id}`)}>
                            {t('client.openExisting')}
                        </button>
                    </FoundClientCard>
                )}
                <div className="crm-field-pair">
                    <label className="field">
                        <span>{t('client.source')}</span>
                        <select value={form.source_id} onChange={setField('source_id')}>
                            <option value="">{t('common.notSet')}</option>
                            {reference.sources.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span>{t('client.manager')}</span>
                        <select value={form.manager_id} onChange={setField('manager_id')}>
                            <option value="">{t('common.notSet')}</option>
                            {assignableUsers.map((u) => (
                                <option key={u.id} value={u.id}>
                                    {u.full_name}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <label className="field">
                    <span>{t('client.notes')}</span>
                    <textarea value={form.notes} onChange={setField('notes')} />
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
