-- Lets a platform admin pause a tenant organization without deleting data:
-- every user in a suspended org is blocked at login.
alter table organizations add column is_suspended boolean not null default false;
