import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';
import StatusBadge from '../components/StatusBadge';

export default function AssignmentDetailPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { id } = useParams();

    const [assignment, setAssignment] = useState(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        api(`/api/assignments/${id}`)
            .then((res) => {
                if (cancelled) return;
                setAssignment(res.assignment);
                setItems(res.items);
            })
            .catch((err) => !cancelled && setError(err.message))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [api, id]);

    if (loading) return <p>Загрузка...</p>;
    if (error) return <p className="error-text">{error}</p>;
    if (!assignment) return null;

    const doneCount = items.filter((item) => item.is_done).length;

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate(-1)}>
                ← Назад
            </button>

            <div className="page-header">
                <h1>{assignment.template?.title || 'Чек-лист'}</h1>
                <StatusBadge status={assignment.status} />
            </div>

            <p className="hint">Сотрудник: {assignment.assignee?.full_name || '—'}</p>
            {assignment.template?.description && <p className="hint">{assignment.template.description}</p>}
            <p className="hint">Дедлайн: {new Date(assignment.due_at).toLocaleString('ru-RU')}</p>
            <p className="hint">
                Выполнено: {doneCount} из {items.length}
            </p>

            <ul className="checklist-items">
                {items.map((item) => (
                    <li key={item.id} className={`checklist-item${item.is_done ? ' checklist-item--done' : ''}`}>
                        <div className="checklist-item__main">
                            <span className="checklist-item__check">{item.is_done ? '✓' : ''}</span>
                            <div className="checklist-item__body">
                                <div className="checklist-item__title">{item.template_item.title}</div>
                                {item.template_item.description && <div className="hint">{item.template_item.description}</div>}
                                {item.is_done && item.done_at && (
                                    <div className="hint">Выполнено: {new Date(item.done_at).toLocaleString('ru-RU')}</div>
                                )}
                                {item.comment && <div className="hint">Комментарий: {item.comment}</div>}
                                {item.photo_url && (
                                    <div className="checklist-item__photo">
                                        <a href={item.photo_url} target="_blank" rel="noopener noreferrer">
                                            <img src={item.photo_url} alt="" className="checklist-item__thumb" />
                                        </a>
                                    </div>
                                )}
                                {item.template_item.requires_photo && !item.photo_url && (
                                    <div className="hint">Фото ещё не загружено</div>
                                )}
                            </div>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}
