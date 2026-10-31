import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonBlocks } from '../../../components/Skeleton';
import { useCrm } from '../CrmContext';
import LeadStatusBadge from '../components/LeadStatusBadge';
import { clientName, formatDate, formatDateTime, formatMoney, formatPhone } from '../format';
import { t } from '../i18n';

export default function ClientDetailPage() {
    const { id } = useParams();
    const api = useApiClient();
    const navigate = useNavigate();
    const { can, sourceName, userName } = useCrm();

    const [data, setData] = useState(null);
    const [comment, setComment] = useState('');
    const [posting, setPosting] = useState(false);
    const [error, setError] = useState(null);

    async function load() {
        try {
            setData(await api(`/api/crm/clients/${id}`));
            setError(null);
        } catch (err) {
            setError(err.message);
        }
    }

    useEffect(() => {
        load();
    }, [api, id]);

    async function addComment(e) {
        e.preventDefault();
        if (!comment.trim()) return;
        setPosting(true);
        try {
            const res = await api(`/api/crm/clients/${id}/comments`, { method: 'POST', body: { body: comment } });
            setData((prev) => ({ ...prev, comments: [res.comment, ...prev.comments] }));
            setComment('');
        } catch (err) {
            setError(err.message);
        } finally {
            setPosting(false);
        }
    }

    if (!data) {
        return <div className="page">{error ? <p className="error-text">{error}</p> : <SkeletonBlocks count={3} />}</div>;
    }

    const { client, leads, comments, vehicles, orders } = data;
    const facts = [
        [t('client.phone'), formatPhone(client.phone)],
        [t('client.instagram'), client.instagram_username && `@${client.instagram_username}`],
        [t('client.telegram'), client.telegram_username && `@${client.telegram_username}`],
        [t('client.source'), sourceName(client.source_id)],
        [t('client.manager'), userName(client.manager_id)],
        [t('client.firstContact'), formatDate(client.first_contact_at)],
    ].filter(([, value]) => value);

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate(-1)}>
                {t('common.back')}
            </button>
            <div className="page-header">
                <h1>{clientName(client)}</h1>
                <button type="button" className="btn btn--ghost" onClick={() => navigate(`/clients/${id}/edit`)}>
                    {t('common.edit')}
                </button>
            </div>

            <div className="card crm-facts">
                {facts.map(([label, value]) => (
                    <div key={label} className="crm-facts__row">
                        <span className="hint">{label}</span>
                        <span>{value}</span>
                    </div>
                ))}
                {client.notes && <p className="crm-facts__notes">{client.notes}</p>}
            </div>
            <div className="crm-contact-actions">
                {client.phone && (
                    <a className="btn btn--ghost" href={`tel:${client.phone}`}>
                        {t('client.phone')}
                    </a>
                )}
                {client.instagram_username && (
                    <a className="btn btn--ghost" href={`https://instagram.com/${client.instagram_username}`} target="_blank" rel="noreferrer">
                        Instagram
                    </a>
                )}
                {client.telegram_username && (
                    <a className="btn btn--ghost" href={`https://t.me/${client.telegram_username}`} target="_blank" rel="noreferrer">
                        Telegram
                    </a>
                )}
            </div>

            {error && <p className="error-text">{error}</p>}

            <div className="page-header crm-subheader">
                <h3>{t('client.leads')}</h3>
                {can('leads.manage') && (
                    <button type="button" className="btn btn--ghost" onClick={() => navigate('/leads/new', { state: { client } })}>
                        {t('client.newLead')}
                    </button>
                )}
            </div>
            {leads.length === 0 ? (
                <p className="hint">{t('client.noLeads')}</p>
            ) : (
                <ul className="list">
                    {leads.map((lead) => (
                        <li key={lead.id}>
                            <Link to={`/leads/${lead.id}`} className="list-row crm-row">
                                <div className="crm-row__main">
                                    <div className="list-row__title">{t('lead.title', { number: lead.number })}</div>
                                    <div className="hint">
                                        {t(`channel.${lead.channel}`)}
                                        {lead.source_id && ` · ${sourceName(lead.source_id)}`} · {formatDateTime(lead.created_at)}
                                    </div>
                                </div>
                                <LeadStatusBadge status={lead.status} />
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {vehicles.length > 0 && (
                <>
                    <h3 className="crm-section-title">{t('client.vehicles')}</h3>
                    <ul className="list">
                        {vehicles.map((v) => (
                            <li key={v.id} className="list-row">
                                <div className="list-row__title">{[v.make, v.model, v.year].filter(Boolean).join(' ')}</div>
                                <span className="hint">{[v.plate, v.color].filter(Boolean).join(' · ')}</span>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            {orders.length > 0 && (
                <>
                    <h3 className="crm-section-title">{t('client.orders')}</h3>
                    <ul className="list">
                        {orders.map((o) => (
                            <li key={o.id} className="list-row">
                                <div className="list-row__title">№{o.number}</div>
                                <span className="hint">{formatMoney(o.total, o.currency)}</span>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            <h3 className="crm-section-title">{t('client.comments')}</h3>
            <form className="crm-comment-form" onSubmit={addComment}>
                <textarea placeholder={t('client.commentPlaceholder')} value={comment} onChange={(e) => setComment(e.target.value)} />
                <button type="submit" className="btn" disabled={posting || !comment.trim()}>
                    {t('client.addComment')}
                </button>
            </form>
            {comments.length === 0 ? (
                <p className="hint">{t('client.noComments')}</p>
            ) : (
                <ul className="crm-timeline">
                    {comments.map((c) => (
                        <li key={c.id}>
                            <span className="crm-timeline__when">
                                {formatDateTime(c.created_at)}
                                {userName(c.author_id) && ` · ${userName(c.author_id)}`}
                            </span>
                            <span className="crm-comment-body">{c.body}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
