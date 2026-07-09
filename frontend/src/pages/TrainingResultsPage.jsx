import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';
import { ROLE_LABELS } from '../constants';

export default function TrainingResultsPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        api('/api/training/results')
            .then((res) => setResults(res.results))
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [api]);

    if (loading) return <p>Загрузка...</p>;
    if (error) return <p className="error-text">{error}</p>;

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate('/training')}>
                ← Назад
            </button>
            <div className="page-header">
                <h1>Результаты тестов</h1>
            </div>

            {results.length === 0 && <p className="hint">Пока нет материалов с тестами.</p>}

            {results.map(({ material, test, employees }) => (
                <div key={material.id} style={{ marginBottom: '24px' }}>
                    <h2>{material.title}</h2>
                    <p className="hint">Проходной балл: {test.passing_score_percent}%</p>
                    <ul className="list">
                        {employees.map((employee) => (
                            <li key={employee.user_id} className="list-row">
                                <div>
                                    <div className="list-row__title">{employee.full_name}</div>
                                    <div className="hint">{ROLE_LABELS[employee.role] || employee.role}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    {employee.attempted ? (
                                        <>
                                            <div>
                                                {employee.best_score_percent}%{' '}
                                                <span className="tag" style={{ background: employee.passed ? 'var(--status-success, green)' : 'var(--status-warning)' }}>
                                                    {employee.passed ? 'пройден' : 'не пройден'}
                                                </span>
                                            </div>
                                            <div className="hint">
                                                Попыток: {employee.attempt_count} · {new Date(employee.last_attempt_at).toLocaleString('ru-RU')}
                                            </div>
                                        </>
                                    ) : (
                                        <span className="hint">не проходил</span>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}
