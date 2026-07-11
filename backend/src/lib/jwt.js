import jwt from 'jsonwebtoken';

const { JWT_SECRET } = process.env;

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in .env');
}

const EXPIRES_IN = '30d';

export function signAppToken(user, isPlatformAdmin = false) {
    return jwt.sign(
        {
            sub: user.id,
            telegramId: user.telegram_id,
            organizationId: user.organization_id,
            role: user.role,
            isPlatformAdmin: !!isPlatformAdmin,
        },
        JWT_SECRET,
        { expiresIn: EXPIRES_IN }
    );
}

// For a platform admin who isn't (yet, or ever) a member of any organization --
// carries no organizationId/role, only enough identity to reach admin-only routes.
export function signPlatformAdminToken(telegramId) {
    return jwt.sign(
        {
            sub: `platform-admin:${telegramId}`,
            telegramId,
            organizationId: null,
            role: null,
            isPlatformAdmin: true,
        },
        JWT_SECRET,
        { expiresIn: EXPIRES_IN }
    );
}

export function verifyAppToken(token) {
    return jwt.verify(token, JWT_SECRET);
}
