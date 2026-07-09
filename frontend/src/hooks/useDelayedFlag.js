import { useEffect, useState } from 'react';

// Flips true if `active` stays true for longer than `delayMs` — used to explain
// an otherwise-silent loading spinner (e.g. a cold-starting free-tier backend)
// instead of letting it look frozen.
export function useDelayedFlag(active, delayMs = 4000) {
    const [flag, setFlag] = useState(false);

    useEffect(() => {
        if (!active) {
            setFlag(false);
            return;
        }
        const timer = setTimeout(() => setFlag(true), delayMs);
        return () => clearTimeout(timer);
    }, [active, delayMs]);

    return flag;
}
