export function requirePlatformAdmin(req, res, next) {
    if (!req.user?.isPlatformAdmin) {
        return res.status(403).json({ error: 'Platform admin access required' });
    }
    next();
}
