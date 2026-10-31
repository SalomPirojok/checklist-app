import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonRows } from '../../../components/Skeleton';
import { formatPhone } from '../format';
import { t } from '../i18n';

export default function StaffPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const [staff, setStaff] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        api('/api/crm/staff')
            .then((res) => setStaff(res.staff))
            .catch((err) => setError(err.message));
    }, [api]);

    return (
        <div className="page">
            <div className="page-header">
                <h1>{t('staff.title')}</h1>
                <button type="button" className="btn" onClick={() => navigate('/staff/new')}>
                    {t('staff.new')}
                </button>
            </div>
            <p className="hint">{t('staff.hint')}</p>

            {error && <p className="error-text">{error}</p>}
            {!staff ? (
                <SkeletonRows count={4} />
            ) : staff.length === 0 ? (
                <p className="hint">{t('staff.empty')}</p>
            ) : (
                <ul className="list">
                    {staff.map((s) => (
                        <li key={s.id}>
                            <Link to={`/staff/${s.id}`} className={`list-row crm-row${s.is_active ? '' : ' crm-row--muted'}`}>
                                <div className="crm-row__main">
                                    <div className="list-row__title">{s.full_name}</div>
                                    <div className="hint">
                                        {[s.position, s.specialization, formatPhone(s.phone)].filter(Boolean).join(' · ') || t('common.none')}
                                    </div>
                                </div>
                                <span className="tag">{s.is_active ? t(`payScheme.${s.pay_scheme}`) : t('staff.inactive')}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
