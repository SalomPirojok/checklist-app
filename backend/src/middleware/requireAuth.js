import { verifyAppToken } from '../lib/jwt.js';

export function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    try {
        const payload = verifyAppToken(token);
        req.user = {
            id: payload.sub,
            telegramId: payload.telegramId,
            organizationId: payload.organizationId,
            role: payload.role,
        };
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}
