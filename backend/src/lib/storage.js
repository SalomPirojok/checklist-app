import { supabase } from './supabase.js';

const BUCKET = 'checklist-photos';
let bucketReady = false;

async function ensureBucket() {
    if (bucketReady) return;
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) throw new Error(`Failed to list storage buckets: ${error.message}`);

    if (!buckets.some((b) => b.name === BUCKET)) {
        const { error: createError } = await supabase.storage.createBucket(BUCKET, {
            public: true,
            fileSizeLimit: '8MB',
            allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
        });
        if (createError) throw new Error(`Failed to create storage bucket: ${createError.message}`);
    }
    bucketReady = true;
}

export async function uploadAssignmentItemPhoto({ assignmentId, itemId, buffer, contentType, extension }) {
    await ensureBucket();

    const path = `${assignmentId}/${itemId}-${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, buffer, {
        contentType,
        upsert: false,
    });
    if (uploadError) throw new Error(`Failed to upload photo: ${uploadError.message}`);

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
}

// Defense in depth: a client could otherwise mark a requires_photo item done by
// simply sending an arbitrary photo_url string, without ever uploading anything.
// This confirms the URL both follows our own naming convention for this exact
// assignment/item AND actually exists in storage.
export async function verifyPhotoBelongsToItem(photoUrl, assignmentId, itemId) {
    let pathname;
    try {
        pathname = new URL(photoUrl).pathname;
    } catch {
        return false;
    }

    const marker = `/${BUCKET}/`;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex === -1) return false;

    const objectPath = pathname.slice(markerIndex + marker.length); // "{assignmentId}/{filename}"
    const expectedFolder = `${assignmentId}/`;
    if (!objectPath.startsWith(expectedFolder)) return false;

    const filename = objectPath.slice(expectedFolder.length);
    if (!filename.startsWith(`${itemId}-`)) return false;

    const { data, error } = await supabase.storage.from(BUCKET).list(assignmentId, { search: filename });
    if (error) return false;
    return (data || []).some((f) => f.name === filename);
}
