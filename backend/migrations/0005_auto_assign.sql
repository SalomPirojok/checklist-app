-- Automatic daily assignment of a checklist template to all active employees,
-- instead of the owner assigning it by hand every day.

alter table checklist_templates add column auto_assign_enabled boolean not null default false;
alter table checklist_templates add column auto_assign_time time not null default '09:00';
alter table checklist_templates add column due_offset_minutes integer not null default 120;
-- MVP always assigns to every active employee/manager; kept as its own column so a
-- future "specific employees" selector doesn't require another migration.
alter table checklist_templates add column assign_to_all_active boolean not null default true;
