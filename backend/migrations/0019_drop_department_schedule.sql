-- The "график подразделений" feature (day-of-week x department schedule
-- grid) has been removed in favor of the per-employee, per-date "Смены
-- сотрудников" constructor (schedule_shifts), which is now the sole source
-- for lateness/penalty computation as well. department_schedules (0014) was
-- already unused before this; department_schedule_days (0016) backed the
-- now-removed grid UI and /api/schedules endpoints.
drop table if exists department_schedule_days;
drop table if exists department_schedules;
