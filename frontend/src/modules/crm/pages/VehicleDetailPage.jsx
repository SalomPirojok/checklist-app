import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApiClient, useApiUpload } from '../../../api/useApiClient';
import { SkeletonBlocks } from '../../../components/Skeleton';
import { useCrm } from '../CrmContext';
import OrderStatusBadge from '../components/OrderStatusBadge';
import PhotoStrip from '../components/PhotoStrip';
import { clientName, formatDate, formatMoney, formatPhone, vehicleTitle } from '../format';
import { t } from '../i18n';

export default function VehicleDetailPage() {
    const { id } = useParams();
    const api = useApiClient();
    const upload = useApiUpload();
    const navigate = useNavigate();
    const { can } = useCrm();

    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        api(`/api/crm/vehicles/${id}`)
            .then(setData)
            .catch((err) => setError(err.message));
    }, [api, id]);

    async function uploadPhoto(file) {
        const formData = new FormData();
        formData.append('photo', file);
        try {
            const res = await upload(`/api/crm/vehicles/${id}/photos`, formData);
            setData((prev) => ({ ...prev, photos: [...prev.photos, res.photo] }));
        } catch (err) {
            setError(err.message);
        }
    }

    async function deletePhoto(photo) {
        try {
            await api(`/api/crm/vehicles/${id}/photos/${photo.id}`, { method: 'DELETE' });
            setData((prev) => ({ ...prev, photos: prev.photos.filter((p) => p.id !== photo.id) }));
        } catch (err) {
            setError(err.message);
        }
    }

    if (!data) return <div className="page">{error ? <p className="error-text">{error}</p> : <SkeletonBlocks count={3} />}</div>;

    const { vehicle, client, photos, orders } = data;
    const facts = [
        [t('vehicle.plate'), vehicle.plate],
        [t('vehicle.year'), vehicle.year],
        [t('vehicle.color'), vehicle.color],
        [t('vehicle.vin'), vehicle.vin],
    ].filter(([, v]) => v);

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate(-1)}>
                {t('common.back')}
            </button>
            <div className="page-header">
                <h1>{vehicleTitle({ make: vehicle.make, model: vehicle.model })}</h1>
                <button type="button" className="btn btn--ghost" onClick={() => navigate(`/vehicles/${id}/edit`)}>
                    {t('common.edit')}
                </button>
            </div>

            {facts.length > 0 && (
                <div className="card crm-facts">
                    {facts.map(([label, value]) => (
                        <div key={label} className="crm-facts__row">
                            <span className="hint">{label}</span>
                            <span>{value}</span>
                        </div>
                    ))}
                    {vehicle.notes && <p className="crm-facts__notes">{vehicle.notes}</p>}
                </div>
            )}

            <h3 className="crm-section-title">{t('vehicle.owner')}</h3>
            <Link to={`/clients/${client.id}`} className="list-row crm-row">
                <div className="crm-row__main">
                    <div className="list-row__title">{clientName(client)}</div>
                    <div className="hint">{formatPhone(client.phone)}</div>
                </div>
                <span className="crm-chevron">›</span>
            </Link>

            <h3 className="crm-section-title">{t('vehicle.photos')}</h3>
            <PhotoStrip photos={photos} onUpload={uploadPhoto} onDelete={deletePhoto} />
            {error && <p className="error-text">{error}</p>}

            <div className="page-header crm-subheader">
                <h3>{t('vehicle.history')}</h3>
                {can('orders.manage') && (
                    <button type="button" className="btn btn--ghost" onClick={() => navigate('/orders/new', { state: { client, vehicle } })}>
                        {t('client.newOrder')}
                    </button>
                )}
            </div>
            {orders.length === 0 ? (
                <p className="hint">{t('vehicle.noHistory')}</p>
            ) : (
                <ul className="list">
                    {orders.map((o) => (
                        <li key={o.id}>
                            <Link to={`/orders/${o.id}`} className="list-row crm-row">
                                <div className="crm-row__main">
                                    <div className="list-row__title">
                                        {t('order.title', { number: o.number })} · {formatDate(o.issued_at || o.received_at || o.created_at)}
                                    </div>
                                    <div className="hint">{o.services.join(', ') || t('common.none')}</div>
                                    <div className="hint">{formatMoney(o.total, o.currency)}</div>
                                </div>
                                <OrderStatusBadge status={o.status} />
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
