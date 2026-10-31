// Calendar math in an organization's own timezone (organizations.timezone),
// for reports whose "today" / "this month" must match the business's local
// calendar rather than UTC. Built on Intl only -- no tz library needed.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function partsInZone(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(date);
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

// Minutes the zone is ahead of UTC at the given instant (Asia/Tashkent: 300).
export function zoneOffsetMinutes(date, timeZone) {
    const p = partsInZone(date, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const instant = Math.floor(date.getTime() / 1000) * 1000;
    return Math.round((asUtc - instant) / 60000);
}

// 'YYYY-MM-DD' of the given instant on the zone's wall calendar.
export function localDateString(date, timeZone) {
    const p = partsInZone(date, timeZone);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// The UTC instant at which local date `dateStr` begins in `timeZone`.
export function zonedMidnight(dateStr, timeZone) {
    if (!DATE_PATTERN.test(dateStr)) throw new Error(`Invalid date: ${dateStr}`);
    const [y, m, d] = dateStr.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d);
    let result = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60000;
    // Re-check once: the offset at local midnight can differ from the offset
    // at UTC midnight across a DST switch.
    const corrected = guess - zoneOffsetMinutes(new Date(result), timeZone) * 60000;
    if (corrected !== result) result = corrected;
    return new Date(result);
}

function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Half-open [from, to) range of the local day/week/month containing `now`.
// Weeks start on Monday.
export function periodRange(kind, now, timeZone) {
    const today = localDateString(now, timeZone);
    let startDate;
    let endDate;
    if (kind === 'day') {
        startDate = today;
        endDate = addDays(today, 1);
    } else if (kind === 'week') {
        const [y, m, d] = today.split('-').map(Number);
        const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
        startDate = addDays(today, -((weekday + 6) % 7));
        endDate = addDays(startDate, 7);
    } else if (kind === 'month') {
        startDate = `${today.slice(0, 7)}-01`;
        const [y, m] = today.split('-').map(Number);
        endDate = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    } else {
        throw new Error(`Unknown period: ${kind}`);
    }
    return {
        startDate,
        endDate,
        from: zonedMidnight(startDate, timeZone).toISOString(),
        to: zonedMidnight(endDate, timeZone).toISOString(),
    };
}
