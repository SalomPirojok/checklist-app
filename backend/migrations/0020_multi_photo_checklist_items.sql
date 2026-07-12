-- Employees can now attach several photos to a single checklist item instead
-- of exactly one. A jsonb array column fits the existing architecture better
-- than a child table here: every read path already does `select('*', ...)`
-- on checklist_assignment_items, so the new column comes along for free with
-- no extra joins in GET /assignments/:id, the reset route, etc.
alter table checklist_assignment_items add column photo_urls jsonb not null default '[]'::jsonb;

-- Preserve already-uploaded photos as the first (only) entry in the new array.
update checklist_assignment_items
set photo_urls = jsonb_build_array(photo_url)
where photo_url is not null;

alter table checklist_assignment_items drop column photo_url;
