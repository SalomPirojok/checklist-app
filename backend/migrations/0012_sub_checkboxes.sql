-- Nested checkboxes inside a single checklist item (e.g. "Zone 1" containing
-- "Bins are full", "Floor is clean", "Lighting works"). NULL/empty means the
-- item behaves exactly as before -- no change for existing items.

alter table checklist_template_items add column sub_checkboxes jsonb;
alter table checklist_assignment_items add column sub_checkbox_results jsonb;
