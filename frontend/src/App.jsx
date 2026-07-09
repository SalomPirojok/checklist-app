import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoadingScreen from './components/LoadingScreen';
import ErrorScreen from './components/ErrorScreen';
import AppLayout from './layouts/AppLayout';
import DashboardPage from './pages/DashboardPage';
import EmployeesPage from './pages/EmployeesPage';
import TemplatesPage from './pages/TemplatesPage';
import TemplateEditorPage from './pages/TemplateEditorPage';
import AssignmentDetailPage from './pages/AssignmentDetailPage';
import EmployeeLayout from './layouts/EmployeeLayout';
import EmployeeChecklistsPage from './pages/EmployeeChecklistsPage';
import EmployeeChecklistDetailPage from './pages/EmployeeChecklistDetailPage';

function AppContent() {
    const { status, error, user } = useAuth();

    if (status === 'loading') return <LoadingScreen />;
    if (status === 'error') return <ErrorScreen message={error} />;

    const canManage = user.role === 'owner' || user.role === 'manager';

    return (
        <MemoryRouter>
            <Routes>
                {canManage ? (
                    <Route element={<AppLayout />}>
                        <Route path="/" element={<DashboardPage />} />
                        <Route path="/employees" element={<EmployeesPage />} />
                        <Route path="/templates" element={<TemplatesPage />} />
                        <Route path="/templates/new" element={<TemplateEditorPage />} />
                        <Route path="/templates/:id" element={<TemplateEditorPage />} />
                        <Route path="/assignments/:id" element={<AssignmentDetailPage />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Route>
                ) : (
                    <Route element={<EmployeeLayout />}>
                        <Route path="/" element={<EmployeeChecklistsPage />} />
                        <Route path="/assignments/:id" element={<EmployeeChecklistDetailPage />} />
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
