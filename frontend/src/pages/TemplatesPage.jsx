import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';

export default function TemplatesPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

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

    async function handleArchive(template) {
        if (!confirm(`Архивировать шаблон «${template.title}»?`)) return;
        try {
            await api(`/api/templates/${template.id}`, { method: 'DELETE' });
            await load();
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div className="page">
            <div className="page-header">
                <h1>Шаблоны чек-листов</h1>
                <button className="btn" onClick={() => navigate('/templates/new')}>
                    + Создать
                </button>
            </div>

            {loading && <p>Загрузка...</p>}
            {error && <p className="error-text">{error}</p>}

            {!loading && !error && (
                <ul className="list">
                    {templates.length === 0 && <p className="hint">Шаблонов пока нет.</p>}
                    {templates.map((template) => (
                        <li key={template.id} className="list-row">
                            <div>
                                <Link to={`/templates/${template.id}`} className="list-row__title list-row__title--link">
                                    {template.title}
                                </Link>
                                {template.description && <div className="hint">{template.description}</div>}
                            </div>
                            <div className="list-row__actions">
                                <button className="btn btn--ghost btn--danger" onClick={() => handleArchive(template)}>
                                    Архивировать
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
