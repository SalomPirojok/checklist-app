import { useEffect, useState } from 'react';
import { useApiClient } from '../../../api/useApiClient';
import { clientName, formatPhone } from '../format';
import SearchInput from './SearchInput';

// Search-as-you-type client chooser.
export default function ClientPicker({ onPick, placeholder }) {
    const api = useApiClient();
    const [q, setQ] = useState('');
    const [results, setResults] = useState([]);

    useEffect(() => {
        if (!q) {
            setResults([]);
            return;
        }
        let cancelled = false;
        api(`/api/crm/clients?${new URLSearchParams({ q })}`)
            .then((res) => !cancelled && setResults(res.clients.slice(0, 8)))
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [api, q]);

    return (
        <div>
            <SearchInput value={q} onChange={setQ} placeholder={placeholder} />
            {results.length > 0 && (
                <ul className="list">
                    {results.map((c) => (
                        <li key={c.id}>
                            <button type="button" className="list-row crm-row crm-row--button" onClick={() => onPick(c)}>
                                <div className="crm-row__main">
                                    <div className="list-row__title">{clientName(c)}</div>
                                    <div className="hint">
                                        {[formatPhone(c.phone), c.instagram_username && `@${c.instagram_username}`].filter(Boolean).join(' · ')}
                                    </div>
                                </div>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
