-- checklist_assignment_items.template_item_id references checklist_template_items
-- with no cascade (by design: editing a template must never erase a past
-- employee's recorded answers). That meant PUT /api/templates/:id/items --
-- which every template edit goes through -- always deleted and reinserted
-- every item, and failed with a foreign-key violation ("Failed to replace
-- items") the moment a template had ever been assigned even once.
--
-- Items that still have assignment history are now soft-removed instead of
-- deleted; only items nobody has ever been assigned get hard-deleted.
alter table checklist_template_items add column is_removed boolean not null default false;

create index idx_checklist_template_items_active on checklist_template_items(template_id) where not is_removed;
