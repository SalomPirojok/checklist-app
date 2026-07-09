import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';

export default function DepartmentsPage() {
    const api = useApiClient();
    const navigate = useNavigate();

    const [departments, setDepartments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editingName, setEditingName] = useState('');

    async function load() {
        setLoading(true);
        try {
            const res = await api('/api/departments');
            setDepartments(res.departments);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, [api]);

    async function handleCreate(e) {
        e.preventDefault();
        if (!newName.trim()) return;
        setCreating(true);
        try {
            await api('/api/departments', { method: 'POST', body: { name: newName.trim() } });
            setNewName('');
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setCreating(false);
        }
    }

    function startEdit(dept) {
        setEditingId(dept.id);
        setEditingName(dept.name);
    }

    async function handleRename(id) {
        if (!editingName.trim()) return;
        try {
            await api(`/api/departments/${id}`, { method: 'PATCH', body: { name: editingName.trim() } });
            setEditingId(null);
            await load();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleArchive(dept) {
        if (!confirm(`Архивировать подразделение «${dept.name}»?`)) return;
        try {
            await api(`/api/departments/${dept.id}`, { method: 'DELETE' });
            await load();
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate('/employees')}>
                ← Назад
            </button>

            <div className="page-header">
                <h1>Подразделения</h1>
            </div>

            {loading && <p>Загрузка...</p>}
            {error && <p className="error-text">{error}</p>}

            {!loading && (
                <>
                    <ul className="list">
                        {departments.length === 0 && <p className="hint">Подразделений пока нет.</p>}
                        {departments.map((dept) => (
                            <li key={dept.id} className="list-row">
                                {editingId === dept.id ? (
                                    <input
                                        type="text"
                                        value={editingName}
                                        onChange={(e) => setEditingName(e.target.value)}
                                        autoFocus
                                    />
                                ) : (
                                    <div className="list-row__title">{dept.name}</div>
                                )}
                                <div className="list-row__actions">
                                    {editingId === dept.id ? (
                                        <>
                                            <button className="btn btn--ghost" onClick={() => handleRename(dept.id)}>
                                                Сохранить
                                            </button>
                                            <button className="btn btn--ghost" onClick={() => setEditingId(null)}>
                                                Отмена
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button className="btn btn--ghost" onClick={() => startEdit(dept)}>
                                                Изменить
                                            </button>
                                            <button className="btn btn--ghost btn--danger" onClick={() => handleArchive(dept)}>
                                                Архивировать
                                            </button>
                                        </>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>

                    <form onSubmit={handleCreate} className="form" style={{ marginTop: '16px' }}>
                        <label className="field">
                            <span>Новое подразделение</span>
                            <input
                                type="text"
                                placeholder="Например, Повара"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                            />
                        </label>
                        <div className="form-actions">
                            <button type="submit" className="btn" disabled={creating || !newName.trim()}>
                                {creating ? 'Создание...' : '+ Добавить'}
                            </button>
                        </div>
                    </form>
                </>
            )}
        </div>
    );
}
