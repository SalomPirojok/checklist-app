import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../constants';

function tabClass({ isActive }) {
    return isActive ? 'tab-bar__item tab-bar__item--active' : 'tab-bar__item';
}

export default function AppLayout() {
    const { user } = useAuth();

    return (
        <div className="app-layout">
            <header className="app-header">
                <div>
                    <div className="app-header__name">{user.full_name}</div>
                    <div className="hint">{ROLE_LABELS[user.role] || user.role}</div>
                </div>
            </header>

            <nav className="tab-bar">
                <NavLink to="/" end className={tabClass}>
                    Дашборд
                </NavLink>
                <NavLink to="/employees" className={tabClass}>
                    Сотрудники
                </NavLink>
                <NavLink to="/templates" className={tabClass}>
                    Шаблоны
                </NavLink>
                <NavLink to="/training" className={tabClass}>
                    Обучение
                </NavLink>
                <NavLink to="/penalties" className={tabClass}>
                    Штрафы
                </NavLink>
                <NavLink to="/reports" className={tabClass}>
                    Отчёты
                </NavLink>
                <NavLink to="/schedule" className={tabClass}>
                    График
                </NavLink>
                {user.is_platform_admin && (
                    <NavLink to="/platform-admin" className={tabClass}>
                        Админ
                    </NavLink>
                )}
            </nav>

            <main className="app-main">
                <Outlet />
            </main>
        </div>
    );
}
