import { useRef, useState } from 'react';
import PhotoLightbox from '../../../components/PhotoLightbox';
import { t } from '../i18n';

// Thumbnails with an "add" tile; opens the shared Kontrolla lightbox.
// onUpload(file) uploads one file; several picked files go one by one.
export default function PhotoStrip({ photos, onUpload, onDelete, disabled }) {
    const inputRef = useRef(null);
    const [openIndex, setOpenIndex] = useState(null);
    const [uploading, setUploading] = useState(false);

    async function handleFiles(e) {
        const files = [...e.target.files];
        e.target.value = '';
        setUploading(true);
        try {
            for (const file of files) await onUpload(file);
        } finally {
            setUploading(false);
        }
    }

    return (
        <div className="crm-photos">
            {photos.map((photo, i) => (
                <div key={photo.id} className="crm-photos__item">
                    <img src={photo.url} alt="" onClick={() => setOpenIndex(i)} />
                    {onDelete && !disabled && (
                        <button
                            type="button"
                            className="crm-photos__remove"
                            aria-label={t('common.delete')}
                            onClick={() => confirm(t('common.confirmDelete')) && onDelete(photo)}
                        >
                            ✕
                        </button>
                    )}
                </div>
            ))}
            {onUpload && !disabled && (
                <button type="button" className="crm-photos__add" onClick={() => inputRef.current.click()} disabled={uploading}>
                    {uploading ? '…' : '+'}
                </button>
            )}
            <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={handleFiles} />
            {openIndex !== null && (
                <PhotoLightbox photos={photos.map((p) => p.url)} startIndex={openIndex} onClose={() => setOpenIndex(null)} />
            )}
        </div>
    );
}
