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
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'text/plain': 'txt',
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

// null means "for everyone" (unchanged legacy behavior) -- only a non-null
// value needs to be verified as belonging to this organization.
async function validateDepartmentId(departmentId, organizationId) {
    if (departmentId === null || departmentId === undefined) return null;
    const { data, error } = await supabase
        .from('departments')
        .select('id')
        .eq('id', departmentId)
        .eq('organization_id', organizationId)
        .eq('is_archived', false)
        .maybeSingle();
    if (error) return 'Failed to look up department';
    if (!data) return 'department_id not found in your organization';
    return null;
}

router.get('/', async (req, res) => {
    let query = supabase
        .from('training_materials')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .order('created_at', { ascending: false });

    const includeArchived = req.query.archived === 'true' && req.user.role !== 'employee';
    if (!includeArchived) query = query.eq('is_archived', false);

    // Owner/manager manage the full catalog regardless of department; an
    // employee only sees org-wide material (department_id null) plus their
    // own department's material.
    if (req.user.role === 'employee') {
        const { data: me, error: meError } = await supabase
            .from('users')
            .select('department_id')
            .eq('id', req.user.id)
            .maybeSingle();
        if (meError) return res.status(500).json({ error: 'Failed to look up your department' });
        query = me?.department_id ? query.or(`department_id.is.null,department_id.eq.${me.department_id}`) : query.is('department_id', null);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Failed to list training materials' });
    res.json({ materials: data });
});

// Registered before '/:id' so "results" isn't swallowed as a material id.
router.get('/results', async (req, res) => {
    if (!(await canManageTraining(req))) {
        return res.status(403).json({ error: 'Not allowed to view training results' });
    }

    const { data: materials, error: materialsError } = await supabase
        .from('training_materials')
        .select('id, title, department_id')
        .eq('organization_id', req.user.organizationId)
        .eq('is_archived', false);
    if (materialsError) return res.status(500).json({ error: 'Failed to load training materials' });
    if (materials.length === 0) return res.json({ results: [] });

    const materialIds = materials.map((m) => m.id);
    const { data: tests, error: testsError } = await supabase
        .from('training_tests')
        .select('id, material_id, passing_score_percent')
        .in('material_id', materialIds);
    if (testsError) return res.status(500).json({ error: 'Failed to load tests' });
    if (tests.length === 0) return res.json({ results: [] });

    const { data: employees, error: employeesError } = await supabase
        .from('users')
        .select('id, full_name, role, department_id')
        .eq('organization_id', req.user.organizationId)
        .eq('is_active', true);
    if (employeesError) return res.status(500).json({ error: 'Failed to load employees' });

    const testIds = tests.map((t) => t.id);
    const { data: attempts, error: attemptsError } = await supabase
        .from('training_test_attempts')
        .select('test_id, user_id, score_percent, passed, created_at')
        .in('test_id', testIds)
        .eq('organization_id', req.user.organizationId);
    if (attemptsError) return res.status(500).json({ error: 'Failed to load attempts' });

    const materialById = new Map(materials.map((m) => [m.id, m]));
    const results = tests.map((test) => {
        const material = materialById.get(test.material_id);
        const testAttempts = attempts.filter((a) => a.test_id === test.id);
        // A department-restricted material's results only need to list
        // employees who could ever see it -- org-wide material (department_id
        // null) still lists everyone, matching the auto-assign fan-out rule.
        const relevantEmployees = material.department_id
            ? employees.filter((e) => e.department_id === material.department_id)
            : employees;
        const employeeResults = relevantEmployees.map((employee) => {
            const theirAttempts = testAttempts.filter((a) => a.user_id === employee.id);
            if (theirAttempts.length === 0) {
                return { user_id: employee.id, full_name: employee.full_name, role: employee.role, attempted: false };
            }
            const bestScore = Math.max(...theirAttempts.map((a) => a.score_percent));
            const passedEver = theirAttempts.some((a) => a.passed);
            const lastAttemptAt = theirAttempts.reduce(
                (latest, a) => (a.created_at > latest ? a.created_at : latest),
                theirAttempts[0].created_at
            );
            return {
                user_id: employee.id,
                full_name: employee.full_name,
                role: employee.role,
                attempted: true,
                attempt_count: theirAttempts.length,
                best_score_percent: bestScore,
                passed: passedEver,
                last_attempt_at: lastAttemptAt,
            };
        });
        return {
            material: { id: material.id, title: material.title },
            test: { id: test.id, passing_score_percent: test.passing_score_percent },
            employees: employeeResults,
        };
    });

    res.json({ results });
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
    if (material.department_id && req.user.role === 'employee') {
        const { data: me, error: meError } = await supabase
            .from('users')
            .select('department_id')
            .eq('id', req.user.id)
            .maybeSingle();
        if (meError) return res.status(500).json({ error: 'Failed to look up your department' });
        if (me?.department_id !== material.department_id) {
            return res.status(404).json({ error: 'Training material not found' });
        }
    }
    res.json({ material });
});

router.post('/', upload.single('file'), async (req, res) => {
    if (!(await canManageTraining(req))) {
        return res.status(403).json({ error: 'Not allowed to manage training materials' });
    }

    const { title, body_text } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });

    // Multipart form fields arrive as strings; an empty string means "for everyone".
    const departmentId = req.body.department_id ? req.body.department_id : null;
    const departmentError = await validateDepartmentId(departmentId, req.user.organizationId);
    if (departmentError) return res.status(400).json({ error: departmentError });

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
            department_id: departmentId,
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

    const { title, body_text, is_archived, remove_file, department_id } = req.body || {};
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (body_text !== undefined) updates.body_text = body_text || null;
    if (is_archived !== undefined) updates.is_archived = is_archived === true || is_archived === 'true';
    if (department_id !== undefined) {
        const departmentId = department_id ? department_id : null;
        const departmentError = await validateDepartmentId(departmentId, req.user.organizationId);
        if (departmentError) return res.status(400).json({ error: departmentError });
        updates.department_id = departmentId;
    }

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

async function loadMaterialInOrg(materialId, organizationId) {
    const { data, error } = await supabase
        .from('training_materials')
        .select('*')
        .eq('id', materialId)
        .eq('organization_id', organizationId)
        .maybeSingle();
    if (error) throw new Error('lookup failed');
    return data;
}

function validateTestPayload({ passing_score_percent, questions }) {
    if (passing_score_percent !== undefined) {
        if (!Number.isInteger(passing_score_percent) || passing_score_percent < 1 || passing_score_percent > 100) {
            return 'passing_score_percent must be an integer between 1 and 100';
        }
    }
    if (!Array.isArray(questions) || questions.length === 0) {
        return 'questions must be a non-empty array';
    }
    for (const q of questions) {
        if (!q.question_text || !q.question_text.trim()) {
            return 'every question requires question_text';
        }
        if (!Array.isArray(q.options) || q.options.length < 2) {
            return 'every question requires at least 2 options';
        }
        if (q.options.some((o) => !o.option_text || !o.option_text.trim())) {
            return 'every option requires option_text';
        }
        const correctCount = q.options.filter((o) => o.is_correct).length;
        if (correctCount !== 1) {
            return 'every question must have exactly one correct option';
        }
    }
    return null;
}

// One test per material. GET returns null test if none exists yet, so the
// frontend can show "add a test" (manager) or "no test yet" (employee).
// Employees never see is_correct on options — that would leak the answer key.
router.get('/:materialId/test', async (req, res) => {
    let material;
    try {
        material = await loadMaterialInOrg(req.params.materialId, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch training material' });
    }
    if (!material) return res.status(404).json({ error: 'Training material not found' });
    if (material.is_archived && req.user.role === 'employee') {
        return res.status(404).json({ error: 'Training material not found' });
    }

    const { data: test, error: testError } = await supabase
        .from('training_tests')
        .select('*')
        .eq('material_id', material.id)
        .maybeSingle();
    if (testError) return res.status(500).json({ error: 'Failed to fetch test' });
    if (!test) return res.json({ test: null });

    const canManage = await canManageTraining(req);

    const { data: questions, error: questionsError } = await supabase
        .from('training_test_questions')
        .select('*')
        .eq('test_id', test.id)
        .order('order_index', { ascending: true });
    if (questionsError) return res.status(500).json({ error: 'Failed to fetch questions' });

    const questionIds = questions.map((q) => q.id);
    let options = [];
    if (questionIds.length > 0) {
        const optionColumns = canManage ? '*' : 'id, question_id, option_text, order_index';
        const { data: optionsData, error: optionsError } = await supabase
            .from('training_test_options')
            .select(optionColumns)
            .in('question_id', questionIds)
            .order('order_index', { ascending: true });
        if (optionsError) return res.status(500).json({ error: 'Failed to fetch options' });
        options = optionsData;
    }

    const questionsWithOptions = questions.map((q) => ({
        ...q,
        options: options.filter((o) => o.question_id === q.id),
    }));

    res.json({ test: { ...test, questions: questionsWithOptions } });
});

// Full replace of the test: delete the old questions/options (cascade) and
// insert the new set. Simpler and less error-prone than diffing individual
// question/option edits for a first version.
router.put('/:materialId/test', async (req, res) => {
    if (!(await canManageTraining(req))) {
        return res.status(403).json({ error: 'Not allowed to manage training tests' });
    }

    let material;
    try {
        material = await loadMaterialInOrg(req.params.materialId, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch training material' });
    }
    if (!material) return res.status(404).json({ error: 'Training material not found' });

    const { passing_score_percent, questions } = req.body || {};
    const validationError = validateTestPayload({ passing_score_percent, questions });
    if (validationError) return res.status(400).json({ error: validationError });

    const { error: deleteError } = await supabase.from('training_tests').delete().eq('material_id', material.id);
    if (deleteError) return res.status(500).json({ error: 'Failed to replace test' });

    const { data: test, error: testError } = await supabase
        .from('training_tests')
        .insert({
            material_id: material.id,
            passing_score_percent: passing_score_percent ?? 80,
            created_by: req.user.id,
        })
        .select()
        .single();
    if (testError) return res.status(500).json({ error: 'Failed to create test' });

    const { data: insertedQuestionsRaw, error: insertQuestionsError } = await supabase
        .from('training_test_questions')
        .insert(
            questions.map((q, index) => ({
                test_id: test.id,
                question_text: q.question_text,
                order_index: index,
            }))
        )
        .select();
    if (insertQuestionsError) {
        await supabase.from('training_tests').delete().eq('id', test.id);
        return res.status(500).json({ error: 'Failed to create questions' });
    }
    // Don't rely on the DB returning rows in insertion order — sort explicitly
    // so option rows below get matched to the right question by array index.
    const insertedQuestions = [...insertedQuestionsRaw].sort((a, b) => a.order_index - b.order_index);

    const optionRows = questions.flatMap((q, qIndex) =>
        q.options.map((o, oIndex) => ({
            question_id: insertedQuestions[qIndex].id,
            option_text: o.option_text,
            is_correct: !!o.is_correct,
            order_index: oIndex,
        }))
    );
    const { data: insertedOptions, error: insertOptionsError } = await supabase
        .from('training_test_options')
        .insert(optionRows)
        .select();
    if (insertOptionsError) {
        await supabase.from('training_tests').delete().eq('id', test.id);
        return res.status(500).json({ error: 'Failed to create options' });
    }

    const questionsWithOptions = insertedQuestions.map((q) => ({
        ...q,
        options: insertedOptions.filter((o) => o.question_id === q.id),
    }));

    res.status(200).json({ test: { ...test, questions: questionsWithOptions } });
});

router.delete('/:materialId/test', async (req, res) => {
    if (!(await canManageTraining(req))) {
        return res.status(403).json({ error: 'Not allowed to manage training tests' });
    }

    let material;
    try {
        material = await loadMaterialInOrg(req.params.materialId, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch training material' });
    }
    if (!material) return res.status(404).json({ error: 'Training material not found' });

    const { error } = await supabase.from('training_tests').delete().eq('material_id', material.id);
    if (error) return res.status(500).json({ error: 'Failed to delete test' });
    res.json({ deleted: true });
});

router.get('/:materialId/test/attempts/me', async (req, res) => {
    let material;
    try {
        material = await loadMaterialInOrg(req.params.materialId, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch training material' });
    }
    if (!material) return res.status(404).json({ error: 'Training material not found' });

    const { data: test, error: testError } = await supabase
        .from('training_tests')
        .select('id')
        .eq('material_id', material.id)
        .maybeSingle();
    if (testError) return res.status(500).json({ error: 'Failed to fetch test' });
    if (!test) return res.json({ attempts: [] });

    const { data: attempts, error: attemptsError } = await supabase
        .from('training_test_attempts')
        .select('id, score_percent, passed, created_at')
        .eq('test_id', test.id)
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false });
    if (attemptsError) return res.status(500).json({ error: 'Failed to fetch attempts' });
    res.json({ attempts });
});

router.post('/:materialId/test/attempts', async (req, res) => {
    let material;
    try {
        material = await loadMaterialInOrg(req.params.materialId, req.user.organizationId);
    } catch {
        return res.status(500).json({ error: 'Failed to fetch training material' });
    }
    if (!material) return res.status(404).json({ error: 'Training material not found' });

    const { data: test, error: testError } = await supabase
        .from('training_tests')
        .select('*')
        .eq('material_id', material.id)
        .maybeSingle();
    if (testError) return res.status(500).json({ error: 'Failed to fetch test' });
    if (!test) return res.status(404).json({ error: 'This material has no test' });

    const { data: questions, error: questionsError } = await supabase
        .from('training_test_questions')
        .select('id')
        .eq('test_id', test.id);
    if (questionsError) return res.status(500).json({ error: 'Failed to fetch questions' });

    const { answers } = req.body || {};
    if (!Array.isArray(answers) || answers.length !== questions.length) {
        return res.status(400).json({ error: `answers must include exactly ${questions.length} entries` });
    }
    const questionIdSet = new Set(questions.map((q) => q.id));
    const answeredQuestionIds = new Set(answers.map((a) => a.question_id));
    if (answeredQuestionIds.size !== questions.length || [...answeredQuestionIds].some((id) => !questionIdSet.has(id))) {
        return res.status(400).json({ error: 'answers must cover exactly the questions in this test' });
    }

    const { data: options, error: optionsError } = await supabase
        .from('training_test_options')
        .select('id, question_id, is_correct')
        .in('question_id', [...questionIdSet]);
    if (optionsError) return res.status(500).json({ error: 'Failed to fetch options' });
    const optionById = new Map(options.map((o) => [o.id, o]));

    for (const a of answers) {
        const option = optionById.get(a.selected_option_id);
        if (!option || option.question_id !== a.question_id) {
            return res.status(400).json({ error: 'selected_option_id does not belong to the given question' });
        }
    }

    const correctCount = answers.filter((a) => optionById.get(a.selected_option_id).is_correct).length;
    const scorePercent = Math.round((correctCount / questions.length) * 100);
    const passed = scorePercent >= test.passing_score_percent;

    const { data: attempt, error: attemptError } = await supabase
        .from('training_test_attempts')
        .insert({
            test_id: test.id,
            user_id: req.user.id,
            organization_id: req.user.organizationId,
            score_percent: scorePercent,
            passed,
        })
        .select()
        .single();
    if (attemptError) return res.status(500).json({ error: 'Failed to record attempt' });

    const answerRows = answers.map((a) => ({
        attempt_id: attempt.id,
        question_id: a.question_id,
        selected_option_id: a.selected_option_id,
        is_correct: optionById.get(a.selected_option_id).is_correct,
    }));
    const { error: answersError } = await supabase.from('training_test_attempt_answers').insert(answerRows);
    if (answersError) return res.status(500).json({ error: 'Failed to record attempt answers' });

    res.status(201).json({
        attempt,
        results: answerRows.map((r) => ({
            question_id: r.question_id,
            selected_option_id: r.selected_option_id,
            is_correct: r.is_correct,
            correct_option_id: options.find((o) => o.question_id === r.question_id && o.is_correct)?.id,
        })),
    });
});

export default router;
