import { Router } from 'express';
import { supabase } from '../../../lib/supabase.js';
import { requirePermission } from '../middleware.js';
import { crmAudit } from '../lib/audit.js';
import { sendDbError } from '../lib/dbErrors.js';
import { cleanText, normalizePhone } from '../lib/normalize.js';

const router = Router();

const PAY_SCHEMES = ['commission', 'salary', 'salary_plus_commission'];
const STAFF_FIELDS = 'id, user_id, full_name, phone, position, specialization, pay_scheme, base_salary, is_active, hired_on, notes, created_at';

function parseStaffInput(body, { requireName }) {
    const out = {};
    if (body.full_name !== undefined || requireName) {
        out.full_name = cleanText(body.full_name, 150);
        if (!out.full_name) throw new Error('Укажите имя сотрудника');
    }
    if (body.phone !== undefined) out.phone = normalizePhone(body.phone);
    if (body.position !== undefined) out.position = cleanText(body.position, 100);
    if (body.specialization !== undefined) out.specialization = cleanText(body.specialization, 200);
    if (body.pay_scheme !== undefined) {
        if (!PAY_SCHEMES.includes(body.pay_scheme)) throw new Error('Неверная система оплаты');
        out.pay_scheme = body.pay_scheme;
    }
    if (body.base_salary !== undefined) {
        const salary = Number(body.base_salary || 0);
        if (!Number.isFinite(salary) || salary < 0) throw new Error('Неверный оклад');
        out.base_salary = salary;
    }
    if (body.is_active !== undefined) out.is_active = !!body.is_active;
    if (body.hired_on !== undefined) out.hired_on = body.hired_on || null;
    if (body.notes !== undefined) out.notes = cleanText(body.notes, 2000);
    return out;
}

// Anyone working with orders needs the list of masters to assign them.
router.get('/', requirePermission('staff.manage', 'orders.manage'), async (req, res) => {
    const { data, error } = await supabase
        .from('crm_staff')
        .select(STAFF_FIELDS)
        .eq('organization_id', req.user.organizationId)
        .order('is_active', { ascending: false })
        .order('full_name');
    if (error) return sendDbError(res, error, 'Не удалось загрузить сотрудников');
    res.json({ staff: data });
});

router.get('/:id', requirePermission('staff.manage'), async (req, res) => {
    const { data, error } = await supabase
        .from('crm_staff')
        .select(STAFF_FIELDS)
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (error) return sendDbError(res, error);
    if (!data) return res.status(404).json({ error: 'Сотрудник не найден' });
    res.json({ staff: data });
});

router.post('/', requirePermission('staff.manage'), async (req, res) => {
    let input;
    try {
        input = parseStaffInput(req.body || {}, { requireName: true });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    const { data, error } = await supabase
        .from('crm_staff')
        .insert({ ...input, organization_id: req.user.organizationId })
        .select(STAFF_FIELDS)
        .single();
    if (error) return sendDbError(res, error, 'Не удалось создать сотрудника');
    await crmAudit(req, 'crm.staff.create', 'crm_staff', data.id, null, data);
    res.status(201).json({ staff: data });
});

router.patch('/:id', requirePermission('staff.manage'), async (req, res) => {
    let input;
    try {
        input = parseStaffInput(req.body || {}, { requireName: false });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
    if (!Object.keys(input).length) return res.status(400).json({ error: 'Нет полей для изменения' });

    const { data: before, error: beforeError } = await supabase
        .from('crm_staff')
        .select(STAFF_FIELDS)
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (beforeError) return sendDbError(res, beforeError);
    if (!before) return res.status(404).json({ error: 'Сотрудник не найден' });

    const { data, error } = await supabase
        .from('crm_staff')
        .update(input)
        .eq('id', before.id)
        .eq('organization_id', req.user.organizationId)
        .select(STAFF_FIELDS)
        .single();
    if (error) return sendDbError(res, error, 'Не удалось сохранить сотрудника');
    await crmAudit(req, 'crm.staff.update', 'crm_staff', data.id, before, data);
    res.json({ staff: data });
});

export default router;
