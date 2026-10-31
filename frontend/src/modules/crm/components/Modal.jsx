// Bottom-sheet modal using the existing Kontrolla .modal styles.
export default function Modal({ title, onClose, children }) {
    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
                <h2>{title}</h2>
                {children}
            </div>
        </div>
    );
}
