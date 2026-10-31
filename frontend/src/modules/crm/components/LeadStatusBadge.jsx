import { t } from '../i18n';

const TONE = {
    new: 'serious',
    in_progress: 'warning',
    waiting_reply: 'warning',
    booked: 'info',
    arrived: 'info',
    order_created: 'good',
    completed: 'neutral',
    lost: 'critical',
};

export default function LeadStatusBadge({ status }) {
    return <span className={`status-badge crm-tone--${TONE[status] || 'neutral'}`}>{t(`leadStatus.${status}`)}</span>;
}
