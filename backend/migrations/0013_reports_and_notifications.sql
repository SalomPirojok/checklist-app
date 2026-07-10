-- Evening summary report settings + idempotency marker for the daily cron.
alter table organizations add column daily_report_time time not null default '22:00';
alter table organizations add column last_daily_report_sent_date date;
