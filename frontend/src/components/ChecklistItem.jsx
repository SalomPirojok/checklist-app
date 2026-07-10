import { useRef, useState } from 'react';

export default function ChecklistItem({ item, onToggleDone, onUploadPhoto, onSaveComment, onToggleSubCheckbox, readOnly }) {
    const fileInputRef = useRef(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    const [comment, setComment] = useState(item.comment || '');
    const [subSaving, setSubSaving] = useState(false);

    const { title, description, requires_photo: requiresPhoto, sub_checkboxes: subCheckboxes } = item.template_item;
    const isDone = item.is_done;
    const hasSubCheckboxes = Array.isArray(subCheckboxes) && subCheckboxes.length > 0;
    const subsComplete = !hasSubCheckboxes || (item.sub_checkbox_results || []).every((r) => r.checked);

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

    // Toggles are disabled while a request is in flight so a second click
    // can't build its updated array from an item that hasn't caught up with
    // the first click's server response yet, which would otherwise silently
    // overwrite it.
    async function handleSubToggle(subId, checked) {
        setSubSaving(true);
        try {
            await onToggleSubCheckbox(item, subId, checked);
        } finally {
            setSubSaving(false);
        }
    }

    return (
        <li className={`checklist-item${isDone ? ' checklist-item--done' : ''}`}>
            <div className="checklist-item__main">
                {!requiresPhoto && (
                    <button
                        type="button"
                        className="checklist-item__check"
                        disabled={readOnly || (!isDone && !subsComplete)}
                        onClick={() => onToggleDone(item, !isDone)}
                        aria-label={isDone ? 'Отменить выполнение' : 'Отметить выполненным'}
                    >
                        {isDone ? '✓' : ''}
                    </button>
                )}
                <div className="checklist-item__body">
                    <div className="checklist-item__title">{title}</div>
                    {description && <div className="hint">{description}</div>}

                    {hasSubCheckboxes && (
                        <ul className="sub-checkbox-list">
                            {subCheckboxes.map((sc) => {
                                const result = (item.sub_checkbox_results || []).find((r) => r.id === sc.id);
                                const checked = !!result?.checked;
                                return (
                                    <li key={sc.id}>
                                        <label className="checkbox-field">
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                disabled={readOnly || subSaving}
                                                onChange={(e) => handleSubToggle(sc.id, e.target.checked)}
                                            />
                                            <span>{sc.label}</span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {hasSubCheckboxes && !subsComplete && !readOnly && (
                        <p className="hint">Отметьте все подпункты, чтобы завершить пункт.</p>
                    )}

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
                                        disabled={uploading || !subsComplete}
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
