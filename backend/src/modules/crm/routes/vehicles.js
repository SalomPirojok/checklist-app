import { Router } from 'express';
import { supabase } from '../../../lib/supabase.js';
import { requirePermission } from '../middleware.js';
import { crmAudit } from '../lib/audit.js';
import { sendDbError } from '../lib/dbErrors.js';
import { photoUpload, removePhoto, uploadPhoto, withSignedUrls } from '../lib/files.js';
import { cleanText, searchTerm } from '../lib/normalize.js';

const router = Router();

router.use(requirePermission('vehicles.manage', 'orders.manage'));

const VEHICLE_FIELDS = 'id, client_id, make, model, year, plate, color, vin, notes, is_archived, created_at';
const PAGE_SIZE = 50;

export function normalizePlate(input) {
    if (input === undefined || input === null) return null;
    const value = String(input).replace(/\s|-/g, '').toUpperCase();
    if (!value) return null;
    if (!/^[A-ZА-Я0-9]{4,12}$/.test(value)) throw new Error('Неверный госномер');
    return value;
}

function parseVehicleInput(body, { requireMake }) {
    const out = {};
    if (body.make !== undefined || requireMake) {
        out.make = cleanText(body.make, 60);
        if (!out.make) throw new Error('Укажите марку');
    }
    if (body.model !== undefined) out.model = cleanText(body.model, 60);
    if (body.year !== undefined) {
        if (body.year === '' || body.year === null) out.year = null;
        else {
            const year = Number(body.year);
            if (!Number.isInteger(year) || year < 1950 || year > 2100) throw new Error('Неверный год выпуска');
            out.year = year;
        }
    }
    if (body.plate !== undefined) out.plate = normalizePlate(body.plate);
    if (body.color !== undefined) out.color = cleanText(body.color, 40);
    if (body.vin !== undefined) {
        const vin = cleanText(body.vin, 17);
        out.vin = vin ? vin.toUpperCase() : null;
    }
    if (body.notes !== undefined) out.notes = cleanText(body.notes, 2000);
    return out;
}

async function plateTaken(orgId, plate, excludeId) {
    if (!plate) return null;
    let query = supabase
        .from('crm_vehicles')
        .select(VEHICLE_FIELDS)
        .eq('organization_id', orgId)
        .eq('plate', plate)
        .eq('is_archived', false)
        .limit(1);
    if (excludeId) query = query.neq('id', excludeId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data[0] || null;
}

router.get('/', async (req, res) => {
    const orgId = req.user.organizationId;
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    let query = supabase
        .from('crm_vehicles')
        .select(VEHICLE_FIELDS, { count: 'exact' })
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
    if (req.query.client_id) query = query.eq('client_id', req.query.client_id);
    const q = searchTerm(req.query.q);
    if (q) {
        const plate = q.replace(/\s|-/g, '').toUpperCase();
        query = query.or(`plate.ilike.%${plate}%,make.ilike.%${q}%,model.ilike.%${q}%,vin.ilike.%${plate}%`);
    }
    const { data: vehicles, error, count } = await query;
    if (error) return sendDbError(res, error, 'Не удалось загрузить автомобили');

    const clientIds = [...new Set(vehicles.map((v) => v.client_id))];
    const { data: clients, error: clientsError } = clientIds.length
        ? await supabase.from('crm_clients').select('id, first_name, last_name, phone').in('id', clientIds)
        : { data: [], error: null };
    if (clientsError) return sendDbError(res, clientsError);
    const clientMap = new Map(clients.map((c) => [c.id, c]));

    res.json({
        vehicles: vehicles.map((v) => ({ ...v, client: clientMap.get(v.client_id) || null })),
        total: count,
        page_size: PAGE_SIZE,
    });
});

router.get('/:id', async (req, res) => {
    const { data: vehicle, error } = await supabase
        .from('crm_vehicles')
        .select(VEHICLE_FIELDS)
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (error) return sendDbError(res, error);
    if (!vehicle) return res.status(404).json({ error: 'Автомобиль не найден' });

    const [client, photos, orders] = await Promise.all([
        supabase.from('crm_clients').select('id, first_name, last_name, phone, instagram_username').eq('id', vehicle.client_id).single(),
        supabase.from('crm_vehicle_photos').select('id, storage_path, created_at').eq('vehicle_id', vehicle.id).order('created_at'),
        supabase
            .from('crm_orders')
            .select('id, number, status, currency, total, received_at, issued_at, created_at')
            .eq('vehicle_id', vehicle.id)
            .order('created_at', { ascending: false }),
    ]);
    const failed = [client, photos, orders].find((r) => r.error);
    if (failed) return sendDbError(res, failed.error);

    // Service history: what was done on each order.
    const orderIds = orders.data.map((o) => o.id);
    const { data: items, error: itemsError } = orderIds.length
        ? await supabase.from('crm_order_items').select('order_id, name').in('order_id', orderIds).order('sort_order')
        : { data: [], error: null };
    if (itemsError) return sendDbError(res, itemsError);

    let signedPhotos;
    try {
        signedPhotos = await withSignedUrls(photos.data);
    } catch {
        return res.status(500).json({ error: 'Не удалось загрузить фото' });
    }

    res.json({
        vehicle,
        client: client.data,
        photos: signedPhotos,
        orders: orders.data.map((o) => ({ ...o, services: items.filter((i) => i.order_id === o.id).map((i) => i.name) })),
    });
});

router.post('/', async (req, res) => {
    const orgId = req.user.organizationId;
    let input;
    try {
        input = parseVehicleInput(req.body || {}, { requireMake: true });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const clientId = req.body?.client_id;
    if (!clientId) return res.status(400).json({ error: 'Укажите владельца' });

    try {
        const existing = await plateTaken(orgId, input.plate);
        if (existing) return res.status(409).json({ error: 'Автомобиль с таким номером уже есть', code: 'DUPLICATE_VEHICLE', vehicle: existing });
    } catch {
        return res.status(500).json({ error: 'Не удалось проверить номер' });
    }

    const { data, error } = await supabase
        .from('crm_vehicles')
        .insert({ ...input, client_id: clientId, organization_id: orgId })
        .select(VEHICLE_FIELDS)
        .single();
    if (error) return sendDbError(res, error, 'Не удалось добавить автомобиль');
    await crmAudit(req, 'crm.vehicle.create', 'crm_vehicle', data.id, null, data);
    res.status(201).json({ vehicle: data });
});

router.patch('/:id', async (req, res) => {
    const orgId = req.user.organizationId;
    let input;
    try {
        input = parseVehicleInput(req.body || {}, { requireMake: false });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    // Ownership change (car sold to another client) is allowed.
    if (req.body?.client_id) input.client_id = req.body.client_id;
    if (req.body?.is_archived !== undefined) input.is_archived = !!req.body.is_archived;
    if (!Object.keys(input).length) return res.status(400).json({ error: 'Нет полей для изменения' });

    const { data: before, error: beforeError } = await supabase
        .from('crm_vehicles')
        .select(VEHICLE_FIELDS)
        .eq('id', req.params.id)
        .eq('organization_id', orgId)
        .maybeSingle();
    if (beforeError) return sendDbError(res, beforeError);
    if (!before) return res.status(404).json({ error: 'Автомобиль не найден' });

    try {
        const existing = await plateTaken(orgId, input.plate, before.id);
        if (existing) return res.status(409).json({ error: 'Автомобиль с таким номером уже есть', code: 'DUPLICATE_VEHICLE', vehicle: existing });
    } catch {
        return res.status(500).json({ error: 'Не удалось проверить номер' });
    }

    const { data, error } = await supabase
        .from('crm_vehicles')
        .update(input)
        .eq('id', before.id)
        .eq('organization_id', orgId)
        .select(VEHICLE_FIELDS)
        .single();
    if (error) return sendDbError(res, error, 'Не удалось сохранить автомобиль');
    await crmAudit(req, 'crm.vehicle.update', 'crm_vehicle', data.id, before, data);
    res.json({ vehicle: data });
});

router.post('/:id/photos', photoUpload.single('photo'), async (req, res) => {
    const orgId = req.user.organizationId;
    if (!req.file) return res.status(400).json({ error: 'Фото не получено' });
    const { data: vehicle, error } = await supabase
        .from('crm_vehicles')
        .select('id')
        .eq('id', req.params.id)
        .eq('organization_id', orgId)
        .maybeSingle();
    if (error) return sendDbError(res, error);
    if (!vehicle) return res.status(404).json({ error: 'Автомобиль не найден' });

    let path;
    try {
        path = await uploadPhoto(`${orgId}/vehicles/${vehicle.id}`, req.file);
    } catch (err) {
        console.error(err.message);
        return res.status(500).json({ error: 'Не удалось загрузить фото' });
    }
    const { data, error: insertError } = await supabase
        .from('crm_vehicle_photos')
        .insert({ organization_id: orgId, vehicle_id: vehicle.id, storage_path: path, uploaded_by: req.user.id })
        .select('id, storage_path, created_at')
        .single();
    if (insertError) {
        await removePhoto(path).catch(() => {});
        return sendDbError(res, insertError, 'Не удалось сохранить фото');
    }
    const [photo] = await withSignedUrls([data]);
    res.status(201).json({ photo });
});

router.delete('/:id/photos/:photoId', async (req, res) => {
    const { data: photo, error } = await supabase
        .from('crm_vehicle_photos')
        .select('id, storage_path')
        .eq('id', req.params.photoId)
        .eq('vehicle_id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (error) return sendDbError(res, error);
    if (!photo) return res.status(404).json({ error: 'Фото не найдено' });

    const { error: deleteError } = await supabase.from('crm_vehicle_photos').delete().eq('id', photo.id);
    if (deleteError) return sendDbError(res, deleteError);
    await removePhoto(photo.storage_path).catch((err) => console.error('Photo file removal failed:', err.message));
    await crmAudit(req, 'crm.vehicle.photo.delete', 'crm_vehicle', req.params.id, { storage_path: photo.storage_path });
    res.status(204).end();
});

export default router;
