-- MVP schema for checklist-app
-- Roles: owner, manager, employee
-- Assignment statuses: not_started, in_progress, completed, overdue

create type user_role as enum ('owner', 'manager', 'employee');
create type assignment_status as enum ('not_started', 'in_progress', 'completed', 'overdue');

create table organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_at timestamptz not null default now()
);

create table users (
    id uuid primary key default gen_random_uuid(),
    telegram_id bigint not null unique,
    full_name text not null,
    username text,
    role user_role not null default 'employee',
    organization_id uuid not null references organizations(id) on delete cascade,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

create table checklist_templates (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    title text not null,
    description text,
    created_by uuid not null references users(id),
    created_at timestamptz not null default now(),
    is_archived boolean not null default false
);

create table checklist_template_items (
    id uuid primary key default gen_random_uuid(),
    template_id uuid not null references checklist_templates(id) on delete cascade,
    order_index int not null default 0,
    title text not null,
    description text,
    requires_photo boolean not null default false
);

create table checklist_assignments (
    id uuid primary key default gen_random_uuid(),
    template_id uuid not null references checklist_templates(id),
    assigned_to uuid not null references users(id),
    assigned_by uuid not null references users(id),
    status assignment_status not null default 'not_started',
    due_at timestamptz not null,
    started_at timestamptz,
    completed_at timestamptz,
    overdue_notified_at timestamptz,
    created_at timestamptz not null default now()
);

create table checklist_assignment_items (
    id uuid primary key default gen_random_uuid(),
    assignment_id uuid not null references checklist_assignments(id) on delete cascade,
    template_item_id uuid not null references checklist_template_items(id),
    is_done boolean not null default false,
    photo_url text,
    comment text,
    done_at timestamptz
);

-- Indexes

create index idx_users_telegram_id on users(telegram_id);
create index idx_users_organization_id on users(organization_id);

create index idx_templates_organization_id on checklist_templates(organization_id);
create index idx_template_items_template_id on checklist_template_items(template_id);

create index idx_assignments_status_due_at on checklist_assignments(status, due_at);
create index idx_assignments_assigned_to on checklist_assignments(assigned_to);
create index idx_assignments_template_id on checklist_assignments(template_id);

create index idx_assignment_items_assignment_id on checklist_assignment_items(assignment_id);
