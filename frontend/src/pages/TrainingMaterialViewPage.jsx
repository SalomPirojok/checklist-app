import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';
import { useAuth } from '../context/AuthContext';

function canManageTrainingClientSide(user) {
    return user.role === 'owner' || (user.role === 'manager' && user.can_manage_training);
}

function getFileKind(url) {
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext)) return 'image';
    if (['mp4', 'mov', 'webm'].includes(ext)) return 'video';
    if (ext === 'pdf') return 'pdf';
    return 'other';
}

export default function TrainingMaterialViewPage() {
    const api = useApiClient();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { id } = useParams();

    const [material, setMaterial] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        api(`/api/training/${id}`)
            .then((res) => !cancelled && setMaterial(res.material))
            .catch((err) => !cancelled && setError(err.message))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [api, id]);

    async function handleArchive() {
        if (!confirm('Архивировать этот материал?')) return;
        try {
            await api(`/api/training/${id}`, { method: 'DELETE' });
            navigate('/training');
        } catch (err) {
            setError(err.message);
        }
    }

    if (loading) return <p>Загрузка...</p>;
    if (error) return <p className="error-text">{error}</p>;
    if (!material) return null;

    const canManage = canManageTrainingClientSide(user);
    const fileKind = material.file_url ? getFileKind(material.file_url) : null;

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate('/training')}>
                ← Назад
            </button>

            <div className="page-header">
                <h1>{material.title}</h1>
            </div>

            {material.body_text && <p className="training-body">{material.body_text}</p>}

            {fileKind === 'image' && (
                <a href={material.file_url} target="_blank" rel="noopener noreferrer">
                    <img src={material.file_url} alt="" className="training-file-preview" />
                </a>
            )}
            {fileKind === 'video' && (
                <video src={material.file_url} controls className="training-file-preview" />
            )}
            {(fileKind === 'pdf' || fileKind === 'other') && (
                <a href={material.file_url} target="_blank" rel="noopener noreferrer" className="btn btn--ghost">
                    📎 Открыть вложение
                </a>
            )}

            {canManage && (
                <div className="form-actions">
                    <button type="button" className="btn btn--ghost" onClick={() => navigate(`/training/${id}/edit`)}>
                        Редактировать
                    </button>
                    {!material.is_archived && (
                        <button type="button" className="btn btn--ghost btn--danger" onClick={handleArchive}>
                            Архивировать
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
