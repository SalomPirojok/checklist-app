import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApiClient, useApiUpload } from '../../../api/useApiClient';
import { SkeletonBlocks } from '../../../components/Skeleton';
import { hapticSelect, hapticSuccess } from '../../../lib/haptics';
import { useCrm } from '../CrmContext';
import IssueModal from '../components/IssueModal';
import ItemModal from '../components/ItemModal';
import MaterialModal from '../components/MaterialModal';
import OrderStatusBadge from '../components/OrderStatusBadge';
import PaymentModal from '../components/PaymentModal';
import PhotoStrip from '../components/PhotoStrip';
import ReasonModal from '../components/ReasonModal';
import { clientName, formatDateTime, formatMoney, formatPhone, fromLocalInputValue, toLocalInputValue, vehicleTitle } from '../format';
import { ORDER_STEPS, t } from '../i18n';

const PHOTO_STAGES = ['before', 'process', 'after'];

export default function OrderDetailPage() {
    const { id } = useParams();
    const api = useApiClient();
    const upload = useApiUpload();
    const navigate = useNavigate();
    const { can, staffName, userName, account, categoryName } = useCrm();

    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [modal, setModal] = useState(null); // { type, ...props }
    const [discount, setDiscount] = useState('');
    const [comment, setComment] = useState('');

    async function load() {
        try {
            const res = await api(`/api/crm/orders/${id}`);
            setData(res);
            setDiscount(Number(res.order.discount_amount) ? String(Number(res.order.discount_amount)) : '');
            setError(null);
        } catch (err) {
            setError(err.message);
        }
    }

    useEffect(() => {
        load();
    }, [api, id]);

    // Runs an API call, then reloads the order; errors show on the page.
    async function act(fn) {
        setBusy(true);
        setError(null);
        try {
            await fn();
            await load();
            return true;
        } catch (err) {
            setError(err.message);
            return false;
        } finally {
            setBusy(false);
        }
    }

    // For modals: errors stay inside the modal, success closes it.
    async function modalAction(fn) {
        await fn();
        setModal(null);
        hapticSuccess();
        await load();
    }

    if (!data) return <div className="page">{error ? <p className="error-text">{error}</p> : <SkeletonBlocks count={4} />}</div>;

    const { order, client, vehicle, items, materials, photos, comments, history, payments, accruals } = data;
    const closed = order.status === 'issued' || order.status === 'cancelled';
    const canEdit = can('orders.manage') && !closed;
    const due = Number(order.total) - Number(order.paid_amount);
    const reversedIds = new Set(payments.filter((p) => p.reversal_of).map((p) => p.reversal_of));
    const base = (amount) => formatMoney(amount, 'UZS');

    function changeStatus(status) {
        if (status === order.status || busy) return;
        hapticSelect();
        act(() => api(`/api/crm/orders/${id}`, { method: 'PATCH', body: { status } }));
    }

    function cancelOrder() {
        setModal({
            type: 'reason',
            title: t('order.cancel'),
            label: t('order.cancelReason'),
            confirmLabel: t('order.cancel'),
            danger: true,
            required: false,
            run: (reason) => api(`/api/crm/orders/${id}`, { method: 'PATCH', body: { status: 'cancelled', cancel_reason: reason } }),
        });
    }

    function saveDiscount() {
        if (Number(discount || 0) === Number(order.discount_amount)) return;
        act(() => api(`/api/crm/orders/${id}`, { method: 'PATCH', body: { discount_amount: Number(discount || 0) } })).then(
            (ok) => !ok && setDiscount(Number(order.discount_amount) ? String(Number(order.discount_amount)) : '')
        );
    }

    function saveDate(field, value) {
        act(() => api(`/api/crm/orders/${id}`, { method: 'PATCH', body: { [field]: fromLocalInputValue(value) } }));
    }

    function deleteItem(item) {
        if (!confirm(`${t('common.delete')} «${item.name}»?`)) return;
        act(() => api(`/api/crm/orders/${id}/items/${item.id}`, { method: 'DELETE' }));
    }

    function deleteMaterial(material) {
        if (!confirm(`${t('common.delete')} «${material.name}»?`)) return;
        act(() => api(`/api/crm/orders/${id}/materials/${material.id}`, { method: 'DELETE' }));
    }

    function reversePayment(tx) {
        setModal({
            type: 'reason',
            title: `${t('order.reverse')}: ${formatMoney(tx.amount, tx.currency)}`,
            label: t('order.reverseReason'),
            confirmLabel: t('order.reverse'),
            danger: true,
            run: (reason) => api(`/api/crm/orders/${id}/payments/${tx.id}/reverse`, { method: 'POST', body: { reason } }),
        });
    }

    function reopen() {
        setModal({
            type: 'reason',
            title: t('order.reopen'),
            label: t('order.reopenReason'),
            confirmLabel: t('order.reopen'),
            run: (reason) => api(`/api/crm/orders/${id}/reopen`, { method: 'POST', body: { reason } }),
        });
    }

    async function uploadPhoto(stage, file) {
        const formData = new FormData();
        formData.append('stage', stage);
        formData.append('photo', file);
        try {
            const res = await upload(`/api/crm/orders/${id}/photos`, formData);
            setData((prev) => ({ ...prev, photos: [...prev.photos, res.photo] }));
        } catch (err) {
            setError(err.message);
        }
    }

    async function deletePhoto(photo) {
        try {
            await api(`/api/crm/orders/${id}/photos/${photo.id}`, { method: 'DELETE' });
            setData((prev) => ({ ...prev, photos: prev.photos.filter((p) => p.id !== photo.id) }));
        } catch (err) {
            setError(err.message);
        }
    }

    async function addComment(e) {
        e.preventDefault();
        if (!comment.trim()) return;
        const ok = await act(() => api(`/api/crm/orders/${id}/comments`, { method: 'POST', body: { body: comment } }));
        if (ok) setComment('');
    }

    function historyText(h) {
        if (h.event === 'status_changed') {
            return `${t('history.status_changed')}: ${h.from_status ? `${t(`orderStatus.${h.from_status}`)} → ` : ''}${t(`orderStatus.${h.to_status}`)}`;
        }
        if (h.event === 'payment' || h.event === 'refund') {
            return `${t(`history.${h.event}`)}: ${formatMoney(h.details?.amount, h.details?.currency)}`;
        }
        if (h.event === 'reopened' || h.event === 'reversal') {
            return `${t(`history.${h.event}`)}${h.details?.reason ? `: ${h.details.reason}` : ''}`;
        }
        return t(`history.${h.event}`);
    }

    const materialsTotal = materials.reduce((sum, m) => sum + Number(m.total_cost_base), 0);

    return (
        <div className="page">
            <button type="button" className="btn btn--ghost back-link" onClick={() => navigate(-1)}>
                {t('common.back')}
            </button>
            <div className="page-header">
                <h1>{t('order.title', { number: order.number })}</h1>
                <OrderStatusBadge status={order.status} />
            </div>

            <div className="crm-pair-cards">
                <Link to={`/clients/${client.id}`} className="list-row crm-row">
                    <div className="crm-row__main">
                        <div className="hint">{t('order.client')}</div>
                        <div className="list-row__title">{clientName(client)}</div>
                        <div className="hint">{formatPhone(client.phone)}</div>
                    </div>
                </Link>
                {vehicle ? (
                    <Link to={`/vehicles/${vehicle.id}`} className="list-row crm-row">
                        <div className="crm-row__main">
                            <div className="hint">{t('order.vehicle')}</div>
                            <div className="list-row__title">{vehicleTitle({ make: vehicle.make, model: vehicle.model })}</div>
                            <div className="hint">{[vehicle.plate, vehicle.color].filter(Boolean).join(' · ')}</div>
                        </div>
                    </Link>
                ) : (
                    <div className="list-row crm-row">
                        <div className="crm-row__main">
                            <div className="hint">{t('order.vehicle')}</div>
                            <div className="hint">{t('order.noVehicle')}</div>
                        </div>
                    </div>
                )}
            </div>

            {error && <p className="error-text">{error}</p>}

            {/* Status */}
            {order.status === 'cancelled' ? (
                order.cancel_reason && (
                    <p className="hint">
                        {t('order.cancelReason')}: {order.cancel_reason}
                    </p>
                )
            ) : order.status === 'issued' ? (
                <div className="crm-issued">
                    <span>
                        {t('orderStatus.issued')} · {formatDateTime(order.issued_at)}
                    </span>
                    {can('orders.issue') && (
                        <button type="button" className="btn btn--ghost" onClick={reopen} disabled={busy}>
                            {t('order.reopen')}
                        </button>
                    )}
                </div>
            ) : (
                <>
                    <h3 className="crm-section-title">{t('order.status')}</h3>
                    <div className="crm-chips">
                        {ORDER_STEPS.map((s) => (
                            <button
                                key={s}
                                type="button"
                                disabled={busy || !can('orders.manage')}
                                className={order.status === s ? 'crm-chip crm-chip--active' : 'crm-chip'}
                                onClick={() => changeStatus(s)}
                            >
                                {t(`orderStatus.${s}`)}
                            </button>
                        ))}
                    </div>
                    {can('orders.manage') && (
                        <div className="crm-field-pair">
                            <label className="field">
                                <span>{t('order.receivedAt')}</span>
                                <input
                                    type="datetime-local"
                                    defaultValue={toLocalInputValue(order.received_at)}
                                    onBlur={(e) => e.target.value !== toLocalInputValue(order.received_at) && saveDate('received_at', e.target.value)}
                                />
                            </label>
                            <label className="field">
                                <span>{t('order.plannedReadyAt')}</span>
                                <input
                                    type="datetime-local"
                                    defaultValue={toLocalInputValue(order.planned_ready_at)}
                                    onBlur={(e) =>
                                        e.target.value !== toLocalInputValue(order.planned_ready_at) && saveDate('planned_ready_at', e.target.value)
                                    }
                                />
                            </label>
                        </div>
                    )}
                </>
            )}

            {/* Services */}
            <div className="page-header crm-subheader">
                <h3>{t('order.services')}</h3>
                {canEdit && (
                    <button type="button" className="btn btn--ghost" onClick={() => setModal({ type: 'item', item: null })}>
                        {t('order.addService')}
                    </button>
                )}
            </div>
            {items.length === 0 ? (
                <p className="hint">{t('order.noServices')}</p>
            ) : (
                <ul className="list">
                    {items.map((item) => (
                        <li key={item.id} className="list-row crm-line">
                            <div className="crm-row__main">
                                <div className="list-row__title">
                                    {item.name}
                                    {item.is_additional && <span className="tag">{t('order.additional')}</span>}
                                </div>
                                <div className="hint">
                                    {categoryName(item.category_id)}
                                    {Number(item.quantity) !== 1 && ` · ${Number(item.quantity)} × ${formatMoney(item.unit_price, order.currency)}`}
                                    {Number(item.discount_amount) > 0 && ` · −${formatMoney(item.discount_amount, order.currency)}`}
                                </div>
                                <div className="hint">
                                    {item.staff.length
                                        ? item.staff.map((s) => `${staffName(s.staff_id)}${item.staff.length > 1 ? ` ${Number(s.share_percent)}%` : ''}`).join(', ')
                                        : t('item.noMasters')}
                                </div>
                            </div>
                            <div className="crm-line__side">
                                <strong>{formatMoney(item.total, order.currency)}</strong>
                                {canEdit && (
                                    <div>
                                        <button type="button" className="btn btn--ghost" onClick={() => setModal({ type: 'item', item })}>
                                            {t('common.edit')}
                                        </button>
                                        <button type="button" className="btn btn--ghost btn--danger" onClick={() => deleteItem(item)}>
                                            ✕
                                        </button>
                                    </div>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {/* Totals */}
            <div className="card crm-totals">
                <div>
                    <span>{t('order.subtotal')}</span>
                    <span>{formatMoney(order.subtotal, order.currency)}</span>
                </div>
                <div>
                    <span>{t('order.discount')}</span>
                    {canEdit ? (
                        <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            className="crm-inline-input"
                            value={discount}
                            placeholder="0"
                            onChange={(e) => setDiscount(e.target.value)}
                            onBlur={saveDiscount}
                        />
                    ) : (
                        <span>{formatMoney(order.discount_amount, order.currency)}</span>
                    )}
                </div>
                <div className="crm-totals__strong">
                    <span>{t('order.total')}</span>
                    <strong>{formatMoney(order.total, order.currency)}</strong>
                </div>
                <div>
                    <span>{t('order.paid')}</span>
                    <span>{formatMoney(order.paid_amount, order.currency)}</span>
                </div>
                {due > 0 && order.status !== 'cancelled' && (
                    <div className="crm-debt">
                        <span>{t('order.due')}</span>
                        <strong>{formatMoney(due, order.currency)}</strong>
                    </div>
                )}
            </div>

            {can('orders.issue') && !closed && (
                <button type="button" className="btn btn--block btn--large crm-issue-btn" disabled={busy || !items.length} onClick={() => setModal({ type: 'issue' })}>
                    {t('order.issue')}
                </button>
            )}

            {/* Economics, after issue */}
            {order.status === 'issued' && can('finance.view') && (
                <>
                    <h3 className="crm-section-title">{t('order.economics')}</h3>
                    <div className="card crm-totals">
                        <div>
                            <span>{t('order.revenue')}</span>
                            <span>{base(order.revenue_base)}</span>
                        </div>
                        <div>
                            <span>{t('order.materialsCost')}</span>
                            <span>−{base(order.materials_cost_base)}</span>
                        </div>
                        <div>
                            <span>{t('order.laborCost')}</span>
                            <span>−{base(order.labor_cost_base)}</span>
                        </div>
                        <div className="crm-totals__strong">
                            <span>{t('order.grossProfit')}</span>
                            <strong>
                                {base(Number(order.revenue_base) - Number(order.materials_cost_base) - Number(order.labor_cost_base))}
                            </strong>
                        </div>
                    </div>
                </>
            )}
            {accruals.length > 0 && (
                <>
                    <h3 className="crm-section-title">{t('order.accruals')}</h3>
                    <ul className="crm-timeline">
                        {accruals.map((a, i) => (
                            <li key={i}>
                                <span className="crm-timeline__when">{a.details?.line_name}</span>
                                <span>
                                    {staffName(a.staff_id)}: {base(a.amount)}
                                    {a.details?.percent && <span className="hint"> · {Number(a.details.percent)}%</span>}
                                </span>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            {/* Payments */}
            <div className="page-header crm-subheader">
                <h3>{t('order.payments')}</h3>
                {can('payments.record') && order.status !== 'cancelled' && (
                    <div>
                        {Number(order.paid_amount) > 0 && (
                            <button type="button" className="btn btn--ghost" onClick={() => setModal({ type: 'payment', kind: 'refund' })}>
                                {t('order.refund')}
                            </button>
                        )}
                        {due > 0 && (
                            <button type="button" className="btn btn--ghost" onClick={() => setModal({ type: 'payment', kind: 'payment' })}>
                                {t('order.addPayment')}
                            </button>
                        )}
                    </div>
                )}
            </div>
            {payments.length === 0 ? (
                <p className="hint">{t('order.noPayments')}</p>
            ) : (
                <ul className="list">
                    {payments.map((p) => {
                        const isIncome = p.direction === 1;
                        const reversed = reversedIds.has(p.id);
                        return (
                            <li key={p.id} className={`list-row crm-line${reversed || p.reversal_of ? ' crm-row--muted' : ''}`}>
                                <div className="crm-row__main">
                                    <div className="list-row__title">
                                        {isIncome ? '+' : '−'}
                                        {formatMoney(p.amount, p.currency)}
                                        {p.type === 'client_refund' && <span className="tag">{t('order.refund')}</span>}
                                        {p.reversal_of && <span className="tag">{t('order.reversal')}</span>}
                                        {reversed && <span className="tag">{t('order.reversed')}</span>}
                                    </div>
                                    <div className="hint">
                                        {[account(p.account_id)?.name, formatDateTime(p.occurred_at), userName(p.created_by), p.note].filter(Boolean).join(' · ')}
                                    </div>
                                    {p.currency !== order.currency && (
                                        <div className="hint">{t('payment.willCredit', { amount: formatMoney(p.order_amount, order.currency) })}</div>
                                    )}
                                </div>
                                {can('finance.manage') && !reversed && !p.reversal_of && (
                                    <button type="button" className="btn btn--ghost btn--danger" onClick={() => reversePayment(p)} disabled={busy}>
                                        {t('order.reverse')}
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {/* Materials */}
            <div className="page-header crm-subheader">
                <h3>{t('order.materials')}</h3>
                {canEdit && (
                    <button type="button" className="btn btn--ghost" onClick={() => setModal({ type: 'material' })}>
                        {t('order.addMaterial')}
                    </button>
                )}
            </div>
            {materials.length === 0 ? (
                <p className="hint">{t('order.noMaterials')}</p>
            ) : (
                <ul className="list">
                    {materials.map((m) => (
                        <li key={m.id} className="list-row crm-line">
                            <div className="crm-row__main">
                                <div className="list-row__title">{m.name}</div>
                                <div className="hint">
                                    {Number(m.quantity)} {m.unit || ''} × {formatMoney(m.unit_cost, m.currency)}
                                    {m.order_item_id && ` · ${items.find((i) => i.id === m.order_item_id)?.name || ''}`}
                                </div>
                            </div>
                            <div className="crm-line__side">
                                <span>{base(m.total_cost_base)}</span>
                                {canEdit && (
                                    <button type="button" className="btn btn--ghost btn--danger" onClick={() => deleteMaterial(m)}>
                                        ✕
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                    {materials.length > 1 && (
                        <li className="hint crm-materials-total">
                            {t('order.materialsCost')}: {base(materialsTotal)}
                        </li>
                    )}
                </ul>
            )}

            {/* Photos */}
            <h3 className="crm-section-title">{t('order.photos')}</h3>
            {PHOTO_STAGES.map((stage) => (
                <div key={stage} className="crm-photo-stage">
                    <div className="hint">{t(`order.photoStage.${stage}`)}</div>
                    <PhotoStrip
                        photos={photos.filter((p) => p.stage === stage)}
                        onUpload={can('orders.manage') ? (file) => uploadPhoto(stage, file) : null}
                        onDelete={can('orders.manage') ? deletePhoto : null}
                    />
                </div>
            ))}

            {/* Comments */}
            <h3 className="crm-section-title">{t('order.comments')}</h3>
            <form className="crm-comment-form" onSubmit={addComment}>
                <textarea placeholder={t('client.commentPlaceholder')} value={comment} onChange={(e) => setComment(e.target.value)} />
                <button type="submit" className="btn" disabled={busy || !comment.trim()}>
                    {t('client.addComment')}
                </button>
            </form>
            {comments.length > 0 && (
                <ul className="crm-timeline">
                    {comments.map((c) => (
                        <li key={c.id}>
                            <span className="crm-timeline__when">
                                {formatDateTime(c.created_at)}
                                {userName(c.author_id) && ` · ${userName(c.author_id)}`}
                            </span>
                            <span className="crm-comment-body">{c.body}</span>
                        </li>
                    ))}
                </ul>
            )}

            {/* History */}
            <h3 className="crm-section-title">{t('order.history')}</h3>
            <ul className="crm-timeline">
                {history.map((h) => (
                    <li key={h.id}>
                        <span className="crm-timeline__when">
                            {formatDateTime(h.created_at)}
                            {userName(h.user_id) && ` · ${userName(h.user_id)}`}
                        </span>
                        <span>{historyText(h)}</span>
                    </li>
                ))}
            </ul>

            {can('orders.manage') && !closed && (
                <button type="button" className="btn btn--ghost btn--danger btn--block crm-cancel-btn" onClick={cancelOrder} disabled={busy}>
                    {t('order.cancel')}
                </button>
            )}

            {modal?.type === 'item' && (
                <ItemModal
                    item={modal.item}
                    onClose={() => setModal(null)}
                    onSave={(body) =>
                        modalAction(() =>
                            modal.item
                                ? api(`/api/crm/orders/${id}/items/${modal.item.id}`, { method: 'PATCH', body })
                                : api(`/api/crm/orders/${id}/items`, { method: 'POST', body })
                        )
                    }
                />
            )}
            {modal?.type === 'payment' && (
                <PaymentModal
                    order={order}
                    kind={modal.kind}
                    onClose={() => setModal(null)}
                    onSave={(body) => modalAction(() => api(`/api/crm/orders/${id}/payments`, { method: 'POST', body }))}
                />
            )}
            {modal?.type === 'material' && (
                <MaterialModal
                    items={items}
                    onClose={() => setModal(null)}
                    onSave={(body) => modalAction(() => api(`/api/crm/orders/${id}/materials`, { method: 'POST', body }))}
                />
            )}
            {modal?.type === 'reason' && (
                <ReasonModal
                    title={modal.title}
                    label={modal.label}
                    confirmLabel={modal.confirmLabel}
                    danger={modal.danger}
                    required={modal.required !== false}
                    onClose={() => setModal(null)}
                    onConfirm={(reason) => modalAction(() => modal.run(reason))}
                />
            )}
            {modal?.type === 'issue' && (
                <IssueModal
                    order={order}
                    onClose={() => setModal(null)}
                    onConfirm={(body) => modalAction(() => api(`/api/crm/orders/${id}/issue`, { method: 'POST', body }))}
                />
            )}
        </div>
    );
}
