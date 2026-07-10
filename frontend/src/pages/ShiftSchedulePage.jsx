import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';
import { useDelayedFlag } from '../hooks/useDelayedFlag';
import { SkeletonBlocks } from '../components/Skeleton';

const DAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const STATUS_LABELS = { work: 'Работа', off: 'Выходной', undefined: 'Не задано' };

function toDateStr(date) {
    return date.toISOString().slice(0, 10);
}

function startOfWeekUTC(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay(); // 0 = Sun .. 6 = Sat
    const diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    return d;
}

function getWeekDates(monday) {
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setUTCDate(d.getUTCDate() + i);
        return d;
    });
}

function formatWeekLabel(dates) {
    const first = dates[0];
    const last = dates[6];
    const fmt = (d) => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return `${fmt(first)} – ${fmt(last)}, ${last.getUTCFullYear()}`;
}

function CellEditor({ employee, dateStr, dateLabel, initial, onSave, onClear, onClose }) {
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
                user_id: employee.id,
                shift_date: dateStr,
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

    async function handleClear() {
        setSaving(true);
        setError(null);
        try {
            await onClear({ user_id: employee.id, shift_date: dateStr });
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
                <h2>{employee.full_name}</h2>
                <p className="hint">{dateLabel}</p>

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
                        {initial && (
                            <button type="button" className="btn btn--ghost btn--danger" onClick={handleClear} disabled={saving}>
                                Очистить
                            </button>
                        )}
                        <button type="button" className="btn" onClick={handleSave} disabled={saving}>
                            {saving ? 'Сохранение...' : 'Сохранить'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function SaveTemplateModal({ onSave, onClose }) {
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    async function handleSave() {
        if (!name.trim()) {
            setError('Введите название шаблона');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await onSave(name.trim());
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
                <h2>Сохранить как шаблон</h2>
                <p className="hint">Текущая неделя будет сохранена как шаблон по дням недели (без привязки к датам).</p>
                <div className="form">
                    <label className="field">
                        <span>Название шаблона</span>
                        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                    </label>
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

function ApplyTemplateModal({ templates, onApply, onClose }) {
    const [selectedId, setSelectedId] = useState(templates[0]?.id || '');
    const [applying, setApplying] = useState(false);
    const [error, setError] = useState(null);

    async function handleApply() {
        if (!selectedId) return;
        setApplying(true);
        setError(null);
        try {
            await onApply(templates.find((t) => t.id === selectedId));
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setApplying(false);
        }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h2>Применить шаблон</h2>
                <p className="hint">Шаблон заменит статусы на отображаемой неделе для сотрудников, включённых в шаблон.</p>
                {templates.length === 0 ? (
                    <p className="hint">Сохранённых шаблонов пока нет.</p>
                ) : (
                    <div className="form">
                        <label className="field">
                            <span>Шаблон</span>
                            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                                {templates.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {error && <p className="error-text">{error}</p>}
                        <div className="form-actions">
                            <button type="button" className="btn btn--ghost" onClick={onClose}>
                                Отмена
                            </button>
                            <button type="button" className="btn" onClick={handleApply} disabled={applying}>
                                {applying ? 'Применение...' : 'Применить'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function ShiftSchedulePage() {
    const api = useApiClient();
    const navigate = useNavigate();

    const [weekStart, setWeekStart] = useState(() => startOfWeekUTC(new Date()));
    const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
    const from = toDateStr(weekDates[0]);
    const to = toDateStr(weekDates[6]);

    const [employees, setEmployees] = useState([]);
    const [shifts, setShifts] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [departmentFilter, setDepartmentFilter] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const showSlowHint = useDelayedFlag(loading, 4000);

    const [editingCell, setEditingCell] = useState(null);
    const [showSaveTemplate, setShowSaveTemplate] = useState(false);
    const [showApplyTemplate, setShowApplyTemplate] = useState(false);
    const [templates, setTemplates] = useState([]);
    const [message, setMessage] = useState(null);
    const [copying, setCopying] = useState(false);

    async function load() {
        setLoading(true);
        try {
            const res = await api(`/api/schedule/shifts?from=${from}&to=${to}`);
            setEmployees(res.employees);
            setShifts(res.shifts);
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
    }, [api, from, to]);

    useEffect(() => {
        api('/api/departments')
            .then((res) => setDepartments(res.departments))
            .catch(() => {});
    }, [api]);

    const shiftByKey = useMemo(() => {
        const map = new Map();
        for (const s of shifts) map.set(`${s.user_id}_${s.shift_date}`, s);
        return map;
    }, [shifts]);

    const visibleEmployees = departmentFilter
        ? employees.filter((e) => e.department_id === departmentFilter)
        : employees;

    function goToWeek(offsetWeeks) {
        const d = new Date(weekStart);
        d.setUTCDate(d.getUTCDate() + offsetWeeks * 7);
        setWeekStart(d);
        setMessage(null);
    }

    async function saveCell(payload) {
        const res = await api('/api/schedule/shifts', { method: 'PUT', body: payload });
        setShifts((prev) => {
            const key = `${res.shift.user_id}_${res.shift.shift_date}`;
            const others = prev.filter((s) => `${s.user_id}_${s.shift_date}` !== key);
            return [...others, res.shift];
        });
    }

    async function clearCell({ user_id, shift_date }) {
        await saveCell({ user_id, shift_date, status: 'undefined', start_time: null, end_time: null });
    }

    async function handleCopyToNextWeek() {
        if (shifts.length === 0) {
            setMessage('На этой неделе нет заполненных смен для копирования.');
            return;
        }
        if (!confirm('Скопировать текущую неделю на следующую? Существующие данные следующей недели будут перезаписаны.')) return;
        setCopying(true);
        setMessage(null);
        try {
            const bulkShifts = shifts.map((s) => {
                const d = new Date(`${s.shift_date}T00:00:00Z`);
                d.setUTCDate(d.getUTCDate() + 7);
                return {
                    user_id: s.user_id,
                    shift_date: toDateStr(d),
                    status: s.status,
                    start_time: s.start_time ? s.start_time.slice(0, 5) : null,
                    end_time: s.end_time ? s.end_time.slice(0, 5) : null,
                };
            });
            await api('/api/schedule/shifts/bulk', { method: 'POST', body: { shifts: bulkShifts } });
            goToWeek(1);
            setMessage('Неделя скопирована.');
        } catch (err) {
            setMessage(err.message);
        } finally {
            setCopying(false);
        }
    }

    async function handleSaveTemplate(name) {
        const templateData = {};
        for (const s of shifts) {
            const dayOfWeek = new Date(`${s.shift_date}T00:00:00Z`).getUTCDay();
            if (!templateData[s.user_id]) templateData[s.user_id] = {};
            templateData[s.user_id][dayOfWeek] = {
                status: s.status,
                start: s.start_time ? s.start_time.slice(0, 5) : null,
                end: s.end_time ? s.end_time.slice(0, 5) : null,
            };
        }
        await api('/api/schedule/templates', { method: 'POST', body: { name, template_data: templateData } });
        setMessage(`Шаблон «${name}» сохранён.`);
    }

    async function openApplyTemplate() {
        try {
            const res = await api('/api/schedule/templates');
            setTemplates(res.templates);
            setShowApplyTemplate(true);
        } catch (err) {
            setMessage(err.message);
        }
    }

    async function handleApplyTemplate(template) {
        const bulkShifts = [];
        for (const dateObj of weekDates) {
            const dayOfWeek = dateObj.getUTCDay();
            const dateStr = toDateStr(dateObj);
            for (const [userId, byDay] of Object.entries(template.template_data)) {
                const entry = byDay[dayOfWeek] ?? byDay[String(dayOfWeek)];
                if (!entry) continue;
                bulkShifts.push({
                    user_id: userId,
                    shift_date: dateStr,
                    status: entry.status || 'undefined',
                    start_time: entry.start || null,
                    end_time: entry.end || null,
                });
            }
        }
        if (bulkShifts.length === 0) {
            setMessage('Шаблон не содержит данных для сотрудников этой организации.');
            return;
        }
        await api('/api/schedule/shifts/bulk', { method: 'POST', body: { shifts: bulkShifts } });
        await load();
        setMessage(`Шаблон «${template.name}» применён.`);
    }

    return (
        <div className="page">
            <div className="page-header">
                <button type="button" className="btn btn--ghost back-link" onClick={() => navigate('/schedule')}>
                    ← Назад
                </button>
            </div>
            <h1>Конструктор графика смен</h1>

            <div className="page-header" style={{ marginTop: '4px' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button type="button" className="btn btn--ghost" onClick={() => goToWeek(-1)}>
                        ←
                    </button>
                    <strong>{formatWeekLabel(weekDates)}</strong>
                    <button type="button" className="btn btn--ghost" onClick={() => goToWeek(1)}>
                        →
                    </button>
                </div>
                <button type="button" className="btn btn--ghost" onClick={() => setWeekStart(startOfWeekUTC(new Date()))}>
                    Сегодня
                </button>
            </div>

            {departments.length > 0 && (
                <div className="tab-bar" style={{ marginBottom: '12px' }}>
                    <button
                        type="button"
                        className={departmentFilter === '' ? 'tab-bar__item tab-bar__item--active' : 'tab-bar__item'}
                        onClick={() => setDepartmentFilter('')}
                    >
                        Все
                    </button>
                    {departments.map((dept) => (
                        <button
                            type="button"
                            key={dept.id}
                            className={departmentFilter === dept.id ? 'tab-bar__item tab-bar__item--active' : 'tab-bar__item'}
                            onClick={() => setDepartmentFilter(dept.id)}
                        >
                            {dept.name}
                        </button>
                    ))}
                </div>
            )}

            <div className="form-actions" style={{ justifyContent: 'flex-start', marginBottom: '12px' }}>
                <button type="button" className="btn btn--ghost" onClick={handleCopyToNextWeek} disabled={copying || loading}>
                    {copying ? 'Копирование...' : 'Скопировать на след. неделю'}
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setShowSaveTemplate(true)} disabled={loading}>
                    Сохранить как шаблон
                </button>
                <button type="button" className="btn btn--ghost" onClick={openApplyTemplate} disabled={loading}>
                    Применить шаблон
                </button>
            </div>

            {message && <p className="success-text">{message}</p>}
            {error && <p className="error-text">{error}</p>}

            {loading && (
                <>
                    <SkeletonBlocks count={1} />
                    {showSlowHint && (
                        <p className="hint">Сервер мог «заснуть» из-за простоя — обычно просыпается в течение минуты.</p>
                    )}
                </>
            )}

            {!loading && !error && (
                <div className="shift-grid-wrapper">
                    <table className="shift-grid">
                        <thead>
                            <tr>
                                <th className="shift-grid__name-col">Сотрудник</th>
                                {weekDates.map((d) => (
                                    <th key={toDateStr(d)}>
                                        {DAY_LABELS[(d.getUTCDay() + 6) % 7]}
                                        <br />
                                        {String(d.getUTCDate()).padStart(2, '0')}.{String(d.getUTCMonth() + 1).padStart(2, '0')}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {visibleEmployees.length === 0 && (
                                <tr>
                                    <td colSpan={8} style={{ padding: '16px' }}>
                                        <span className="hint">Сотрудников не найдено.</span>
                                    </td>
                                </tr>
                            )}
                            {visibleEmployees.map((employee) => (
                                <tr key={employee.id}>
                                    <td className="shift-grid__name-col">{employee.full_name}</td>
                                    {weekDates.map((d) => {
                                        const dateStr = toDateStr(d);
                                        const shift = shiftByKey.get(`${employee.id}_${dateStr}`);
                                        const status = shift?.status || 'undefined';
                                        return (
                                            <td key={dateStr}>
                                                <button
                                                    type="button"
                                                    className={`shift-cell-btn shift-cell-btn--${status}`}
                                                    onClick={() => setEditingCell({ employee, dateStr })}
                                                >
                                                    {status === 'work' && shift.start_time
                                                        ? `${shift.start_time.slice(0, 5)}–${shift.end_time?.slice(0, 5) || ''}`
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

            {editingCell && (
                <CellEditor
                    employee={editingCell.employee}
                    dateStr={editingCell.dateStr}
                    dateLabel={new Date(`${editingCell.dateStr}T00:00:00Z`).toLocaleDateString('ru-RU', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        timeZone: 'UTC',
                    })}
                    initial={shiftByKey.get(`${editingCell.employee.id}_${editingCell.dateStr}`)}
                    onSave={saveCell}
                    onClear={clearCell}
                    onClose={() => setEditingCell(null)}
                />
            )}

            {showSaveTemplate && (
                <SaveTemplateModal onSave={handleSaveTemplate} onClose={() => setShowSaveTemplate(false)} />
            )}

            {showApplyTemplate && (
                <ApplyTemplateModal
                    templates={templates}
                    onApply={handleApplyTemplate}
                    onClose={() => setShowApplyTemplate(false)}
                />
            )}
        </div>
    );
}
