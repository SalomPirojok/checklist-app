-- Employee check-in/check-out with a mandatory selfie.

create type attendance_type as enum ('check_in', 'check_out');

create table attendance_records (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    organization_id uuid not null references organizations(id) on delete cascade,
    type attendance_type not null,
    photo_url text not null,
    created_at timestamptz not null default now()
);

create index idx_attendance_records_user_created on attendance_records(user_id, created_at);
create index idx_attendance_records_org_created on attendance_records(organization_id, created_at);
