import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';
import StatusBadge from '../components/StatusBadge';
import { SkeletonRows } from '../components/Skeleton';

function isToday(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const now = new Date();
    return (
        d.getUTCFullYear() === now.getUTCFullYear() &&
        d.getUTCMonth() === now.getUTCMonth() &&
        d.getUTCDate() === now.getUTCDate()
    );
}

function AssignmentListItem({ assignment }) {
    return (
        <li className="list-row">
            <Link to={`/assignments/${assignment.id}`} className="list-row__title list-row__title--link">
                {assignment.template?.title || 'Чек-лист'}
            </Link>
            <StatusBadge status={assignment.status} />
        </li>
    );
}

export default function EmployeeChecklistsPage() {
    const api = useApiClient();
    const [assignments, setAssignments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api('/api/assignments')
            .then((res) => {
                if (!cancelled) setAssignments(res.assignments);
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

    if (loading) {
        return (
            <div className="page">
                <div className="skeleton skeleton-text" style={{ height: 24, width: '45%', marginBottom: 16 }} />
                <SkeletonRows count={4} />
            </div>
        );
    }
    if (error) return <p className="error-text">{error}</p>;

    const standing = assignments.filter((a) => a.is_standing);
    const overdue = assignments.filter((a) => !a.is_standing && a.status === 'overdue');
    // A no-deadline checklist has due_at null -- fall back to created_at so it
    // still shows up on the day it was assigned.
    const today = assignments.filter((a) => !a.is_standing && a.status !== 'overdue' && isToday(a.due_at || a.created_at));

    return (
        <div className="page">
            <h1>Мои чек-листы</h1>

            {standing.length > 0 && (
                <section>
                    <h2>Постоянные</h2>
                    <ul className="list">
                        {standing.map((a) => (
                            <AssignmentListItem key={a.id} assignment={a} />
                        ))}
                    </ul>
                </section>
            )}

            {overdue.length > 0 && (
                <section>
                    <h2>Просроченные</h2>
                    <ul className="list">
                        {overdue.map((a) => (
                            <AssignmentListItem key={a.id} assignment={a} />
                        ))}
                    </ul>
                </section>
            )}

            <section>
                <h2>На сегодня</h2>
                {today.length === 0 ? (
                    <p className="hint">На сегодня ничего не назначено.</p>
                ) : (
                    <ul className="list">
                        {today.map((a) => (
                            <AssignmentListItem key={a.id} assignment={a} />
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
