import { supabase } from '../../../lib/supabase.js';

// Official Central Bank of Uzbekistan rates (UZS per unit). Cached in the
// shared exchange_rates table so each currency/date is fetched once.
const CBU_URL = (currency, date) => `https://cbu.uz/ru/arkhiv-kursov-valyut/json/${currency}/${date}/`;

export function parseCbuResponse(json, currency) {
    const row = Array.isArray(json) ? json.find((r) => r.Ccy === currency) : null;
    if (!row) return null;
    const rate = Number(row.Rate) / (Number(row.Nominal) || 1);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const [dd, mm, yyyy] = String(row.Date).split('.');
    return { rate, rateDate: `${yyyy}-${mm}-${dd}` };
}

// Returns { rate, rate_date, source } or null if no rate can be found.
// `date` is 'YYYY-MM-DD'; CBU answers with the rate in force on that date.
export async function getRate(currency, date, fetchImpl = fetch) {
    if (currency === 'UZS') return { rate: 1, rate_date: date, source: 'base' };

    const { data: cached, error } = await supabase
        .from('exchange_rates')
        .select('rate, rate_date, source')
        .eq('currency', currency)
        .eq('base_currency', 'UZS')
        .eq('rate_date', date)
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (cached) return { ...cached, rate: Number(cached.rate) };

    let parsed;
    try {
        const res = await fetchImpl(CBU_URL(currency, date), { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        parsed = parseCbuResponse(await res.json(), currency);
    } catch {
        return null;
    }
    if (!parsed) return null;

    // Cache under the requested date (CBU returns the rate valid on it).
    await supabase
        .from('exchange_rates')
        .upsert(
            { currency, base_currency: 'UZS', rate_date: date, rate: parsed.rate, source: 'cbu' },
            { onConflict: 'currency,base_currency,rate_date', ignoreDuplicates: true }
        );
    return { rate: parsed.rate, rate_date: date, source: 'cbu' };
}
