export default function ErrorScreen({ message }) {
    return (
        <div className="screen screen-center">
            <p className="error-text">{message || 'Что-то пошло не так.'}</p>
        </div>
    );
}
