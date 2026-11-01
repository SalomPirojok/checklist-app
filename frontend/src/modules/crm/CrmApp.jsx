import { useCallback, useEffect, useState } from 'react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useApiClient } from '../../api/useApiClient';
import { useModule } from '../../context/ModuleContext';
import LoadingScreen from '../../components/LoadingScreen';
import ErrorScreen from '../../components/ErrorScreen';
import { CrmProvider } from './CrmContext';
import CrmLayout from './CrmLayout';
import LeadsPage from './pages/LeadsPage';
import LeadNewPage from './pages/LeadNewPage';
import LeadDetailPage from './pages/LeadDetailPage';
import ClientsPage from './pages/ClientsPage';
import ClientFormPage from './pages/ClientFormPage';
import ClientDetailPage from './pages/ClientDetailPage';
import VehiclesPage from './pages/VehiclesPage';
import VehicleFormPage from './pages/VehicleFormPage';
import VehicleDetailPage from './pages/VehicleDetailPage';
import OrdersPage from './pages/OrdersPage';
import OrderNewPage from './pages/OrderNewPage';
import OrderDetailPage from './pages/OrderDetailPage';
import StaffPage from './pages/StaffPage';
import StaffFormPage from './pages/StaffFormPage';
import AccessPage from './pages/AccessPage';
import FinancePage from './pages/FinancePage';
import FinanceJournalPage from './pages/FinanceJournalPage';
import FinanceSettingsPage from './pages/FinanceSettingsPage';
import PayrollPage from './pages/PayrollPage';
import PayrollStaffPage from './pages/PayrollStaffPage';
import CommissionRulesPage from './pages/CommissionRulesPage';
import DashboardPage from './pages/DashboardPage';
import MarketingPage from './pages/MarketingPage';
import NotificationsPage from './pages/NotificationsPage';
import SettingsPage from './pages/SettingsPage';
import { t } from './i18n';
import './crm.css';

export default function CrmApp() {
    const api = useApiClient();
    const { crmAccess, deepLink } = useModule();
    // Read once: the screen a notification button asked to open.
    const [initialPath] = useState(() => (deepLink ? `/${deepLink}` : null));
    const [reference, setReference] = useState(null);
    const [error, setError] = useState(null);

    const reloadReference = useCallback(
        () =>
            api('/api/crm/reference')
                .then(setReference)
                .catch((err) => setError(err.message)),
        [api]
    );

    useEffect(() => {
        reloadReference();
    }, [reloadReference]);

    if (error) return <ErrorScreen message={error} />;
    if (!reference) return <LoadingScreen />;

    const can = (p) => crmAccess.permissions.includes(p);
    const canSeeClients = can('clients.manage') || can('leads.manage');
    const canSeeVehicles = can('vehicles.manage') || can('orders.manage');
    const canSeeOrders = can('orders.manage') || can('payments.record');

    // Start page: the first section this role can use.
    const home = can('dashboard.view') ? (
        <DashboardPage />
    ) : can('leads.manage') ? (
        <Navigate to="/leads" replace />
    ) : canSeeOrders ? (
        <Navigate to="/orders" replace />
    ) : canSeeClients ? (
        <Navigate to="/clients" replace />
    ) : can('finance.view') ? (
        <Navigate to="/finance" replace />
    ) : can('payroll.view') ? (
        <Navigate to="/payroll" replace />
    ) : (
        <div className="page crm-placeholder">
            <p className="hint">{t('home.comingSoon')}</p>
        </div>
    );

    return (
        <CrmProvider access={crmAccess} reference={reference} reloadReference={reloadReference}>
            <MemoryRouter initialEntries={[initialPath || '/']}>
                <Routes>
                    <Route element={<CrmLayout />}>
                        <Route path="/" element={home} />
                        {can('leads.manage') && <Route path="/leads" element={<LeadsPage />} />}
                        {can('leads.manage') && <Route path="/leads/new" element={<LeadNewPage />} />}
                        {can('marketing.view') && <Route path="/marketing" element={<MarketingPage />} />}
                        {can('leads.manage') && <Route path="/leads/:id" element={<LeadDetailPage />} />}
                        {canSeeClients && <Route path="/clients" element={<ClientsPage />} />}
                        {canSeeClients && <Route path="/clients/new" element={<ClientFormPage />} />}
                        {canSeeClients && <Route path="/clients/:id" element={<ClientDetailPage />} />}
                        {canSeeClients && <Route path="/clients/:id/edit" element={<ClientFormPage />} />}
                        {canSeeVehicles && <Route path="/vehicles" element={<VehiclesPage />} />}
                        {canSeeVehicles && <Route path="/vehicles/new" element={<VehicleFormPage />} />}
                        {canSeeVehicles && <Route path="/vehicles/:id" element={<VehicleDetailPage />} />}
                        {canSeeVehicles && <Route path="/vehicles/:id/edit" element={<VehicleFormPage />} />}
                        {canSeeOrders && <Route path="/orders" element={<OrdersPage />} />}
                        {can('orders.manage') && <Route path="/orders/new" element={<OrderNewPage />} />}
                        {canSeeOrders && <Route path="/orders/:id" element={<OrderDetailPage />} />}
                        {can('staff.manage') && <Route path="/staff" element={<StaffPage />} />}
                        {can('staff.manage') && <Route path="/staff/new" element={<StaffFormPage />} />}
                        {can('staff.manage') && <Route path="/staff/:id" element={<StaffFormPage />} />}
                        {can('finance.view') && <Route path="/finance" element={<FinancePage />} />}
                        {can('finance.view') && <Route path="/finance/journal" element={<FinanceJournalPage />} />}
                        {can('finance.manage') && <Route path="/finance/settings" element={<FinanceSettingsPage />} />}
                        {can('payroll.view') && <Route path="/payroll" element={<PayrollPage />} />}
                        {can('payroll.view') && <Route path="/payroll/rules" element={<CommissionRulesPage />} />}
                        {can('payroll.view') && <Route path="/payroll/:staffId" element={<PayrollStaffPage />} />}
                        {can('settings.manage') && <Route path="/access" element={<AccessPage />} />}
                        <Route path="/settings" element={<SettingsPage />} />
                        <Route path="/notifications" element={<NotificationsPage />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Route>
                </Routes>
            </MemoryRouter>
        </CrmProvider>
    );
}
