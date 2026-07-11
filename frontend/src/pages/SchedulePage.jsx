import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';
import { useAuth } from '../context/AuthContext';
import { SkeletonBlocks } from '../components/Skeleton';

const DISPLAY_DAYS = [
    { value: 1, label: 'Пн' },
    { value: 2, label: 'Вт' },
    { value: 3, label: 'Ср' },
    { value: 4, label: 'Чт' },
    { value: 5, label: 'Пт' },
    { value: 6, label: 'Сб' },
    { value: 0, label: 'Вс' },
];

const STATUS_LABELS = { work: 'Работа', off: 'Выходной', undefined: 'Не задано' };

function DayCellEditor({ department, dayOfWeek, dayLabel, initial, onSave, onClose }) {
    const [status, setStatus] = useState(initial?.status || 'undefined');
    const [startTime, setStartTime] = useState((initial?.start_time || '09:00').slice(0, 5));
    const [endTime, setEndTime] = useState((initial?.end_time || '18:00').slice(0, 5));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    async function handleSave() {
        setSaving(true);
        setError(null);
        try {
            await onSave({
                day_of_week: dayOfWeek,
                status,
                start_time: status === 'work' ? startTime : null,
                end_time: status === 'work' ? endTime : null,
            });
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h2>{department.name}</h2>
                <p className="hint">{dayLabel}</p>

                <div className="form">
                    <label className="field">
                        <span>Статус</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                            {['work', 'off', 'undefined'].map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    className={`tab-bar__item${status === s ? ' tab-bar__item--active' : ''}`}
                                    onClick={() => setStatus(s)}
                                >
                                    {STATUS_LABELS[s]}
                                </button>
                            ))}
                        </div>
                    </label>

                    {status === 'work' && (
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <label className="field">
                                <span>Начало</span>
                                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                            </label>
                            <label className="field">
                                <span>Конец</span>
                                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                            </label>
                        </div>
                    )}

                    {error && <p className="error-text">{error}</p>}

                    <div className="form-actions">
                        <button type="button" className="btn btn--ghost" onClick={onClose}>
                            Отмена
                        </button>
                        <button type="button" className="btn" onClick={handleSave} disabled={saving}>
                            {saving ? 'Сохранение...' : 'Сохранить'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function SchedulePage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { user } = useAuth();
    const canManage = user.role === 'owner' || user.role === 'manager';

    const [departments, setDepartments] = useState([]);
    const [scheduleDays, setScheduleDays] = useState([]);
    const [defaultShiftStartTime, setDefaultShiftStartTime] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [editingCell, setEditingCell] = useState(null);

    async function load() {
        setLoading(true);
        try {
            const res = await api('/api/schedules');
            setDepartments(res.departments);
            setScheduleDays(res.schedule_days);
            setDefaultShiftStartTime(res.default_shift_start_time);
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
    }, [api]);

    const dayByKey = useMemo(() => {
        const map = new Map();
        for (const d of scheduleDays) map.set(`${d.department_id}_${d.day_of_week}`, d);
        return map;
    }, [scheduleDays]);

    async function saveCell(departmentId, payload) {
        const res = await api(`/api/schedules/${departmentId}`, { method: 'PUT', body: payload });
        setScheduleDays((prev) => {
            const key = `${res.schedule_day.department_id}_${res.schedule_day.day_of_week}`;
            const others = prev.filter((d) => `${d.department_id}_${d.day_of_week}` !== key);
            return [...others, res.schedule_day];
        });
    }

    return (
        <div className="page">
            <div className="page-header">
                <h1>График подразделений</h1>
                {canManage && (
                    <button type="button" className="btn btn--ghost" onClick={() => navigate('/shift-schedule')}>
                        Смены сотрудников
                    </button>
                )}
            </div>

            {loading && <SkeletonBlocks count={1} />}
            {error && <p className="error-text">{error}</p>}

            {!loading && !error && (
                <>
                    {departments.length === 0 ? (
                        <p className="hint">Подразделений пока нет.</p>
                    ) : (
                        <div className="shift-grid-wrapper">
                            <table className="shift-grid">
                                <thead>
                                    <tr>
                                        <th className="shift-grid__name-col">Подразделение</th>
                                        {DISPLAY_DAYS.map((d) => (
                                            <th key={d.value}>{d.label}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {departments.map((dept) => (
                                        <tr key={dept.id}>
                                            <td className="shift-grid__name-col">{dept.name}</td>
                                            {DISPLAY_DAYS.map((d) => {
                                                const row = dayByKey.get(`${dept.id}_${d.value}`);
                                                const status = row?.status || 'undefined';
                                                return (
                                                    <td key={d.value}>
                                                        <button
                                                            type="button"
                                                            className={`shift-cell-btn shift-cell-btn--${status}`}
                                                            disabled={!canManage}
                                                            onClick={() =>
                                                                canManage &&
                                                                setEditingCell({ department: dept, dayOfWeek: d.value, dayLabel: d.label })
                                                            }
                                                        >
                                                            {status === 'work' && row.start_time
                                                                ? `${row.start_time.slice(0, 5)}–${row.end_time?.slice(0, 5) || ''}`
                                                                : status === 'off'
                                                                  ? 'Вых'
                                                                  : ''}
                                                        </button>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <p className="hint" style={{ marginTop: '12px' }}>
                        Дни без явного статуса («Не задано») используют общее время смены организации: {defaultShiftStartTime?.slice(0, 5)}.
                    </p>
                </>
            )}

            {editingCell && (
                <DayCellEditor
                    department={editingCell.department}
                    dayOfWeek={editingCell.dayOfWeek}
                    dayLabel={editingCell.dayLabel}
                    initial={dayByKey.get(`${editingCell.department.id}_${editingCell.dayOfWeek}`)}
                    onSave={(payload) => saveCell(editingCell.department.id, payload)}
                    onClose={() => setEditingCell(null)}
                />
            )}
        </div>
    );
}
