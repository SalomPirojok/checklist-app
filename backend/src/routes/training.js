import { Router } from 'express';
import multer from 'multer';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { uploadTrainingFile } from '../lib/storage.js';

const router = Router();

router.use(requireAuth);

const MIME_EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'application/pdf': 'pdf',
};

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!MIME_EXTENSIONS[file.mimetype]) {
            return cb(new Error('Unsupported file type'));
        }
        cb(null, true);
    },
});

// Owner can always manage training; a manager needs it explicitly granted.
// Looked up fresh from the DB (not trusted from the JWT) so revoking a
// manager's access takes effect immediately, not on their next login.
async function canManageTraining(req) {
    if (req.user.role === 'owner') return true;
    if (req.user.role !== 'manager') return false;
    const { data } = await supabase.from('users').select('can_manage_training').eq('id', req.user.id).maybeSingle();
    return !!data?.can_manage_training;
}

router.get('/', async (req, res) => {
    let query = supabase
        .from('training_materials')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .order('created_at', { ascending: false });

    const includeArchived = req.query.archived === 'true' && req.user.role !== 'employee';
    if (!includeArchived) query = query.eq('is_archived', false);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Failed to list training materials' });
    res.json({ materials: data });
});

router.get('/:id', async (req, res) => {
    const { data: material, error } = await supabase
        .from('training_materials')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (error) return res.status(500).json({ error: 'Failed to fetch training material' });
    if (!material) return res.status(404).json({ error: 'Training material not found' });
    if (material.is_archived && req.user.role === 'employee') {
        return res.status(404).json({ error: 'Training material not found' });
    }
    res.json({ material });
});

router.post('/', upload.single('file'), async (req, res) => {
    if (!(await canManageTraining(req))) {
        return res.status(403).json({ error: 'Not allowed to manage training materials' });
    }

    const { title, body_text } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });

    let fileUrl = null;
    if (req.file) {
        try {
            fileUrl = await uploadTrainingFile({
                organizationId: req.user.organizationId,
                buffer: req.file.buffer,
                contentType: req.file.mimetype,
                extension: MIME_EXTENSIONS[req.file.mimetype],
            });
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    }

    const { data, error } = await supabase
        .from('training_materials')
        .insert({
            organization_id: req.user.organizationId,
            title,
            body_text: body_text || null,
            file_url: fileUrl,
            created_by: req.user.id,
        })
        .select()
        .single();

    if (error) return res.status(500).json({ error: 'Failed to create training material' });
    res.status(201).json({ material: data });
});

router.patch('/:id', upload.single('file'), async (req, res) => {
    if (!(await canManageTraining(req))) {
        return res.status(403).json({ error: 'Not allowed to manage training materials' });
    }

    const { data: material, error: lookupError } = await supabase
        .from('training_materials')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (lookupError) return res.status(500).json({ error: 'Failed to fetch training material' });
    if (!material) return res.status(404).json({ error: 'Training material not found' });

    const { title, body_text, is_archived, remove_file } = req.body || {};
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (body_text !== undefined) updates.body_text = body_text || null;
    if (is_archived !== undefined) updates.is_archived = is_archived === true || is_archived === 'true';

    if (req.file) {
        try {
            updates.file_url = await uploadTrainingFile({
                organizationId: req.user.organizationId,
                buffer: req.file.buffer,
                contentType: req.file.mimetype,
                extension: MIME_EXTENSIONS[req.file.mimetype],
            });
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    } else if (remove_file === true || remove_file === 'true') {
        updates.file_url = null;
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
        .from('training_materials')
        .update(updates)
        .eq('id', req.params.id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: 'Failed to update training material' });
    res.json({ material: data });
});

// Materials may end up referenced by the upcoming tests/exams feature, so
// "delete" archives rather than removes the row — same pattern as templates.
router.delete('/:id', async (req, res) => {
    if (!(await canManageTraining(req))) {
        return res.status(403).json({ error: 'Not allowed to manage training materials' });
    }

    const { data: material, error: lookupError } = await supabase
        .from('training_materials')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .maybeSingle();
    if (lookupError) return res.status(500).json({ error: 'Failed to fetch training material' });
    if (!material) return res.status(404).json({ error: 'Training material not found' });

    const { data, error } = await supabase
        .from('training_materials')
        .update({ is_archived: true })
        .eq('id', req.params.id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: 'Failed to archive training material' });
    res.json({ material: data });
});

export default router;
