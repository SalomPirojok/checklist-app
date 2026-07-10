export default function PhotoLightbox({ src, onClose }) {
    return (
        <div className="photo-lightbox" onClick={onClose}>
            <button type="button" className="photo-lightbox__close" onClick={onClose} aria-label="Закрыть">
                ✕
            </button>
            <img src={src} alt="" className="photo-lightbox__image" onClick={(e) => e.stopPropagation()} />
        </div>
    );
}
