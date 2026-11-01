import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonBlocks } from '../../../components/Skeleton';
import { hapticSuccess } from '../../../lib/haptics';
import { formatDateTime } from '../format';
import { t } from '../i18n';

export default function InstagramSettingsPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [token, setToken] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    async function load() {
        try {
            setData(await api('/api/crm/integrations/instagram'));
        } catch (err) {
            setError(err.message);
        }
    }

    useEffect(() => {
        load();
    }, [api]);

    async function connect(e) {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            const res = await api('/api/crm/integrations/instagram', { method: 'PUT', body: { access_token: token } });
            setData((prev) => ({ ...prev, instagram: res.instagram }));
            setToken('');
            hapticSuccess();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    async function disconnect() {
        if (!confirm(t('ig.confirmDisconnect'))) return;
        setSaving(true);
        try {
            const res = await api('/api/crm/integrations/instagram', { method: 'DELETE' });
            setData((prev) => ({ ...prev, instagram: res.instagram }));
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    if (!data) return <div className="page">{error ? <p className="error-text">{error}</p> : <SkeletonBlocks count={3} />}</div>;

    const ig = data.instagram;
    const connected = ig.status === 'connected';

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate(-1)}>
                {t('common.back')}
            </button>
            <div className="page-header">
                <h1>Instagram Direct</h1>
            </div>

            {!data.server_ready && <p className="crm-warning">{t('ig.serverNotReady')}</p>}

            {connected ? (
                <div className="crm-issued">
                    <span>
                        {t('ig.connected')} {ig.username ? `@${ig.username}` : ''}
                        {ig.connected_at && <span className="hint"> · {formatDateTime(ig.connected_at)}</span>}
                    </span>
                    <button type="button" className="btn btn--ghost btn--danger" onClick={disconnect} disabled={saving}>
                        {t('ig.disconnect')}
                    </button>
                </div>
            ) : (
                <p className="hint">{t('ig.notConnected')}</p>
            )}
            {ig.last_error && <p className="error-text">{ig.last_error}</p>}

            <form className="form" onSubmit={connect}>
                <label className="field">
                    <span>{connected ? t('ig.replaceToken') : t('ig.token')}</span>
                    <textarea
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="IGAA…"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    <span className="hint">{t('ig.tokenHint')}</span>
                </label>
                {error && <p className="error-text">{error}</p>}
                <button type="submit" className="btn btn--block" disabled={saving || token.trim().length < 20}>
                    {saving ? t('common.saving') : t('ig.connect')}
                </button>
            </form>

            <h3 className="crm-section-title">{t('ig.setupTitle')}</h3>
            <ol className="crm-steps">
                <li>{t('ig.step1')}</li>
                <li>{t('ig.step2')}</li>
                <li>
                    {t('ig.step3')}
                    <code className="crm-code">{data.webhook_url}</code>
                </li>
                <li>{t('ig.step4')}</li>
                <li>{t('ig.step5')}</li>
            </ol>
            <p className="hint">{t('ig.windowHint')}</p>
        </div>
    );
}
