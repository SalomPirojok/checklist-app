-- Allow "no deadline" checklists (e.g. general cleaning that's never overdue)
-- and restricting auto-assign to specific days of the week (e.g. Mon/Wed/Fri).

alter table checklist_assignments alter column due_at drop not null;
alter table checklist_templates alter column due_offset_minutes drop not null;

-- NULL/empty means "every day" (matches existing auto-assign templates unchanged).
-- Values are 0=Sunday .. 6=Saturday, matching JS Date#getUTCDay().
alter table checklist_templates add column auto_assign_days_of_week int[];
