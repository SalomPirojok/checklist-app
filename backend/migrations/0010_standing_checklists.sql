-- Standing checklists: one assignment that's always visible to the employee,
-- never expires, never goes overdue, and gets reset in place instead of being
-- recreated (e.g. "keep the fire extinguisher check visible at all times").

alter table checklist_assignments add column is_standing boolean not null default false;
alter table checklist_templates add column is_standing boolean not null default false;
