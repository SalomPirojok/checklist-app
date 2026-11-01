import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../api/useApiClient';
import { SkeletonRows } from '../../../components/Skeleton';
import { useCrm } from '../CrmContext';
import Modal from '../components/Modal';
import { formatMoney } from '../format';
import { t } from '../i18n';

const uzs = (n) => formatMoney(n, 'UZS');

function currentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function PayrollPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { can } = useCrm();

    const [data, setData] = useState(null);
    const [showAccrue, setShowAccrue] = useState(false);
    const [month, setMonth] = useState(currentMonth());
    const [result, setResult] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    async function load() {
        try {
            setData(await api('/api/crm/payroll/summary'));
        } catch (err) {
            setError(err.message);
        }
    }

    useEffect(() => {
        load();
    }, [api]);

    async function accrue(e) {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            const res = await api('/api/crm/payroll/salaries', { method: 'POST', body: { period_month: month } });
            setResult(t('payroll.accrueDone', { created: res.created, skipped: res.skipped }));
            setShowAccrue(false);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="page">
            <div className="page-header">
                <h1>{t('payroll.title')}</h1>
            </div>
            <div className="crm-actions-row">
                <button type="button" className="btn btn--ghost" onClick={() => navigate('/payroll/rules')}>
                    {t('payroll.rules')}
                </button>
                {can('payroll.manage') && (
                    <button type="button" className="btn btn--ghost" onClick={() => setShowAccrue(true)}>
                        {t('payroll.accrueSalaries')}
                    </button>
                )}
            </div>
            {result && <p className="success-text">{result}</p>}
            {error && !showAccrue && <p className="error-text">{error}</p>}

            {!data ? (
                <SkeletonRows count={4} />
            ) : data.staff.length === 0 ? (
                <p className="hint">{t('payroll.empty')}</p>
            ) : (
                <>
                    <p className="crm-owed-total">{t('payroll.totalOwed', { amount: uzs(data.total_owed) })}</p>
                    <ul className="list">
                        {data.staff.map((s) => (
                            <li key={s.id}>
                                <Link to={`/payroll/${s.id}`} className={`list-row crm-row${s.is_active ? '' : ' crm-row--muted'}`}>
                                    <div className="crm-row__main">
                                        <div className="list-row__title">{s.full_name}</div>
                                        <div className="hint">
                                            {t('payroll.accrued')} {uzs(s.accrued)} · {t('payroll.paid')} {uzs(s.paid)}
                                        </div>
                                    </div>
                                    <div className="crm-line__side">
                                        <strong className={s.owed > 0 ? 'crm-debt' : undefined}>{uzs(Math.abs(s.owed))}</strong>
                                        <span className="hint">{s.owed < 0 ? t('payroll.overpaid') : t('payroll.owed')}</span>
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            {showAccrue && (
                <Modal title={t('payroll.accrueTitle')} onClose={() => setShowAccrue(false)}>
                    <form className="form" onSubmit={accrue}>
                        <label className="field">
                            <span>{t('payroll.month')}</span>
                            <input type="month" required value={month} onChange={(e) => setMonth(e.target.value)} />
                        </label>
                        {error && <p className="error-text">{error}</p>}
                        <button type="submit" className="btn btn--block" disabled={saving || !month}>
                            {saving ? t('common.saving') : t('payroll.accrueSalaries')}
                        </button>
                    </form>
                </Modal>
            )}
        </div>
    );
}
