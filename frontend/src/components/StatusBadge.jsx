import { STATUS_META } from '../constants';

export default function StatusBadge({ status }) {
    const meta = STATUS_META[status] || { label: status };
    return <span className={`status-badge status-badge--${status}`}>{meta.label}</span>;
}
