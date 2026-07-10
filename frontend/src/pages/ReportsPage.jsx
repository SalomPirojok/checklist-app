import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../api/useApiClient';

function toDateStr(date) {
    return date.toISOString().slice(0, 10);
}

function todayStr() {
    return toDateStr(new Date());
}

function yesterdayStr() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return toDateStr(d);
}

function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

export default function ReportsPage() {
    const api = useApiClient();
    const navigate = useNavigate();

    const [preset, setPreset] = useState('today');
    const [from, setFrom] = useState(todayStr());
    const [to, setTo] = useState(todayStr());
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    function applyPreset(p) {
        setPreset(p);
        if (p === 'today') {
            setFrom(todayStr());
            setTo(todayStr());
        } else if (p === 'yesterday') {
            setFrom(yesterdayStr());
            setTo(yesterdayStr());
        }
    }

    async function load() {
        setLoading(true);
        try {
            const res = await api(`/api/reports?from=${from}&to=${to}`);
            setReports(res.reports);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, from, to]);

    return (
        <div className="page">
            <div className="page-header">
                <h1>Отчёты</h1>
                <button className="btn btn--ghost" onClick={() => navigate('/reports/settings')}>
                    Настройки отчёта
                </button>
            </div>

            <div className="tab-bar" style={{ marginBottom: '12px' }}>
                <button
                    type="button"
                    className={preset === 'today' ? 'tab-bar__item tab-bar__item--active' : 'tab-bar__item'}
                    onClick={() => applyPreset('today')}
                >
                    Сегодня
                </button>
                <button
                    type="button"
                    className={preset === 'yesterday' ? 'tab-bar__item tab-bar__item--active' : 'tab-bar__item'}
                    onClick={() => applyPreset('yesterday')}
                >
                    Вчера
                </button>
                <button
                    type="button"
                    className={preset === 'custom' ? 'tab-bar__item tab-bar__item--active' : 'tab-bar__item'}
                    onClick={() => setPreset('custom')}
                >
                    Период
                </button>
            </div>

            {preset === 'custom' && (
                <div className="form" style={{ flexDirection: 'row', gap: '8px', alignItems: 'flex-end', marginBottom: '12px' }}>
                    <label className="field">
                        <span>С</span>
                        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={to} />
                    </label>
                    <label className="field">
                        <span>По</span>
                        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from} max={todayStr()} />
                    </label>
                </div>
            )}

            {loading && <p>Загрузка...</p>}
            {error && <p className="error-text">{error}</p>}

            {!loading &&
                !error &&
                reports.map((report) => {
                    const withCheckIn = report.attendance.filter((a) => a.check_in);
                    return (
                        <div key={report.date} style={{ marginBottom: '24px' }}>
                            <h2>{report.date}</h2>

                            {!report.has_activity && <p className="hint">Активности за этот день не было.</p>}

                            <h3 className="hint">Посещаемость</h3>
                            {withCheckIn.length === 0 ? (
                                <p className="hint">Никто не отметился.</p>
                            ) : (
                                <ul className="list">
                                    {withCheckIn.map((a) => (
                                        <li key={a.user_id} className="list-row">
                                            <div className="list-row__title">{a.full_name}</div>
                                            <div className="hint" style={{ textAlign: 'right' }}>
                                                <div>
                                                    Приход: {formatTime(a.check_in.time)}{' '}
                                                    {a.check_in.isLate ? (
                                                        <span className="tag tag--pending">опоздание {a.check_in.lateMinutes} мин</span>
                                                    ) : (
                                                        <span className="tag">вовремя</span>
                                                    )}
                                                </div>
                                                {a.check_out && <div>Уход: {formatTime(a.check_out.time)}</div>}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}

                            {report.no_checkin.length > 0 && (
                                <>
                                    <h3 className="hint">Не отметили приход</h3>
                                    <ul className="list">
                                        {report.no_checkin.map((u) => (
                                            <li key={u.user_id} className="list-row">
                                                <div className="list-row__title">{u.full_name}</div>
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            )}

                            <h3 className="hint">Чек-листы</h3>
                            <p className="hint">
                                Выполнено {report.checklists.completed} из {report.checklists.total}, просрочено {report.checklists.overdue}
                            </p>

                            {report.penalties.length > 0 && (
                                <>
                                    <h3 className="hint">Штрафы</h3>
                                    <ul className="list">
                                        {report.penalties.map((p) => (
                                            <li key={p.id} className="list-row">
                                                <div>
                                                    <div className="list-row__title">{p.full_name}</div>
                                                    <div className="hint">{p.reason}</div>
                                                </div>
                                                <div className="list-row__title">{Number(p.amount).toLocaleString('ru-RU')} ₽</div>
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            )}
                        </div>
                    );
                })}
        </div>
    );
}
