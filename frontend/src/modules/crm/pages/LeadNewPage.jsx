import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { useAuth } from '../../../context/AuthContext';
import { hapticSuccess } from '../../../lib/haptics';
import { useCrm } from '../CrmContext';
import ClientFields, { emptyClient } from '../components/ClientFields';
import CampaignSelect from '../components/CampaignSelect';
import FoundClientCard from '../components/FoundClientCard';
import { fromLocalInputValue } from '../format';
import { CHANNELS, t } from '../i18n';

export default function LeadNewPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const { reference, assignableUsers } = useCrm();

    // Opened from a client card: the lead is for that client.
    const [selectedClient, setSelectedClient] = useState(location.state?.client || null);
    const [client, setClient] = useState(emptyClient);
    const [found, setFound] = useState(null);
    const [lead, setLead] = useState({
        channel: 'instagram',
        source_id: '',
        campaign_id: '',
        manager_id: user.id,
        booked_for: '',
        notes: '',
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    const setLeadField = (field) => (e) => setLead({ ...lead, [field]: e.target.value });

    async function lookup() {
        if (!client.phone.trim() && !client.instagram_username.trim()) return;
        const params = new URLSearchParams();
        if (client.phone.trim()) params.set('phone', client.phone.trim());
        if (client.instagram_username.trim()) params.set('instagram_username', client.instagram_username.trim());
        try {
            const res = await api(`/api/crm/clients/lookup?${params}`);
            setFound(res.client);
        } catch {
            // The server re-checks duplicates on submit anyway.
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        const body = {
            channel: lead.channel,
            source_id: lead.source_id || null,
            campaign_id: lead.campaign_id || null,
            manager_id: lead.manager_id || null,
            notes: lead.notes,
            booked_for: fromLocalInputValue(lead.booked_for),
        };
        if (selectedClient) body.client_id = selectedClient.id;
        else body.client = client;
        try {
            const res = await api('/api/crm/leads', { method: 'POST', body });
            hapticSuccess();
            navigate(`/leads/${res.lead.id}`, { replace: true });
        } catch (err) {
            if (err.code === 'DUPLICATE_CLIENT') setFound(err.body.client);
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate(-1)}>
                {t('common.back')}
            </button>
            <div className="page-header">
                <h1>{t('newLead.title')}</h1>
            </div>

            <form className="form" onSubmit={handleSubmit}>
                <h3 className="crm-section-title">{t('newLead.clientSection')}</h3>
                {selectedClient ? (
                    <FoundClientCard client={selectedClient} title={t('lead.client')}>
                        <button type="button" className="btn btn--ghost" onClick={() => setSelectedClient(null)}>
                            {t('newLead.otherClient')}
                        </button>
                    </FoundClientCard>
                ) : (
                    <>
                        <ClientFields value={client} onChange={setClient} onContactBlur={lookup} showTelegram={false} />
                        {found && (
                            <FoundClientCard client={found} title={t('newLead.found')}>
                                <button
                                    type="button"
                                    className="btn"
                                    onClick={() => {
                                        setSelectedClient(found);
                                        setFound(null);
                                        setError(null);
                                    }}
                                >
                                    {t('newLead.useFound')}
                                </button>
                            </FoundClientCard>
                        )}
                    </>
                )}

                <h3 className="crm-section-title">{t('newLead.leadSection')}</h3>
                <div className="crm-field-pair">
                    <label className="field">
                        <span>{t('lead.channel')}</span>
                        <select value={lead.channel} onChange={setLeadField('channel')}>
                            {CHANNELS.map((c) => (
                                <option key={c} value={c}>
                                    {t(`channel.${c}`)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span>{t('lead.source')}</span>
                        <select value={lead.source_id} onChange={(e) => setLead({ ...lead, source_id: e.target.value, campaign_id: '' })}>
                            <option value="">{t('common.notSet')}</option>
                            {reference.sources.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.name}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <CampaignSelect sourceId={lead.source_id} value={lead.campaign_id} onChange={(v) => setLead({ ...lead, campaign_id: v })} />
                <label className="field">
                    <span>{t('lead.manager')}</span>
                    <select value={lead.manager_id} onChange={setLeadField('manager_id')}>
                        <option value="">{t('common.notSet')}</option>
                        {assignableUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                                {u.full_name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="field">
                    <span>{t('lead.bookedFor')}</span>
                    <input type="datetime-local" value={lead.booked_for} onChange={setLeadField('booked_for')} />
                    <span className="hint">{t('newLead.bookedHint')}</span>
                </label>
                <label className="field">
                    <span>{t('lead.notes')}</span>
                    <textarea value={lead.notes} onChange={setLeadField('notes')} />
                </label>

                {error && <p className="error-text">{error}</p>}
                <div className="form-actions">
                    <button type="submit" className="btn btn--block" disabled={submitting}>
                        {submitting ? t('common.saving') : t('newLead.submit')}
                    </button>
                </div>
            </form>
        </div>
    );
}
