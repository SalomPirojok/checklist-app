import 'dotenv/config';
import app from './app.js';
import { runOverdueCheck } from './jobs/overdueNotifier.js';
import { runAutoAssignChecklists } from './jobs/autoAssignChecklists.js';

const port = process.env.PORT || 3000;
const OVERDUE_CHECK_INTERVAL_MS = Number(process.env.OVERDUE_CHECK_INTERVAL_MS) || 5 * 60 * 1000;
const AUTO_ASSIGN_CHECK_INTERVAL_MS = Number(process.env.AUTO_ASSIGN_CHECK_INTERVAL_MS) || 5 * 60 * 1000;

function scheduleOverdueChecks() {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
        console.warn('BOT_TOKEN not set — overdue notifications disabled');
        return;
    }

    const tick = () => {
        runOverdueCheck(botToken)
            .then(({ notified, pending }) => {
                if (pending) console.log(`Overdue check: notified owners for ${notified}/${pending} assignments`);
            })
            .catch((err) => console.error('Overdue check failed:', err.message));
    };

    tick();
    setInterval(tick, OVERDUE_CHECK_INTERVAL_MS);
}

function scheduleAutoAssignChecklists() {
    const tick = () => {
        runAutoAssignChecklists()
            .then(({ templatesChecked, assignmentsCreated }) => {
                if (templatesChecked) console.log(`Auto-assign check: created ${assignmentsCreated} assignment(s) across ${templatesChecked} template(s)`);
            })
            .catch((err) => console.error('Auto-assign check failed:', err.message));
    };

    tick();
    setInterval(tick, AUTO_ASSIGN_CHECK_INTERVAL_MS);
}

app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
    scheduleOverdueChecks();
    scheduleAutoAssignChecklists();
});
