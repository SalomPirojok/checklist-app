import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isOutsideWindow, parseWebhook, verifySignature } from '../../src/modules/crm/lib/instagram.js';
import { messageNewText } from '../../src/modules/crm/lib/notifyText.js';

describe('secrets', () => {
    it('round-trips and rejects tampering', async () => {
        process.env.CRM_ENCRYPTION_KEY = 'test-encryption-key-123456';
        const { encryptSecret, decryptSecret } = await import('../../src/lib/secrets.js');
        const sealed = encryptSecret('IGAAtoken');
        expect(sealed).not.toContain('IGAAtoken');
        expect(decryptSecret(sealed)).toBe('IGAAtoken');
        const parts = sealed.split(':');
        parts[3] = Buffer.from('other').toString('base64');
        expect(() => decryptSecret(parts.join(':'))).toThrow();
    });
});

describe('verifySignature', () => {
    const body = Buffer.from('{"object":"instagram"}');
    const sign = (secret) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

    it('accepts the app secret signature only', () => {
        expect(verifySignature(body, sign('app-secret'), 'app-secret')).toBe(true);
        expect(verifySignature(body, sign('other'), 'app-secret')).toBe(false);
        expect(verifySignature(body, 'sha256=zz', 'app-secret')).toBe(false);
        expect(verifySignature(body, undefined, 'app-secret')).toBe(false);
    });
});

describe('parseWebhook', () => {
    const payload = {
        object: 'instagram',
        entry: [
            {
                id: '1784',
                time: 1,
                messaging: [
                    {
                        sender: { id: '555' },
                        recipient: { id: '1784' },
                        timestamp: 1761990000000,
                        message: { mid: 'm1', text: 'Сколько стоит PPF?' },
                        referral: { ad_id: 120210, source: 'ADS', type: 'OPEN_THREAD', ads_context_data: { ad_title: 'PPF -20%' } },
                    },
                    { sender: { id: '1784' }, recipient: { id: '555' }, message: { mid: 'm2', text: 'Здравствуйте!', is_echo: true } },
                    { sender: { id: '555' }, recipient: { id: '1784' }, message: { mid: 'm3', attachments: [{ type: 'image', payload: { url: 'https://x/y.jpg' } }] } },
                    { sender: { id: '555' }, recipient: { id: '1784' }, read: { mid: 'm1' } },
                ],
            },
        ],
    };

    it('extracts messages, echoes, attachments and ad referrals; skips read receipts', () => {
        const items = parseWebhook(payload);
        expect(items).toHaveLength(3);
        expect(items[0]).toMatchObject({
            accountId: '1784',
            senderId: '555',
            mid: 'm1',
            text: 'Сколько стоит PPF?',
            isEcho: false,
            referral: { ad_id: '120210', source: 'ADS', ad_title: 'PPF -20%' },
        });
        expect(items[1]).toMatchObject({ mid: 'm2', isEcho: true, recipientId: '555' });
        expect(items[2].attachments).toEqual([{ type: 'image', url: 'https://x/y.jpg' }]);
    });

    it('ignores other objects', () => {
        expect(parseWebhook({ object: 'page', entry: [] })).toEqual([]);
    });
});

describe('helpers', () => {
    it('detects the 24h window error', () => {
        expect(isOutsideWindow({ code: 10, message: 'x' })).toBe(true);
        expect(isOutsideWindow({ code: 100, error_subcode: 1, message: 'x' })).toBe(false);
    });

    it('formats a new message notification', () => {
        expect(messageNewText({ client: { first_name: 'Азиз', instagram_username: 'aziz' }, text: 'Привет' })).toBe('💬 Азиз (@aziz)\nПривет');
        expect(messageNewText({ client: { first_name: 'Азиз' }, text: null, attachments: [{ type: 'image' }] })).toContain('[вложение: image]');
    });
});

// The public endpoint with the database and processing stubbed out.
vi.mock('../../src/modules/crm/lib/instagramInbox.js', () => ({ processInstagramMessage: vi.fn().mockResolvedValue({}) }));
vi.mock('../../src/lib/supabase.js', () => {
    const chain = new Proxy(() => {}, {
        get: (target, prop) => (prop === 'then' ? (resolve) => resolve({ data: null, error: null }) : () => chain),
        apply: () => chain,
    });
    return { supabase: { from: () => chain } };
});

describe('Instagram webhook endpoint', () => {
    let server;
    let base;
    beforeAll(async () => {
        process.env.META_APP_SECRET = 'app-secret';
        process.env.META_VERIFY_TOKEN = 'verify-me';
        const express = (await import('express')).default;
        const router = (await import('../../src/routes/instagramWebhook.js')).default;
        const app = express();
        app.use('/hook', router);
        app.use(express.json());
        await new Promise((resolve) => {
            server = app.listen(0, resolve);
        });
        base = `http://127.0.0.1:${server.address().port}/hook`;
    });
    afterAll(() => server?.close());

    it('answers the subscription handshake only with the right verify token', async () => {
        const ok = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42`);
        expect(ok.status).toBe(200);
        expect(await ok.text()).toBe('42');
        expect((await fetch(`${base}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42`)).status).toBe(403);
    });

    it('rejects unsigned posts and processes signed ones', async () => {
        const { processInstagramMessage } = await import('../../src/modules/crm/lib/instagramInbox.js');
        const body = JSON.stringify({ object: 'instagram', entry: [{ id: '1', messaging: [{ sender: { id: '2' }, recipient: { id: '1' }, message: { mid: 'x', text: 'hi' } }] }] });
        const bad = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' }, body });
        expect(bad.status).toBe(401);

        const signature = `sha256=${crypto.createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
        const good = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body });
        expect(good.status).toBe(200);
        await vi.waitFor(() => expect(processInstagramMessage).toHaveBeenCalledWith(expect.objectContaining({ mid: 'x', text: 'hi' })));
    });
});
