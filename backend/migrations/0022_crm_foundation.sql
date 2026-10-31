-- Foundation for the Kamo Autoservice CRM (and any later per-business module):
-- per-organization timezone, per-organization module switches, and a shared
-- user-action audit log. Purely additive -- nothing existing reads these yet.

-- All existing day boundaries are computed in UTC. CRM money reports ("revenue
-- today") must follow the business's local calendar day instead.
alter table organizations add column timezone text not null default 'Asia/Tashkent';

-- Which optional modules an organization has turned on (e.g. 'crm'). A
-- missing row means "not enabled". Kept as a row-per-module table rather than
-- boolean columns on organizations so a new business module never needs
-- another migration on that table.
create table organization_modules (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    module_key text not null,
    enabled boolean not null default true,
    settings jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, module_key)
);

create index idx_organization_modules_organization_id on organization_modules(organization_id);

-- Append-only journal of who did what. organization_id is nullable for
-- platform-admin actions that aren't scoped to one tenant. No cascade from
-- organizations on purpose: the journal must outlive what it describes.
create table audit_log (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid references organizations(id) on delete set null,
    actor_user_id uuid references users(id) on delete set null,
    actor_telegram_id bigint,
    action text not null,
    entity_type text not null,
    entity_id uuid,
    before jsonb,
    after jsonb,
    created_at timestamptz not null default now()
);

create index idx_audit_log_org_created on audit_log(organization_id, created_at desc);
create index idx_audit_log_entity on audit_log(entity_type, entity_id);

-- The backend talks to Postgres with the service-role key, which bypasses RLS.
-- Enabling RLS with no policies just closes these tables to the anon key.
alter table organization_modules enable row level security;
alter table audit_log enable row level security;
