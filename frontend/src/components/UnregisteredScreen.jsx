import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function UnregisteredScreen() {
    const { register } = useAuth();
    const [orgName, setOrgName] = useState('');
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState(null);

    async function handleCreate() {
        setCreating(true);
        setError(null);
        try {
            await register(orgName.trim() || undefined);
        } catch (err) {
            setError(err.message);
            setCreating(false);
        }
    }

    return (
        <div className="screen screen-center">
            <div className="card">
                <h1>Вы пока не состоите ни в одной организации</h1>
                <p className="hint">
                    Если вас должны были пригласить — попросите владельца организации добавить вас по вашему Telegram
                    username. Либо создайте свою организацию и станьте её владельцем.
                </p>

                <div className="form">
                    <label className="field">
                        <span>Название организации (необязательно)</span>
                        <input
                            type="text"
                            value={orgName}
                            onChange={(e) => setOrgName(e.target.value)}
                            placeholder="Например: Кафе «Ромашка»"
                        />
                    </label>

                    {error && <p className="error-text">{error}</p>}

                    <button type="button" className="btn btn--large btn--block" onClick={handleCreate} disabled={creating}>
                        {creating ? 'Создание...' : 'Создать свою организацию'}
                    </button>
                </div>
            </div>
        </div>
    );
}
