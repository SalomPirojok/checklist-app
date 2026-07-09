-- Allows pre-creating an employee/manager by username only, before they've ever
-- opened the bot. Their telegram_id gets filled in on first login (see auth.js).

alter table users alter column telegram_id drop not null;

alter table users
    add constraint users_identifier_required
    check (telegram_id is not null or username is not null);

-- Case-insensitive lookup: Telegram usernames are matched case-insensitively.
create index idx_users_username_lower on users (lower(username));
