import { Link } from 'react-router-dom';
import { useCrm } from '../CrmContext';
import { t } from '../i18n';

// Hub for CRM settings; each item is shown only to roles that can use it.
export default function SettingsPage() {
    const { can } = useCrm();
    const items = [
        { to: '/notifications', title: t('notif.title'), hint: t('settings.notificationsHint'), show: true },
        { to: '/access', title: t('access.title'), hint: t('settings.accessHint'), show: can('settings.manage') },
        { to: '/settings/instagram', title: 'Instagram Direct', hint: t('settings.instagramHint'), show: can('settings.manage') },
        { to: '/payroll/rules', title: t('rules.title'), hint: t('settings.rulesHint'), show: can('payroll.view') },
        { to: '/finance/settings', title: t('finance.settings'), hint: t('settings.financeHint'), show: can('finance.manage') },
        { to: '/marketing', title: t('mkt.campaigns'), hint: t('settings.campaignsHint'), show: can('marketing.view') },
    ].filter((i) => i.show);

    return (
        <div className="page">
            <div className="page-header">
                <h1>{t('nav.settings')}</h1>
            </div>
            <ul className="list">
                {items.map((item) => (
                    <li key={item.to}>
                        <Link to={item.to} className="list-row crm-row">
                            <div className="crm-row__main">
                                <div className="list-row__title">{item.title}</div>
                                <div className="hint">{item.hint}</div>
                            </div>
                            <span className="crm-chevron">›</span>
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}
