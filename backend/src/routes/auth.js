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

    // First time this telegram_id logs in: bootstrap a new organization and make them the owner.
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
            username: telegramUser.username || null,
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
