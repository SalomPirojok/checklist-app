import { Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// For a platform admin who isn't a member of any organization at all -- just
// the admin panel, no tab bar (there's nothing else for this identity to see).
export default function PlatformAdminOnlyLayout() {
    const { user } = useAuth();

    return (
        <div className="app-layout">
            <header className="app-header">
                <div>
                    <div className="app-header__name">{user.full_name}</div>
                    <div className="hint">Platform admin</div>
                </div>
            </header>

            <main className="app-main">
                <Outlet />
            </main>
        </div>
    );
}
