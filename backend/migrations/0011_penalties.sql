-- Employee penalties/violations. Auto-penalties fire on late check-in
-- (checked against a single org-wide shift start time -- no per-employee
-- shift schedules for MVP); manual penalties are added by owner/manager.

create type penalty_rule_type as enum ('auto_late', 'manual');

create table penalties (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    organization_id uuid not null references organizations(id) on delete cascade,
    reason text not null,
    amount numeric not null,
    rule_type penalty_rule_type not null,
    related_attendance_id uuid references attendance_records(id),
    related_assignment_id uuid references checklist_assignments(id),
    created_by uuid references users(id),
    created_at timestamptz not null default now()
);

create index idx_penalties_organization_id on penalties(organization_id);
create index idx_penalties_user_id on penalties(user_id);

alter table organizations add column late_threshold_minutes integer not null default 15;
alter table organizations add column late_penalty_amount numeric not null default 0;
alter table organizations add column auto_penalty_enabled boolean not null default false;
alter table organizations add column shift_start_time time not null default '09:00';
