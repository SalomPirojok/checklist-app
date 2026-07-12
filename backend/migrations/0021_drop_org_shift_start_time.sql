-- organizations.shift_start_time (0011) was the org-wide default lateness
-- clock; it stopped being read anywhere once auto-penalty switched over to
-- each employee's personal schedule_shifts entry. The "Настройки автоштрафа"
-- page no longer exposes it either.
alter table organizations drop column shift_start_time;
