-- Optional category label for grouping checklist template items into sections.
alter table checklist_template_items add column category text;

-- Employee's signature image, captured as the last required step before an
-- assignment can be marked completed.
alter table checklist_assignments add column signature_url text;
