import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonBlocks } from '../../../components/Skeleton';
import { hapticSuccess } from '../../../lib/haptics';
import ClientPicker from '../components/ClientPicker';
import FoundClientCard from '../components/FoundClientCard';
import { vehicleTitle } from '../format';
import { t } from '../i18n';

const emptyForm = { make: '', model: '', year: '', plate: '', color: '', vin: '', notes: '' };

// /vehicles/new (owner passed as location.state.client, or picked here) or
// /vehicles/:id/edit. location.state.returnTo sends the user back, e.g. to
// a half-filled new order.
export default function VehicleFormPage() {
    const { id } = useParams();
    const api = useApiClient();
    const navigate = useNavigate();
    const location = useLocation();

    const [client, setClient] = useState(location.state?.client || null);
    const [form, setForm] = useState(id ? null : emptyForm);
    const [duplicate, setDuplicate] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!id) return;
        api(`/api/crm/vehicles/${id}`)
            .then(({ vehicle, client: owner }) => {
                setClient(owner);
                setForm({
                    make: vehicle.make || '',
                    model: vehicle.model || '',
                    year: vehicle.year ? String(vehicle.year) : '',
                    plate: vehicle.plate || '',
                    color: vehicle.color || '',
                    vin: vehicle.vin || '',
                    notes: vehicle.notes || '',
                });
            })
            .catch((err) => setError(err.message));
    }, [api, id]);

    async function handleSubmit(e) {
        e.preventDefault();
        if (!client) return;
        setSaving(true);
        setError(null);
        setDuplicate(null);
        try {
            const body = { ...form, client_id: client.id };
            const res = id
                ? await api(`/api/crm/vehicles/${id}`, { method: 'PATCH', body })
                : await api('/api/crm/vehicles', { method: 'POST', body });
            hapticSuccess();
            if (location.state?.returnTo) {
                navigate(location.state.returnTo, { replace: true, state: { ...location.state.returnState, vehicle: res.vehicle } });
            } else {
                navigate(`/vehicles/${res.vehicle.id}`, { replace: true });
            }
        } catch (err) {
            if (err.code === 'DUPLICATE_VEHICLE') setDuplicate(err.body.vehicle);
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    if (!form) return <div className="page">{error ? <p className="error-text">{error}</p> : <SkeletonBlocks count={3} />}</div>;

    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate(-1)}>
                {t('common.back')}
            </button>
            <div className="page-header">
                <h1>{id ? t('vehicle.editTitle') : t('vehicle.newTitle')}</h1>
            </div>

            <form className="form" onSubmit={handleSubmit}>
                <h3 className="crm-section-title">{t('vehicle.owner')}</h3>
                {client ? (
                    <FoundClientCard client={client} title={t('vehicle.owner')}>
                        <button type="button" className="btn btn--ghost" onClick={() => setClient(null)}>
                            {t('newLead.otherClient')}
                        </button>
                    </FoundClientCard>
                ) : (
                    <ClientPicker onPick={setClient} placeholder={t('order.pickClient')} />
                )}

                <div className="crm-field-pair">
                    <label className="field">
                        <span>{t('vehicle.make')} *</span>
                        <input type="text" value={form.make} onChange={set('make')} required placeholder="Chevrolet" />
                    </label>
                    <label className="field">
                        <span>{t('vehicle.model')}</span>
                        <input type="text" value={form.model} onChange={set('model')} placeholder="Malibu" />
                    </label>
                </div>
                <div className="crm-field-pair">
                    <label className="field">
                        <span>{t('vehicle.plate')}</span>
                        <input type="text" autoCapitalize="characters" value={form.plate} onChange={set('plate')} placeholder="01 A 123 BC" />
                    </label>
                    <label className="field">
                        <span>{t('vehicle.year')}</span>
                        <input type="number" inputMode="numeric" min="1950" max="2100" value={form.year} onChange={set('year')} />
                    </label>
                </div>
                <div className="crm-field-pair">
                    <label className="field">
                        <span>{t('vehicle.color')}</span>
                        <input type="text" value={form.color} onChange={set('color')} />
                    </label>
                    <label className="field">
                        <span>{t('vehicle.vin')}</span>
                        <input type="text" autoCapitalize="characters" maxLength={17} value={form.vin} onChange={set('vin')} />
                    </label>
                </div>
                <label className="field">
                    <span>{t('vehicle.notes')}</span>
                    <textarea value={form.notes} onChange={set('notes')} />
                </label>

                {duplicate && (
                    <div className="crm-found">
                        <div className="hint">{t('vehicle.duplicate')}</div>
                        <div className="list-row__title">{vehicleTitle(duplicate)}</div>
                        <div className="crm-found__actions">
                            <button type="button" className="btn btn--ghost" onClick={() => navigate(`/vehicles/${duplicate.id}`)}>
                                {t('client.openExisting')}
                            </button>
                        </div>
                    </div>
                )}
                {error && !duplicate && <p className="error-text">{error}</p>}
                <div className="form-actions">
                    <button type="submit" className="btn btn--block" disabled={saving || !client}>
                        {saving ? t('common.saving') : t('common.save')}
                    </button>
                </div>
            </form>
        </div>
    );
}
