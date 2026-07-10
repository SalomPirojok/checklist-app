import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApiClient, useApiUpload } from '../api/useApiClient';
import StatusBadge from '../components/StatusBadge';
import ChecklistItem from '../components/ChecklistItem';
import CategorySection from '../components/CategorySection';
import SignaturePad from '../components/SignaturePad';
import PhotoLightbox from '../components/PhotoLightbox';
import { buildDisplaySegments } from '../utils/groupByCategory';

export default function EmployeeChecklistDetailPage() {
    const api = useApiClient();
    const upload = useApiUpload();
    const navigate = useNavigate();
    const { id } = useParams();

    const [assignment, setAssignment] = useState(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [signatureSaving, setSignatureSaving] = useState(false);
    const [lightboxUrl, setLightboxUrl] = useState(null);

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
        if (itemId) {
            setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...itemPatch } : it)));
        }
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

    async function handleToggleSubCheckbox(item, subId, checked) {
        const updatedResults = (item.sub_checkbox_results || []).map((r) => (r.id === subId ? { ...r, checked } : r));
        try {
            const res = await api(`/api/assignments/${id}/items/${item.id}`, {
                method: 'PATCH',
                body: { sub_checkbox_results: updatedResults },
            });
            applyUpdate(item.id, res.item, res.assignment);
        } catch (err) {
            setError(err.message);
        }
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

    async function handleSaveSignature(blob) {
        setSignatureSaving(true);
        setError(null);
        try {
            const formData = new FormData();
            formData.append('signature', blob, 'signature.png');
            const res = await upload(`/api/assignments/${id}/signature`, formData);
            applyUpdate(null, null, res.assignment);
        } catch (err) {
            setError(err.message);
        } finally {
            setSignatureSaving(false);
        }
    }

    async function handleReset() {
        if (!confirm('Сбросить чек-лист и пройти заново?')) return;
        try {
            const res = await api(`/api/assignments/${id}/reset`, { method: 'POST' });
            setAssignment(res.assignment);
            setItems(res.items);
            setError(null);
        } catch (err) {
            setError(err.message);
        }
    }

    if (loading) return <p>Загрузка...</p>;
    if (error && !assignment) return <p className="error-text">{error}</p>;
    if (!assignment) return null;

    const doneCount = items.filter((i) => i.is_done).length;
    const progressPct = items.length ? Math.round((doneCount / items.length) * 100) : 0;
    const allItemsDone = items.length > 0 && doneCount === items.length;
    const readOnly = assignment.status === 'completed';

    const renderItem = (item) => (
        <ChecklistItem
            key={item.id}
            item={item}
            readOnly={readOnly}
            onToggleDone={handleToggleDone}
            onUploadPhoto={handleUploadPhoto}
            onSaveComment={handleSaveComment}
            onToggleSubCheckbox={handleToggleSubCheckbox}
        />
    );

    const segments = buildDisplaySegments(items, (item) => item.template_item.category);

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
            {assignment.is_standing ? (
                <p className="hint">Постоянный чек-лист — без дедлайна, всегда доступен</p>
            ) : (
                <p className="hint">Дедлайн: {assignment.due_at ? new Date(assignment.due_at).toLocaleString('ru-RU') : 'без дедлайна'}</p>
            )}
            {assignment.is_standing && (
                <button type="button" className="btn btn--ghost" onClick={handleReset}>
                    Сбросить
                </button>
            )}

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
                {segments.map((segment, index) =>
                    segment.type === 'item' ? (
                        renderItem(segment.item)
                    ) : (
                        <CategorySection
                            key={`cat-${index}`}
                            name={segment.name}
                            items={segment.items}
                            doneCount={segment.items.filter((i) => i.is_done).length}
                            renderItem={renderItem}
                        />
                    )
                )}
            </ul>

            <section className="signature-section">
                <h2>Подпись</h2>
                {assignment.signature_url ? (
                    <button type="button" className="clickable-photo" onClick={() => setLightboxUrl(assignment.signature_url)}>
                        <img src={assignment.signature_url} alt="Подпись" className="signature-pad__preview" />
                    </button>
                ) : allItemsDone ? (
                    <SignaturePad onSave={handleSaveSignature} saving={signatureSaving} disabled={readOnly} />
                ) : (
                    <p className="hint">Сначала выполните все пункты, чтобы поставить подпись.</p>
                )}
            </section>

            {lightboxUrl && <PhotoLightbox src={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
        </div>
    );
}
