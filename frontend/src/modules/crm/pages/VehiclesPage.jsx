import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonRows } from '../../../components/Skeleton';
import SearchInput from '../components/SearchInput';
import { clientName, vehicleTitle } from '../format';
import { t } from '../i18n';

export default function VehiclesPage() {
    const api = useApiClient();
    const [q, setQ] = useState('');
    const [vehicles, setVehicles] = useState(null);
    const [total, setTotal] = useState(0);
    const [error, setError] = useState(null);

    const path = (offset) => `/api/crm/vehicles?${new URLSearchParams({ q, offset: String(offset) })}`;

    useEffect(() => {
        let cancelled = false;
        setVehicles(null);
        api(path(0))
            .then((res) => {
                if (cancelled) return;
                setVehicles(res.vehicles);
                setTotal(res.total);
            })
            .catch((err) => !cancelled && setError(err.message));
        return () => {
            cancelled = true;
        };
    }, [api, q]);

    async function loadMore() {
        try {
            const res = await api(path(vehicles.length));
            setVehicles((prev) => [...prev, ...res.vehicles]);
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div className="page">
            <div className="page-header">
                <h1>{t('vehicles.title')}</h1>
            </div>
            <SearchInput value={q} onChange={setQ} placeholder={t('vehicles.search')} />

            {error && <p className="error-text">{error}</p>}
            {!vehicles ? (
                <SkeletonRows count={5} />
            ) : vehicles.length === 0 ? (
                <p className="hint">{q ? t('leads.emptyFiltered') : t('vehicles.empty')}</p>
            ) : (
                <ul className="list">
                    {vehicles.map((v) => (
                        <li key={v.id}>
                            <Link to={`/vehicles/${v.id}`} className="list-row crm-row">
                                <div className="crm-row__main">
                                    <div className="list-row__title">{vehicleTitle(v)}</div>
                                    <div className="hint">{clientName(v.client)}</div>
                                </div>
                                {v.plate && <span className="crm-plate">{v.plate}</span>}
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
            {vehicles && vehicles.length < total && (
                <button type="button" className="btn btn--ghost btn--block" onClick={loadMore}>
                    {t('common.more')}
                </button>
            )}
        </div>
    );
}
