import { useEffect, useState } from 'react';
import { useApiClient } from '../api/useApiClient';
import { ROLE_LABELS } from '../constants';

export default function AssignChecklistModal({ template, onClose, onAssigned }) {
    const api = useApiClient();
    const [employees, setEmployees] = useState([]);
    const [loadingEmployees, setLoadingEmployees] = useState(true);
    const [assignedTo, setAssignedTo] = useState('');
    const [dueAt, setDueAt] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        api('/api/employees')
            .then((res) => {
                if (cancelled) return;
                // Assignments can only go to active employees/managers, never the owner.
                setEmployees(res.employees.filter((e) => e.role !== 'owner' && e.is_active));
            })
            .catch((err) => !cancelled && setError(err.message))
            .finally(() => !cancelled && setLoadingEmployees(false));
        return () => {
            cancelled = true;
        };
    }, [api]);

    async function handleSubmit(e) {
        e.preventDefault();
        if (!assignedTo || !dueAt) {
            setError('Выберите сотрудника и дедлайн');
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            await api('/api/assignments', {
                method: 'POST',
                body: {
                    template_id: template.id,
                    assigned_to: assignedTo,
                    due_at: new Date(dueAt).toISOString(),
                },
            });
            onAssigned();
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h2>Назначить «{template.title}»</h2>
                <form onSubmit={handleSubmit} className="form">
                    <label className="field">
                        <span>Сотрудник</span>
                        {loadingEmployees ? (
                            <p className="hint">Загрузка...</p>
                        ) : employees.length === 0 ? (
                            <p className="hint">Нет доступных сотрудников. Сначала добавьте их на вкладке «Сотрудники».</p>
                        ) : (
                            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} required>
                                <option value="" disabled>
                                    Выберите сотрудника
                                </option>
                                {employees.map((emp) => (
                                    <option key={emp.id} value={emp.id}>
                                        {emp.full_name} ({ROLE_LABELS[emp.role] || emp.role})
                                    </option>
                                ))}
                            </select>
                        )}
                    </label>

                    <label className="field">
                        <span>Дедлайн</span>
                        <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} required />
                    </label>

                    {error && <p className="error-text">{error}</p>}

                    <div className="form-actions">
                        <button type="button" className="btn btn--ghost" onClick={onClose}>
                            Отмена
                        </button>
                        <button type="submit" className="btn" disabled={submitting || loadingEmployees || employees.length === 0}>
                            {submitting ? 'Назначение...' : 'Назначить'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
