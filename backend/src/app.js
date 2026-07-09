import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth.js';
import employeesRouter from './routes/employees.js';
import templatesRouter from './routes/templates.js';
import assignmentsRouter from './routes/assignments.js';
import dashboardRouter from './routes/dashboard.js';
import attendanceRouter from './routes/attendance.js';
import trainingRouter from './routes/training.js';

const app = express();

// FRONTEND_ORIGIN restricts CORS to the deployed Mini App origin in production;
// left unset, it falls back to allowing any origin (fine for local dev).
const allowedOrigin = process.env.FRONTEND_ORIGIN;
app.use(cors(allowedOrigin ? { origin: allowedOrigin } : {}));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/assignments', assignmentsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/training', trainingRouter);

// Catches multer errors (oversized/unsupported file, etc.) and anything else
// passed to next(err) so clients always get JSON instead of Express's HTML page.
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 400;
    res.status(status).json({ error: err.message || 'Unexpected error' });
});

export default app;
