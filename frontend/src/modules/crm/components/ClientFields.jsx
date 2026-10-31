import { t } from '../i18n';

export const emptyClient = {
    first_name: '',
    last_name: '',
    phone: '',
    instagram_username: '',
    telegram_username: '',
};

// Contact fields shared by "new lead" and "new/edit client". onContactBlur
// fires when phone or Instagram loses focus, for the duplicate lookup.
export default function ClientFields({ value, onChange, onContactBlur, showTelegram = true }) {
    const set = (field) => (e) => onChange({ ...value, [field]: e.target.value });

    return (
        <>
            <label className="field">
                <span>{t('client.phone')}</span>
                <input
                    type="tel"
                    inputMode="tel"
                    placeholder={t('client.phonePlaceholder')}
                    value={value.phone}
                    onChange={set('phone')}
                    onBlur={onContactBlur}
                />
            </label>
            <div className="crm-field-pair">
                <label className="field">
                    <span>{t('client.firstName')} *</span>
                    <input type="text" value={value.first_name} onChange={set('first_name')} required />
                </label>
                <label className="field">
                    <span>{t('client.lastName')}</span>
                    <input type="text" value={value.last_name} onChange={set('last_name')} />
                </label>
            </div>
            <label className="field">
                <span>{t('client.instagram')}</span>
                <input
                    type="text"
                    autoCapitalize="none"
                    placeholder="@username"
                    value={value.instagram_username}
                    onChange={set('instagram_username')}
                    onBlur={onContactBlur}
                />
            </label>
            {showTelegram && (
                <label className="field">
                    <span>{t('client.telegram')}</span>
                    <input
                        type="text"
                        autoCapitalize="none"
                        placeholder="@username"
                        value={value.telegram_username}
                        onChange={set('telegram_username')}
                    />
                </label>
            )}
        </>
    );
}
