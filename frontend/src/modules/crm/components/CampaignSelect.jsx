import { useCrm } from '../CrmContext';
import { t } from '../i18n';

// Ad campaign picker; shown only when the chosen source has campaigns.
export default function CampaignSelect({ sourceId, value, onChange }) {
    const { reference } = useCrm();
    const campaigns = reference.campaigns.filter((c) => c.source_id === sourceId);
    if (!sourceId || (!campaigns.length && !value)) return null;
    return (
        <label className="field">
            <span>{t('lead.campaign')}</span>
            <select value={value} onChange={(e) => onChange(e.target.value)}>
                <option value="">{t('expense.noCampaign')}</option>
                {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                        {c.name}
                    </option>
                ))}
            </select>
        </label>
    );
}
