import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';
import StatusBadge from '../components/StatusBadge';
import CategorySection from '../components/CategorySection';
import PhotoLightbox from '../components/PhotoLightbox';
import { buildDisplaySegments } from '../utils/groupByCategory';

function ItemRow({ item, onOpenPhotos }) {
    const photoUrls = item.photo_urls || [];
    return (
        <li className={`checklist-item${item.is_done ? ' checklist-item--done' : ''}`}>
            <div className="checklist-item__main">
                <span className="checklist-item__check">{item.is_done ? '✓' : ''}</span>
                <div className="checklist-item__body">
                    <div className="checklist-item__title">{item.template_item.title}</div>
                    {item.template_item.description && <div className="hint">{item.template_item.description}</div>}
                    {Array.isArray(item.template_item.sub_checkboxes) && item.template_item.sub_checkboxes.length > 0 && (
                        <ul className="sub-checkbox-list">
                            {item.template_item.sub_checkboxes.map((sc) => {
                                const result = (item.sub_checkbox_results || []).find((r) => r.id === sc.id);
                                const checked = !!result?.checked;
                                return (
                                    <li key={sc.id} className="hint">
                                        {checked ? '✓' : '○'} {sc.label}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {item.is_done && item.done_at && (
                        <div className="hint">Выполнено: {new Date(item.done_at).toLocaleString('ru-RU')}</div>
                    )}
                    {item.comment && <div className="hint">Комментарий: {item.comment}</div>}
                    {photoUrls.length > 0 && (
                        <div className="checklist-item__photo-grid">
                            {photoUrls.map((url, index) => (
                                <button
                                    key={url}
                                    type="button"
                                    className="clickable-photo"
                                    onClick={() => onOpenPhotos(photoUrls, index)}
                                >
                                    <img src={url} alt="" className="checklist-item__thumb" />
                                </button>
                            ))}
                        </div>
                    )}
                    {item.template_item.requires_photo && photoUrls.length === 0 && (
                        <div className="hint">Фото ещё не загружено</div>
                    )}
                </div>
            </div>
        </li>
    );
}

export default function AssignmentDetailPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { id } = useParams();

    const [assignment, setAssignment] = useState(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lightbox, setLightbox] = useState(null);

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

    async function handleReset() {
        if (!confirm('Сбросить чек-лист сотрудника? Он сможет пройти его заново.')) return;
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
    if (error) return <p className="error-text">{error}</p>;
    if (!assignment) return null;

    const doneCount = items.filter((item) => item.is_done).length;
    const segments = buildDisplaySegments(items, (item) => item.template_item.category);

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
            {assignment.is_standing ? (
                <p className="hint">Постоянный чек-лист — без дедлайна, всегда доступен</p>
            ) : (
                <p className="hint">Дедлайн: {assignment.due_at ? new Date(assignment.due_at).toLocaleString('ru-RU') : 'без дедлайна'}</p>
            )}
            <p className="hint">
                Выполнено: {doneCount} из {items.length}
            </p>
            {assignment.is_standing && (
                <button type="button" className="btn btn--ghost" onClick={handleReset}>
                    Сбросить
                </button>
            )}

            <ul className="checklist-items">
                {segments.map((segment, index) => {
                    const onOpenPhotos = (photos, photoIndex) => setLightbox({ photos, index: photoIndex });
                    return segment.type === 'item' ? (
                        <ItemRow key={segment.item.id} item={segment.item} onOpenPhotos={onOpenPhotos} />
                    ) : (
                        <CategorySection
                            key={`cat-${index}`}
                            name={segment.name}
                            items={segment.items}
                            doneCount={segment.items.filter((i) => i.is_done).length}
                            renderItem={(item) => <ItemRow key={item.id} item={item} onOpenPhotos={onOpenPhotos} />}
                        />
                    );
                })}
            </ul>

            <section className="signature-section">
                <h2>Подпись сотрудника</h2>
                {assignment.signature_url ? (
                    <button
                        type="button"
                        className="clickable-photo"
                        onClick={() => setLightbox({ photos: [assignment.signature_url], index: 0 })}
                    >
                        <img src={assignment.signature_url} alt="Подпись" className="signature-pad__preview" />
                    </button>
                ) : (
                    <p className="hint">Подпись ещё не поставлена.</p>
                )}
            </section>

            {lightbox && (
                <PhotoLightbox photos={lightbox.photos} startIndex={lightbox.index} onClose={() => setLightbox(null)} />
            )}
        </div>
    );
}
