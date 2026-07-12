import { useState } from 'react';

// `photos` is always an array (even for a single image, e.g. a signature) so
// this component owns all next/prev logic in one place.
export default function PhotoLightbox({ photos, startIndex = 0, onClose }) {
    const [index, setIndex] = useState(startIndex);
    const hasMultiple = photos.length > 1;

    function goTo(e, next) {
        e.stopPropagation();
        setIndex((i) => (i + next + photos.length) % photos.length);
    }

    return (
        <div className="photo-lightbox" onClick={onClose}>
            <button type="button" className="photo-lightbox__close" onClick={onClose} aria-label="Закрыть">
                ✕
            </button>
            {hasMultiple && (
                <button
                    type="button"
                    className="photo-lightbox__nav photo-lightbox__nav--prev"
                    onClick={(e) => goTo(e, -1)}
                    aria-label="Предыдущее фото"
                >
                    ‹
                </button>
            )}
            <img src={photos[index]} alt="" className="photo-lightbox__image" onClick={(e) => e.stopPropagation()} />
            {hasMultiple && (
                <button
                    type="button"
                    className="photo-lightbox__nav photo-lightbox__nav--next"
                    onClick={(e) => goTo(e, 1)}
                    aria-label="Следующее фото"
                >
                    ›
                </button>
            )}
            {hasMultiple && (
                <div className="photo-lightbox__counter">
                    {index + 1} / {photos.length}
                </div>
            )}
        </div>
    );
}
