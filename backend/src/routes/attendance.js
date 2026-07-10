import { Router } from 'express';
import multer from 'multer';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { uploadAttendancePhoto, verifyAttendancePhotoBelongsToUser } from '../lib/storage.js';
import { computeLateness } from '../lib/lateness.js';
import { sendTelegramMessage } from '../lib/telegramNotify.js';

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

    const { data: org, error: orgFetchError } = await supabase
        .from('organizations')
        .select('auto_penalty_enabled, late_threshold_minutes, late_penalty_amount, shift_start_time')
        .eq('id', req.user.organizationId)
        .single();
    if (orgFetchError) console.error('Failed to load organization settings for attendance side-effects:', orgFetchError.message);

    if (type === 'check_in' && org) {
        try {
            await maybeCreateLatePenalty(record, req.user.organizationId, org);
        } catch (err) {
            // Best-effort: a failed penalty check must never block the check-in itself.
            console.error('Auto-penalty check failed:', err.message);
        }
    }

    try {
        await notifyOwnerOfAttendance(record, req.user, type, org);
    } catch (err) {
        console.error('Failed to notify owner of attendance:', err.message);
    }

    res.status(201).json({ record });
});

async function maybeCreateLatePenalty(attendanceRecord, organizationId, org) {
    if (!org.auto_penalty_enabled) return;

    const { lateMinutes } = computeLateness(new Date(attendanceRecord.created_at), org.shift_start_time);
    const thresholdMinutes = org.late_threshold_minutes;
    if (lateMinutes <= thresholdMinutes) return;

    const { error: penaltyError } = await supabase.from('penalties').insert({
        user_id: attendanceRecord.user_id,
        organization_id: organizationId,
        reason: `Опоздание на ${lateMinutes} мин.`,
        amount: org.late_penalty_amount,
        rule_type: 'auto_late',
        related_attendance_id: attendanceRecord.id,
        created_by: null,
    });
    if (penaltyError) throw new Error(penaltyError.message);
}

// Instant "employee checked in/out" ping to the owner, using the same
// Telegram-sending infrastructure as the overdue notifier.
async function notifyOwnerOfAttendance(record, user, type, org) {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) return;

    const { data: owner, error: ownerError } = await supabase
        .from('users')
        .select('telegram_id')
        .eq('organization_id', user.organizationId)
        .eq('role', 'owner')
        .maybeSingle();
    if (ownerError || !owner?.telegram_id) return;

    const { data: employee, error: employeeError } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();
    if (employeeError || !employee) return;

    const time = new Date(record.created_at).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
    });

    let text;
    if (type === 'check_in') {
        const lateSuffix = org
            ? (() => {
                  const { isLate, lateMinutes } = computeLateness(new Date(record.created_at), org.shift_start_time);
                  return isLate ? `опоздание на ${lateMinutes} мин` : 'вовремя';
              })()
            : 'вовремя';
        text = `✅ ${employee.full_name} отметил приход в ${time} (${lateSuffix})`;
    } else {
        text = `🏁 ${employee.full_name} отметил уход в ${time}`;
    }

    await sendTelegramMessage(botToken, owner.telegram_id, text);
}

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
