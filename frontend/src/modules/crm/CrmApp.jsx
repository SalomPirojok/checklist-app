import { useEffect, useState } from 'react';
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
import AccessPage from './pages/AccessPage';
import { t } from './i18n';
import './crm.css';

export default function CrmApp() {
    const api = useApiClient();
    const { crmAccess } = useModule();
    const [reference, setReference] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        api('/api/crm/reference')
            .then(setReference)
            .catch((err) => setError(err.message));
    }, [api]);

    if (error) return <ErrorScreen message={error} />;
    if (!reference) return <LoadingScreen />;

    const can = (p) => crmAccess.permissions.includes(p);
    const canSeeClients = can('clients.manage') || can('leads.manage');
    // Start page: leads if allowed, else clients; roles with neither (e.g.
    // cashier) get their sections in later stages.
    const home = can('leads.manage') ? (
        <LeadsPage />
    ) : canSeeClients ? (
        <Navigate to="/clients" replace />
    ) : (
        <div className="page crm-placeholder">
            <p className="hint">{t('home.comingSoon')}</p>
        </div>
    );

    return (
        <CrmProvider access={crmAccess} reference={reference}>
            <MemoryRouter>
                <Routes>
                    <Route element={<CrmLayout />}>
                        <Route path="/" element={home} />
                        {can('leads.manage') && <Route path="/leads/new" element={<LeadNewPage />} />}
                        {can('leads.manage') && <Route path="/leads/:id" element={<LeadDetailPage />} />}
                        {canSeeClients && <Route path="/clients" element={<ClientsPage />} />}
                        {canSeeClients && <Route path="/clients/new" element={<ClientFormPage />} />}
                        {canSeeClients && <Route path="/clients/:id" element={<ClientDetailPage />} />}
                        {canSeeClients && <Route path="/clients/:id/edit" element={<ClientFormPage />} />}
                        {can('settings.manage') && <Route path="/access" element={<AccessPage />} />}
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Route>
                </Routes>
            </MemoryRouter>
        </CrmProvider>
    );
}
