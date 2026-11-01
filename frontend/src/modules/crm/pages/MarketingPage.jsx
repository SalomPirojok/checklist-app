import { useEffect, useState } from 'react';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonRows } from '../../../components/Skeleton';
import { useCrm } from '../CrmContext';
import Modal from '../components/Modal';
import PeriodPicker, { presetRange } from '../components/PeriodPicker';
import { formatMoney } from '../format';
import { t } from '../i18n';

const uzs = (n) => formatMoney(n, 'UZS');

function CampaignModal({ campaign, onSave, onClose }) {
    const { reference } = useCrm();
    const [form, setForm] = useState({
        name: campaign?.name || '',
        source_id: campaign?.source_id || reference.sources.find((s) => s.is_paid)?.id || reference.sources[0]?.id || '',
        external_campaign_id: campaign?.external_campaign_id || '',
        started_on: campaign?.started_on || '',
        ended_on: campaign?.ended_on || '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    async function submit(e) {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            await onSave(form);
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    }

    return (
        <Modal title={campaign ? t('common.edit') : t('mkt.addCampaign')} onClose={onClose}>
            <form className="form" onSubmit={submit}>
                <label className="field">
                    <span>{t('mkt.campaignName')} *</span>
                    <input type="text" required autoFocus value={form.name} onChange={set('name')} placeholder="PPF — ноябрь" />
                </label>
                <label className="field">
                    <span>{t('lead.source')}</span>
                    <select value={form.source_id} onChange={set('source_id')}>
                        {reference.sources.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.name}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="crm-field-pair">
                    <label className="field">
                        <span>{t('period.from')}</span>
                        <input type="date" value={form.started_on} onChange={set('started_on')} />
                    </label>
                    <label className="field">
                        <span>{t('period.to')}</span>
                        <input type="date" value={form.ended_on} onChange={set('ended_on')} />
                    </label>
                </div>
                <label className="field">
                    <span>{t('mkt.metaId')}</span>
                    <input type="text" inputMode="numeric" value={form.external_campaign_id} onChange={set('external_campaign_id')} />
                    <span className="hint">{t('mkt.metaIdHint')}</span>
                </label>
                {error && <p className="error-text">{error}</p>}
                <button type="submit" className="btn btn--block" disabled={saving}>
                    {saving ? t('common.saving') : t('common.save')}
                </button>
            </form>
        </Modal>
    );
}

export default function MarketingPage() {
    const api = useApiClient();
    const { can, reference, reloadReference, sourceName } = useCrm();

    const [period, setPeriod] = useState({ preset: 'month', ...presetRange('month') });
    const [group, setGroup] = useState('source');
    const [report, setReport] = useState(null);
    const [campaigns, setCampaigns] = useState([]);
    const [modal, setModal] = useState(null);
    const [error, setError] = useState(null);

    const campaignName = (id) => campaigns.find((c) => c.id === id)?.name;
    const canEditCampaigns = can('settings.manage') || can('finance.manage');

    async function loadCampaigns() {
        try {
            setCampaigns((await api('/api/crm/marketing/campaigns')).campaigns);
        } catch {
            // The report still works without names.
        }
    }

    useEffect(() => {
        loadCampaigns();
    }, [api]);

    useEffect(() => {
        setReport(null);
        api(`/api/crm/marketing/report?group=${group}&from=${period.from}&to=${period.to}`)
            .then((res) => {
                setReport(res);
                setError(null);
            })
            .catch((err) => setError(err.message));
    }, [api, group, period.from, period.to]);

    function rowName(key) {
        if (key === 'unallocated') return t('mkt.unallocated');
        if (key === null) return group === 'campaign' ? t('mkt.noCampaign') : t('dash.noSource');
        return (group === 'campaign' ? campaignName(key) : sourceName(key)) || '—';
    }

    async function saveCampaign(body) {
        if (modal.campaign) await api(`/api/crm/marketing/campaigns/${modal.campaign.id}`, { method: 'PATCH', body });
        else await api('/api/crm/marketing/campaigns', { method: 'POST', body });
        setModal(null);
        await Promise.all([loadCampaigns(), reloadReference()]);
    }

    const tot = report?.totals;

    return (
        <div className="page">
            <div className="page-header">
                <h1>{t('mkt.title')}</h1>
            </div>
            <PeriodPicker value={period} onChange={setPeriod} />
            <div className="crm-chips">
                {['source', 'campaign'].map((g) => (
                    <button key={g} type="button" className={group === g ? 'crm-chip crm-chip--active' : 'crm-chip'} onClick={() => setGroup(g)}>
                        {t(`mkt.by.${g}`)}
                    </button>
                ))}
            </div>
            {error && <p className="error-text">{error}</p>}

            {!report ? (
                <SkeletonRows count={4} />
            ) : (
                <>
                    <div className="card crm-funnel">
                        {[
                            ['mkt.leads', tot.leads],
                            ['mkt.booked', tot.booked],
                            ['mkt.arrived', tot.arrived],
                            ['mkt.orders', tot.orders],
                            ['mkt.issued', tot.issued_orders],
                        ].map(([label, value]) => (
                            <div key={label}>
                                <strong>{value}</strong>
                                <span className="hint">{t(label)}</span>
                            </div>
                        ))}
                    </div>
                    <p className="hint">
                        {t('finance.revenue')} {uzs(tot.revenue)} · {t('finance.grossProfit')} {uzs(tot.gross_profit)} · {t('mkt.spend')} {uzs(tot.spend)}
                    </p>

                    {report.rows.length === 0 ? (
                        <p className="hint">{t('mkt.empty')}</p>
                    ) : (
                        <ul className="list">
                            {report.rows.map((r) => (
                                <li key={String(r.key)} className="list-row crm-mkt-row">
                                    <div className="crm-mkt-row__head">
                                        <div className="list-row__title">{rowName(r.key)}</div>
                                        {r.spend > 0 && (
                                            <strong className={r.profit_after_ads < 0 ? 'crm-debt' : 'crm-income'}>
                                                {r.profit_after_ads < 0 ? t('mkt.loss') : t('mkt.profit')} {uzs(Math.abs(r.profit_after_ads))}
                                            </strong>
                                        )}
                                    </div>
                                    <div className="hint">
                                        {t('mkt.funnelLine', { leads: r.leads, booked: r.booked, arrived: r.arrived, orders: r.orders })}
                                        {r.conversion !== null && ` · ${t('mkt.conversion', { value: r.conversion })}`}
                                    </div>
                                    <div className="hint">
                                        {t('mkt.moneyLine', { issued: r.issued_orders, revenue: uzs(r.revenue), profit: uzs(r.gross_profit) })}
                                    </div>
                                    {r.spend > 0 && (
                                        <div className="hint">
                                            {t('mkt.spend')} {uzs(r.spend)}
                                            {r.cost_per_lead !== null && ` · ${t('mkt.cpl', { value: uzs(r.cost_per_lead) })}`}
                                            {r.cost_per_order !== null && ` · ${t('mkt.cpo', { value: uzs(r.cost_per_order) })}`}
                                            {r.romi !== null && ` · ROMI ${r.romi}%`}
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="hint">{t('mkt.hint')}</p>
                </>
            )}

            <div className="page-header crm-subheader">
                <h3>{t('mkt.campaigns')}</h3>
                {canEditCampaigns && (
                    <button type="button" className="btn btn--ghost" onClick={() => setModal({ campaign: null })}>
                        {t('mkt.addCampaign')}
                    </button>
                )}
            </div>
            {campaigns.length === 0 ? (
                <p className="hint">{t('mkt.noCampaigns')}</p>
            ) : (
                <ul className="list">
                    {campaigns.map((c) => (
                        <li key={c.id}>
                            <button
                                type="button"
                                className={`list-row crm-row crm-row--button${c.is_archived ? ' crm-row--muted' : ''}`}
                                disabled={!canEditCampaigns}
                                onClick={() => setModal({ campaign: c })}
                            >
                                <div className="crm-row__main">
                                    <div className="list-row__title">{c.name}</div>
                                    <div className="hint">
                                        {[reference.sources.find((s) => s.id === c.source_id)?.name, c.started_on, c.ended_on && `— ${c.ended_on}`]
                                            .filter(Boolean)
                                            .join(' ')}
                                    </div>
                                </div>
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {modal && <CampaignModal campaign={modal.campaign} onSave={saveCampaign} onClose={() => setModal(null)} />}
        </div>
    );
}
