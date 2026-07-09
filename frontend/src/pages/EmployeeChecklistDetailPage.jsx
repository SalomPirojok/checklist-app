import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApiClient, useApiUpload } from '../api/useApiClient';
import StatusBadge from '../components/StatusBadge';
import ChecklistItem from '../components/ChecklistItem';

export default function EmployeeChecklistDetailPage() {
    const api = useApiClient();
    const upload = useApiUpload();
    const navigate = useNavigate();
    const { id } = useParams();

    const [assignment, setAssignment] = useState(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    async function load() {
        try {
            const res = await api(`/api/assignments/${id}`);
            setAssignment(res.assignment);
            setItems(res.items);
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
    }, [id]);

    function applyUpdate(itemId, itemPatch, updatedAssignment) {
        setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...itemPatch } : it)));
        // Merge rather than replace: some responses don't carry every enriched
        // field (e.g. template), so a blind replace would drop it from state.
        if (updatedAssignment) setAssignment((prev) => ({ ...prev, ...updatedAssignment }));
    }

    async function handleToggleDone(item, done) {
        if (done && item.template_item.requires_photo && !item.photo_url) return;
        try {
            const res = await api(`/api/assignments/${id}/items/${item.id}`, {
                method: 'PATCH',
                body: { is_done: done },
            });
            applyUpdate(item.id, res.item, res.assignment);
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleUploadPhoto(item, file) {
        const formData = new FormData();
        formData.append('photo', file);
        const { photo_url } = await upload(`/api/assignments/${id}/items/${item.id}/photo`, formData);

        const res = await api(`/api/assignments/${id}/items/${item.id}`, {
            method: 'PATCH',
            body: { is_done: true, photo_url },
        });
        applyUpdate(item.id, res.item, res.assignment);
    }

    async function handleSaveComment(item, comment) {
        try {
            const res = await api(`/api/assignments/${id}/items/${item.id}`, {
                method: 'PATCH',
                body: { comment },
            });
            applyUpdate(item.id, res.item, res.assignment);
        } catch (err) {
            setError(err.message);
        }
    }

    if (loading) return <p>Загрузка...</p>;
    if (error && !assignment) return <p className="error-text">{error}</p>;
    if (!assignment) return null;

    const doneCount = items.filter((i) => i.is_done).length;
    const progressPct = items.length ? Math.round((doneCount / items.length) * 100) : 0;
    const readOnly = assignment.status === 'completed';

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate('/')}>
                ← Назад
            </button>

            <div className="page-header">
                <h1>{assignment.template?.title || 'Чек-лист'}</h1>
                <StatusBadge status={assignment.status} />
            </div>
            {assignment.template?.description && <p className="hint">{assignment.template.description}</p>}
            <p className="hint">Дедлайн: {new Date(assignment.due_at).toLocaleString('ru-RU')}</p>

            <div className="progress-meter">
                <div className="progress-meter__track">
                    <div className="progress-meter__fill" style={{ width: `${progressPct}%` }} />
                </div>
                <span className="hint">
                    {doneCount} из {items.length} выполнено
                </span>
            </div>

            {error && <p className="error-text">{error}</p>}

            <ul className="checklist-items">
                {items.map((item) => (
                    <ChecklistItem
                        key={item.id}
                        item={item}
                        readOnly={readOnly}
                        onToggleDone={handleToggleDone}
                        onUploadPhoto={handleUploadPhoto}
                        onSaveComment={handleSaveComment}
                    />
                ))}
            </ul>
        </div>
    );
}
