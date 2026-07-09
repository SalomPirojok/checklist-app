import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApiClient, useApiUpload } from '../api/useApiClient';

export default function TrainingMaterialEditorPage() {
    const api = useApiClient();
    const upload = useApiUpload();
    const navigate = useNavigate();
    const { id } = useParams();
    const isNew = !id || id === 'new';
    const fileInputRef = useRef(null);

    const [title, setTitle] = useState('');
    const [bodyText, setBodyText] = useState('');
    const [departmentId, setDepartmentId] = useState('');
    const [departments, setDepartments] = useState([]);
    const [existingFileUrl, setExistingFileUrl] = useState(null);
    const [removeExistingFile, setRemoveExistingFile] = useState(false);
    const [newFile, setNewFile] = useState(null);
    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        api('/api/departments')
            .then((res) => setDepartments(res.departments))
            .catch(() => {});
    }, [api]);

    useEffect(() => {
        if (isNew) return;
        let cancelled = false;
        api(`/api/training/${id}`)
            .then((res) => {
                if (cancelled) return;
                setTitle(res.material.title);
                setBodyText(res.material.body_text || '');
                setDepartmentId(res.material.department_id || '');
                setExistingFileUrl(res.material.file_url);
            })
            .catch((err) => !cancelled && setError(err.message))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [api, id, isNew]);

    function handleFileChange(e) {
        const file = e.target.files?.[0];
        if (file) {
            setNewFile(file);
            setRemoveExistingFile(false);
        }
    }

    async function handleSave(e) {
        e.preventDefault();
        setError(null);

        if (!title.trim()) {
            setError('Укажите название материала.');
            return;
        }

        setSaving(true);
        try {
            const formData = new FormData();
            formData.append('title', title);
            formData.append('body_text', bodyText);
            formData.append('department_id', departmentId);
            if (newFile) formData.append('file', newFile);
            if (!isNew && removeExistingFile && !newFile) formData.append('remove_file', 'true');

            if (isNew) {
                const res = await upload('/api/training', formData);
                navigate(`/training/${res.material.id}`, { replace: true });
            } else {
                await upload(`/api/training/${id}`, formData, 'PATCH');
                navigate(`/training/${id}`);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <p>Загрузка...</p>;

    return (
        <div className="page">
            <h1>{isNew ? 'Новый материал' : 'Редактирование материала'}</h1>
            <form onSubmit={handleSave} className="form">
                <label className="field">
                    <span>Название</span>
                    <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label className="field">
                    <span>Текст</span>
                    <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={8} />
                </label>

                {departments.length > 0 && (
                    <label className="field">
                        <span>Подразделение</span>
                        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                            <option value="">Для всех</option>
                            {departments.map((dept) => (
                                <option key={dept.id} value={dept.id}>
                                    {dept.name}
                                </option>
                            ))}
                        </select>
                    </label>
                )}

                <label className="field">
                    <span>Вложение (фото, видео, PDF или документ, необязательно)</span>
                    {existingFileUrl && !removeExistingFile && !newFile && (
                        <div className="hint">
                            Текущий файл прикреплён.{' '}
                            <button type="button" className="btn btn--ghost btn--danger" onClick={() => setRemoveExistingFile(true)}>
                                Удалить
                            </button>
                        </div>
                    )}
                    {newFile && <div className="hint">Выбран новый файл: {newFile.name}</div>}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,video/mp4,video/quicktime,video/webm,application/pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,text/plain"
                        onChange={handleFileChange}
                    />
                </label>

                {error && <p className="error-text">{error}</p>}

                <div className="form-actions">
                    <button type="button" className="btn btn--ghost" onClick={() => navigate('/training')}>
                        Отмена
                    </button>
                    <button type="submit" className="btn" disabled={saving}>
                        {saving ? 'Сохранение...' : 'Сохранить'}
                    </button>
                </div>
            </form>
        </div>
    );
}
