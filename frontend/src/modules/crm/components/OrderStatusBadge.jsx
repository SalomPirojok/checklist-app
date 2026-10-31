import { t } from '../i18n';

const TONE = {
    pending: 'serious',
    accepted: 'info',
    in_progress: 'info',
    waiting_parts: 'warning',
    quality_check: 'warning',
    ready: 'good',
    issued: 'neutral',
    cancelled: 'critical',
};

export default function OrderStatusBadge({ status }) {
    return <span className={`status-badge crm-tone--${TONE[status] || 'neutral'}`}>{t(`orderStatus.${status}`)}</span>;
}
