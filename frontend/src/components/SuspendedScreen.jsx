export default function SuspendedScreen({ message }) {
    return (
        <div className="screen screen-center">
            <p className="error-text">{message || 'Доступ временно приостановлен, обратитесь к администратору.'}</p>
        </div>
    );
}
