-- Recurring weekly work schedule per department (e.g. Повара: Пн-Сб, 09:00-20:00).
-- One row per department; a department with no row falls back to the
-- organization's single shift_start_time with no day restriction (legacy
-- behavior, unchanged for employees without a department).

create table department_schedules (
    id uuid primary key default gen_random_uuid(),
    department_id uuid not null unique references departments(id) on delete cascade,
    organization_id uuid not null references organizations(id) on delete cascade,
    days_of_week int[] not null,
    start_time time not null default '09:00',
    end_time time not null default '18:00',
    created_at timestamptz not null default now()
);

create index idx_department_schedules_organization_id on department_schedules(organization_id);
