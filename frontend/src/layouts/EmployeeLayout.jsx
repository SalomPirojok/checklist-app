import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useApiClient } from '../api/useApiClient';
import CheckInScreen from '../pages/CheckInScreen';
import AttendanceBar from '../components/AttendanceBar';

function tabClass({ isActive }) {
    return isActive ? 'tab-bar__item tab-bar__item--active' : 'tab-bar__item';
}

export default function EmployeeLayout() {
    const { user } = useAuth();
    const api = useApiClient();
    const [attendance, setAttendance] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    async function loadAttendance() {
        setLoading(true);
        try {
            const res = await api('/api/attendance/today');
            setAttendance(res);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadAttendance();
    }, [api]);

    if (loading) return <p>Загрузка...</p>;
    if (error) return <p className="error-text">{error}</p>;

    if (!attendance.check_in) {
        return <CheckInScreen onCheckedIn={loadAttendance} />;
    }

    return (
        <div className="app-layout">
            <header className="app-header">
                <div>
                    <div className="app-header__name">{user.full_name}</div>
                    <div className="hint">Сотрудник</div>
                </div>
            </header>
            <AttendanceBar attendance={attendance} onCheckedOut={loadAttendance} />

            <nav className="tab-bar">
                <NavLink to="/" end className={tabClass}>
                    Чек-листы
                </NavLink>
                <NavLink to="/training" className={tabClass}>
                    Обучение
                </NavLink>
            </nav>

            <main className="app-main">
                <Outlet />
            </main>
        </div>
    );
}
