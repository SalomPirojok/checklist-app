import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import ModuleSwitcher from '../../components/ModuleSwitcher';
import { useCrm } from './CrmContext';
import { t } from './i18n';

function tabClass({ isActive }) {
    return isActive ? 'tab-bar__item tab-bar__item--active' : 'tab-bar__item';
}

export default function CrmLayout() {
    const { user } = useAuth();
    const { role, can } = useCrm();

    return (
        <div className="app-layout crm-layout">
            <header className="app-header">
                <div>
                    <div className="app-header__name">{user.full_name}</div>
                    <div className="hint">{role.name}</div>
                </div>
                <ModuleSwitcher />
            </header>

            <nav className="tab-bar">
                {can('dashboard.view') && (
                    <NavLink to="/" end className={tabClass}>
                        {t('nav.dashboard')}
                    </NavLink>
                )}
                {can('leads.manage') && (
                    <NavLink to="/leads" className={tabClass}>
                        {t('nav.leads')}
                    </NavLink>
                )}
                {(can('clients.manage') || can('leads.manage')) && (
                    <NavLink to="/clients" className={tabClass}>
                        {t('nav.clients')}
                    </NavLink>
                )}
                {(can('vehicles.manage') || can('orders.manage')) && (
                    <NavLink to="/vehicles" className={tabClass}>
                        {t('nav.vehicles')}
                    </NavLink>
                )}
                {(can('orders.manage') || can('payments.record')) && (
                    <NavLink to="/orders" className={tabClass}>
                        {t('nav.orders')}
                    </NavLink>
                )}
                {can('finance.view') && (
                    <NavLink to="/finance" className={tabClass}>
                        {t('nav.finance')}
                    </NavLink>
                )}
                {can('payroll.view') && (
                    <NavLink to="/payroll" className={tabClass}>
                        {t('nav.payroll')}
                    </NavLink>
                )}
                {can('marketing.view') && (
                    <NavLink to="/marketing" className={tabClass}>
                        {t('nav.marketing')}
                    </NavLink>
                )}
                {can('staff.manage') && (
                    <NavLink to="/staff" className={tabClass}>
                        {t('nav.staff')}
                    </NavLink>
                )}
                <NavLink to="/settings" className={tabClass}>
                    {t('nav.settings')}
                </NavLink>
            </nav>

            <main className="app-main crm-main">
                <Outlet />
            </main>
        </div>
    );
}
