-- Shift-planning module: a visual "employee x date" table where owners/managers
-- assign a work/off/undefined status (plus optional start/end time) per day.
-- Reuses the existing users table (which already has department_id) rather than
-- a separate employees entity.

create type shift_status as enum ('work', 'off', 'undefined');

create table schedule_shifts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    shift_date date not null,
    status shift_status not null default 'undefined',
    start_time time,
    end_time time,
    color_override text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, shift_date)
);

create table schedule_week_templates (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    name text not null,
    template_data jsonb not null,
    created_at timestamptz not null default now()
);

create index idx_schedule_shifts_shift_date on schedule_shifts(shift_date);
create index idx_schedule_shifts_user_id on schedule_shifts(user_id);
create index idx_schedule_week_templates_organization_id on schedule_week_templates(organization_id);
