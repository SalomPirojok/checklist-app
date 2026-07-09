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
