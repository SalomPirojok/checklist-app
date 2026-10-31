import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { useAuth } from '../../../context/AuthContext';
import { hapticSuccess } from '../../../lib/haptics';
import { useCrm } from '../CrmContext';
import ClientPicker from '../components/ClientPicker';
import FoundClientCard from '../components/FoundClientCard';
import { fromLocalInputValue, toLocalInputValue, vehicleTitle } from '../format';
import { CURRENCIES, t } from '../i18n';

// Opened from a lead / client / vehicle card (location.state carries client,
// vehicle, lead), or blank from the orders list.
export default function OrderNewPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const { assignableUsers } = useCrm();
    const initial = location.state || {};

    const [client, setClient] = useState(initial.client || null);
    const [vehicles, setVehicles] = useState([]);
    const [form, setForm] = useState(() => {
        const base = {
            vehicle_id: '',
            currency: 'UZS',
            received_at: toLocalInputValue(new Date().toISOString()),
            planned_ready_at: '',
            manager_id: user.id,
            notes: '',
            ...initial.form,
        };
        // A vehicle passed in (or just created) wins over the kept form.
        if (initial.vehicle) base.vehicle_id = initial.vehicle.id;
        return base;
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!client) {
            setVehicles([]);
            return;
        }
        api(`/api/crm/vehicles?client_id=${client.id}`)
            .then((res) => {
                setVehicles(res.vehicles);
                if (!form.vehicle_id && res.vehicles.length === 1) setForm((f) => ({ ...f, vehicle_id: res.vehicles[0].id }));
            })
            .catch(() => {});
    }, [api, client]);

    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    function addVehicle() {
        // Come back here with the new car selected and the form kept.
        navigate('/vehicles/new', {
            state: { client, returnTo: '/orders/new', returnState: { client, lead: initial.lead, form } },
        });
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!client) return;
        setSaving(true);
        setError(null);
        try {
            const res = await api('/api/crm/orders', {
                method: 'POST',
                body: {
                    client_id: client.id,
                    vehicle_id: form.vehicle_id || null,
                    lead_id: initial.lead?.id || null,
                    currency: form.currency,
                    received_at: fromLocalInputValue(form.received_at),
                    planned_ready_at: fromLocalInputValue(form.planned_ready_at),
                    manager_id: form.manager_id || null,
                    notes: form.notes,
                },
            });
            hapticSuccess();
            navigate(`/orders/${res.order.id}`, { replace: true });
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate(-1)}>
                {t('common.back')}
            </button>
            <div className="page-header">
                <h1>{t('order.newTitle')}</h1>
            </div>

            <form className="form" onSubmit={handleSubmit}>
                <h3 className="crm-section-title">{t('order.client')}</h3>
                {client ? (
                    <FoundClientCard client={client} title={t('order.client')}>
                        {!initial.lead && (
                            <button
                                type="button"
                                className="btn btn--ghost"
                                onClick={() => {
                                    setClient(null);
                                    setForm({ ...form, vehicle_id: '' });
                                }}
                            >
                                {t('newLead.otherClient')}
                            </button>
                        )}
                    </FoundClientCard>
                ) : (
                    <ClientPicker onPick={setClient} placeholder={t('order.pickClient')} />
                )}

                {client && (
                    <label className="field">
                        <span>{t('order.vehicle')}</span>
                        <select value={form.vehicle_id} onChange={set('vehicle_id')}>
                            <option value="">{t('order.noVehicle')}</option>
                            {vehicles.map((v) => (
                                <option key={v.id} value={v.id}>
                                    {[vehicleTitle({ make: v.make, model: v.model }), v.plate].filter(Boolean).join(' · ')}
                                </option>
                            ))}
                        </select>
                        <button type="button" className="btn btn--ghost crm-inline-link" onClick={addVehicle}>
                            {t('order.addVehicle')}
                        </button>
                    </label>
                )}

                <div className="crm-field-pair">
                    <label className="field">
                        <span>{t('order.currency')}</span>
                        <select value={form.currency} onChange={set('currency')}>
                            {CURRENCIES.map((c) => (
                                <option key={c} value={c}>
                                    {c === 'UZS' ? `UZS (${t('common.uzs')})` : c}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span>{t('order.manager')}</span>
                        <select value={form.manager_id} onChange={set('manager_id')}>
                            <option value="">{t('common.notSet')}</option>
                            {assignableUsers.map((u) => (
                                <option key={u.id} value={u.id}>
                                    {u.full_name}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <div className="crm-field-pair">
                    <label className="field">
                        <span>{t('order.receivedAt')}</span>
                        <input type="datetime-local" value={form.received_at} onChange={set('received_at')} />
                    </label>
                    <label className="field">
                        <span>{t('order.plannedReadyAt')}</span>
                        <input type="datetime-local" value={form.planned_ready_at} onChange={set('planned_ready_at')} />
                    </label>
                </div>
                <label className="field">
                    <span>{t('order.notes')}</span>
                    <textarea value={form.notes} onChange={set('notes')} />
                </label>

                {error && <p className="error-text">{error}</p>}
                <div className="form-actions">
                    <button type="submit" className="btn btn--block" disabled={saving || !client}>
                        {saving ? t('common.saving') : t('order.create')}
                    </button>
                </div>
            </form>
        </div>
    );
}
