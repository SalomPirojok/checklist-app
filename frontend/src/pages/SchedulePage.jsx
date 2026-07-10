import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';
import { useAuth } from '../context/AuthContext';

const DAYS_OF_WEEK = [
    { value: 1, label: 'Пн' },
    { value: 2, label: 'Вт' },
    { value: 3, label: 'Ср' },
    { value: 4, label: 'Чт' },
    { value: 5, label: 'Пт' },
    { value: 6, label: 'Сб' },
    { value: 0, label: 'Вс' },
];

function formatDays(daysOfWeek) {
    if (!daysOfWeek || daysOfWeek.length === 0) return 'дни не заданы';
    const set = new Set(daysOfWeek);
    return DAYS_OF_WEEK.filter((d) => set.has(d.value))
        .map((d) => d.label)
        .join(', ');
}

function ScheduleEditor({ departmentId, initial, onSaved, onCancel, api }) {
    const [daysOfWeek, setDaysOfWeek] = useState(initial?.days_of_week || DAYS_OF_WEEK.map((d) => d.value));
    const [startTime, setStartTime] = useState((initial?.start_time || '09:00').slice(0, 5));
    const [endTime, setEndTime] = useState((initial?.end_time || '18:00').slice(0, 5));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    function toggleDay(day) {
        setDaysOfWeek((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
    }

    async function handleSave() {
        if (daysOfWeek.length === 0) {
            setError('Выберите хотя бы один день недели.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await api(`/api/schedules/${departmentId}`, {
                method: 'PUT',
                body: { days_of_week: daysOfWeek, start_time: startTime, end_time: endTime },
            });
            onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleClear() {
        if (!confirm('Убрать расписание для этого подразделения? Будет использоваться общее время смены организации.')) return;
        setSaving(true);
        setError(null);
        try {
            await api(`/api/schedules/${departmentId}`, { method: 'DELETE' });
            onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal" style={{ marginTop: '8px' }}>
            <label className="field">
                <span>Дни недели</span>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {DAYS_OF_WEEK.map((d) => (
                        <label key={d.value} className="checkbox-field" style={{ gap: '4px' }}>
                            <input type="checkbox" checked={daysOfWeek.includes(d.value)} onChange={() => toggleDay(d.value)} />
                            <span>{d.label}</span>
                        </label>
                    ))}
                </div>
            </label>
            <div style={{ display: 'flex', gap: '12px' }}>
                <label className="field">
                    <span>Начало смены</span>
                    <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
                </label>
                <label className="field">
                    <span>Конец смены</span>
                    <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
                </label>
            </div>

            {error && <p className="error-text">{error}</p>}

            <div className="form-actions">
                <button type="button" className="btn btn--ghost" onClick={onCancel}>
                    Отмена
                </button>
                {initial && (
                    <button type="button" className="btn btn--ghost btn--danger" onClick={handleClear} disabled={saving}>
                        Убрать расписание
                    </button>
                )}
                <button type="button" className="btn" onClick={handleSave} disabled={saving}>
                    {saving ? 'Сохранение...' : 'Сохранить'}
                </button>
            </div>
        </div>
    );
}

export default function SchedulePage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { user } = useAuth();
    const canManage = user.role === 'owner' || user.role === 'manager';

    const [departmentSchedules, setDepartmentSchedules] = useState([]);
    const [defaultShiftStartTime, setDefaultShiftStartTime] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [editingDeptId, setEditingDeptId] = useState(null);

    async function load() {
        setLoading(true);
        try {
            const res = await api('/api/schedules');
            setDepartmentSchedules(res.department_schedules);
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

    return (
        <div className="page">
            <div className="page-header">
                <h1>График работы</h1>
                {canManage && (
                    <button type="button" className="btn btn--ghost" onClick={() => navigate('/shift-schedule')}>
                        Конструктор смен
                    </button>
                )}
            </div>

            {loading && <p>Загрузка...</p>}
            {error && <p className="error-text">{error}</p>}

            {!loading && !error && (
                <>
                    <ul className="list">
                        {departmentSchedules.length === 0 && <p className="hint">Подразделений пока нет.</p>}
                        {departmentSchedules.map(({ department, schedule }) => (
                            <li key={department.id} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                    <div>
                                        <div className="list-row__title">{department.name}</div>
                                        {schedule ? (
                                            <div className="hint">
                                                {formatDays(schedule.days_of_week)} · {schedule.start_time.slice(0, 5)}–{schedule.end_time.slice(0, 5)}
                                            </div>
                                        ) : (
                                            <div className="hint">Расписание не задано — используется общее время смены ({defaultShiftStartTime?.slice(0, 5)})</div>
                                        )}
                                    </div>
                                    {canManage && (
                                        <button
                                            type="button"
                                            className="btn btn--ghost"
                                            onClick={() => setEditingDeptId(editingDeptId === department.id ? null : department.id)}
                                        >
                                            {editingDeptId === department.id ? 'Закрыть' : 'Изменить'}
                                        </button>
                                    )}
                                </div>
                                {canManage && editingDeptId === department.id && (
                                    <ScheduleEditor
                                        departmentId={department.id}
                                        initial={schedule}
                                        api={api}
                                        onCancel={() => setEditingDeptId(null)}
                                        onSaved={async () => {
                                            setEditingDeptId(null);
                                            await load();
                                        }}
                                    />
                                )}
                            </li>
                        ))}
                    </ul>

                    <p className="hint" style={{ marginTop: '12px' }}>
                        Сотрудники без подразделения работают по общему времени смены организации: {defaultShiftStartTime?.slice(0, 5)}.
                    </p>
                </>
            )}
        </div>
    );
}
