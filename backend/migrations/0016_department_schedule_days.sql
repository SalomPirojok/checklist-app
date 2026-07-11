-- Per-day-of-week schedule constructor for departments, replacing the single
-- days_of_week[] + one shared start/end pair on department_schedules with one
-- row per day of week, so hours (and days off) can differ day to day. Same
-- three-state status enum as schedule_shifts (work/off/undefined), applied
-- weekly/recurring instead of to specific dates.
--
-- department_schedules is left in place (unused) rather than dropped, so the
-- currently-deployed backend keeps working unaffected until the new backend
-- code (which reads department_schedule_days instead) is deployed.

create table department_schedule_days (
    id uuid primary key default gen_random_uuid(),
    department_id uuid not null references departments(id) on delete cascade,
    organization_id uuid not null references organizations(id) on delete cascade,
    day_of_week int not null check (day_of_week between 0 and 6),
    status shift_status not null default 'undefined',
    start_time time,
    end_time time,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (department_id, day_of_week)
);

create index idx_department_schedule_days_organization_id on department_schedule_days(organization_id);

-- Backfill: a day listed in the old days_of_week[] becomes an explicit 'work'
-- row with the shared hours; every other day of the week becomes an explicit
-- 'off' row -- this preserves today's lateness behavior exactly (a day
-- outside days_of_week was never checked for lateness).
insert into department_schedule_days (department_id, organization_id, day_of_week, status, start_time, end_time)
select
    ds.department_id,
    ds.organization_id,
    d.day,
    case when d.day = any(ds.days_of_week) then 'work'::shift_status else 'off'::shift_status end,
    case when d.day = any(ds.days_of_week) then ds.start_time else null end,
    case when d.day = any(ds.days_of_week) then ds.end_time else null end
from department_schedules ds
cross join generate_series(0, 6) as d(day);
