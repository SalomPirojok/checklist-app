import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';
import { buildDisplaySegments } from '../utils/groupByCategory';

const emptyItem = () => ({ title: '', description: '', requires_photo: false, category: '' });

export default function TemplateEditorPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { id } = useParams();
    const isNew = !id || id === 'new';

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [items, setItems] = useState([emptyItem()]);
    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isNew) return;
        let cancelled = false;
        api(`/api/templates/${id}`)
            .then((res) => {
                if (cancelled) return;
                setTitle(res.template.title);
                setDescription(res.template.description || '');
                setItems(
                    res.items.length
                        ? res.items.map((item) => ({
                              title: item.title,
                              description: item.description || '',
                              requires_photo: item.requires_photo,
                              category: item.category || '',
                          }))
                        : [emptyItem()]
                );
            })
            .catch((err) => !cancelled && setError(err.message))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [api, id, isNew]);

    function updateItem(index, patch) {
        setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    }

    function addItem() {
        setItems((prev) => [...prev, emptyItem()]);
    }

    function removeItem(index) {
        setItems((prev) => prev.filter((_, i) => i !== index));
    }

    async function handleSave(e) {
        e.preventDefault();
        setError(null);

        const cleanItems = items
            .filter((item) => item.title.trim())
            .map((item, index) => ({ ...item, category: item.category.trim() || null, order_index: index }));

        if (cleanItems.length === 0) {
            setError('Добавьте хотя бы один пункт с названием.');
            return;
        }

        setSaving(true);
        try {
            if (isNew) {
                const res = await api('/api/templates', {
                    method: 'POST',
                    body: { title, description, items: cleanItems },
                });
                navigate(`/templates/${res.template.id}`, { replace: true });
            } else {
                await api(`/api/templates/${id}`, { method: 'PATCH', body: { title, description } });
                await api(`/api/templates/${id}/items`, { method: 'PUT', body: { items: cleanItems } });
                navigate('/templates');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleArchive() {
        if (!confirm('Архивировать этот шаблон?')) return;
        try {
            await api(`/api/templates/${id}`, { method: 'DELETE' });
            navigate('/templates');
        } catch (err) {
            setError(err.message);
        }
    }

    if (loading) return <p>Загрузка...</p>;

    const indexedItems = items.map((item, index) => ({ ...item, __index: index }));
    const segments = buildDisplaySegments(indexedItems, (item) => item.category?.trim());

    function renderItemRow(item) {
        const index = item.__index;
        return (
            <div className="item-row" key={index}>
                <input
                    type="text"
                    placeholder="Пункт чек-листа"
                    value={item.title}
                    onChange={(e) => updateItem(index, { title: e.target.value })}
                />
                <input
                    type="text"
                    placeholder="Категория (необязательно)"
                    className="item-row__category"
                    value={item.category}
                    onChange={(e) => updateItem(index, { category: e.target.value })}
                />
                <label className="checkbox-field">
                    <input
                        type="checkbox"
                        checked={item.requires_photo}
                        onChange={(e) => updateItem(index, { requires_photo: e.target.checked })}
                    />
                    <span>Фото обязательно</span>
                </label>
                <button type="button" className="btn btn--ghost btn--danger" onClick={() => removeItem(index)}>
                    Удалить
                </button>
            </div>
        );
    }

    return (
        <div className="page">
            <h1>{isNew ? 'Новый шаблон' : 'Редактирование шаблона'}</h1>
            <form onSubmit={handleSave} className="form">
                <label className="field">
                    <span>Название</span>
                    <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label className="field">
                    <span>Описание</span>
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>

                <h2>Пункты</h2>
                {segments.map((segment, segIndex) =>
                    segment.type === 'item' ? (
                        renderItemRow(segment.item)
                    ) : (
                        <div className="category-divider" key={`cat-${segIndex}`}>
                            <span>{segment.name}</span>
                            {segment.items.map(renderItemRow)}
                        </div>
                    )
                )}
                <button type="button" className="btn btn--ghost" onClick={addItem}>
                    + Добавить пункт
                </button>

                {error && <p className="error-text">{error}</p>}

                <div className="form-actions">
                    <button type="button" className="btn btn--ghost" onClick={() => navigate('/templates')}>
                        Отмена
                    </button>
                    {!isNew && (
                        <button type="button" className="btn btn--ghost btn--danger" onClick={handleArchive}>
                            Архивировать
                        </button>
                    )}
                    <button type="submit" className="btn" disabled={saving}>
                        {saving ? 'Сохранение...' : 'Сохранить'}
                    </button>
                </div>
            </form>
        </div>
    );
}
