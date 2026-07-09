import jwt from 'jsonwebtoken';

const { JWT_SECRET } = process.env;

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in .env');
}

const EXPIRES_IN = '30d';

export function signAppToken(user) {
    return jwt.sign(
        {
            sub: user.id,
            telegramId: user.telegram_id,
            organizationId: user.organization_id,
            role: user.role,
        },
        JWT_SECRET,
        { expiresIn: EXPIRES_IN }
    );
}

export function verifyAppToken(token) {
    return jwt.verify(token, JWT_SECRET);
}
