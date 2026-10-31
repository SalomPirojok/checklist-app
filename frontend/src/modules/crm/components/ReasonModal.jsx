import { useState } from 'react';
import { t } from '../i18n';
import Modal from './Modal';

// Asks for a short reason before a sensitive action. Used instead of
// window.prompt, which Telegram's in-app browser doesn't reliably support.
export default function ReasonModal({ title, label, confirmLabel, danger, required = true, onConfirm, onClose }) {
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    async function handleSubmit(e) {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            await onConfirm(reason.trim());
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    }

    return (
        <Modal title={title} onClose={onClose}>
            <form className="form" onSubmit={handleSubmit}>
                <label className="field">
                    <span>{label}</span>
                    <input type="text" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                {error && <p className="error-text">{error}</p>}
                <div className="form-actions">
                    <button
                        type="submit"
                        className={danger ? 'btn btn--block crm-btn--danger' : 'btn btn--block'}
                        disabled={saving || (required && !reason.trim())}
                    >
                        {saving ? t('common.saving') : confirmLabel}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
