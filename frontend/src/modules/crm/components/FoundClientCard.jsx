import { clientName, formatPhone } from '../format';

// Compact card for an existing client found by the duplicate check.
export default function FoundClientCard({ client, title, children }) {
    return (
        <div className="crm-found">
            <div className="hint">{title}</div>
            <div className="list-row__title">{clientName(client)}</div>
            <div className="hint">
                {[formatPhone(client.phone), client.instagram_username && `@${client.instagram_username}`].filter(Boolean).join(' · ')}
            </div>
            <div className="crm-found__actions">{children}</div>
        </div>
    );
}
