import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonBlocks } from '../../../components/Skeleton';
import { hapticSelect, hapticSuccess } from '../../../lib/haptics';
import { useCrm } from '../CrmContext';
import LeadStatusBadge from '../components/LeadStatusBadge';
import { clientName, formatDateTime, formatPhone, fromLocalInputValue, toLocalInputValue } from '../format';
import { CHANNELS, MANUAL_LEAD_STATUSES, t } from '../i18n';

function draftFrom(lead) {
    return {
        channel: lead.channel,
        source_id: lead.source_id || '',
        manager_id: lead.manager_id || '',
        booked_for: toLocalInputValue(lead.booked_for),
        notes: lead.notes || '',
    };
}

export default function LeadDetailPage() {
    const { id } = useParams();
    const api = useApiClient();
    const navigate = useNavigate();
    const { reference, assignableUsers, userName, can } = useCrm();

    const [lead, setLead] = useState(null);
    const [events, setEvents] = useState([]);
    const [draft, setDraft] = useState(null);
    const [lostReason, setLostReason] = useState('');
    const [showLostForm, setShowLostForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    async function load() {
        try {
            const res = await api(`/api/crm/leads/${id}`);
            setLead(res.lead);
            setEvents(res.events);
            setDraft(draftFrom(res.lead));
            setError(null);
        } catch (err) {
            setError(err.message);
        }
    }

    useEffect(() => {
        load();
    }, [api, id]);

    async function patch(body) {
        setSaving(true);
        setError(null);
        try {
            await api(`/api/crm/leads/${id}`, { method: 'PATCH', body });
            await load();
            return true;
        } catch (err) {
            setError(err.message);
            return false;
        } finally {
            setSaving(false);
        }
    }

    async function changeStatus(status) {
        if (status === lead.status) return;
        hapticSelect();
        await patch({ status });
    }

    async function markLost(e) {
        e.preventDefault();
        if (await patch({ status: 'lost', lost_reason: lostReason })) {
            setShowLostForm(false);
            setLostReason('');
        }
    }

    async function saveDetails(e) {
        e.preventDefault();
        const ok = await patch({
            channel: draft.channel,
            source_id: draft.source_id || null,
            manager_id: draft.manager_id || null,
            booked_for: fromLocalInputValue(draft.booked_for),
            notes: draft.notes,
        });
        if (ok) hapticSuccess();
    }

    if (!lead) {
        return (
            <div className="page">
                {error ? <p className="error-text">{error}</p> : <SkeletonBlocks count={3} />}
            </div>
        );
    }

    const setField = (field) => (e) => setDraft({ ...draft, [field]: e.target.value });
    const statusLocked = lead.status === 'order_created' || lead.status === 'completed';
    const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(lead));

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate(-1)}>
                {t('common.back')}
            </button>
            <div className="page-header">
                <h1>{t('lead.title', { number: lead.number })}</h1>
                <LeadStatusBadge status={lead.status} />
            </div>

            <Link to={`/clients/${lead.client.id}`} className="list-row crm-row">
                <div className="crm-row__main">
                    <div className="hint">{t('lead.client')}</div>
                    <div className="list-row__title">{clientName(lead.client)}</div>
                    <div className="hint">
                        {[formatPhone(lead.client.phone), lead.client.instagram_username && `@${lead.client.instagram_username}`]
                            .filter(Boolean)
                            .join(' · ')}
                    </div>
                </div>
                <span className="crm-chevron">›</span>
            </Link>
            <div className="crm-contact-actions">
                {lead.client.phone && (
                    <a className="btn btn--ghost" href={`tel:${lead.client.phone}`}>
                        {t('client.phone')}
                    </a>
                )}
                {lead.client.instagram_username && (
                    <a
                        className="btn btn--ghost"
                        href={`https://instagram.com/${lead.client.instagram_username}`}
                        target="_blank"
                        rel="noreferrer"
                    >
                        Instagram
                    </a>
                )}
            </div>

            {lead.order ? (
                <button type="button" className="btn btn--block crm-lead-order" onClick={() => navigate(`/orders/${lead.order.id}`)}>
                    {t('order.openOrder', { number: lead.order.number })}
                </button>
            ) : (
                can('orders.manage') &&
                lead.status !== 'lost' && (
                    <button
                        type="button"
                        className="btn btn--block crm-lead-order"
                        onClick={() => navigate('/orders/new', { state: { client: lead.client, lead: { id: lead.id } } })}
                    >
                        {t('order.createFromLead')}
                    </button>
                )
            )}

            <h3 className="crm-section-title">{t('lead.status')}</h3>
            {statusLocked ? (
                <p className="hint">{t('lead.statusAuto')}</p>
            ) : (
                <>
                    <div className="crm-chips">
                        {MANUAL_LEAD_STATUSES.map((s) => (
                            <button
                                key={s}
                                type="button"
                                disabled={saving}
                                className={lead.status === s ? 'crm-chip crm-chip--active' : 'crm-chip'}
                                onClick={() => changeStatus(s)}
                            >
                                {t(`leadStatus.${s}`)}
                            </button>
                        ))}
                        {lead.status !== 'lost' && (
                            <button type="button" className="crm-chip crm-chip--danger" onClick={() => setShowLostForm(true)}>
                                {t('leadStatus.lost')}
                            </button>
                        )}
                    </div>
                    {lead.status === 'lost' && lead.lost_reason && (
                        <p className="hint">
                            {t('lead.lostReason')}: {lead.lost_reason}
                        </p>
                    )}
                    {showLostForm && (
                        <form className="form crm-inline-form" onSubmit={markLost}>
                            <label className="field">
                                <span>{t('lead.lostReason')}</span>
                                <input
                                    type="text"
                                    autoFocus
                                    placeholder={t('lead.lostReasonPlaceholder')}
                                    value={lostReason}
                                    onChange={(e) => setLostReason(e.target.value)}
                                />
                            </label>
                            <div className="form-actions">
                                <button type="submit" className="btn crm-btn--danger" disabled={saving}>
                                    {t('lead.markLost')}
                                </button>
                                <button type="button" className="btn btn--ghost" onClick={() => setShowLostForm(false)}>
                                    {t('common.cancel')}
                                </button>
                            </div>
                        </form>
                    )}
                </>
            )}

            <form className="form" onSubmit={saveDetails}>
                <div className="crm-field-pair">
                    <label className="field">
                        <span>{t('lead.channel')}</span>
                        <select value={draft.channel} onChange={setField('channel')}>
                            {CHANNELS.map((c) => (
                                <option key={c} value={c}>
                                    {t(`channel.${c}`)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span>{t('lead.source')}</span>
                        <select value={draft.source_id} onChange={setField('source_id')}>
                            <option value="">{t('common.notSet')}</option>
                            {reference.sources.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.name}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <label className="field">
                    <span>{t('lead.manager')}</span>
                    <select value={draft.manager_id} onChange={setField('manager_id')}>
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
                    <input type="datetime-local" value={draft.booked_for} onChange={setField('booked_for')} />
                </label>
                <label className="field">
                    <span>{t('lead.notes')}</span>
                    <textarea value={draft.notes} onChange={setField('notes')} />
                </label>
                {error && <p className="error-text">{error}</p>}
                {dirty && (
                    <div className="form-actions">
                        <button type="submit" className="btn btn--block" disabled={saving}>
                            {saving ? t('common.saving') : t('common.save')}
                        </button>
                    </div>
                )}
            </form>

            <h3 className="crm-section-title">{t('lead.history')}</h3>
            <ul className="crm-timeline">
                {events.map((ev) => (
                    <li key={ev.id}>
                        <span className="crm-timeline__when">{formatDateTime(ev.created_at)}</span>
                        <span>
                            {ev.from_status ? `${t(`leadStatus.${ev.from_status}`)} → ` : `${t('lead.created')}: `}
                            {t(`leadStatus.${ev.to_status}`)}
                            {ev.user_id && userName(ev.user_id) && <span className="hint"> · {userName(ev.user_id)}</span>}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
