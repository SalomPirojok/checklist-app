import { useEffect, useState } from 'react';
import { useApiClient } from '../api/useApiClient';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS, canActOnRole } from '../constants';

const emptyForm = { telegram_id: '', full_name: '', username: '', role: 'employee' };

export default function EmployeesPage() {
    const api = useApiClient();
    const { user: currentUser } = useAuth();

    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [listError, setListError] = useState(null);

    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [formError, setFormError] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    async function load() {
        setLoading(true);
        try {
            const res = await api('/api/employees');
            setEmployees(res.employees);
            setListError(null);
        } catch (err) {
            setListError(err.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, [api]);

    function openCreateForm() {
        setForm(emptyForm);
        setEditingId(null);
        setFormError(null);
        setShowForm(true);
    }

    function openEditForm(employee) {
        setForm({
            telegram_id: String(employee.telegram_id),
            full_name: employee.full_name,
            username: employee.username || '',
            role: employee.role,
        });
        setEditingId(employee.id);
        setFormError(null);
        setShowForm(true);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSubmitting(true);
        setFormError(null);
        try {
            if (editingId) {
                await api(`/api/employees/${editingId}`, {
                    method: 'PATCH',
                    body: { full_name: form.full_name, username: form.username || null, role: form.role },
                });
            } else {
                await api('/api/employees', {
                    method: 'POST',
                    body: {
                        telegram_id: Number(form.telegram_id),
                        full_name: form.full_name,
                        username: form.username || undefined,
                        role: form.role,
                    },
                });
            }
            setShowForm(false);
            await load();
        } catch (err) {
            setFormError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDeactivate(employee) {
        if (!confirm(`Деактивировать ${employee.full_name}?`)) return;
        try {
            await api(`/api/employees/${employee.id}`, { method: 'DELETE' });
            await load();
        } catch (err) {
            setListError(err.message);
        }
    }

    return (
        <div className="page">
            <div className="page-header">
                <h1>Сотрудники</h1>
                <button className="btn" onClick={openCreateForm}>
                    + Добавить
                </button>
            </div>

            {loading && <p>Загрузка...</p>}
            {listError && <p className="error-text">{listError}</p>}

            {!loading && !listError && (
                <ul className="list">
                    {employees.length === 0 && <p className="hint">Сотрудников пока нет.</p>}
                    {employees.map((employee) => {
                        const canAct = canActOnRole(currentUser.role, employee.role);
                        return (
                            <li key={employee.id} className="list-row">
                                <div>
                                    <div className="list-row__title">
                                        {employee.full_name}
                                        {!employee.is_active && <span className="tag">неактивен</span>}
                                    </div>
                                    <div className="hint">
                                        {ROLE_LABELS[employee.role] || employee.role}
                                        {employee.username && ` · @${employee.username}`}
                                    </div>
                                </div>
                                {canAct && (
                                    <div className="list-row__actions">
                                        <button className="btn btn--ghost" onClick={() => openEditForm(employee)}>
                                            Изменить
                                        </button>
                                        {employee.is_active && (
                                            <button
                                                className="btn btn--ghost btn--danger"
                                                onClick={() => handleDeactivate(employee)}
                                            >
                                                Деактивировать
                                            </button>
                                        )}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {showForm && (
                <div className="modal-backdrop" onClick={() => setShowForm(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h2>{editingId ? 'Изменить сотрудника' : 'Новый сотрудник'}</h2>
                        <form onSubmit={handleSubmit} className="form">
                            {!editingId && (
                                <label className="field">
                                    <span>Telegram ID</span>
                                    <input
                                        type="number"
                                        required
                                        value={form.telegram_id}
                                        onChange={(e) => setForm({ ...form, telegram_id: e.target.value })}
                                    />
                                </label>
                            )}
                            <label className="field">
                                <span>Имя</span>
                                <input
                                    type="text"
                                    required
                                    value={form.full_name}
                                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                                />
                            </label>
                            <label className="field">
                                <span>Username (без @)</span>
                                <input
                                    type="text"
                                    value={form.username}
                                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                                />
                            </label>
                            <label className="field">
                                <span>Роль</span>
                                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                                    <option value="employee">Сотрудник</option>
                                    {currentUser.role === 'owner' && <option value="manager">Управляющий</option>}
                                </select>
                            </label>

                            {formError && <p className="error-text">{formError}</p>}

                            <div className="form-actions">
                                <button type="button" className="btn btn--ghost" onClick={() => setShowForm(false)}>
                                    Отмена
                                </button>
                                <button type="submit" className="btn" disabled={submitting}>
                                    {submitting ? 'Сохранение...' : 'Сохранить'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
