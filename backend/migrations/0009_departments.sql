-- Departments (e.g. Повара / Официанты / Хостес / Кассир). An employee
-- belongs to at most one department. A template/material with department_id
-- NULL is "for everyone" -- unchanged from current behavior; a template/
-- material with department_id set only reaches employees in that department.

create table departments (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    name text not null,
    is_archived boolean not null default false,
    created_at timestamptz not null default now()
);

create index idx_departments_organization_id on departments(organization_id);

alter table users add column department_id uuid references departments(id) on delete set null;
alter table checklist_templates add column department_id uuid references departments(id) on delete set null;
alter table training_materials add column department_id uuid references departments(id) on delete set null;
