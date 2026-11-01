import { Router } from 'express';
import { supabase } from '../../../lib/supabase.js';
import { requirePermission } from '../middleware.js';
import { crmAudit } from '../lib/audit.js';
import { sendDbError } from '../lib/dbErrors.js';
import { photoUpload, removePhoto, uploadPhoto, withSignedUrls } from '../lib/files.js';
import { getRate } from '../lib/fx.js';
import { cleanText, searchTerm } from '../lib/normalize.js';
import { notifyLater, orderContext } from '../lib/notify.js';
import { debtText, orderIssuedText, orderNewText, orderStatusText, paymentText } from '../lib/notifyText.js';
import { localDateString } from '../../../lib/time.js';

const router = Router();

const PAGE_SIZE = 50;
export const ORDER_STATUSES = ['pending', 'accepted', 'in_progress', 'waiting_parts', 'quality_check', 'ready', 'issued', 'cancelled'];
// 'issued' only through POST /:id/issue (revenue recognition).
const MANUAL_STATUSES = ORDER_STATUSES.filter((s) => s !== 'issued');
const ACTIVE_STATUSES = ['pending', 'accepted', 'in_progress', 'waiting_parts', 'quality_check', 'ready'];
const CURRENCIES = ['UZS', 'USD'];
const PHOTO_STAGES = ['before', 'process', 'after'];

const ORDER_FIELDS =
    'id, number, client_id, vehicle_id, lead_id, manager_id, status, currency, received_at, planned_ready_at, issued_at, cancelled_at, cancel_reason, subtotal, discount_amount, total, paid_amount, fx_rate_at_issue, revenue_base, materials_cost_base, labor_cost_base, notes, created_at, updated_at';

const canView = requirePermission('orders.manage', 'payments.record');
const canEdit = requirePermission('orders.manage');

function money(value, field, { allowZero = true } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) throw new Error(`Неверное значение: ${field}`);
    return Math.round(n * 100) / 100;
}

function isoOrNull(value) {
    if (value === null || value === '' || value === undefined) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new Error('Неверная дата');
    return d.toISOString();
}

function today() {
    return localDateString(new Date(), 'Asia/Tashkent');
}

// Uses the given rate, or today's Central Bank rate when none was given.
async function rateOrDefault(currency, given) {
    if (currency === 'UZS') return 1;
    if (given !== undefined && given !== null && given !== '') return money(given, 'курс', { allowZero: false });
    const found = await getRate(currency, today());
    if (!found) throw new Error(`Не удалось получить курс ${currency} — укажите его вручную`);
    return found.rate;
}

async function loadOrder(req, res) {
    const { data, error } = await supabase
        .from('crm_orders')
        .select(ORDER_FIELDS)
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (error) {
        sendDbError(res, error);
        return null;
    }
    if (!data) {
        res.status(404).json({ error: 'Заказ не найден' });
        return null;
    }
    return data;
}

// ---------------------------------------------------------------------------
// List, summary, detail
// ---------------------------------------------------------------------------

router.get('/', canView, async (req, res) => {
    const orgId = req.user.organizationId;
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const statuses = String(req.query.status || '')
        .split(',')
        .filter((s) => ORDER_STATUSES.includes(s));

    let query = supabase
        .from('crm_orders')
        .select(ORDER_FIELDS, { count: 'exact' })
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
    if (statuses.length) query = query.in('status', statuses);
    if (req.query.client_id) query = query.eq('client_id', req.query.client_id);

    const q = searchTerm(req.query.q);
    if (q) {
        const digits = q.replace(/\D/g, '');
        const plate = q.replace(/\s|-/g, '').toUpperCase();
        const clientConditions = [`first_name.ilike.%${q}%`, `last_name.ilike.%${q}%`];
        if (digits.length >= 3) clientConditions.push(`phone.ilike.%${digits}%`);
        const [clients, vehicles] = await Promise.all([
            supabase.from('crm_clients').select('id').eq('organization_id', orgId).or(clientConditions.join(',')).limit(300),
            supabase.from('crm_vehicles').select('id').eq('organization_id', orgId).ilike('plate', `%${plate}%`).limit(300),
        ]);
        if (clients.error || vehicles.error) return sendDbError(res, clients.error || vehicles.error);
        const conditions = [];
        if (/^\d{1,9}$/.test(q)) conditions.push(`number.eq.${q}`);
        if (clients.data.length) conditions.push(`client_id.in.(${clients.data.map((c) => c.id).join(',')})`);
        if (vehicles.data.length) conditions.push(`vehicle_id.in.(${vehicles.data.map((v) => v.id).join(',')})`);
        if (!conditions.length) return res.json({ orders: [], total: 0, page_size: PAGE_SIZE });
        query = query.or(conditions.join(','));
    }

    const { data: orders, error, count } = await query;
    if (error) return sendDbError(res, error, 'Не удалось загрузить заказы');

    const clientIds = [...new Set(orders.map((o) => o.client_id))];
    const vehicleIds = [...new Set(orders.map((o) => o.vehicle_id).filter(Boolean))];
    const [clients, vehicles] = await Promise.all([
        clientIds.length
            ? supabase.from('crm_clients').select('id, first_name, last_name, phone').in('id', clientIds)
            : { data: [], error: null },
        vehicleIds.length
            ? supabase.from('crm_vehicles').select('id, make, model, plate, color').in('id', vehicleIds)
            : { data: [], error: null },
    ]);
    if (clients.error || vehicles.error) return sendDbError(res, clients.error || vehicles.error);
    const clientMap = new Map(clients.data.map((c) => [c.id, c]));
    const vehicleMap = new Map(vehicles.data.map((v) => [v.id, v]));

    res.json({
        orders: orders.map((o) => ({
            ...o,
            client: clientMap.get(o.client_id) || null,
            vehicle: vehicleMap.get(o.vehicle_id) || null,
        })),
        total: count,
        page_size: PAGE_SIZE,
    });
});

router.get('/summary', canView, async (req, res) => {
    const { data, error } = await supabase
        .from('crm_orders')
        .select('status')
        .eq('organization_id', req.user.organizationId)
        .in('status', ACTIVE_STATUSES);
    if (error) return sendDbError(res, error);
    const counts = {};
    for (const { status } of data) counts[status] = (counts[status] || 0) + 1;
    res.json({ counts });
});

router.get('/:id', canView, async (req, res) => {
    const order = await loadOrder(req, res);
    if (!order) return;

    const [client, vehicle, items, materials, photos, comments, history, payments] = await Promise.all([
        supabase.from('crm_clients').select('id, first_name, last_name, phone, instagram_username').eq('id', order.client_id).single(),
        order.vehicle_id
            ? supabase.from('crm_vehicles').select('id, make, model, year, plate, color, vin').eq('id', order.vehicle_id).single()
            : { data: null, error: null },
        supabase
            .from('crm_order_items')
            .select('id, service_id, category_id, name, quantity, unit_price, discount_amount, total, is_additional, sort_order, created_at')
            .eq('order_id', order.id)
            .order('sort_order')
            .order('created_at'),
        supabase
            .from('crm_order_materials')
            .select('id, order_item_id, name, quantity, unit, unit_cost, currency, fx_rate, total_cost_base, created_at')
            .eq('order_id', order.id)
            .order('created_at'),
        supabase.from('crm_order_photos').select('id, stage, storage_path, created_at').eq('order_id', order.id).order('created_at'),
        supabase.from('crm_order_comments').select('id, body, author_id, created_at').eq('order_id', order.id).order('created_at', { ascending: false }),
        supabase
            .from('crm_order_history')
            .select('id, event, from_status, to_status, details, user_id, created_at')
            .eq('order_id', order.id)
            .order('created_at'),
        supabase
            .from('crm_transactions')
            .select('id, type, direction, account_id, amount, currency, fx_rate, order_amount, occurred_at, reversal_of, note, created_by')
            .eq('order_id', order.id)
            .order('occurred_at'),
    ]);
    const failed = [client, vehicle, items, materials, photos, comments, history, payments].find((r) => r.error);
    if (failed) return sendDbError(res, failed.error, 'Не удалось загрузить заказ');

    const itemIds = items.data.map((i) => i.id);
    const { data: itemStaff, error: staffError } = itemIds.length
        ? await supabase.from('crm_order_item_staff').select('order_item_id, staff_id, share_percent').in('order_item_id', itemIds)
        : { data: [], error: null };
    if (staffError) return sendDbError(res, staffError);

    // Commission accruals are only shown to those who may see payroll.
    let accruals = [];
    if (req.crm.permissions.includes('payroll.view') && order.status === 'issued') {
        const { data, error } = await supabase
            .from('crm_payroll_entries')
            .select('staff_id, amount, order_item_id, details')
            .eq('order_id', order.id);
        if (error) return sendDbError(res, error);
        accruals = data;
    }

    let signedPhotos;
    try {
        signedPhotos = await withSignedUrls(photos.data);
    } catch {
        return res.status(500).json({ error: 'Не удалось загрузить фото' });
    }

    res.json({
        order,
        client: client.data,
        vehicle: vehicle.data,
        items: items.data.map((i) => ({ ...i, staff: itemStaff.filter((s) => s.order_item_id === i.id) })),
        materials: materials.data,
        photos: signedPhotos,
        comments: comments.data,
        history: history.data,
        payments: payments.data,
        accruals,
    });
});

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------

router.post('/', canEdit, async (req, res) => {
    const orgId = req.user.organizationId;
    const body = req.body || {};
    const order = { organization_id: orgId, created_by: req.user.id, updated_by: req.user.id };
    try {
        if (!body.client_id) throw new Error('Укажите клиента');
        order.client_id = body.client_id;
        order.vehicle_id = body.vehicle_id || null;
        order.currency = body.currency || 'UZS';
        if (!CURRENCIES.includes(order.currency)) throw new Error('Неверная валюта');
        order.received_at = isoOrNull(body.received_at);
        order.planned_ready_at = isoOrNull(body.planned_ready_at);
        order.manager_id = body.manager_id || req.user.id;
        order.notes = cleanText(body.notes, 5000);
        if (order.received_at) order.status = 'accepted';
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    if (order.vehicle_id) {
        const { data: vehicle, error } = await supabase
            .from('crm_vehicles')
            .select('id, client_id')
            .eq('id', order.vehicle_id)
            .eq('organization_id', orgId)
            .maybeSingle();
        if (error) return sendDbError(res, error);
        if (!vehicle || vehicle.client_id !== order.client_id) {
            return res.status(400).json({ error: 'Автомобиль не принадлежит этому клиенту' });
        }
    }

    let lead = null;
    if (body.lead_id) {
        const { data, error } = await supabase
            .from('crm_leads')
            .select('id, client_id, order_id, status')
            .eq('id', body.lead_id)
            .eq('organization_id', orgId)
            .maybeSingle();
        if (error) return sendDbError(res, error);
        if (!data || data.client_id !== order.client_id) return res.status(400).json({ error: 'Заявка не относится к этому клиенту' });
        if (data.order_id) return res.status(409).json({ error: 'По этой заявке уже оформлен заказ' });
        lead = data;
        order.lead_id = lead.id;
    }

    const { data: created, error } = await supabase.from('crm_orders').insert(order).select(ORDER_FIELDS).single();
    if (error) return sendDbError(res, error, 'Не удалось создать заказ');

    if (lead) {
        const { error: leadError } = await supabase
            .from('crm_leads')
            .update({ order_id: created.id, status: 'order_created', updated_by: req.user.id })
            .eq('id', lead.id);
        if (leadError) console.error('Failed to link lead to order:', leadError.message);
    }
    await crmAudit(req, 'crm.order.create', 'crm_order', created.id, null, created);
    res.status(201).json({ order: created });

    notifyLater(orgId, 'order_new', async () => ({
        text: orderNewText({ order: created, ...(await orderContext(created)) }),
        link: `orders/${created.id}`,
    }));
});

router.patch('/:id', canEdit, async (req, res) => {
    const body = req.body || {};
    const updates = {};
    try {
        if (body.status !== undefined) {
            if (!MANUAL_STATUSES.includes(body.status)) throw new Error('Неверный статус');
            updates.status = body.status;
        }
        if (body.vehicle_id !== undefined) updates.vehicle_id = body.vehicle_id || null;
        if (body.currency !== undefined) {
            if (!CURRENCIES.includes(body.currency)) throw new Error('Неверная валюта');
            updates.currency = body.currency;
        }
        if (body.received_at !== undefined) updates.received_at = isoOrNull(body.received_at);
        if (body.planned_ready_at !== undefined) updates.planned_ready_at = isoOrNull(body.planned_ready_at);
        if (body.manager_id !== undefined) updates.manager_id = body.manager_id || null;
        if (body.notes !== undefined) updates.notes = cleanText(body.notes, 5000);
        if (body.discount_amount !== undefined) updates.discount_amount = money(body.discount_amount || 0, 'скидка');
        if (body.cancel_reason !== undefined) updates.cancel_reason = cleanText(body.cancel_reason, 500);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Нет полей для изменения' });

    const before = await loadOrder(req, res);
    if (!before) return;
    if (updates.vehicle_id) {
        const { data: vehicle, error } = await supabase
            .from('crm_vehicles')
            .select('client_id')
            .eq('id', updates.vehicle_id)
            .eq('organization_id', req.user.organizationId)
            .maybeSingle();
        if (error) return sendDbError(res, error);
        if (!vehicle || vehicle.client_id !== before.client_id) return res.status(400).json({ error: 'Автомобиль не принадлежит этому клиенту' });
    }
    if (updates.status === 'accepted' && !before.received_at && updates.received_at === undefined) {
        updates.received_at = new Date().toISOString();
    }

    const { data, error } = await supabase
        .from('crm_orders')
        .update({ ...updates, updated_by: req.user.id })
        .eq('id', before.id)
        .eq('organization_id', req.user.organizationId)
        .select(ORDER_FIELDS)
        .single();
    if (error) return sendDbError(res, error, 'Не удалось сохранить заказ');

    if (updates.status === 'cancelled' && before.lead_id) {
        await supabase
            .from('crm_leads')
            .update({ status: 'lost', lost_reason: updates.cancel_reason || 'Заказ отменён', closed_at: new Date().toISOString(), updated_by: req.user.id })
            .eq('id', before.lead_id);
    }
    await crmAudit(req, 'crm.order.update', 'crm_order', data.id, before, data);
    res.json({ order: data });

    if (data.status !== before.status) {
        notifyLater(req.user.organizationId, data.status === 'ready' ? 'order_ready' : 'order_status', async () => ({
            text: orderStatusText({ order: data, fromStatus: before.status, ...(await orderContext(data)) }),
            link: `orders/${data.id}`,
        }));
    }
});

// ---------------------------------------------------------------------------
// Lines and their masters
// ---------------------------------------------------------------------------

function parseItemInput(body, { partial }) {
    const out = {};
    if (body.category_id !== undefined || !partial) {
        if (!body.category_id) throw new Error('Укажите категорию услуги');
        out.category_id = body.category_id;
    }
    if (body.service_id !== undefined) out.service_id = body.service_id || null;
    if (body.name !== undefined || !partial) {
        out.name = cleanText(body.name, 200);
        if (!out.name) throw new Error('Укажите название услуги');
    }
    if (body.quantity !== undefined) out.quantity = money(body.quantity, 'количество', { allowZero: false });
    if (body.unit_price !== undefined || !partial) out.unit_price = money(body.unit_price, 'цена');
    if (body.discount_amount !== undefined) out.discount_amount = money(body.discount_amount || 0, 'скидка');
    if (body.is_additional !== undefined) out.is_additional = !!body.is_additional;
    return out;
}

export function parseStaff(staff) {
    if (staff === undefined) return undefined;
    if (!Array.isArray(staff)) throw new Error('Неверный список мастеров');
    const seen = new Set();
    const rows = staff.map((s) => {
        if (!s.staff_id || seen.has(s.staff_id)) throw new Error('Мастер указан дважды или не выбран');
        seen.add(s.staff_id);
        const share = Number(s.share_percent);
        if (!Number.isFinite(share) || share <= 0 || share > 100) throw new Error('Доля мастера должна быть от 1 до 100%');
        return { staff_id: s.staff_id, share_percent: Math.round(share * 100) / 100 };
    });
    if (rows.length && Math.abs(rows.reduce((sum, r) => sum + r.share_percent, 0) - 100) > 0.001) {
        throw new Error('Доли мастеров должны в сумме составлять 100%');
    }
    return rows;
}

async function replaceItemStaff(orgId, itemId, staff) {
    const { error: deleteError } = await supabase.from('crm_order_item_staff').delete().eq('order_item_id', itemId);
    if (deleteError) return deleteError;
    if (!staff.length) return null;
    const { error } = await supabase
        .from('crm_order_item_staff')
        .insert(staff.map((s) => ({ ...s, order_item_id: itemId, organization_id: orgId })));
    return error;
}

router.post('/:id/items', canEdit, async (req, res) => {
    const orgId = req.user.organizationId;
    let item;
    let staff;
    try {
        item = parseItemInput(req.body || {}, { partial: false });
        staff = parseStaff(req.body?.staff) || [];
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const order = await loadOrder(req, res);
    if (!order) return;
    // A line added after the car was accepted is an extra service.
    if (item.is_additional === undefined) item.is_additional = !['pending', 'accepted'].includes(order.status);

    const { data, error } = await supabase
        .from('crm_order_items')
        .insert({ ...item, order_id: order.id, organization_id: orgId })
        .select('id')
        .single();
    if (error) return sendDbError(res, error, 'Не удалось добавить услугу');
    const staffError = await replaceItemStaff(orgId, data.id, staff);
    if (staffError) {
        await supabase.from('crm_order_items').delete().eq('id', data.id);
        return sendDbError(res, staffError, 'Не удалось назначить мастеров');
    }
    await crmAudit(req, 'crm.order.item.create', 'crm_order', order.id, null, { ...item, staff });
    res.status(201).json({ item_id: data.id });
});

router.patch('/:id/items/:itemId', canEdit, async (req, res) => {
    const orgId = req.user.organizationId;
    let updates;
    let staff;
    try {
        updates = parseItemInput(req.body || {}, { partial: true });
        staff = parseStaff(req.body?.staff);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const { data: before, error: beforeError } = await supabase
        .from('crm_order_items')
        .select('*')
        .eq('id', req.params.itemId)
        .eq('order_id', req.params.id)
        .eq('organization_id', orgId)
        .maybeSingle();
    if (beforeError) return sendDbError(res, beforeError);
    if (!before) return res.status(404).json({ error: 'Услуга не найдена' });

    if (Object.keys(updates).length) {
        const { error } = await supabase.from('crm_order_items').update(updates).eq('id', before.id);
        if (error) return sendDbError(res, error, 'Не удалось сохранить услугу');
    }
    if (staff !== undefined) {
        const staffError = await replaceItemStaff(orgId, before.id, staff);
        if (staffError) return sendDbError(res, staffError, 'Не удалось назначить мастеров');
    }
    await crmAudit(req, 'crm.order.item.update', 'crm_order', req.params.id, before, { ...updates, staff });
    res.json({ ok: true });
});

router.delete('/:id/items/:itemId', canEdit, async (req, res) => {
    const { data: before, error: beforeError } = await supabase
        .from('crm_order_items')
        .select('*')
        .eq('id', req.params.itemId)
        .eq('order_id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (beforeError) return sendDbError(res, beforeError);
    if (!before) return res.status(404).json({ error: 'Услуга не найдена' });

    const { error } = await supabase.from('crm_order_items').delete().eq('id', before.id);
    if (error) return sendDbError(res, error, 'Не удалось удалить услугу');
    await crmAudit(req, 'crm.order.item.delete', 'crm_order', req.params.id, before, null);
    res.status(204).end();
});

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

router.post('/:id/materials', canEdit, async (req, res) => {
    const body = req.body || {};
    const material = {};
    try {
        material.name = cleanText(body.name, 200);
        if (!material.name) throw new Error('Укажите материал');
        material.quantity = money(body.quantity ?? 1, 'количество', { allowZero: false });
        material.unit = cleanText(body.unit, 20);
        material.unit_cost = money(body.unit_cost, 'стоимость');
        material.currency = body.currency || 'UZS';
        if (!CURRENCIES.includes(material.currency)) throw new Error('Неверная валюта');
        material.fx_rate = await rateOrDefault(material.currency, body.fx_rate);
        material.order_item_id = body.order_item_id || null;
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const order = await loadOrder(req, res);
    if (!order) return;

    const { data, error } = await supabase
        .from('crm_order_materials')
        .insert({ ...material, order_id: order.id, organization_id: req.user.organizationId, created_by: req.user.id })
        .select()
        .single();
    if (error) return sendDbError(res, error, 'Не удалось добавить материал');
    await crmAudit(req, 'crm.order.material.create', 'crm_order', order.id, null, data);
    res.status(201).json({ material: data });
});

router.delete('/:id/materials/:materialId', canEdit, async (req, res) => {
    const { data: before, error: beforeError } = await supabase
        .from('crm_order_materials')
        .select('*')
        .eq('id', req.params.materialId)
        .eq('order_id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (beforeError) return sendDbError(res, beforeError);
    if (!before) return res.status(404).json({ error: 'Материал не найден' });

    const { error } = await supabase.from('crm_order_materials').delete().eq('id', before.id);
    if (error) return sendDbError(res, error, 'Не удалось удалить материал');
    await crmAudit(req, 'crm.order.material.delete', 'crm_order', req.params.id, before, null);
    res.status(204).end();
});

// ---------------------------------------------------------------------------
// Money: payments, refunds, reversals, issue, reopen (all in SQL functions)
// ---------------------------------------------------------------------------

router.post('/:id/payments', requirePermission('payments.record'), async (req, res) => {
    const body = req.body || {};
    const kind = body.kind === 'refund' ? 'refund' : 'payment';
    const order = await loadOrder(req, res);
    if (!order) return;

    const { data: account, error: accountError } = await supabase
        .from('crm_accounts')
        .select('id, currency')
        .eq('id', body.account_id || '00000000-0000-0000-0000-000000000000')
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (accountError) return sendDbError(res, accountError);
    if (!account) return res.status(400).json({ error: 'Выберите кассу' });

    let amount;
    let fxRate;
    let orderFxRate;
    let occurredAt;
    try {
        occurredAt = isoOrNull(body.occurred_at);
        amount = money(body.amount, 'сумма', { allowZero: false });
        fxRate = await rateOrDefault(account.currency, body.fx_rate);
        orderFxRate = account.currency === order.currency ? null : await rateOrDefault(order.currency, body.order_fx_rate);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    const { data, error } = await supabase.rpc('crm_record_order_payment', {
        p_order_id: order.id,
        p_kind: kind,
        p_account_id: account.id,
        p_amount: amount,
        p_fx_rate: fxRate,
        p_order_fx_rate: orderFxRate,
        p_occurred_at: occurredAt,
        p_note: cleanText(body.note, 500),
        p_actor: req.user.id,
    });
    if (error) return sendDbError(res, error, 'Не удалось провести оплату');
    await crmAudit(req, kind === 'refund' ? 'crm.order.refund' : 'crm.order.payment', 'crm_order', order.id, null, data);
    res.status(201).json({ transaction: data });

    notifyLater(req.user.organizationId, 'payment', async () => {
        const { data: updated } = await supabase.from('crm_orders').select(ORDER_FIELDS).eq('id', order.id).single();
        return { text: paymentText({ order: updated, transaction: data, ...(await orderContext(updated)) }), link: `orders/${order.id}` };
    });
});

router.post('/:id/payments/:txId/reverse', requirePermission('finance.manage'), async (req, res) => {
    const { data: tx, error: txError } = await supabase
        .from('crm_transactions')
        .select('id, order_id')
        .eq('id', req.params.txId)
        .eq('order_id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (txError) return sendDbError(res, txError);
    if (!tx) return res.status(404).json({ error: 'Операция не найдена' });

    const reason = cleanText(req.body?.reason, 500);
    if (!reason) return res.status(400).json({ error: 'Укажите причину сторно' });
    const { data, error } = await supabase.rpc('crm_reverse_transaction', {
        p_transaction_id: tx.id,
        p_actor: req.user.id,
        p_reason: reason,
    });
    if (error) return sendDbError(res, error, 'Не удалось сторнировать операцию');
    await crmAudit(req, 'crm.transaction.reverse', 'crm_transaction', tx.id, null, data);
    res.status(201).json({ transaction: data });
});

router.post('/:id/issue', requirePermission('orders.issue'), async (req, res) => {
    const order = await loadOrder(req, res);
    if (!order) return;
    let fxRate;
    try {
        fxRate = await rateOrDefault(order.currency, req.body?.fx_rate);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const { data, error } = await supabase.rpc('crm_issue_order', {
        p_order_id: order.id,
        p_fx_rate: fxRate,
        p_issued_at: null,
        p_actor: req.user.id,
    });
    if (error) return sendDbError(res, error, 'Не удалось выдать заказ');
    await crmAudit(req, 'crm.order.issue', 'crm_order', order.id, order, data);
    res.json({ order: data });

    const orgId = req.user.organizationId;
    notifyLater(orgId, 'order_status', async () => ({
        text: orderIssuedText({ order: data, ...(await orderContext(data)) }),
        link: `orders/${data.id}`,
    }));
    if (Number(data.total) > Number(data.paid_amount)) {
        notifyLater(orgId, 'client_debt', async () => ({
            text: debtText({ order: data, ...(await orderContext(data)) }),
            link: `orders/${data.id}`,
        }));
    }
});

router.post('/:id/reopen', requirePermission('orders.issue'), async (req, res) => {
    const reason = cleanText(req.body?.reason, 500);
    if (!reason) return res.status(400).json({ error: 'Укажите причину' });
    const order = await loadOrder(req, res);
    if (!order) return;
    const { data, error } = await supabase.rpc('crm_reopen_order', {
        p_order_id: order.id,
        p_actor: req.user.id,
        p_reason: reason,
    });
    if (error) return sendDbError(res, error, 'Не удалось вернуть заказ в работу');
    await crmAudit(req, 'crm.order.reopen', 'crm_order', order.id, order, data);
    res.json({ order: data });
});

// ---------------------------------------------------------------------------
// Photos and comments
// ---------------------------------------------------------------------------

router.post('/:id/photos', canEdit, photoUpload.single('photo'), async (req, res) => {
    const orgId = req.user.organizationId;
    const stage = req.body?.stage;
    if (!PHOTO_STAGES.includes(stage)) return res.status(400).json({ error: 'Неверный этап фото' });
    if (!req.file) return res.status(400).json({ error: 'Фото не получено' });
    const order = await loadOrder(req, res);
    if (!order) return;

    let path;
    try {
        path = await uploadPhoto(`${orgId}/orders/${order.id}`, req.file);
    } catch (err) {
        console.error(err.message);
        return res.status(500).json({ error: 'Не удалось загрузить фото' });
    }
    const { data, error } = await supabase
        .from('crm_order_photos')
        .insert({ organization_id: orgId, order_id: order.id, stage, storage_path: path, uploaded_by: req.user.id })
        .select('id, stage, storage_path, created_at')
        .single();
    if (error) {
        await removePhoto(path).catch(() => {});
        return sendDbError(res, error, 'Не удалось сохранить фото');
    }
    const [photo] = await withSignedUrls([data]);
    res.status(201).json({ photo });
});

router.delete('/:id/photos/:photoId', canEdit, async (req, res) => {
    const { data: photo, error } = await supabase
        .from('crm_order_photos')
        .select('id, storage_path')
        .eq('id', req.params.photoId)
        .eq('order_id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (error) return sendDbError(res, error);
    if (!photo) return res.status(404).json({ error: 'Фото не найдено' });

    const { error: deleteError } = await supabase.from('crm_order_photos').delete().eq('id', photo.id);
    if (deleteError) return sendDbError(res, deleteError);
    await removePhoto(photo.storage_path).catch((err) => console.error('Photo file removal failed:', err.message));
    await crmAudit(req, 'crm.order.photo.delete', 'crm_order', req.params.id, { storage_path: photo.storage_path });
    res.status(204).end();
});

router.post('/:id/comments', canView, async (req, res) => {
    const body = cleanText(req.body?.body, 5000);
    if (!body) return res.status(400).json({ error: 'Комментарий пустой' });
    const { data, error } = await supabase
        .from('crm_order_comments')
        .insert({ organization_id: req.user.organizationId, order_id: req.params.id, author_id: req.user.id, body })
        .select('id, body, author_id, created_at')
        .single();
    if (error) return sendDbError(res, error, 'Не удалось добавить комментарий');
    res.status(201).json({ comment: data });
});

export default router;
