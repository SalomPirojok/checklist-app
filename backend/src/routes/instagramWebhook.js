import express, { Router } from 'express';
import crypto from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { parseWebhook, verifySignature } from '../modules/crm/lib/instagram.js';
import { processInstagramMessage } from '../modules/crm/lib/instagramInbox.js';

// Public endpoint Meta calls; authenticated by the HMAC signature, not by a
// user session. Mounted before express.json() so the raw body is available.
const router = Router();

// Subscription handshake when the webhook URL is saved in the Meta app.
router.get('/', (req, res) => {
    const verifyToken = process.env.META_VERIFY_TOKEN;
    if (verifyToken && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === verifyToken) {
        return res.status(200).send(String(req.query['hub.challenge'] || ''));
    }
    res.sendStatus(403);
});

router.post('/', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret || !verifySignature(req.body, req.get('x-hub-signature-256'), appSecret)) {
        return res.sendStatus(401);
    }
    let body;
    try {
        body = JSON.parse(req.body.toString('utf8'));
    } catch {
        return res.sendStatus(400);
    }

    // Keep the raw event first, so nothing is lost if processing fails, and
    // a redelivery is recognized by its hash.
    const eventId = crypto.createHash('sha256').update(req.body).digest('hex');
    const { error: storeError } = await supabase
        .from('crm_webhook_events')
        .upsert({ provider: 'instagram', external_event_id: eventId, payload: body }, { onConflict: 'provider,external_event_id', ignoreDuplicates: true });
    if (storeError) console.error('Instagram webhook store failed:', storeError.message);

    // Meta expects a fast 200; process after answering.
    res.sendStatus(200);

    const errors = [];
    for (const item of parseWebhook(body)) {
        try {
            await processInstagramMessage(item);
        } catch (err) {
            errors.push(err.message);
            console.error('Instagram message processing failed:', err.message);
        }
    }
    await supabase
        .from('crm_webhook_events')
        .update({ processed_at: new Date().toISOString(), error: errors.join('; ') || null })
        .eq('provider', 'instagram')
        .eq('external_event_id', eventId);
});

export default router;
