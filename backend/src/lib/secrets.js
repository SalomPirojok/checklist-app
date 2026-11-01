import crypto from 'node:crypto';

// AES-256-GCM for third-party tokens stored in the database. The key comes
// from CRM_ENCRYPTION_KEY (any long random string; hashed to 32 bytes), so a
// database leak alone doesn't expose live Instagram access.
function key() {
    const secret = process.env.CRM_ENCRYPTION_KEY;
    if (!secret || secret.length < 16) throw new Error('CRM_ENCRYPTION_KEY is not configured');
    return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptSecret(payload) {
    const [version, iv, tag, data] = String(payload).split(':');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported secret format');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
