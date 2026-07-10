import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';
import { useDelayedFlag } from '../hooks/useDelayedFlag';
import AssignChecklistModal from '../components/AssignChecklistModal';

export default function TemplatesPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const [templates, setTemplates] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const showSlowHint = useDelayedFlag(loading, 4000);
    const [assigningTemplate, setAssigningTemplate] = useState(null);
    const [assignedMessage, setAssignedMessage] = useState(null);
    const [departmentFilter, setDepartmentFilter] = useState('');

    async function load() {
        setLoading(true);
        try {
            const res = await api('/api/templates');
            setTemplates(res.templates);
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
        api('/api/departments')
            .then((res) => setDepartments(res.departments))
            .catch(() => {});
    }, [api]);

    const departmentById = new Map(departments.map((d) => [d.id, d]));
    const visibleTemplates = departmentFilter ? templates.filter((t) => t.department_id === departmentFilter) : templates;

    async function handleArchive(template) {
        if (!confirm(`Архивировать шаблон «${template.title}»?`)) return;
        try {
            await api(`/api/templates/${template.id}`, { method: 'DELETE' });
            await load();
        } catch (err) {
            setError(err.message);
        }
    }

    function handleAssigned() {
        setAssignedMessage(`Чек-лист «${assigningTemplate.title}» назначен.`);
        setAssigningTemplate(null);
    }

    return (
        <div className="page">
            <div className="page-header">
                <h1>Шаблоны чек-листов</h1>
                <button className="btn" onClick={() => navigate('/templates/new')}>
                    + Создать
                </button>
            </div>

            {assignedMessage && <p className="success-text">{assignedMessage}</p>}

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

            {loading && (
                <p>
                    Загрузка...
                    {showSlowHint && (
                        <>
                            {' '}
                            <span className="hint">
                                Сервер мог «заснуть» из-за простоя — обычно просыпается в течение минуты.
                            </span>
                        </>
                    )}
                </p>
            )}
            {error && <p className="error-text">{error}</p>}

            {!loading && !error && (
                <ul className="list">
                    {visibleTemplates.length === 0 && (
                        <p className="hint">{departmentFilter ? 'Нет шаблонов для этого подразделения.' : 'Шаблонов пока нет.'}</p>
                    )}
                    {visibleTemplates.map((template) => (
                        <li key={template.id} className="list-row">
                            <div>
                                <Link to={`/templates/${template.id}`} className="list-row__title list-row__title--link">
                                    {template.title}
                                    {template.department_id && (
                                        <span className="tag">{departmentById.get(template.department_id)?.name || '…'}</span>
                                    )}
                                </Link>
                                {template.description && <div className="hint">{template.description}</div>}
                            </div>
                            <div className="list-row__actions">
                                <button
                                    className="btn btn--ghost"
                                    onClick={() => {
                                        setAssignedMessage(null);
                                        setAssigningTemplate(template);
                                    }}
                                >
                                    Назначить
                                </button>
                                <button className="btn btn--ghost btn--danger" onClick={() => handleArchive(template)}>
                                    Архивировать
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {assigningTemplate && (
                <AssignChecklistModal
                    template={assigningTemplate}
                    onClose={() => setAssigningTemplate(null)}
                    onAssigned={handleAssigned}
                />
            )}
        </div>
    );
}
