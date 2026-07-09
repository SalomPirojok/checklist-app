-- Training materials library for employees. Tests/exams are a separate,
-- later step — this is just the content (title, text, one optional
-- photo/video/PDF attachment).

create table training_materials (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    title text not null,
    body_text text,
    file_url text,
    created_by uuid not null references users(id),
    created_at timestamptz not null default now(),
    is_archived boolean not null default false
);

create index idx_training_materials_organization_id on training_materials(organization_id);

-- Owner can always manage training regardless of this flag; a manager needs it
-- explicitly granted by the owner.
alter table users add column can_manage_training boolean not null default false;
