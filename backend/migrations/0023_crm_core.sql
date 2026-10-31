-- Kamo Autoservice CRM, part 1: reference data, clients, leads, vehicles,
-- staff and orders. Finance lives in 0024, business-rule functions in 0025.
--
-- Conventions for every crm_* table:
-- * organization_id references organizations with no cascade -- CRM history
--   (orders, money) must never disappear because a tenant row was removed.
-- * unique (organization_id, id) + composite foreign keys, so a row can only
--   ever point at rows of the same organization, enforced by Postgres itself
--   rather than by every backend query remembering to check.
-- * RLS enabled with no policies: only the service-role backend can read.

-- users gets the same composite key so CRM tables can reference "a user of
-- this organization". Additive only; existing queries are unaffected.
alter table users add constraint users_organization_id_id_key unique (organization_id, id);

create or replace function crm_touch_updated_at() returns trigger
language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organization-level CRM settings and sequential numbers
-- ---------------------------------------------------------------------------

create table crm_settings (
    organization_id uuid primary key references organizations(id),
    -- Every report is in this currency; foreign-currency amounts are converted
    -- at the rate recorded on the individual operation.
    base_currency text not null default 'UZS' check (base_currency ~ '^[A-Z]{3}$'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Human-friendly order/lead numbers (1, 2, 3...) per organization.
create table crm_counters (
    organization_id uuid not null references organizations(id),
    key text not null,
    value integer not null default 0,
    primary key (organization_id, key)
);

create or replace function crm_next_number(p_organization_id uuid, p_key text) returns integer
language sql as $$
    insert into crm_counters (organization_id, key, value)
    values (p_organization_id, p_key, 1)
    on conflict (organization_id, key) do update set value = crm_counters.value + 1
    returning value;
$$;

-- ---------------------------------------------------------------------------
-- Access roles (CRM permissions are separate from Kontrolla's owner/manager/
-- employee roles; the organization owner always has full CRM access)
-- ---------------------------------------------------------------------------

create table crm_roles (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    key text,
    name text not null,
    permissions text[] not null default '{}',
    is_system boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    unique (organization_id, name),
    unique (organization_id, key)
);

create table crm_user_roles (
    user_id uuid primary key,
    organization_id uuid not null,
    role_id uuid not null,
    created_at timestamptz not null default now(),
    foreign key (organization_id, user_id) references users(organization_id, id) on delete cascade,
    foreign key (organization_id, role_id) references crm_roles(organization_id, id)
);

-- ---------------------------------------------------------------------------
-- Reference data (seeded per organization by crm_seed_organization)
-- ---------------------------------------------------------------------------

create table crm_sources (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    key text,
    name text not null,
    is_paid boolean not null default false,
    sort_order integer not null default 0,
    is_archived boolean not null default false,
    created_at timestamptz not null default now(),
    unique (organization_id, id),
    unique (organization_id, key),
    unique (organization_id, name)
);

create table crm_campaigns (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    source_id uuid not null,
    name text not null,
    -- Meta campaign id, when the campaign comes from Meta Ads.
    external_campaign_id text,
    started_on date,
    ended_on date,
    is_archived boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    foreign key (organization_id, source_id) references crm_sources(organization_id, id)
);

create unique index crm_campaigns_external_uq on crm_campaigns(organization_id, external_campaign_id)
    where external_campaign_id is not null;

create table crm_service_categories (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    key text,
    name text not null,
    sort_order integer not null default 0,
    is_archived boolean not null default false,
    created_at timestamptz not null default now(),
    unique (organization_id, id),
    unique (organization_id, key),
    unique (organization_id, name)
);

-- Price list. An order line copies name/price at the time of the order, so
-- later price changes never rewrite past orders.
create table crm_services (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    category_id uuid not null,
    name text not null,
    default_price numeric(16, 2) check (default_price >= 0),
    currency text not null default 'UZS' check (currency ~ '^[A-Z]{3}$'),
    is_archived boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    foreign key (organization_id, category_id) references crm_service_categories(organization_id, id)
);

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------

create table crm_clients (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    first_name text not null,
    last_name text,
    -- Normalized to E.164 by the backend (+998901234567) so duplicates match.
    phone text check (phone ~ '^\+[0-9]{7,15}$'),
    instagram_username text,
    -- Instagram-scoped user id from the Messaging API: the stable identity of
    -- a Direct conversation partner even if they rename their account.
    instagram_user_id text,
    telegram_username text,
    -- First-touch attribution; each lead also carries its own source.
    source_id uuid,
    campaign_id uuid,
    first_contact_at timestamptz not null default now(),
    manager_id uuid,
    notes text,
    -- Set when this card was merged into another one as a duplicate.
    merged_into_id uuid,
    is_archived boolean not null default false,
    created_by uuid references users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    foreign key (organization_id, source_id) references crm_sources(organization_id, id),
    foreign key (organization_id, campaign_id) references crm_campaigns(organization_id, id),
    foreign key (organization_id, manager_id) references users(organization_id, id),
    foreign key (organization_id, merged_into_id) references crm_clients(organization_id, id)
);

-- Duplicate protection: one live card per phone / Instagram account.
create unique index crm_clients_phone_uq on crm_clients(organization_id, phone)
    where phone is not null and merged_into_id is null;
create unique index crm_clients_instagram_username_uq on crm_clients(organization_id, lower(instagram_username))
    where instagram_username is not null and merged_into_id is null;
create unique index crm_clients_instagram_user_id_uq on crm_clients(organization_id, instagram_user_id)
    where instagram_user_id is not null and merged_into_id is null;
create index idx_crm_clients_org_created on crm_clients(organization_id, created_at desc);

create table crm_client_comments (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    client_id uuid not null,
    author_id uuid references users(id),
    body text not null,
    created_at timestamptz not null default now(),
    foreign key (organization_id, client_id) references crm_clients(organization_id, id)
);

create index idx_crm_client_comments_client on crm_client_comments(client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Leads (заявки): one row per inquiry. A repeat client gets a new lead, so
-- conversion and source analytics count every inquiry, not every person.
-- ---------------------------------------------------------------------------

create table crm_leads (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    number integer not null,
    client_id uuid not null,
    source_id uuid,
    campaign_id uuid,
    -- Raw ad attribution from Meta (referral.ad_id etc.) kept as received.
    external_ad_id text,
    referral jsonb,
    channel text not null default 'other'
        check (channel in ('instagram', 'telegram', 'phone', 'walk_in', 'website', 'other')),
    status text not null default 'new'
        check (status in ('new', 'in_progress', 'waiting_reply', 'booked', 'arrived', 'order_created', 'completed', 'lost')),
    lost_reason text,
    manager_id uuid,
    booked_for timestamptz,
    arrived_at timestamptz,
    closed_at timestamptz,
    order_id uuid,
    notes text,
    created_by uuid references users(id),
    updated_by uuid references users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    unique (organization_id, number),
    foreign key (organization_id, client_id) references crm_clients(organization_id, id),
    foreign key (organization_id, source_id) references crm_sources(organization_id, id),
    foreign key (organization_id, campaign_id) references crm_campaigns(organization_id, id),
    foreign key (organization_id, manager_id) references users(organization_id, id)
);

create index idx_crm_leads_org_status on crm_leads(organization_id, status, created_at desc);
create index idx_crm_leads_client on crm_leads(client_id);

-- Every status transition, for funnel reports ("how many leads ever reached
-- 'booked'") that the current status alone can't answer.
create table crm_lead_events (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    lead_id uuid not null references crm_leads(id) on delete cascade,
    from_status text,
    to_status text not null,
    user_id uuid references users(id),
    created_at timestamptz not null default now()
);

create index idx_crm_lead_events_lead on crm_lead_events(lead_id, created_at);
create index idx_crm_lead_events_org_status on crm_lead_events(organization_id, to_status, created_at);

create table crm_messages (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    client_id uuid not null,
    lead_id uuid,
    channel text not null check (channel in ('instagram', 'telegram', 'whatsapp', 'sms', 'other')),
    direction text not null check (direction in ('in', 'out')),
    -- Message id on the external platform: makes webhook redelivery idempotent.
    external_id text,
    body text,
    attachments jsonb not null default '[]'::jsonb,
    sent_by uuid references users(id),
    status text not null default 'received' check (status in ('received', 'pending', 'sent', 'failed')),
    error text,
    sent_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    foreign key (organization_id, client_id) references crm_clients(organization_id, id),
    foreign key (organization_id, lead_id) references crm_leads(organization_id, id)
);

create unique index crm_messages_external_uq on crm_messages(channel, external_id) where external_id is not null;
create index idx_crm_messages_client on crm_messages(client_id, sent_at desc);
create index idx_crm_messages_org_sent on crm_messages(organization_id, sent_at desc);

-- ---------------------------------------------------------------------------
-- Vehicles
-- ---------------------------------------------------------------------------

create table crm_vehicles (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    client_id uuid not null,
    make text not null,
    model text,
    year integer check (year between 1950 and 2100),
    -- Stored uppercase without spaces ("01A123BC") so the same car is found
    -- however the plate was typed.
    plate text check (plate = upper(regexp_replace(plate, '\s', '', 'g'))),
    color text,
    vin text check (vin = upper(vin)),
    notes text,
    is_archived boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    foreign key (organization_id, client_id) references crm_clients(organization_id, id)
);

create unique index crm_vehicles_plate_uq on crm_vehicles(organization_id, plate)
    where plate is not null and not is_archived;
create index idx_crm_vehicles_client on crm_vehicles(client_id);

create table crm_vehicle_photos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    vehicle_id uuid not null,
    storage_path text not null,
    uploaded_by uuid references users(id),
    created_at timestamptz not null default now(),
    foreign key (organization_id, vehicle_id) references crm_vehicles(organization_id, id)
);

create index idx_crm_vehicle_photos_vehicle on crm_vehicle_photos(vehicle_id);

-- ---------------------------------------------------------------------------
-- Staff. Masters don't log into the app, so a staff card stands on its own;
-- user_id links it to a Kontrolla user only for those who do (e.g. a manager
-- who also earns commission).
-- ---------------------------------------------------------------------------

create table crm_staff (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    user_id uuid unique,
    full_name text not null,
    phone text,
    position text,
    specialization text,
    pay_scheme text not null default 'commission'
        check (pay_scheme in ('commission', 'salary', 'salary_plus_commission')),
    -- Monthly fixed salary, in the organization's base currency.
    base_salary numeric(16, 2) not null default 0 check (base_salary >= 0),
    is_active boolean not null default true,
    hired_on date,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    foreign key (organization_id, user_id) references users(organization_id, id)
);

-- Commission rules, most specific wins: (master, category) > (master, any) >
-- (anyone, category) > (anyone, any). Never hardcoded; edited in the UI.
create table crm_commission_rules (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    staff_id uuid,
    category_id uuid,
    -- net_price: % of the line price after discounts
    -- net_minus_materials: % of (line price after discounts - its materials)
    -- fixed: a fixed amount (base currency) per line
    base text not null check (base in ('net_price', 'net_minus_materials', 'fixed')),
    percent numeric(5, 2) check (percent between 0 and 100),
    fixed_amount numeric(16, 2) check (fixed_amount >= 0),
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check ((base = 'fixed' and fixed_amount is not null) or (base <> 'fixed' and percent is not null)),
    foreign key (organization_id, staff_id) references crm_staff(organization_id, id),
    foreign key (organization_id, category_id) references crm_service_categories(organization_id, id)
);

create unique index crm_commission_rules_scope_uq on crm_commission_rules(
    organization_id,
    coalesce(staff_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

create table crm_orders (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    number integer not null,
    client_id uuid not null,
    vehicle_id uuid,
    lead_id uuid,
    manager_id uuid,
    status text not null default 'pending'
        check (status in ('pending', 'accepted', 'in_progress', 'waiting_parts', 'quality_check', 'ready', 'issued', 'cancelled')),
    currency text not null default 'UZS' check (currency ~ '^[A-Z]{3}$'),
    received_at timestamptz,
    planned_ready_at timestamptz,
    issued_at timestamptz,
    cancelled_at timestamptz,
    cancel_reason text,
    -- Money fields below are maintained only by the 0025 functions/triggers.
    subtotal numeric(16, 2) not null default 0,
    discount_amount numeric(16, 2) not null default 0 check (discount_amount >= 0),
    total numeric(16, 2) not null default 0 check (total >= 0),
    paid_amount numeric(16, 2) not null default 0 check (paid_amount >= 0),
    -- Fixed at the moment of issue (revenue recognition), in base currency.
    fx_rate_at_issue numeric(18, 6),
    revenue_base numeric(16, 2),
    materials_cost_base numeric(16, 2),
    labor_cost_base numeric(16, 2),
    notes text,
    created_by uuid references users(id),
    updated_by uuid references users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    unique (organization_id, number),
    foreign key (organization_id, client_id) references crm_clients(organization_id, id),
    foreign key (organization_id, vehicle_id) references crm_vehicles(organization_id, id),
    foreign key (organization_id, lead_id) references crm_leads(organization_id, id),
    foreign key (organization_id, manager_id) references users(organization_id, id)
);

create index idx_crm_orders_org_status on crm_orders(organization_id, status, created_at desc);
create index idx_crm_orders_org_issued on crm_orders(organization_id, issued_at) where issued_at is not null;
create index idx_crm_orders_client on crm_orders(client_id);
create index idx_crm_orders_vehicle on crm_orders(vehicle_id);

alter table crm_leads add constraint crm_leads_order_fk
    foreign key (organization_id, order_id) references crm_orders(organization_id, id);

create table crm_order_items (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    order_id uuid not null,
    service_id uuid,
    category_id uuid not null,
    name text not null,
    quantity numeric(12, 3) not null default 1 check (quantity > 0),
    unit_price numeric(16, 2) not null check (unit_price >= 0),
    discount_amount numeric(16, 2) not null default 0 check (discount_amount >= 0),
    total numeric(16, 2) generated always as (round(quantity * unit_price, 2) - discount_amount) stored,
    -- Added after the car was accepted ("доп. услуга").
    is_additional boolean not null default false,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    check (discount_amount <= round(quantity * unit_price, 2)),
    unique (organization_id, id),
    foreign key (organization_id, order_id) references crm_orders(organization_id, id) on delete cascade,
    foreign key (organization_id, service_id) references crm_services(organization_id, id),
    foreign key (organization_id, category_id) references crm_service_categories(organization_id, id)
);

create index idx_crm_order_items_order on crm_order_items(order_id);

-- Masters on a line, with their share of it (shares on one line sum to 100).
create table crm_order_item_staff (
    order_item_id uuid not null,
    organization_id uuid not null references organizations(id),
    staff_id uuid not null,
    share_percent numeric(5, 2) not null default 100 check (share_percent > 0 and share_percent <= 100),
    primary key (order_item_id, staff_id),
    foreign key (organization_id, order_item_id) references crm_order_items(organization_id, id) on delete cascade,
    foreign key (organization_id, staff_id) references crm_staff(organization_id, id)
);

create index idx_crm_order_item_staff_staff on crm_order_item_staff(staff_id);

-- Materials used on the order: the order's cost of goods.
create table crm_order_materials (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    order_id uuid not null,
    -- Optional: tie the material to one line (e.g. PPF film to the PPF line)
    -- so per-line commissions "minus materials" are exact; unlinked materials
    -- are spread over lines in proportion to their price.
    order_item_id uuid references crm_order_items(id) on delete set null,
    name text not null,
    quantity numeric(12, 3) not null check (quantity > 0),
    unit text,
    unit_cost numeric(16, 2) not null check (unit_cost >= 0),
    currency text not null default 'UZS' check (currency ~ '^[A-Z]{3}$'),
    fx_rate numeric(18, 6) not null default 1 check (fx_rate > 0),
    total_cost_base numeric(16, 2) generated always as (round(quantity * unit_cost * fx_rate, 2)) stored,
    created_by uuid references users(id),
    created_at timestamptz not null default now(),
    foreign key (organization_id, order_id) references crm_orders(organization_id, id) on delete cascade
);

create index idx_crm_order_materials_order on crm_order_materials(order_id);

create table crm_order_photos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    order_id uuid not null,
    stage text not null check (stage in ('before', 'process', 'after')),
    storage_path text not null,
    uploaded_by uuid references users(id),
    created_at timestamptz not null default now(),
    foreign key (organization_id, order_id) references crm_orders(organization_id, id) on delete cascade
);

create index idx_crm_order_photos_order on crm_order_photos(order_id);

create table crm_order_comments (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    order_id uuid not null,
    author_id uuid references users(id),
    body text not null,
    created_at timestamptz not null default now(),
    foreign key (organization_id, order_id) references crm_orders(organization_id, id) on delete cascade
);

create index idx_crm_order_comments_order on crm_order_comments(order_id, created_at);

-- User-facing change history of an order (status changes, payments, issue).
create table crm_order_history (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    order_id uuid not null,
    user_id uuid references users(id),
    event text not null,
    from_status text,
    to_status text,
    details jsonb,
    created_at timestamptz not null default now(),
    foreign key (organization_id, order_id) references crm_orders(organization_id, id) on delete cascade
);

create index idx_crm_order_history_order on crm_order_history(order_id, created_at);

-- updated_at maintenance
create trigger crm_settings_touch before update on crm_settings for each row execute function crm_touch_updated_at();
create trigger crm_roles_touch before update on crm_roles for each row execute function crm_touch_updated_at();
create trigger crm_campaigns_touch before update on crm_campaigns for each row execute function crm_touch_updated_at();
create trigger crm_services_touch before update on crm_services for each row execute function crm_touch_updated_at();
create trigger crm_clients_touch before update on crm_clients for each row execute function crm_touch_updated_at();
create trigger crm_leads_touch before update on crm_leads for each row execute function crm_touch_updated_at();
create trigger crm_vehicles_touch before update on crm_vehicles for each row execute function crm_touch_updated_at();
create trigger crm_staff_touch before update on crm_staff for each row execute function crm_touch_updated_at();
create trigger crm_commission_rules_touch before update on crm_commission_rules for each row execute function crm_touch_updated_at();
create trigger crm_orders_touch before update on crm_orders for each row execute function crm_touch_updated_at();

alter table crm_settings enable row level security;
alter table crm_counters enable row level security;
alter table crm_roles enable row level security;
alter table crm_user_roles enable row level security;
alter table crm_sources enable row level security;
alter table crm_campaigns enable row level security;
alter table crm_service_categories enable row level security;
alter table crm_services enable row level security;
alter table crm_clients enable row level security;
alter table crm_client_comments enable row level security;
alter table crm_leads enable row level security;
alter table crm_lead_events enable row level security;
alter table crm_messages enable row level security;
alter table crm_vehicles enable row level security;
alter table crm_vehicle_photos enable row level security;
alter table crm_staff enable row level security;
alter table crm_commission_rules enable row level security;
alter table crm_orders enable row level security;
alter table crm_order_items enable row level security;
alter table crm_order_item_staff enable row level security;
alter table crm_order_materials enable row level security;
alter table crm_order_photos enable row level security;
alter table crm_order_comments enable row level security;
alter table crm_order_history enable row level security;
