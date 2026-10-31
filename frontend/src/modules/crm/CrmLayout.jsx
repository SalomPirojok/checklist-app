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
                {can('leads.manage') && (
                    <NavLink to="/" end className={tabClass}>
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
                {can('staff.manage') && (
                    <NavLink to="/staff" className={tabClass}>
                        {t('nav.staff')}
                    </NavLink>
                )}
                {can('settings.manage') && (
                    <NavLink to="/access" className={tabClass}>
                        {t('nav.access')}
                    </NavLink>
                )}
            </nav>

            <main className="app-main crm-main">
                <Outlet />
            </main>
        </div>
    );
}
