import { useEffect, useRef, useState } from 'react';
import { useApiClient } from '../../../api/useApiClient';
import { useCrm } from '../CrmContext';
import { formatDateTime } from '../format';
import { t } from '../i18n';

// Instagram Direct conversation with one client, plus a reply box.
export default function ChatThread({ client }) {
    const api = useApiClient();
    const { can, userName } = useCrm();
    const [messages, setMessages] = useState(null);
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState(null);
    const endRef = useRef(null);

    async function load() {
        try {
            const res = await api(`/api/crm/messages?client_id=${client.id}`);
            setMessages(res.messages);
        } catch (err) {
            setError(err.message);
        }
    }

    useEffect(() => {
        load();
    }, [api, client.id]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ block: 'nearest' });
    }, [messages?.length]);

    async function send(e) {
        e.preventDefault();
        if (!text.trim()) return;
        setSending(true);
        setError(null);
        try {
            const res = await api('/api/crm/messages', { method: 'POST', body: { client_id: client.id, text } });
            setMessages((prev) => [...prev, res.message]);
            setText('');
        } catch (err) {
            // A failed send is stored too; show it in the thread.
            if (err.body?.message) setMessages((prev) => [...prev, err.body.message]);
            setError(err.message);
        } finally {
            setSending(false);
        }
    }

    if (!messages) return error ? <p className="error-text">{error}</p> : null;
    if (!messages.length && !client.instagram_user_id) return null;

    return (
        <div className="crm-chat">
            <div className="page-header crm-subheader">
                <h3>{t('chat.title')}</h3>
                <button type="button" className="btn btn--ghost" onClick={load}>
                    ↻
                </button>
            </div>
            <div className="crm-chat__list">
                {messages.length === 0 && <p className="hint">{t('chat.empty')}</p>}
                {messages.map((m) => (
                    <div key={m.id} className={`crm-bubble crm-bubble--${m.direction}${m.status === 'failed' ? ' crm-bubble--failed' : ''}`}>
                        {m.body && <div className="crm-bubble__text">{m.body}</div>}
                        {m.attachments?.map((a, i) =>
                            a.type === 'image' && a.url ? (
                                <a key={i} href={a.url} target="_blank" rel="noreferrer">
                                    <img src={a.url} alt="" className="crm-bubble__image" />
                                </a>
                            ) : (
                                <div key={i} className="hint">
                                    [{a.type}]
                                </div>
                            )
                        )}
                        <div className="crm-bubble__meta">
                            {formatDateTime(m.sent_at)}
                            {m.direction === 'out' && userName(m.sent_by) && ` · ${userName(m.sent_by)}`}
                            {m.status === 'failed' && ` · ${t('chat.failed')}`}
                        </div>
                        {m.status === 'failed' && m.error && <div className="crm-bubble__error">{m.error}</div>}
                    </div>
                ))}
                <div ref={endRef} />
            </div>
            {can('messages.send') && client.instagram_user_id && (
                <form className="crm-chat__form" onSubmit={send}>
                    <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t('chat.placeholder')} rows={2} />
                    <button type="submit" className="btn" disabled={sending || !text.trim()}>
                        {t('chat.send')}
                    </button>
                </form>
            )}
            {error && <p className="error-text">{error}</p>}
        </div>
    );
}
