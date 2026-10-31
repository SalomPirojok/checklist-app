import { verifyAppToken } from '../lib/jwt.js';
import { loadAuthState } from '../lib/authState.js';

export async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    let payload;
    try {
        payload = verifyAppToken(token);
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = {
        id: payload.sub,
        telegramId: payload.telegramId,
        organizationId: payload.organizationId,
        role: payload.role,
        isPlatformAdmin: !!payload.isPlatformAdmin,
    };

    // A platform admin with no organization membership has no users row to
    // re-check -- their access comes from PLATFORM_ADMIN_TELEGRAM_IDS alone.
    if (!payload.organizationId) return next();

    let state;
    try {
        state = await loadAuthState(payload.sub);
    } catch {
        return res.status(500).json({ error: 'Failed to verify user' });
    }
    if (!state || !state.isActive) {
        return res.status(401).json({ error: 'User is deactivated', code: 'USER_INACTIVE' });
    }
    if (state.isOrgSuspended) {
        return res.status(403).json({
            error: 'Доступ временно приостановлен, обратитесь к администратору.',
            code: 'ORG_SUSPENDED',
        });
    }

    // Current values win over the token's: a demoted manager or a user moved
    // to another organization must not keep their old access for 30 days.
    req.user.role = state.role;
    req.user.organizationId = state.organizationId;
    next();
}
