import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';
import { useAuth } from '../context/AuthContext';
import { SkeletonRows } from '../components/Skeleton';

function canManageTrainingClientSide(user) {
    return user.role === 'owner' || (user.role === 'manager' && user.can_manage_training);
}

export default function TrainingPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { user } = useAuth();
    const [materials, setMaterials] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    async function load() {
        setLoading(true);
        try {
            const res = await api('/api/training');
            setMaterials(res.materials);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, [api]);

    useEffect(() => {
        api('/api/departments')
            .then((res) => setDepartments(res.departments))
            .catch(() => {});
    }, [api]);

    const departmentById = new Map(departments.map((d) => [d.id, d]));
    const canManage = canManageTrainingClientSide(user);

    return (
        <div className="page">
            <div className="page-header">
                <h1>Обучение</h1>
                {canManage && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn--ghost" onClick={() => navigate('/training/results')}>
                            Результаты
                        </button>
                        <button className="btn" onClick={() => navigate('/training/new')}>
                            + Добавить материал
                        </button>
                    </div>
                )}
            </div>

            {loading && <SkeletonRows count={5} />}
            {error && <p className="error-text">{error}</p>}

            {!loading && !error && (
                <ul className="list">
                    {materials.length === 0 && <p className="hint">Материалов пока нет.</p>}
                    {materials.map((material) => (
                        <li key={material.id} className="list-row">
                            <Link to={`/training/${material.id}`} className="list-row__title--link">
                                <div className="list-row__title">
                                    {material.title}
                                    {material.is_archived && <span className="tag">архив</span>}
                                    {material.department_id && (
                                        <span className="tag">{departmentById.get(material.department_id)?.name || '…'}</span>
                                    )}
                                </div>
                                {material.file_url && <div className="hint">📎 есть вложение</div>}
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
