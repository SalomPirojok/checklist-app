import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';
import { ROLE_LABELS } from '../constants';

function toDateStr(date) {
    return date.toISOString().slice(0, 10);
}

const PRESETS = [
    { key: '7', label: '7 дней', days: 7 },
    { key: '30', label: '30 дней', days: 30 },
    { key: '90', label: '90 дней', days: 90 },
    { key: 'all', label: 'Всё время', days: null },
];

export default function EmployeeProfilePage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { id } = useParams();

    const [preset, setPreset] = useState('30');
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    async function load() {
        setLoading(true);
        try {
            let query = '';
            const activePreset = PRESETS.find((p) => p.key === preset);
            if (activePreset?.days) {
                const to = new Date();
                const from = new Date(to.getTime() - (activePreset.days - 1) * 24 * 60 * 60 * 1000);
                query = `?from=${toDateStr(from)}&to=${toDateStr(to)}`;
            }
            const res = await api(`/api/employees/${id}/profile${query}`);
            setProfile(res);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, id, preset]);

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate('/employees')}>
                ← Назад
            </button>

            {loading && <p>Загрузка...</p>}
            {error && <p className="error-text">{error}</p>}

            {!loading && !error && profile && (
                <>
                    <div className="page-header">
                        <h1>{profile.employee.full_name}</h1>
                    </div>
                    <p className="hint">
                        {ROLE_LABELS[profile.employee.role] || profile.employee.role}
                        {profile.employee.department && ` · ${profile.employee.department.name}`}
                    </p>

                    <div className="tab-bar" style={{ marginTop: '12px', marginBottom: '16px' }}>
                        {PRESETS.map((p) => (
                            <button
                                type="button"
                                key={p.key}
                                className={preset === p.key ? 'tab-bar__item tab-bar__item--active' : 'tab-bar__item'}
                                onClick={() => setPreset(p.key)}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>

                    <section style={{ marginBottom: '20px' }}>
                        <h2>Посещаемость</h2>
                        <p className="hint">
                            Приходов: {profile.attendance.check_ins}, из них с опозданием: {profile.attendance.late_check_ins}
                        </p>
                    </section>

                    <section style={{ marginBottom: '20px' }}>
                        <h2>Чек-листы</h2>
                        <p className="hint">
                            Выполнено {profile.checklists.completed} из {profile.checklists.total}, просрочено {profile.checklists.overdue}
                        </p>
                    </section>

                    <section style={{ marginBottom: '20px' }}>
                        <h2>Штрафы</h2>
                        {profile.penalties.items.length === 0 ? (
                            <p className="hint">Штрафов за период нет.</p>
                        ) : (
                            <>
                                <p className="hint">Итого: {profile.penalties.total_amount.toLocaleString('ru-RU')} сум</p>
                                <ul className="list">
                                    {profile.penalties.items.map((p) => (
                                        <li key={p.id} className="list-row">
                                            <div>
                                                <div className="list-row__title">{p.reason}</div>
                                                <div className="hint">{new Date(p.created_at).toLocaleDateString('ru-RU')}</div>
                                            </div>
                                            <div className="list-row__title">{Number(p.amount).toLocaleString('ru-RU')} сум</div>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </section>

                    <section>
                        <h2>Обучение</h2>
                        {profile.training.length === 0 ? (
                            <p className="hint">Тестов не проходил за период.</p>
                        ) : (
                            <ul className="list">
                                {profile.training.map((t) => (
                                    <li key={t.test_id} className="list-row">
                                        <div className="list-row__title">{t.material_title}</div>
                                        <div className="hint" style={{ textAlign: 'right' }}>
                                            <div>
                                                {t.best_score_percent}%{' '}
                                                <span className="tag" style={{ background: t.passed ? 'var(--status-success, green)' : 'var(--status-warning)' }}>
                                                    {t.passed ? 'пройден' : 'не пройден'}
                                                </span>
                                            </div>
                                            <div>Попыток: {t.attempt_count}</div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
