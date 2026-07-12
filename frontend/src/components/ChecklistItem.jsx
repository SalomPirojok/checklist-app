import { useState } from 'react';
import CameraCapture from './CameraCapture';
import { hapticError, hapticSelect, hapticTap } from '../lib/haptics';

export default function ChecklistItem({ item, onToggleDone, onUploadPhoto, onDeletePhoto, onSaveComment, onToggleSubCheckbox, onOpenPhotos, readOnly }) {
    const [cameraOpen, setCameraOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    const [comment, setComment] = useState(item.comment || '');
    const [subSaving, setSubSaving] = useState(false);

    const { title, description, requires_photo: requiresPhoto, sub_checkboxes: subCheckboxes } = item.template_item;
    const isDone = item.is_done;
    const hasSubCheckboxes = Array.isArray(subCheckboxes) && subCheckboxes.length > 0;
    const subsComplete = !hasSubCheckboxes || (item.sub_checkbox_results || []).every((r) => r.checked);
    const photoUrls = item.photo_urls || [];

    async function handleCapture(blob) {
        setCameraOpen(false);
        setUploading(true);
        setUploadError(null);
        try {
            await onUploadPhoto(item, blob);
            hapticTap();
        } catch (err) {
            setUploadError(err.message);
            hapticError();
        } finally {
            setUploading(false);
        }
    }

    async function handleDeletePhoto(e, url) {
        e.stopPropagation();
        try {
            await onDeletePhoto(item, url);
            hapticTap();
        } catch (err) {
            setUploadError(err.message);
            hapticError();
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
        hapticSelect();
        try {
            await onToggleSubCheckbox(item, subId, checked);
        } finally {
            setSubSaving(false);
        }
    }

    function handleToggleDone(nextDone) {
        hapticTap();
        onToggleDone(item, nextDone);
    }

    return (
        <li className={`checklist-item${isDone ? ' checklist-item--done' : ''}`}>
            <div className="checklist-item__main">
                <button
                    type="button"
                    className="checklist-item__check"
                    disabled={readOnly || (!isDone && (!subsComplete || (requiresPhoto && photoUrls.length === 0)))}
                    onClick={() => handleToggleDone(!isDone)}
                    aria-label={isDone ? 'Отменить выполнение' : 'Отметить выполненным'}
                >
                    {isDone ? '✓' : ''}
                </button>
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
                            {photoUrls.length > 0 && (
                                <div className="checklist-item__photo-grid">
                                    {photoUrls.map((url, index) => (
                                        <div className="checklist-item__photo-thumb-wrap" key={url}>
                                            <button
                                                type="button"
                                                className="clickable-photo"
                                                onClick={() => onOpenPhotos(photoUrls, index)}
                                            >
                                                <img src={url} alt="" className="checklist-item__thumb" />
                                            </button>
                                            {!readOnly && !isDone && (
                                                <button
                                                    type="button"
                                                    className="checklist-item__photo-remove"
                                                    aria-label="Удалить фото"
                                                    onClick={(e) => handleDeletePhoto(e, url)}
                                                >
                                                    ✕
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {!readOnly && !isDone && (
                                <button
                                    type="button"
                                    className="btn btn--ghost"
                                    disabled={uploading || !subsComplete}
                                    onClick={() => setCameraOpen(true)}
                                >
                                    {uploading ? 'Загрузка...' : '📷 Добавить фото'}
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

            {cameraOpen && (
                <CameraCapture facingMode="environment" onCapture={handleCapture} onClose={() => setCameraOpen(false)} />
            )}
        </li>
    );
}
