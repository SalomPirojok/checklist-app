import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runMiddleware } from './helpers.js';

vi.mock('../src/lib/modules.js', () => ({ isModuleEnabled: vi.fn() }));

const { isModuleEnabled } = await import('../src/lib/modules.js');
const { requireModule } = await import('../src/middleware/requireModule.js');

const run = (user) => runMiddleware(requireModule('crm'), { user });

describe('requireModule', () => {
    beforeEach(() => {
        isModuleEnabled.mockReset();
    });

    it('passes when the module is enabled for the organization', async () => {
        isModuleEnabled.mockResolvedValue(true);
        const { next } = await run({ organizationId: 'org1' });
        expect(isModuleEnabled).toHaveBeenCalledWith('org1', 'crm');
        expect(next).toHaveBeenCalled();
    });

    it('blocks when the module is disabled', async () => {
        isModuleEnabled.mockResolvedValue(false);
        const { res, next } = await run({ organizationId: 'org1' });
        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('MODULE_DISABLED');
        expect(next).not.toHaveBeenCalled();
    });

    it('blocks a user without an organization', async () => {
        const { res } = await run({ organizationId: null });
        expect(res.statusCode).toBe(403);
        expect(isModuleEnabled).not.toHaveBeenCalled();
    });

    it('returns 500 when the lookup fails', async () => {
        isModuleEnabled.mockRejectedValue(new Error('db down'));
        const { res } = await run({ organizationId: 'org1' });
        expect(res.statusCode).toBe(500);
    });
});
