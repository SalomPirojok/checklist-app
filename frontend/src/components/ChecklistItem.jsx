import { useRef, useState } from 'react';

export default function ChecklistItem({ item, onToggleDone, onUploadPhoto, onSaveComment, readOnly }) {
    const fileInputRef = useRef(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    const [comment, setComment] = useState(item.comment || '');

    const { title, description, requires_photo: requiresPhoto } = item.template_item;
    const isDone = item.is_done;

    async function handleFileChange(e) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        setUploading(true);
        setUploadError(null);
        try {
            await onUploadPhoto(item, file);
        } catch (err) {
            setUploadError(err.message);
        } finally {
            setUploading(false);
        }
    }

    function handleCommentBlur() {
        if (comment !== (item.comment || '')) {
            onSaveComment(item, comment);
        }
    }

    return (
        <li className={`checklist-item${isDone ? ' checklist-item--done' : ''}`}>
            <div className="checklist-item__main">
                {!requiresPhoto && (
                    <button
                        type="button"
                        className="checklist-item__check"
                        disabled={readOnly}
                        onClick={() => onToggleDone(item, !isDone)}
                        aria-label={isDone ? 'Отменить выполнение' : 'Отметить выполненным'}
                    >
                        {isDone ? '✓' : ''}
                    </button>
                )}
                <div className="checklist-item__body">
                    <div className="checklist-item__title">{title}</div>
                    {description && <div className="hint">{description}</div>}

                    {requiresPhoto && (
                        <div className="checklist-item__photo">
                            {item.photo_url && (
                                <img src={item.photo_url} alt="" className="checklist-item__thumb" />
                            )}
                            {!readOnly && (
                                <>
                                    <button
                                        type="button"
                                        className="btn btn--ghost"
                                        disabled={uploading}
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        {uploading ? 'Загрузка...' : item.photo_url ? 'Заменить фото' : '📷 Добавить фото'}
                                    </button>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        capture="environment"
                                        hidden
                                        onChange={handleFileChange}
                                    />
                                </>
                            )}
                            {isDone && !readOnly && (
                                <button type="button" className="btn btn--ghost" onClick={() => onToggleDone(item, false)}>
                                    Отменить
                                </button>
                            )}
                            {uploadError && <p className="error-text">{uploadError}</p>}
                        </div>
                    )}

                    {!readOnly && (
                        <textarea
                            className="checklist-item__comment"
                            placeholder="Комментарий (необязательно)"
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            onBlur={handleCommentBlur}
                        />
                    )}
                    {readOnly && item.comment && <div className="hint">Комментарий: {item.comment}</div>}
                </div>
            </div>
        </li>
    );
}
