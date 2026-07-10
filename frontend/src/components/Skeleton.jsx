export function SkeletonRows({ count = 4 }) {
    return (
        <div>
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="skeleton skeleton-row" />
            ))}
        </div>
    );
}

export function SkeletonBlocks({ count = 3 }) {
    return (
        <div>
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="skeleton skeleton-block" />
            ))}
        </div>
    );
}

export function SkeletonKpiRow() {
    return (
        <div className="kpi-row">
            <div className="skeleton skeleton-block" />
            <div className="skeleton skeleton-block" />
            <div className="skeleton skeleton-block" />
            <div className="skeleton skeleton-block" />
        </div>
    );
}
