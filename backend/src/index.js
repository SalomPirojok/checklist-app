import 'dotenv/config';
import app from './app.js';
import { runOverdueCheck } from './jobs/overdueNotifier.js';
import { runAutoAssignChecklists } from './jobs/autoAssignChecklists.js';
import { runDailyReportCheck } from './jobs/dailyReportNotifier.js';

const port = process.env.PORT || 3000;
const OVERDUE_CHECK_INTERVAL_MS = Number(process.env.OVERDUE_CHECK_INTERVAL_MS) || 5 * 60 * 1000;
const AUTO_ASSIGN_CHECK_INTERVAL_MS = Number(process.env.AUTO_ASSIGN_CHECK_INTERVAL_MS) || 5 * 60 * 1000;
const DAILY_REPORT_CHECK_INTERVAL_MS = Number(process.env.DAILY_REPORT_CHECK_INTERVAL_MS) || 5 * 60 * 1000;

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

function scheduleDailyReportChecks() {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
        console.warn('BOT_TOKEN not set — daily report notifications disabled');
        return;
    }

    const tick = () => {
        runDailyReportCheck(botToken)
            .then(({ checked, sent }) => {
                if (checked) console.log(`Daily report check: sent ${sent}/${checked} organization report(s)`);
            })
            .catch((err) => console.error('Daily report check failed:', err.message));
    };

    tick();
    setInterval(tick, DAILY_REPORT_CHECK_INTERVAL_MS);
}

app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
    scheduleOverdueChecks();
    scheduleAutoAssignChecklists();
    scheduleDailyReportChecks();
});
