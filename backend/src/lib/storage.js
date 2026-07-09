import { supabase } from './supabase.js';

const CHECKLIST_BUCKET = 'checklist-photos';
const ATTENDANCE_BUCKET = 'attendance-photos';
const SIGNATURE_BUCKET = 'checklist-signatures';

const PHOTO_BUCKET_OPTIONS = {
    public: true,
    fileSizeLimit: '8MB',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
};

const bucketsReady = new Set();

async function ensureBucket(bucket) {
    if (bucketsReady.has(bucket)) return;
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) throw new Error(`Failed to list storage buckets: ${error.message}`);

    if (!buckets.some((b) => b.name === bucket)) {
        const { error: createError } = await supabase.storage.createBucket(bucket, PHOTO_BUCKET_OPTIONS);
        if (createError) throw new Error(`Failed to create storage bucket: ${createError.message}`);
    }
    bucketsReady.add(bucket);
}

async function uploadPhoto(bucket, path, buffer, contentType) {
    await ensureBucket(bucket);

    const { error: uploadError } = await supabase.storage.from(bucket).upload(path, buffer, {
        contentType,
        upsert: false,
    });
    if (uploadError) throw new Error(`Failed to upload photo: ${uploadError.message}`);

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
}

// Confirms a photo_url both follows our own naming convention for the given
// bucket/folder AND actually exists in storage — a client could otherwise claim
// a photo was uploaded by simply sending an arbitrary or reused URL string.
async function photoExistsAtPath(bucket, folder, filename) {
    const { data, error } = await supabase.storage.from(bucket).list(folder, { search: filename });
    if (error) return false;
    return (data || []).some((f) => f.name === filename);
}

function extractBucketRelativePath(photoUrl, bucket) {
    let pathname;
    try {
        pathname = new URL(photoUrl).pathname;
    } catch {
        return null;
    }
    const marker = `/${bucket}/`;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex === -1) return null;
    return pathname.slice(markerIndex + marker.length); // "{folder}/{filename}"
}

export async function uploadAssignmentItemPhoto({ assignmentId, itemId, buffer, contentType, extension }) {
    const path = `${assignmentId}/${itemId}-${Date.now()}.${extension}`;
    return uploadPhoto(CHECKLIST_BUCKET, path, buffer, contentType);
}

export async function verifyPhotoBelongsToItem(photoUrl, assignmentId, itemId) {
    const objectPath = extractBucketRelativePath(photoUrl, CHECKLIST_BUCKET);
    if (!objectPath) return false;

    const expectedFolder = `${assignmentId}/`;
    if (!objectPath.startsWith(expectedFolder)) return false;

    const filename = objectPath.slice(expectedFolder.length);
    if (!filename.startsWith(`${itemId}-`)) return false;

    return photoExistsAtPath(CHECKLIST_BUCKET, assignmentId, filename);
}

export async function uploadAttendancePhoto({ userId, buffer, contentType, extension }) {
    const path = `${userId}/${Date.now()}.${extension}`;
    return uploadPhoto(ATTENDANCE_BUCKET, path, buffer, contentType);
}

export async function verifyAttendancePhotoBelongsToUser(photoUrl, userId) {
    const objectPath = extractBucketRelativePath(photoUrl, ATTENDANCE_BUCKET);
    if (!objectPath) return false;

    const expectedFolder = `${userId}/`;
    if (!objectPath.startsWith(expectedFolder)) return false;

    const filename = objectPath.slice(expectedFolder.length);
    return photoExistsAtPath(ATTENDANCE_BUCKET, userId, filename);
}

export async function uploadSignaturePhoto({ assignmentId, buffer, contentType, extension }) {
    const path = `${assignmentId}/signature-${Date.now()}.${extension}`;
    return uploadPhoto(SIGNATURE_BUCKET, path, buffer, contentType);
}

export async function verifySignatureBelongsToAssignment(photoUrl, assignmentId) {
    const objectPath = extractBucketRelativePath(photoUrl, SIGNATURE_BUCKET);
    if (!objectPath) return false;

    const expectedFolder = `${assignmentId}/`;
    if (!objectPath.startsWith(expectedFolder)) return false;

    const filename = objectPath.slice(expectedFolder.length);
    return photoExistsAtPath(SIGNATURE_BUCKET, assignmentId, filename);
}
