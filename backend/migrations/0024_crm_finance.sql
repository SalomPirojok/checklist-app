-- Kamo Autoservice CRM, part 2: money. Cash accounts, exchange rates, the
-- append-only ledger of money movements, payroll accruals, plus the
-- integration/notification tables.
--
-- Two separate questions, two separate sources:
-- * "Where did the money go?"  -> crm_transactions (cash flow)
-- * "Did we make a profit?"    -> issued orders' revenue and costs, payroll
--                                 accruals, and operating expenses
-- Receiving money is never counted as profit by itself.

create table crm_accounts (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    name text not null,
    kind text not null check (kind in ('cash', 'bank_transfer', 'card', 'other')),
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    is_archived boolean not null default false,
    created_at timestamptz not null default now(),
    unique (organization_id, id),
    unique (organization_id, name)
);

-- kind decides how an expense lands in the profit report:
-- * opex / marketing: operating expense in the period it was paid
-- * materials: stock purchase -- cash out, but the cost reaches profit only
--   when the material is used on an issued order (crm_order_materials)
create table crm_expense_categories (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    key text,
    name text not null,
    kind text not null check (kind in ('opex', 'marketing', 'materials')),
    is_archived boolean not null default false,
    created_at timestamptz not null default now(),
    unique (organization_id, id),
    unique (organization_id, key),
    unique (organization_id, name)
);

-- Reference rates (e.g. Central Bank of Uzbekistan), shared by all tenants:
-- units of base currency per 1 unit of `currency`. Operations store their own
-- rate; this table only suggests the default.
create table exchange_rates (
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    base_currency text not null default 'UZS' check (base_currency ~ '^[A-Z]{3}$'),
    rate_date date not null,
    rate numeric(18, 6) not null check (rate > 0),
    source text not null default 'cbu',
    created_at timestamptz not null default now(),
    primary key (currency, base_currency, rate_date)
);

-- The ledger. Rows are never updated or deleted (enforced in 0025): a
-- mistake is fixed by a reversal row pointing at the original.
create table crm_transactions (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    type text not null check (type in (
        'client_payment',   -- money from a client towards an order
        'client_refund',    -- money returned to a client
        'expense',          -- rent, ads, materials purchase, ...
        'payroll_payout',   -- salary/commission paid to a staff member
        'transfer_in',      -- between own accounts (incl. currency exchange)
        'transfer_out',
        'other_income'
    )),
    -- +1 money in, -1 money out of the account.
    direction smallint not null check (direction in (1, -1)),
    account_id uuid not null,
    amount numeric(16, 2) not null check (amount > 0),
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    -- Base-currency units per 1 unit of `currency` at the time of operation.
    fx_rate numeric(18, 6) not null check (fx_rate > 0),
    amount_base numeric(16, 2) generated always as (round(amount * fx_rate, 2)) stored,
    occurred_at timestamptz not null default now(),
    order_id uuid,
    -- The part of `amount` credited to the order, in the order's currency.
    order_amount numeric(16, 2) check (order_amount > 0),
    client_id uuid,
    staff_id uuid,
    category_id uuid,
    campaign_id uuid,
    transfer_group_id uuid,
    reversal_of uuid unique references crm_transactions(id),
    note text,
    created_by uuid references users(id),
    created_at timestamptz not null default now(),
    unique (organization_id, id),
    foreign key (organization_id, account_id) references crm_accounts(organization_id, id),
    foreign key (organization_id, order_id) references crm_orders(organization_id, id),
    foreign key (organization_id, client_id) references crm_clients(organization_id, id),
    foreign key (organization_id, staff_id) references crm_staff(organization_id, id),
    foreign key (organization_id, category_id) references crm_expense_categories(organization_id, id),
    foreign key (organization_id, campaign_id) references crm_campaigns(organization_id, id),
    check ((type in ('client_payment', 'client_refund')) = (order_id is not null and order_amount is not null)),
    check (type <> 'expense' or category_id is not null),
    check (type <> 'payroll_payout' or staff_id is not null),
    check ((type in ('transfer_in', 'transfer_out')) = (transfer_group_id is not null))
);

create index idx_crm_transactions_org_occurred on crm_transactions(organization_id, occurred_at desc);
create index idx_crm_transactions_order on crm_transactions(order_id) where order_id is not null;
create index idx_crm_transactions_staff on crm_transactions(staff_id) where staff_id is not null;
create index idx_crm_transactions_account on crm_transactions(account_id);
create index idx_crm_transactions_campaign on crm_transactions(campaign_id) where campaign_id is not null;

-- What each staff member has earned (accrued), in base currency. Signed:
-- deductions and reversals are negative. Owed = sum(entries) - payouts.
-- Append-only, like the ledger.
create table crm_payroll_entries (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    staff_id uuid not null,
    kind text not null check (kind in ('commission', 'salary', 'bonus', 'deduction', 'adjustment')),
    amount numeric(16, 2) not null check (amount <> 0),
    order_id uuid,
    order_item_id uuid,
    -- First day of the month a salary/bonus belongs to.
    period_month date check (period_month = date_trunc('month', period_month)::date),
    -- Snapshot of the rule and inputs used, so later rule edits never change
    -- what was already accrued.
    details jsonb,
    reversal_of uuid unique references crm_payroll_entries(id),
    note text,
    created_by uuid references users(id),
    created_at timestamptz not null default now(),
    foreign key (organization_id, staff_id) references crm_staff(organization_id, id),
    foreign key (organization_id, order_id) references crm_orders(organization_id, id)
);

create index idx_crm_payroll_entries_staff on crm_payroll_entries(staff_id, created_at);
create index idx_crm_payroll_entries_order on crm_payroll_entries(order_id) where order_id is not null;

-- ---------------------------------------------------------------------------
-- Integrations and notifications
-- ---------------------------------------------------------------------------

-- One row per connected platform. Secrets are encrypted by the backend with a
-- key from its environment before they are stored; never sent to clients.
create table crm_integrations (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    provider text not null check (provider in ('instagram', 'telegram')),
    status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'error')),
    -- Non-secret settings, e.g. Instagram account id and username.
    config jsonb not null default '{}'::jsonb,
    secrets_encrypted text,
    last_error text,
    connected_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, provider)
);

-- Raw incoming webhooks, stored before processing: nothing is lost if
-- processing fails, and a redelivered event is recognized by its id.
create table crm_webhook_events (
    id uuid primary key default gen_random_uuid(),
    provider text not null,
    external_event_id text not null,
    organization_id uuid references organizations(id),
    payload jsonb not null,
    received_at timestamptz not null default now(),
    processed_at timestamptz,
    error text,
    unique (provider, external_event_id)
);

create index idx_crm_webhook_events_unprocessed on crm_webhook_events(received_at) where processed_at is null;

-- Who gets which Telegram notification. A row = subscribed.
create table crm_notification_subscriptions (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null,
    user_id uuid not null,
    event_type text not null check (event_type in (
        'lead_new', 'message_new', 'lead_booked', 'order_new', 'order_status',
        'order_ready', 'payment', 'client_debt', 'payroll_due', 'daily_summary'
    )),
    created_at timestamptz not null default now(),
    unique (user_id, event_type),
    foreign key (organization_id, user_id) references users(organization_id, id) on delete cascade
);

create trigger crm_integrations_touch before update on crm_integrations for each row execute function crm_touch_updated_at();

alter table crm_accounts enable row level security;
alter table crm_expense_categories enable row level security;
alter table exchange_rates enable row level security;
alter table crm_transactions enable row level security;
alter table crm_payroll_entries enable row level security;
alter table crm_integrations enable row level security;
alter table crm_webhook_events enable row level security;
alter table crm_notification_subscriptions enable row level security;
