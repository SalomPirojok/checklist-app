import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runMiddleware } from './helpers.js';

vi.mock('../src/lib/authState.js', () => ({ loadAuthState: vi.fn() }));

const { loadAuthState } = await import('../src/lib/authState.js');
const { requireAuth } = await import('../src/middleware/requireAuth.js');
const { signAppToken, signPlatformAdminToken } = await import('../src/lib/jwt.js');

const run = (token) => runMiddleware(requireAuth, { headers: token ? { authorization: `Bearer ${token}` } : {} });

const tokenUser = { id: 'u1', telegram_id: 1, organization_id: 'org1', role: 'manager' };

describe('requireAuth', () => {
    beforeEach(() => {
        loadAuthState.mockReset();
    });

    it('rejects a missing header', async () => {
        const { res, next } = await run(null);
        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects an invalid token', async () => {
        const { res } = await run('garbage');
        expect(res.statusCode).toBe(401);
    });

    it('lets an active user through with current role and org from the database', async () => {
        loadAuthState.mockResolvedValue({ role: 'employee', organizationId: 'org2', isActive: true, isOrgSuspended: false });
        const { req, next } = await run(signAppToken(tokenUser));
        expect(next).toHaveBeenCalled();
        expect(req.user).toMatchObject({ id: 'u1', role: 'employee', organizationId: 'org2' });
    });

    it('blocks a user deactivated after the token was issued', async () => {
        loadAuthState.mockResolvedValue({ role: 'manager', organizationId: 'org1', isActive: false, isOrgSuspended: false });
        const { res, next } = await run(signAppToken(tokenUser));
        expect(res.statusCode).toBe(401);
        expect(res.body.code).toBe('USER_INACTIVE');
        expect(next).not.toHaveBeenCalled();
    });

    it('blocks a deleted user', async () => {
        loadAuthState.mockResolvedValue(null);
        const { res } = await run(signAppToken(tokenUser));
        expect(res.statusCode).toBe(401);
    });

    it('blocks users of a suspended organization', async () => {
        loadAuthState.mockResolvedValue({ role: 'manager', organizationId: 'org1', isActive: true, isOrgSuspended: true });
        const { res } = await run(signAppToken(tokenUser));
        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('ORG_SUSPENDED');
    });

    it('returns 500 when the state lookup fails', async () => {
        loadAuthState.mockRejectedValue(new Error('db down'));
        const { res, next } = await run(signAppToken(tokenUser));
        expect(res.statusCode).toBe(500);
        expect(next).not.toHaveBeenCalled();
    });

    it('lets an org-less platform admin through without a database lookup', async () => {
        const { req, next } = await run(signPlatformAdminToken(777));
        expect(next).toHaveBeenCalled();
        expect(loadAuthState).not.toHaveBeenCalled();
        expect(req.user.isPlatformAdmin).toBe(true);
    });
});
