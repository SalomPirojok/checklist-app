import { Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function EmployeeLayout() {
    const { user } = useAuth();

    return (
        <div className="app-layout">
            <header className="app-header">
                <div>
                    <div className="app-header__name">{user.full_name}</div>
                    <div className="hint">Сотрудник</div>
                </div>
            </header>
            <main className="app-main">
                <Outlet />
            </main>
        </div>
    );
}
