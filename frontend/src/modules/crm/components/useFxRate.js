import { useEffect, useState } from 'react';
import { useApiClient } from '../../../api/useApiClient';

// Today's Central Bank rate for `currency` as an editable string ('' while
// loading, for UZS, or when unavailable -- the user then types it).
export function useFxRate(currency) {
    const api = useApiClient();
    const [rate, setRate] = useState('');

    useEffect(() => {
        if (!currency || currency === 'UZS') {
            setRate('');
            return;
        }
        let cancelled = false;
        api(`/api/crm/reference/fx/${currency}`)
            .then((res) => !cancelled && setRate(String(res.rate)))
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [api, currency]);

    return [rate, setRate];
}
