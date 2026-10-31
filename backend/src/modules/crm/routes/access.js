import { Router } from 'express';
import { supabase } from '../../../lib/supabase.js';
import { writeAuditLog } from '../../../lib/auditLog.js';
import { requirePermission } from '../middleware.js';
import { sendDbError } from '../lib/dbErrors.js';

const router = Router();

router.use(requirePermission('settings.manage'));

// Organization users with their CRM role, plus the roles to choose from.
router.get('/', async (req, res) => {
    const orgId = req.user.organizationId;
    const [users, roles, assignments] = await Promise.all([
        supabase.from('users').select('id, full_name, username, role, is_active').eq('organization_id', orgId).order('full_name'),
        supabase.from('crm_roles').select('id, key, name, permissions, is_system').eq('organization_id', orgId).order('created_at'),
        supabase.from('crm_user_roles').select('user_id, role_id').eq('organization_id', orgId),
    ]);
    const failed = [users, roles, assignments].find((r) => r.error);
    if (failed) return sendDbError(res, failed.error, 'Не удалось загрузить доступы');

    const roleByUser = new Map(assignments.data.map((a) => [a.user_id, a.role_id]));
    res.json({
        users: users.data.map((u) => ({ ...u, crm_role_id: roleByUser.get(u.id) || null })),
        roles: roles.data,
    });
});

// Body: { role_id } to grant or change, { role_id: null } to revoke.
router.put('/:userId', async (req, res) => {
    const orgId = req.user.organizationId;
    const roleId = req.body?.role_id ?? null;

    const { data: target, error: targetError } = await supabase
        .from('users')
        .select('id, role')
        .eq('id', req.params.userId)
        .eq('organization_id', orgId)
        .maybeSingle();
    if (targetError) return sendDbError(res, targetError);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
    if (target.role === 'owner') return res.status(400).json({ error: 'Владелец всегда имеет полный доступ' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'Нельзя менять собственный доступ' });

    const { data: before, error: beforeError } = await supabase
        .from('crm_user_roles')
        .select('role_id')
        .eq('user_id', target.id)
        .maybeSingle();
    if (beforeError) return sendDbError(res, beforeError);

    const result = roleId
        ? await supabase
              .from('crm_user_roles')
              .upsert({ user_id: target.id, organization_id: orgId, role_id: roleId }, { onConflict: 'user_id' })
        : await supabase.from('crm_user_roles').delete().eq('user_id', target.id).eq('organization_id', orgId);
    if (result.error) return sendDbError(res, result.error, 'Не удалось сохранить доступ');

    try {
        await writeAuditLog(req.user, {
            organizationId: orgId,
            action: roleId ? 'crm.access.grant' : 'crm.access.revoke',
            entityType: 'user',
            entityId: target.id,
            before: before ? { role_id: before.role_id } : null,
            after: roleId ? { role_id: roleId } : null,
        });
    } catch (err) {
        console.error('Audit log write failed:', err.message);
    }
    res.json({ user_id: target.id, crm_role_id: roleId });
});

export default router;
