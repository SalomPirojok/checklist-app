import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoadingScreen from './components/LoadingScreen';
import ErrorScreen from './components/ErrorScreen';
import UnregisteredScreen from './components/UnregisteredScreen';
import SuspendedScreen from './components/SuspendedScreen';
import AppLayout from './layouts/AppLayout';
import PlatformAdminOnlyLayout from './layouts/PlatformAdminOnlyLayout';
import PlatformAdminPage from './pages/PlatformAdminPage';
import DashboardPage from './pages/DashboardPage';
import EmployeesPage from './pages/EmployeesPage';
import TemplatesPage from './pages/TemplatesPage';
import TemplateEditorPage from './pages/TemplateEditorPage';
import AssignmentDetailPage from './pages/AssignmentDetailPage';
import EmployeeLayout from './layouts/EmployeeLayout';
import EmployeeChecklistsPage from './pages/EmployeeChecklistsPage';
import EmployeeChecklistDetailPage from './pages/EmployeeChecklistDetailPage';
import TrainingPage from './pages/TrainingPage';
import TrainingMaterialViewPage from './pages/TrainingMaterialViewPage';
import TrainingMaterialEditorPage from './pages/TrainingMaterialEditorPage';
import TrainingTestEditorPage from './pages/TrainingTestEditorPage';
import TrainingTestTakePage from './pages/TrainingTestTakePage';
import TrainingResultsPage from './pages/TrainingResultsPage';
import DepartmentsPage from './pages/DepartmentsPage';
import PenaltiesPage from './pages/PenaltiesPage';
import PenaltySettingsPage from './pages/PenaltySettingsPage';
import ReportsPage from './pages/ReportsPage';
import ReportSettingsPage from './pages/ReportSettingsPage';
import EmployeeProfilePage from './pages/EmployeeProfilePage';
import SchedulePage from './pages/SchedulePage';
import ShiftSchedulePage from './pages/ShiftSchedulePage';

function AppContent() {
    const { status, error, user } = useAuth();

    if (status === 'loading') return <LoadingScreen />;
    if (status === 'error') return <ErrorScreen message={error} />;
    if (status === 'unregistered') return <UnregisteredScreen />;
    if (status === 'suspended') return <SuspendedScreen message={error} />;

    // A platform admin with no organization membership at all only ever sees
    // the admin panel -- there's no owner/employee experience to route into.
    if (!user.organization_id) {
        return (
            <MemoryRouter>
                <Routes>
                    <Route element={<PlatformAdminOnlyLayout />}>
                        <Route path="*" element={<PlatformAdminPage />} />
                    </Route>
                </Routes>
            </MemoryRouter>
        );
    }

    const canManage = user.role === 'owner' || user.role === 'manager';

    return (
        <MemoryRouter>
            <Routes>
                {canManage ? (
                    <Route element={<AppLayout />}>
                        <Route path="/" element={<DashboardPage />} />
                        <Route path="/employees" element={<EmployeesPage />} />
                        <Route path="/employees/:id" element={<EmployeeProfilePage />} />
                        <Route path="/departments" element={<DepartmentsPage />} />
                        <Route path="/templates" element={<TemplatesPage />} />
                        <Route path="/templates/new" element={<TemplateEditorPage />} />
                        <Route path="/templates/:id" element={<TemplateEditorPage />} />
                        <Route path="/assignments/:id" element={<AssignmentDetailPage />} />
                        <Route path="/training" element={<TrainingPage />} />
                        <Route path="/training/new" element={<TrainingMaterialEditorPage />} />
                        <Route path="/training/results" element={<TrainingResultsPage />} />
                        <Route path="/training/:id/edit" element={<TrainingMaterialEditorPage />} />
                        <Route path="/training/:id/test/edit" element={<TrainingTestEditorPage />} />
                        <Route path="/training/:id" element={<TrainingMaterialViewPage />} />
                        <Route path="/penalties" element={<PenaltiesPage />} />
                        <Route path="/penalties/settings" element={<PenaltySettingsPage />} />
                        <Route path="/reports" element={<ReportsPage />} />
                        <Route path="/reports/settings" element={<ReportSettingsPage />} />
                        <Route path="/schedule" element={<SchedulePage />} />
                        <Route path="/shift-schedule" element={<ShiftSchedulePage />} />
                        {user.is_platform_admin && <Route path="/platform-admin" element={<PlatformAdminPage />} />}
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Route>
                ) : (
                    <Route element={<EmployeeLayout />}>
                        <Route path="/" element={<EmployeeChecklistsPage />} />
                        <Route path="/assignments/:id" element={<EmployeeChecklistDetailPage />} />
                        <Route path="/training" element={<TrainingPage />} />
                        <Route path="/training/:id/test/take" element={<TrainingTestTakePage />} />
                        <Route path="/training/:id" element={<TrainingMaterialViewPage />} />
                        <Route path="/schedule" element={<SchedulePage />} />
                        {user.is_platform_admin && <Route path="/platform-admin" element={<PlatformAdminPage />} />}
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Route>
                )}
            </Routes>
        </MemoryRouter>
    );
}

export default function App() {
    return (
        <AuthProvider>
            <AppContent />
        </AuthProvider>
    );
}
