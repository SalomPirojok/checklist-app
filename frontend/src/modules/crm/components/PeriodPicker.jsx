import { useState } from 'react';
import { t } from '../i18n';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Ranges on the device's calendar (the business and its phones are in the
// same timezone); the server interprets them in the organization's zone.
export function presetRange(preset) {
    const now = new Date();
    if (preset === 'today') return { from: ymd(now), to: ymd(now) };
    if (preset === 'week') {
        const monday = new Date(now);
        monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
        return { from: ymd(monday), to: ymd(now) };
    }
    if (preset === 'lastMonth') {
        const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const last = new Date(now.getFullYear(), now.getMonth(), 0);
        return { from: ymd(first), to: ymd(last) };
    }
    return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
}

const PRESETS = ['today', 'week', 'month', 'lastMonth', 'custom'];

// value: { preset, from, to }
export default function PeriodPicker({ value, onChange }) {
    const [custom, setCustom] = useState({ from: value.from, to: value.to });

    function choose(preset) {
        if (preset === 'custom') onChange({ preset, ...custom });
        else onChange({ preset, ...presetRange(preset) });
    }

    function setCustomField(field, v) {
        const next = { ...custom, [field]: v };
        setCustom(next);
        if (next.from && next.to && next.from <= next.to) onChange({ preset: 'custom', ...next });
    }

    return (
        <div className="crm-period">
            <div className="crm-chips">
                {PRESETS.map((p) => (
                    <button key={p} type="button" className={value.preset === p ? 'crm-chip crm-chip--active' : 'crm-chip'} onClick={() => choose(p)}>
                        {t(`period.${p}`)}
                    </button>
                ))}
            </div>
            {value.preset === 'custom' && (
                <div className="crm-field-pair">
                    <label className="field">
                        <span>{t('period.from')}</span>
                        <input type="date" value={custom.from} onChange={(e) => setCustomField('from', e.target.value)} />
                    </label>
                    <label className="field">
                        <span>{t('period.to')}</span>
                        <input type="date" value={custom.to} onChange={(e) => setCustomField('to', e.target.value)} />
                    </label>
                </div>
            )}
        </div>
    );
}
