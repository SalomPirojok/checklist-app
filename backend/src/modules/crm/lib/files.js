import crypto from 'node:crypto';
import multer from 'multer';
import { supabase } from '../../../lib/supabase.js';

// Car and order photos show client property and plates, so unlike the
// Kontrolla buckets this one is private: files are read through short-lived
// signed URLs only.
const BUCKET = 'crm-photos';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const MIME_EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
};

export const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!MIME_EXTENSIONS[file.mimetype]) return cb(new Error('Поддерживаются только фото (JPEG, PNG, WebP, HEIC)'));
        cb(null, true);
    },
});

let bucketReady = false;

async function ensureBucket() {
    if (bucketReady) return;
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) throw new Error(`Failed to list storage buckets: ${error.message}`);
    if (!buckets.some((b) => b.name === BUCKET)) {
        const { error: createError } = await supabase.storage.createBucket(BUCKET, {
            public: false,
            fileSizeLimit: '10MB',
            allowedMimeTypes: Object.keys(MIME_EXTENSIONS),
        });
        if (createError) throw new Error(`Failed to create storage bucket: ${createError.message}`);
    }
    bucketReady = true;
}

// folder: e.g. "<orgId>/orders/<orderId>". Returns the storage path.
export async function uploadPhoto(folder, file) {
    await ensureBucket();
    const path = `${folder}/${crypto.randomUUID()}.${MIME_EXTENSIONS[file.mimetype]}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
    });
    if (error) throw new Error(`Failed to upload photo: ${error.message}`);
    return path;
}

export async function removePhoto(path) {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) throw new Error(error.message);
}

// Adds `url` (signed, temporary) to each row that has `storage_path`.
export async function withSignedUrls(rows) {
    if (!rows.length) return rows;
    const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(rows.map((r) => r.storage_path), SIGNED_URL_TTL_SECONDS);
    if (error) throw new Error(error.message);
    const urlByPath = new Map(data.map((d) => [d.path, d.signedUrl]));
    return rows.map((r) => ({ ...r, url: urlByPath.get(r.storage_path) || null }));
}
