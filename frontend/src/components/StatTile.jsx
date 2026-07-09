export default function StatTile({ statusKey, label, value }) {
    return (
        <div className={`stat-tile stat-tile--${statusKey}`}>
            <div className="stat-tile__value">{value}</div>
            <div className="stat-tile__label">{label}</div>
        </div>
    );
}
