import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { validateTelegramInitData } from '../lib/telegramAuth.js';
import { signAppToken, signPlatformAdminToken } from '../lib/jwt.js';
import { isPlatformAdminTelegramId } from '../lib/platformAdmin.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

function deriveIdentity(initData, botToken) {
    const telegramUser = validateTelegramInitData(initData, botToken);
    if (!telegramUser) return null;
    return {
        telegramId: telegramUser.id,
        fullName: [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ') || 'Без имени',
        username: telegramUser.username || null,
    };
}

router.post('/telegram', async (req, res) => {
    const { initData } = req.body || {};
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
        return res.status(500).json({ error: 'BOT_TOKEN is not configured on the server' });
    }

    const identity = deriveIdentity(initData, botToken);
    if (!identity) {
        return res.status(401).json({ error: 'Invalid Telegram initData' });
    }
    const { telegramId, fullName, username: telegramUsername } = identity;
    const isPlatformAdmin = isPlatformAdminTelegramId(telegramId);

    // 1. Already linked: log straight in.
    const { data: existingUser, error: lookupError } = await supabase
        .from('users')
        .select('*, organization:organizations(is_suspended)')
        .eq('telegram_id', telegramId)
        .maybeSingle();
    if (lookupError) {
        return res.status(500).json({ error: 'Failed to look up user' });
    }
    if (existingUser) {
        if (!existingUser.is_active) {
            return res.status(403).json({ error: 'User is deactivated' });
        }
        if (existingUser.organization?.is_suspended) {
            return res.status(403).json({
                error: 'Доступ временно приостановлен, обратитесь к администратору.',
                code: 'ORG_SUSPENDED',
            });
        }
        const { organization, ...userRow } = existingUser;
        const token = signAppToken(userRow, isPlatformAdmin);
        return res.json({ token, user: { ...userRow, is_platform_admin: isPlatformAdmin } });
    }

    // 2. Not linked yet: maybe an owner pre-added this person by username, before
    // they ever opened the bot. Claim that pending row instead of creating a new one.
    if (telegramUsername) {
        const { data: pendingUser, error: pendingError } = await supabase
            .from('users')
            .select('*, organization:organizations(is_suspended)')
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
            if (pendingUser.organization?.is_suspended) {
                return res.status(403).json({
                    error: 'Доступ временно приостановлен, обратитесь к администратору.',
                    code: 'ORG_SUSPENDED',
                });
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
                const token = signAppToken(claimedUser, isPlatformAdmin);
                return res.json({ token, user: { ...claimedUser, is_platform_admin: isPlatformAdmin } });
            }
            // Someone else claimed it a moment earlier — fall through to the "not found" checks below.
        }
    }

    // 3. Nobody matched. A platform admin always gets in (to the admin panel),
    // even with no organization membership at all.
    if (isPlatformAdmin) {
        const token = signPlatformAdminToken(telegramId);
        return res.json({
            token,
            user: {
                id: null,
                telegram_id: telegramId,
                full_name: fullName,
                username: telegramUsername,
                role: null,
                organization_id: null,
                is_active: true,
                is_platform_admin: true,
            },
        });
    }

    // Everyone else sees an explicit "not registered" screen with the option to
    // self-provision a new organization -- no access is granted without that
    // deliberate action.
    return res.status(404).json({
        error: 'Вы пока не состоите ни в одной организации.',
        code: 'NOT_REGISTERED',
    });
});

// Explicit, user-initiated self-registration: creates a brand-new organization
// with the caller as its owner. Never triggered implicitly by /telegram.
router.post('/register-organization', async (req, res) => {
    const { initData, organization_name } = req.body || {};
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
        return res.status(500).json({ error: 'BOT_TOKEN is not configured on the server' });
    }

    const identity = deriveIdentity(initData, botToken);
    if (!identity) {
        return res.status(401).json({ error: 'Invalid Telegram initData' });
    }
    const { telegramId, fullName, username: telegramUsername } = identity;
    const isPlatformAdmin = isPlatformAdminTelegramId(telegramId);

    // Re-check for a race: someone may have invited or registered this
    // telegram_id in the time between the "not registered" screen and this click.
    const { data: existingUser, error: lookupError } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .maybeSingle();
    if (lookupError) return res.status(500).json({ error: 'Failed to look up user' });
    if (existingUser) {
        if (!existingUser.is_active) return res.status(403).json({ error: 'User is deactivated' });
        const token = signAppToken(existingUser, isPlatformAdmin);
        return res.json({ token, user: { ...existingUser, is_platform_admin: isPlatformAdmin } });
    }
    if (telegramUsername) {
        const { data: pendingUser, error: pendingError } = await supabase
            .from('users')
            .select('*')
            .is('telegram_id', null)
            .ilike('username', telegramUsername)
            .maybeSingle();
        if (pendingError) return res.status(500).json({ error: 'Failed to look up pending invite' });
        if (pendingUser) {
            const { data: claimedUser, error: claimError } = await supabase
                .from('users')
                .update({ telegram_id: telegramId })
                .eq('id', pendingUser.id)
                .is('telegram_id', null)
                .select()
                .maybeSingle();
            if (!claimError && claimedUser) {
                const token = signAppToken(claimedUser, isPlatformAdmin);
                return res.json({ token, user: { ...claimedUser, is_platform_admin: isPlatformAdmin } });
            }
        }
    }

    const orgName = (organization_name && organization_name.trim()) || `${fullName} — организация`;
    const { data: newOrg, error: orgError } = await supabase
        .from('organizations')
        .insert({ name: orgName })
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
        // Lost a race with a concurrent request for the same telegram_id: the
        // other request already created the user, so drop our now-orphaned
        // organization and log this user in instead.
        if (userError.code === '23505') {
            await supabase.from('organizations').delete().eq('id', newOrg.id);
            const { data: raceWinnerUser, error: refetchError } = await supabase
                .from('users')
                .select('*')
                .eq('telegram_id', telegramId)
                .maybeSingle();
            if (!refetchError && raceWinnerUser) {
                const token = signAppToken(raceWinnerUser, isPlatformAdmin);
                return res.json({ token, user: { ...raceWinnerUser, is_platform_admin: isPlatformAdmin } });
            }
        }
        await supabase.from('organizations').delete().eq('id', newOrg.id);
        return res.status(500).json({ error: 'Failed to create user' });
    }

    const token = signAppToken(newUser, isPlatformAdmin);
    return res.status(201).json({ token, user: { ...newUser, is_platform_admin: isPlatformAdmin } });
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
