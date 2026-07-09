import { useEffect, useState } from 'react';
import { useApiClient } from '../api/useApiClient';
import StatTile from '../components/StatTile';
import StatusBadge from '../components/StatusBadge';

const STAT_ORDER = [
    ['not_started', 'Не начато'],
    ['in_progress', 'В процессе'],
    ['completed', 'Выполнено'],
    ['overdue', 'Просрочено'],
];

function AssignmentRow({ assignment, showDueAt }) {
    return (
        <li className="list-row">
            <div>
                <div className="list-row__title">{assignment.template?.title}</div>
                <div className="hint">
                    {assignment.assignee?.full_name}
                    {showDueAt && ` · дедлайн ${new Date(assignment.due_at).toLocaleString('ru-RU')}`}
                </div>
            </div>
            <StatusBadge status={assignment.status} />
        </li>
    );
}

export default function DashboardPage() {
    const api = useApiClient();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api('/api/dashboard/today')
            .then((res) => {
                if (!cancelled) setData(res);
            })
            .catch((err) => {
                if (!cancelled) setError(err.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [api]);

    if (loading) return <p>Загрузка...</p>;
    if (error) return <p className="error-text">{error}</p>;
    if (!data) return null;

    return (
        <div className="page">
            <h1>Сегодня, {data.date}</h1>

            <div className="kpi-row">
                {STAT_ORDER.map(([key, label]) => (
                    <StatTile key={key} statusKey={key} label={label} value={data.todays_summary[key]} />
                ))}
            </div>

            {data.overdue_total > 0 && (
                <div className="alert-banner">Всего просрочено (за все дни): {data.overdue_total}</div>
            )}

            <section>
                <h2>Назначения на сегодня</h2>
                {data.todays_assignments.length === 0 ? (
                    <p className="hint">На сегодня ничего не назначено.</p>
                ) : (
                    <ul className="list">
                        {data.todays_assignments.map((a) => (
                            <AssignmentRow key={a.id} assignment={a} />
                        ))}
                    </ul>
                )}
            </section>

            <section>
                <h2>Просроченные</h2>
                {data.overdue_assignments.length === 0 ? (
                    <p className="hint">Просроченных нет.</p>
                ) : (
                    <ul className="list">
                        {data.overdue_assignments.map((a) => (
                            <AssignmentRow key={a.id} assignment={a} showDueAt />
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
