import { useEffect, useState } from 'react';
import { t } from '../i18n';

// Search box that reports its value 300ms after typing stops, so a list
// isn't re-fetched on every keystroke.
export default function SearchInput({ value, onChange, placeholder = t('common.search') }) {
    const [draft, setDraft] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (draft.trim() !== value) onChange(draft.trim());
        }, 300);
        return () => clearTimeout(timer);
    }, [draft]);

    return (
        <input
            type="search"
            className="crm-search"
            placeholder={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
        />
    );
}
