import { Router } from 'express';
import multer from 'multer';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { uploadAttendancePhoto, verifyAttendancePhotoBelongsToUser } from '../lib/storage.js';

const router = Router();

router.use(requireAuth);

const MIME_EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
};

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!MIME_EXTENSIONS[file.mimetype]) {
            return cb(new Error('Unsupported image type'));
        }
        cb(null, true);
    },
});

function startOfDayUTC(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function endOfDayUTC(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
}

async function loadTodayRecordsForUser(userId) {
    const now = new Date();
    const { data, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', startOfDayUTC(now))
        .lt('created_at', endOfDayUTC(now))
        .order('created_at', { ascending: true });
    if (error) throw new Error('Failed to load attendance');
    return data;
}

router.get('/today', async (req, res) => {
    let records;
    try {
        records = await loadTodayRecordsForUser(req.user.id);
    } catch {
        return res.status(500).json({ error: 'Failed to load attendance' });
    }
    res.json({
        check_in: records.find((r) => r.type === 'check_in') || null,
        check_out: records.find((r) => r.type === 'check_out') || null,
    });
});

router.post('/', upload.single('photo'), async (req, res) => {
    const { type } = req.body || {};
    if (type !== 'check_in' && type !== 'check_out') {
        return res.status(400).json({ error: 'type must be check_in or check_out' });
    }
    if (!req.file) {
        return res.status(400).json({ error: 'photo is required' });
    }

    let todayRecords;
    try {
        todayRecords = await loadTodayRecordsForUser(req.user.id);
    } catch {
        return res.status(500).json({ error: 'Failed to check existing attendance' });
    }

    const existingCheckIn = todayRecords.find((r) => r.type === 'check_in');
    const existingCheckOut = todayRecords.find((r) => r.type === 'check_out');

    if (type === 'check_in' && existingCheckIn) {
        return res.status(409).json({ error: 'Already checked in today' });
    }
    if (type === 'check_out') {
        if (!existingCheckIn) {
            return res.status(400).json({ error: 'Must check in before checking out' });
        }
        if (existingCheckOut) {
            return res.status(409).json({ error: 'Already checked out today' });
        }
    }

    let photoUrl;
    try {
        photoUrl = await uploadAttendancePhoto({
            userId: req.user.id,
            buffer: req.file.buffer,
            contentType: req.file.mimetype,
            extension: MIME_EXTENSIONS[req.file.mimetype],
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }

    const verified = await verifyAttendancePhotoBelongsToUser(photoUrl, req.user.id);
    if (!verified) {
        return res.status(500).json({ error: 'Failed to verify uploaded photo' });
    }

    const { data: record, error: insertError } = await supabase
        .from('attendance_records')
        .insert({
            user_id: req.user.id,
            organization_id: req.user.organizationId,
            type,
            photo_url: photoUrl,
        })
        .select()
        .single();
    if (insertError) return res.status(500).json({ error: 'Failed to record attendance' });

    res.status(201).json({ record });
});

router.get('/organization/today', requireRole('owner', 'manager'), async (req, res) => {
    const { data: orgUsers, error: usersError } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('organization_id', req.user.organizationId)
        .eq('is_active', true)
        .neq('role', 'owner')
        .order('full_name', { ascending: true });
    if (usersError) return res.status(500).json({ error: 'Failed to load employees' });

    const now = new Date();
    const { data: records, error: recordsError } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .gte('created_at', startOfDayUTC(now))
        .lt('created_at', endOfDayUTC(now));
    if (recordsError) return res.status(500).json({ error: 'Failed to load attendance records' });

    const recordsByUser = new Map();
    for (const record of records) {
        if (!recordsByUser.has(record.user_id)) recordsByUser.set(record.user_id, {});
        recordsByUser.get(record.user_id)[record.type] = record;
    }

    const attendance = orgUsers.map((u) => ({
        user: { id: u.id, full_name: u.full_name },
        check_in: recordsByUser.get(u.id)?.check_in || null,
        check_out: recordsByUser.get(u.id)?.check_out || null,
    }));

    res.json({ date: startOfDayUTC(now).slice(0, 10), attendance });
});

export default router;
