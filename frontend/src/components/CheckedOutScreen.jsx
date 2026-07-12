function formatTime(isoString) {
    return new Date(isoString).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export default function CheckedOutScreen({ attendance }) {
    return (
        <div className="screen screen-center">
            <div className="card">
                <h1>Смена завершена</h1>
                <p className="hint">
                    Приход: {formatTime(attendance.check_in.created_at)} · Уход: {formatTime(attendance.check_out.created_at)}
                </p>
                <p className="hint">Доступ к чек-листам откроется снова после следующей отметки прихода.</p>
            </div>
        </div>
    );
}
