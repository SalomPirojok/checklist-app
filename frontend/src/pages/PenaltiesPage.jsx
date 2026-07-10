import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';
import { SkeletonRows } from '../components/Skeleton';

const RULE_TYPE_LABELS = {
    auto_late: 'авто (опоздание)',
    manual: 'вручную',
};

const emptyForm = { user_id: '', reason: '', amount: '' };

export default function PenaltiesPage() {
    const api = useApiClient();
    const navigate = useNavigate();

    const [penalties, setPenalties] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [formError, setFormError] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    async function load() {
        setLoading(true);
        try {
            const res = await api('/api/penalties');
            setPenalties(res.penalties);
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

    useEffect(() => {
        api('/api/employees')
            .then((res) => setEmployees(res.employees.filter((e) => e.role !== 'owner' && e.is_active)))
            .catch(() => {});
    }, [api]);

    function openForm() {
        setForm(emptyForm);
        setFormError(null);
        setShowForm(true);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setFormError(null);
        if (!form.user_id || !form.reason.trim() || form.amount === '') {
            setFormError('Заполните все поля');
            return;
        }
        setSubmitting(true);
        try {
            await api('/api/penalties', {
                method: 'POST',
                body: { user_id: form.user_id, reason: form.reason.trim(), amount: Number(form.amount) },
            });
            setShowForm(false);
            await load();
        } catch (err) {
            setFormError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="page">
            <div className="page-header">
                <h1>Штрафы</h1>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn--ghost" onClick={() => navigate('/penalties/settings')}>
                        Настройки автоштрафа
                    </button>
                    <button className="btn" onClick={openForm}>
                        + Добавить штраф
                    </button>
                </div>
            </div>

            {loading && <SkeletonRows count={5} />}
            {error && <p className="error-text">{error}</p>}

            {!loading && !error && (
                <ul className="list">
                    {penalties.length === 0 && <p className="hint">Штрафов пока нет.</p>}
                    {penalties.map((p) => (
                        <li key={p.id} className="list-row">
                            <div>
                                <div className="list-row__title">
                                    {p.user?.full_name || '—'}
                                    <span className="tag">{RULE_TYPE_LABELS[p.rule_type] || p.rule_type}</span>
                                </div>
                                <div className="hint">{p.reason}</div>
                                <div className="hint">
                                    {new Date(p.created_at).toLocaleString('ru-RU')}
                                    {p.created_by_user && ` · добавил: ${p.created_by_user.full_name}`}
                                </div>
                            </div>
                            <div className="list-row__title">{Number(p.amount).toLocaleString('ru-RU')} сум</div>
                        </li>
                    ))}
                </ul>
            )}

            {showForm && (
                <div className="modal-backdrop" onClick={() => setShowForm(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Добавить штраф</h2>
                        <form onSubmit={handleSubmit} className="form">
                            <label className="field">
                                <span>Сотрудник</span>
                                <select value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} required>
                                    <option value="" disabled>
                                        Выберите сотрудника
                                    </option>
                                    {employees.map((emp) => (
                                        <option key={emp.id} value={emp.id}>
                                            {emp.full_name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="field">
                                <span>Причина</span>
                                <input
                                    type="text"
                                    required
                                    value={form.reason}
                                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                                />
                            </label>
                            <label className="field">
                                <span>Сумма</span>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    required
                                    value={form.amount}
                                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                                />
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
