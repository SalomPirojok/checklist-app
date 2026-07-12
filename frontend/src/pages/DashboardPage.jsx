import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';
import { useDelayedFlag } from '../hooks/useDelayedFlag';
import StatTile from '../components/StatTile';
import StatusBadge from '../components/StatusBadge';
import PhotoLightbox from '../components/PhotoLightbox';
import { SkeletonKpiRow, SkeletonRows } from '../components/Skeleton';

const STAT_ORDER = [
    ['not_started', 'Не начато'],
    ['in_progress', 'В процессе'],
    ['completed', 'Выполнено'],
    ['overdue', 'Просрочено'],
];

function AssignmentRow({ assignment, showDueAt }) {
    return (
        <li className="list-row">
            <Link to={`/assignments/${assignment.id}`} className="list-row__title--link">
                <div className="list-row__title">{assignment.template?.title}</div>
                <div className="hint">
                    {assignment.assignee?.full_name}
                    {showDueAt && ` · дедлайн ${new Date(assignment.due_at).toLocaleString('ru-RU')}`}
                </div>
            </Link>
            <StatusBadge status={assignment.status} />
        </li>
    );
}

function formatTime(isoString) {
    return new Date(isoString).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function AttendancePhoto({ record, onOpenPhoto }) {
    if (!record) return <span className="hint">не отмечен</span>;
    return (
        <button type="button" className="clickable-photo attendance-photo-link" onClick={() => onOpenPhoto(record.photo_url)}>
            <img src={record.photo_url} alt="" className="attendance-photo-thumb" />
            <span>{formatTime(record.created_at)}</span>
        </button>
    );
}

function AttendanceRow({ entry, onOpenPhoto }) {
    return (
        <li className="list-row">
            <div className="list-row__title">{entry.user.full_name}</div>
            <div className="attendance-row__times">
                <div>
                    <div className="hint">Приход</div>
                    <AttendancePhoto record={entry.check_in} onOpenPhoto={onOpenPhoto} />
                </div>
                <div>
                    <div className="hint">Уход</div>
                    <AttendancePhoto record={entry.check_out} onOpenPhoto={onOpenPhoto} />
                </div>
            </div>
        </li>
    );
}

export default function DashboardPage() {
    const api = useApiClient();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const showSlowHint = useDelayedFlag(loading, 4000);

    const [attendance, setAttendance] = useState(null);
    const [attendanceError, setAttendanceError] = useState(null);
    const [lightboxUrl, setLightboxUrl] = useState(null);

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

    useEffect(() => {
        let cancelled = false;
        api('/api/attendance/organization/today')
            .then((res) => {
                if (!cancelled) setAttendance(res);
            })
            .catch((err) => {
                if (!cancelled) setAttendanceError(err.message);
            });
        return () => {
            cancelled = true;
        };
    }, [api]);

    if (loading) {
        return (
            <div className="page">
                <div className="skeleton skeleton-text" style={{ height: 24, width: '40%', marginBottom: 16 }} />
                <SkeletonKpiRow />
                <SkeletonRows count={4} />
                {showSlowHint && (
                    <p className="hint">Сервер мог «заснуть» из-за простоя — обычно просыпается в течение минуты.</p>
                )}
            </div>
        );
    }
    if (error) return <p className="error-text">{error}</p>;
    if (!data) return null;

    const onShiftCount = attendance ? attendance.attendance.filter((a) => a.check_in && !a.check_out).length : null;
    const totalStaff = attendance ? attendance.attendance.length : null;

    return (
        <div className="page">
            <h1>Сегодня, {data.date}</h1>

            {onShiftCount !== null && totalStaff > 0 && (
                <div className="shift-status-card">
                    <div className="shift-status-card__value">
                        {onShiftCount} <span className="shift-status-card__total">из {totalStaff}</span>
                    </div>
                    <div className="shift-status-card__label">сейчас на смене</div>
                </div>
            )}

            <div className="kpi-row">
                {STAT_ORDER.map(([key, label]) => (
                    <StatTile key={key} statusKey={key} label={label} value={data.todays_summary[key]} />
                ))}
            </div>

            {data.overdue_total > 0 && (
                <div className="alert-banner">Всего просрочено (за все дни): {data.overdue_total}</div>
            )}

            {data.standing_assignments.length > 0 && (
                <section>
                    <h2>Постоянные чек-листы</h2>
                    <ul className="list">
                        {data.standing_assignments.map((a) => (
                            <AssignmentRow key={a.id} assignment={a} />
                        ))}
                    </ul>
                </section>
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

            <section>
                <h2>Посещаемость на сегодня</h2>
                {attendanceError && <p className="error-text">{attendanceError}</p>}
                {!attendanceError && !attendance && <p className="hint">Загрузка...</p>}
                {attendance && attendance.attendance.length === 0 && (
                    <p className="hint">В организации пока нет сотрудников.</p>
                )}
                {attendance && attendance.attendance.length > 0 && (
                    <ul className="list">
                        {attendance.attendance.map((entry) => (
                            <AttendanceRow key={entry.user.id} entry={entry} onOpenPhoto={setLightboxUrl} />
                        ))}
                    </ul>
                )}
            </section>

            {lightboxUrl && <PhotoLightbox photos={[lightboxUrl]} onClose={() => setLightboxUrl(null)} />}
        </div>
    );
}
