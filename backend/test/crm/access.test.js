import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runMiddleware } from '../helpers.js';

vi.mock('../../src/modules/crm/lib/access.js', async (importOriginal) => ({
    ...(await importOriginal()),
    loadCrmAccess: vi.fn(),
}));

const { loadCrmAccess, CRM_PERMISSIONS } = await import('../../src/modules/crm/lib/access.js');
const { requireCrmAccess, requirePermission } = await import('../../src/modules/crm/middleware.js');

describe('requireCrmAccess', () => {
    beforeEach(() => {
        loadCrmAccess.mockReset();
    });

    it('attaches the role and permissions', async () => {
        loadCrmAccess.mockResolvedValue({ role: { key: 'manager' }, permissions: ['leads.manage'] });
        const { req, next } = await runMiddleware(requireCrmAccess, { user: { id: 'u1' } });
        expect(next).toHaveBeenCalled();
        expect(req.crm.permissions).toEqual(['leads.manage']);
    });

    it('blocks users without a CRM role', async () => {
        loadCrmAccess.mockResolvedValue(null);
        const { res, next } = await runMiddleware(requireCrmAccess, { user: { id: 'u1' } });
        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('CRM_NO_ACCESS');
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 500 when access cannot be loaded', async () => {
        loadCrmAccess.mockRejectedValue(new Error('db down'));
        const { res } = await runMiddleware(requireCrmAccess, { user: { id: 'u1' } });
        expect(res.statusCode).toBe(500);
    });
});

describe('requirePermission', () => {
    it('passes with any one of the listed permissions', async () => {
        const { next } = await runMiddleware(requirePermission('clients.manage', 'leads.manage'), {
            crm: { permissions: ['leads.manage'] },
        });
        expect(next).toHaveBeenCalled();
    });

    it('blocks without them', async () => {
        const { res, next } = await runMiddleware(requirePermission('finance.view'), {
            crm: { permissions: ['leads.manage'] },
        });
        expect(res.statusCode).toBe(403);
        expect(next).not.toHaveBeenCalled();
    });
});

describe('loadCrmAccess (real implementation)', () => {
    it('gives the organization owner every permission without a lookup', async () => {
        const { loadCrmAccess: real } = await vi.importActual('../../src/modules/crm/lib/access.js');
        const access = await real({ id: 'o1', role: 'owner', organizationId: 'org1' });
        expect(access.permissions).toEqual(CRM_PERMISSIONS);
    });
});
