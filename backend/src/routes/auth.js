import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { validateTelegramInitData } from '../lib/telegramAuth.js';
import { signAppToken } from '../lib/jwt.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.post('/telegram', async (req, res) => {
    const { initData } = req.body || {};
    const botToken = process.env.BOT_TOKEN;

    if (!botToken) {
        return res.status(500).json({ error: 'BOT_TOKEN is not configured on the server' });
    }

    const telegramUser = validateTelegramInitData(initData, botToken);
    if (!telegramUser) {
        return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    const telegramId = telegramUser.id;
    const fullName = [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ') || 'Без имени';
    const telegramUsername = telegramUser.username || null;

    // 1. Already linked: log straight in.
    const { data: existingUser, error: lookupError } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .maybeSingle();
    if (lookupError) {
        return res.status(500).json({ error: 'Failed to look up user' });
    }
    if (existingUser) {
        if (!existingUser.is_active) {
            return res.status(403).json({ error: 'User is deactivated' });
        }
        const token = signAppToken(existingUser);
        return res.json({ token, user: existingUser });
    }

    // 2. Not linked yet: maybe the owner pre-added this person by username, before
    // they ever opened the bot. Claim that pending row instead of creating a new one.
    if (telegramUsername) {
        const { data: pendingUser, error: pendingError } = await supabase
            .from('users')
            .select('*')
            .is('telegram_id', null)
            .ilike('username', telegramUsername)
            .maybeSingle();
        if (pendingError) {
            return res.status(500).json({ error: 'Failed to look up pending invite' });
        }
        if (pendingUser) {
            if (!pendingUser.is_active) {
                return res.status(403).json({ error: 'User is deactivated' });
            }
            // Atomic claim: only succeeds if nobody else claimed this row first.
            const { data: claimedUser, error: claimError } = await supabase
                .from('users')
                .update({ telegram_id: telegramId })
                .eq('id', pendingUser.id)
                .is('telegram_id', null)
                .select()
                .maybeSingle();
            if (claimError) {
                if (claimError.code === '23505') {
                    return res.status(409).json({ error: 'This Telegram account is already linked to another user' });
                }
                return res.status(500).json({ error: 'Failed to link Telegram account' });
            }
            if (claimedUser) {
                const token = signAppToken(claimedUser);
                return res.json({ token, user: claimedUser });
            }
            // Someone else claimed it a moment earlier — fall through to the "not found" checks below.
        }
    }

    // 3. Nobody matched. Only the very first user of the whole deployment gets to
    // self-provision a new organization; everyone after that must be invited.
    const { count: organizationCount, error: countError } = await supabase
        .from('organizations')
        .select('*', { count: 'exact', head: true });
    if (countError) {
        return res.status(500).json({ error: 'Failed to check existing organizations' });
    }

    if (organizationCount > 0) {
        return res.status(404).json({
            error: 'Пользователь не найден. Обратитесь к владельцу вашей организации, чтобы вас добавили.',
        });
    }

    const { data: newOrg, error: orgError } = await supabase
        .from('organizations')
        .insert({ name: `${fullName} — организация` })
        .select()
        .single();
    if (orgError) {
        return res.status(500).json({ error: 'Failed to create organization' });
    }

    const { data: newUser, error: userError } = await supabase
        .from('users')
        .insert({
            telegram_id: telegramId,
            full_name: fullName,
            username: telegramUsername,
            role: 'owner',
            organization_id: newOrg.id,
        })
        .select()
        .single();

    if (userError) {
        // Lost a race with a concurrent request for the same telegram_id (e.g. a
        // duplicate double-fired request): the other request already created the
        // user, so drop our now-orphaned organization and log this user in instead.
        if (userError.code === '23505') {
            await supabase.from('organizations').delete().eq('id', newOrg.id);
            const { data: raceWinnerUser, error: refetchError } = await supabase
                .from('users')
                .select('*')
                .eq('telegram_id', telegramId)
                .maybeSingle();
            if (!refetchError && raceWinnerUser) {
                const token = signAppToken(raceWinnerUser);
                return res.json({ token, user: raceWinnerUser });
            }
        }
        await supabase.from('organizations').delete().eq('id', newOrg.id);
        return res.status(500).json({ error: 'Failed to create user' });
    }

    const token = signAppToken(newUser);
    return res.status(201).json({ token, user: newUser });
});

router.get('/me', requireAuth, async (req, res) => {
    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', req.user.id)
        .maybeSingle();

    if (error || !user) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
});

export default router;
