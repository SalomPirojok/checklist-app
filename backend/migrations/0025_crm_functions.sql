-- Kamo Autoservice CRM, part 3: business rules enforced inside Postgres.
--
-- Every money-changing operation is one function call = one transaction:
-- the order row is locked (FOR UPDATE), checked, and all dependent rows are
-- written together or not at all. The backend calls them via supabase.rpc().
--
-- Fields that only these functions may change are protected by triggers.
-- The functions mark themselves with the transaction-local setting
-- crm.internal = 'on'; ordinary UPDATEs from the API don't have it.
--
-- Error messages meant for the user are in Russian; 'crm: ...' messages
-- indicate a programming error in the caller.

create or replace function crm_is_internal() returns boolean
language sql stable as $$
    select coalesce(current_setting('crm.internal', true), '') = 'on';
$$;

create or replace function crm_base_currency(p_organization_id uuid) returns text
language sql stable as $$
    select coalesce((select base_currency from crm_settings where organization_id = p_organization_id), 'UZS');
$$;

-- ---------------------------------------------------------------------------
-- Append-only tables
-- ---------------------------------------------------------------------------

create or replace function crm_append_only() returns trigger
language plpgsql as $$
begin
    raise exception 'crm: % is append-only, record a reversal instead', tg_table_name;
end;
$$;

create trigger crm_transactions_append_only before update or delete on crm_transactions
    for each row execute function crm_append_only();
create trigger crm_payroll_entries_append_only before update or delete on crm_payroll_entries
    for each row execute function crm_append_only();

create or replace function crm_transactions_validate() returns trigger
language plpgsql as $$
declare
    v_account crm_accounts;
    v_original crm_transactions;
begin
    select * into v_account from crm_accounts where id = new.account_id;
    if v_account.currency <> new.currency then
        raise exception 'Валюта операции (%) не совпадает с валютой кассы (%)', new.currency, v_account.currency;
    end if;
    if new.currency = crm_base_currency(new.organization_id) and new.fx_rate <> 1 then
        raise exception 'crm: fx_rate must be 1 for the base currency';
    end if;

    if new.reversal_of is null then
        if v_account.is_archived then
            raise exception 'Касса «%» в архиве', v_account.name;
        end if;
        if (new.type in ('client_payment', 'transfer_in', 'other_income')) <> (new.direction = 1) then
            raise exception 'crm: wrong direction % for %', new.direction, new.type;
        end if;
    else
        select * into v_original from crm_transactions where id = new.reversal_of;
        if new.type <> v_original.type or new.direction <> -v_original.direction or new.amount <> v_original.amount
            or new.account_id <> v_original.account_id or new.organization_id <> v_original.organization_id then
            raise exception 'crm: a reversal must mirror the original transaction';
        end if;
    end if;

    -- Order payments also move crm_orders.paid_amount, so they may only be
    -- written by crm_record_order_payment / crm_reverse_transaction.
    if new.type in ('client_payment', 'client_refund') and not crm_is_internal() then
        raise exception 'crm: use crm_record_order_payment() for order payments';
    end if;
    return new;
end;
$$;

create trigger crm_transactions_validate before insert on crm_transactions
    for each row execute function crm_transactions_validate();

-- ---------------------------------------------------------------------------
-- Leads: numbering and status history
-- ---------------------------------------------------------------------------

create or replace function crm_leads_before_insert() returns trigger
language plpgsql as $$
begin
    if new.number is null then
        new.number := crm_next_number(new.organization_id, 'lead');
    end if;
    return new;
end;
$$;

create trigger crm_leads_number before insert on crm_leads
    for each row execute function crm_leads_before_insert();

create or replace function crm_leads_log_status() returns trigger
language plpgsql as $$
begin
    if tg_op = 'INSERT' then
        insert into crm_lead_events (organization_id, lead_id, from_status, to_status, user_id)
        values (new.organization_id, new.id, null, new.status, new.created_by);
    elsif new.status is distinct from old.status then
        insert into crm_lead_events (organization_id, lead_id, from_status, to_status, user_id)
        values (new.organization_id, new.id, old.status, new.status, new.updated_by);
    end if;
    return null;
end;
$$;

create trigger crm_leads_log_status after insert or update on crm_leads
    for each row execute function crm_leads_log_status();

-- ---------------------------------------------------------------------------
-- Orders: numbering, protected fields, totals, history
-- ---------------------------------------------------------------------------

create or replace function crm_orders_guard() returns trigger
language plpgsql as $$
begin
    if tg_op = 'INSERT' then
        if new.number is null then
            new.number := crm_next_number(new.organization_id, 'order');
        end if;
        if new.status in ('issued', 'cancelled') then
            raise exception 'crm: a new order cannot start as %', new.status;
        end if;
        new.subtotal := 0;
        new.paid_amount := 0;
        new.issued_at := null;
        new.fx_rate_at_issue := null;
        new.revenue_base := null;
        new.materials_cost_base := null;
        new.labor_cost_base := null;
    elsif not crm_is_internal() then
        if new.organization_id <> old.organization_id or new.number <> old.number
            or new.subtotal <> old.subtotal or new.paid_amount <> old.paid_amount
            or new.issued_at is distinct from old.issued_at
            or new.fx_rate_at_issue is distinct from old.fx_rate_at_issue
            or new.revenue_base is distinct from old.revenue_base
            or new.materials_cost_base is distinct from old.materials_cost_base
            or new.labor_cost_base is distinct from old.labor_cost_base then
            raise exception 'crm: order money fields are maintained by the system';
        end if;
        if new.status = 'issued' and old.status <> 'issued' then
            raise exception 'crm: use crm_issue_order() to issue an order';
        end if;
        if old.status = 'issued' and new.status <> 'issued' then
            raise exception 'crm: use crm_reopen_order() to reopen an issued order';
        end if;
        if old.status in ('issued', 'cancelled') and old.status = new.status
            and (new.discount_amount <> old.discount_amount or new.currency <> old.currency or new.client_id <> old.client_id) then
            raise exception 'Выданный или отменённый заказ нельзя изменять';
        end if;
        if new.currency <> old.currency and old.paid_amount > 0 then
            raise exception 'Нельзя менять валюту заказа, по которому уже есть оплаты';
        end if;
        if new.status = 'cancelled' and old.status <> 'cancelled' then
            if old.paid_amount > 0 then
                raise exception 'По заказу есть оплаты — сначала оформите возврат';
            end if;
            new.cancelled_at := coalesce(new.cancelled_at, now());
        end if;
    end if;

    new.total := new.subtotal - new.discount_amount;
    if new.total < 0 then
        raise exception 'Скидка больше суммы заказа';
    end if;
    if new.total < new.paid_amount then
        raise exception 'Сумма заказа меньше уже оплаченной — сначала оформите возврат';
    end if;
    return new;
end;
$$;

create trigger crm_orders_guard before insert or update on crm_orders
    for each row execute function crm_orders_guard();

create or replace function crm_orders_before_delete() returns trigger
language plpgsql as $$
begin
    if old.status = 'issued' or old.paid_amount > 0 then
        raise exception 'Выданный или оплаченный заказ удалить нельзя — его можно только отменить';
    end if;
    return old;
end;
$$;

create trigger crm_orders_before_delete before delete on crm_orders
    for each row execute function crm_orders_before_delete();

create or replace function crm_orders_log_status() returns trigger
language plpgsql as $$
begin
    if tg_op = 'INSERT' then
        insert into crm_order_history (organization_id, order_id, user_id, event, to_status)
        values (new.organization_id, new.id, new.created_by, 'created', new.status);
    elsif new.status is distinct from old.status then
        insert into crm_order_history (organization_id, order_id, user_id, event, from_status, to_status)
        values (new.organization_id, new.id, new.updated_by, 'status_changed', old.status, new.status);
    end if;
    return null;
end;
$$;

create trigger crm_orders_log_status after insert or update on crm_orders
    for each row execute function crm_orders_log_status();

-- Lines, masters and materials of an issued/cancelled order are frozen.
create or replace function crm_order_children_guard() returns trigger
language plpgsql as $$
declare
    v_order_id uuid;
    v_status text;
begin
    if tg_table_name = 'crm_order_item_staff' then
        if tg_op = 'DELETE' then
            select order_id into v_order_id from crm_order_items where id = old.order_item_id;
        else
            select order_id into v_order_id from crm_order_items where id = new.order_item_id;
        end if;
    elsif tg_op = 'DELETE' then
        v_order_id := old.order_id;
    else
        v_order_id := new.order_id;
        if tg_op = 'UPDATE' and new.order_id <> old.order_id then
            raise exception 'crm: rows cannot be moved between orders';
        end if;
    end if;

    select status into v_status from crm_orders where id = v_order_id;
    if v_status in ('issued', 'cancelled') and not crm_is_internal() then
        raise exception 'Выданный или отменённый заказ нельзя изменять';
    end if;

    -- Nested ifs on purpose: PL/pgSQL doesn't short-circuit AND, and the
    -- other tables using this trigger have no order_item_id column.
    if tg_table_name = 'crm_order_materials' and tg_op <> 'DELETE' then
        if new.order_item_id is not null
            and not exists (select 1 from crm_order_items where id = new.order_item_id and order_id = new.order_id) then
            raise exception 'crm: material is linked to a line of another order';
        end if;
    end if;

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

create trigger crm_order_items_guard before insert or update or delete on crm_order_items
    for each row execute function crm_order_children_guard();
create trigger crm_order_item_staff_guard before insert or update or delete on crm_order_item_staff
    for each row execute function crm_order_children_guard();
create trigger crm_order_materials_guard before insert or update or delete on crm_order_materials
    for each row execute function crm_order_children_guard();

-- Keeps crm_orders.subtotal (and, via the guard, total) equal to its lines.
create or replace function crm_order_items_recalc() returns trigger
language plpgsql as $$
declare
    v_prev text := current_setting('crm.internal', true);
    v_order_id uuid;
begin
    if tg_op = 'DELETE' then
        v_order_id := old.order_id;
    else
        v_order_id := new.order_id;
    end if;
    perform set_config('crm.internal', 'on', true);
    update crm_orders
    set subtotal = coalesce((select sum(total) from crm_order_items where order_id = v_order_id), 0)
    where id = v_order_id;
    perform set_config('crm.internal', coalesce(v_prev, ''), true);
    return null;
end;
$$;

create trigger crm_order_items_recalc after insert or update or delete on crm_order_items
    for each row execute function crm_order_items_recalc();

-- ---------------------------------------------------------------------------
-- Payments and refunds for an order
-- ---------------------------------------------------------------------------

-- p_kind: 'payment' (client pays) or 'refund' (money returned to the client).
-- p_fx_rate: rate of the account's currency to base (ignored for base).
-- p_order_fx_rate: rate of the order's currency to base; needed only when the
-- client pays in a different currency than the order is priced in.
create or replace function crm_record_order_payment(
    p_order_id uuid,
    p_kind text,
    p_account_id uuid,
    p_amount numeric,
    p_fx_rate numeric default null,
    p_order_fx_rate numeric default null,
    p_occurred_at timestamptz default null,
    p_note text default null,
    p_actor uuid default null
) returns crm_transactions
language plpgsql as $$
declare
    v_order crm_orders;
    v_account crm_accounts;
    v_base text;
    v_rate numeric;
    v_order_rate numeric;
    v_order_amount numeric;
    v_remaining numeric;
    v_tx crm_transactions;
    v_prev text := current_setting('crm.internal', true);
begin
    if p_kind not in ('payment', 'refund') then
        raise exception 'crm: p_kind must be payment or refund';
    end if;
    if p_amount is null or p_amount <= 0 then
        raise exception 'Сумма должна быть больше нуля';
    end if;

    select * into v_order from crm_orders where id = p_order_id for update;
    if not found then
        raise exception 'Заказ не найден';
    end if;
    select * into v_account from crm_accounts where id = p_account_id and organization_id = v_order.organization_id;
    if not found then
        raise exception 'Касса не найдена';
    end if;

    v_base := crm_base_currency(v_order.organization_id);
    v_rate := case when v_account.currency = v_base then 1 else p_fx_rate end;
    if v_rate is null or v_rate <= 0 then
        raise exception 'Укажите курс % к %', v_account.currency, v_base;
    end if;

    if v_account.currency = v_order.currency then
        v_order_amount := p_amount;
    else
        v_order_rate := case when v_order.currency = v_base then 1 else p_order_fx_rate end;
        if v_order_rate is null or v_order_rate <= 0 then
            raise exception 'Укажите курс % к %', v_order.currency, v_base;
        end if;
        v_order_amount := round(p_amount * v_rate / v_order_rate, 2);
    end if;

    if p_kind = 'payment' then
        if v_order.status = 'cancelled' then
            raise exception 'Заказ отменён';
        end if;
        v_remaining := v_order.total - v_order.paid_amount;
        if v_order_amount > v_remaining then
            -- A cross-currency payment that settles the order may round a
            -- cent over the remainder; absorb that instead of rejecting it.
            if v_account.currency <> v_order.currency and v_order_amount - v_remaining <= 0.01 then
                v_order_amount := v_remaining;
            else
                raise exception 'Оплата (%) больше остатка по заказу (%)', v_order_amount, v_remaining;
            end if;
        end if;
    elsif v_order_amount > v_order.paid_amount then
        raise exception 'Возврат (%) больше оплаченной суммы (%)', v_order_amount, v_order.paid_amount;
    end if;
    if v_order_amount <= 0 then
        raise exception 'Сумма должна быть больше нуля';
    end if;

    perform set_config('crm.internal', 'on', true);
    insert into crm_transactions (
        organization_id, type, direction, account_id, amount, currency, fx_rate,
        occurred_at, order_id, order_amount, client_id, note, created_by
    ) values (
        v_order.organization_id,
        case p_kind when 'payment' then 'client_payment' else 'client_refund' end,
        case p_kind when 'payment' then 1 else -1 end,
        v_account.id, p_amount, v_account.currency, v_rate,
        coalesce(p_occurred_at, now()), v_order.id, v_order_amount, v_order.client_id, p_note, p_actor
    ) returning * into v_tx;

    update crm_orders
    set paid_amount = paid_amount + case p_kind when 'payment' then v_order_amount else -v_order_amount end,
        updated_by = coalesce(p_actor, updated_by)
    where id = v_order.id;
    perform set_config('crm.internal', coalesce(v_prev, ''), true);

    insert into crm_order_history (organization_id, order_id, user_id, event, details)
    values (v_order.organization_id, v_order.id, p_actor, p_kind, jsonb_build_object(
        'transaction_id', v_tx.id, 'amount', p_amount, 'currency', v_account.currency, 'order_amount', v_order_amount
    ));
    return v_tx;
end;
$$;

-- Undoes a ledger row by writing its mirror image (both legs of a transfer
-- together). Order payments also roll back the order's paid amount.
create or replace function crm_reverse_transaction(
    p_transaction_id uuid,
    p_actor uuid default null,
    p_reason text default null
) returns crm_transactions
language plpgsql as $$
declare
    v_tx crm_transactions;
    v_row crm_transactions;
    v_new crm_transactions;
    v_result crm_transactions;
    v_prev text := current_setting('crm.internal', true);
begin
    select * into v_tx from crm_transactions where id = p_transaction_id for update;
    if not found then
        raise exception 'Операция не найдена';
    end if;
    if v_tx.reversal_of is not null then
        raise exception 'Сторнирующую операцию нельзя сторнировать';
    end if;

    perform set_config('crm.internal', 'on', true);
    for v_row in
        select * from crm_transactions
        where reversal_of is null
          and (id = v_tx.id or (v_tx.transfer_group_id is not null and transfer_group_id = v_tx.transfer_group_id))
        order by created_at, id
        for update
    loop
        if exists (select 1 from crm_transactions where reversal_of = v_row.id) then
            raise exception 'Операция уже сторнирована';
        end if;

        if v_row.order_id is not null then
            perform 1 from crm_orders where id = v_row.order_id for update;
            update crm_orders
            set paid_amount = paid_amount - v_row.direction * v_row.order_amount,
                updated_by = coalesce(p_actor, updated_by)
            where id = v_row.order_id;
            insert into crm_order_history (organization_id, order_id, user_id, event, details)
            values (v_row.organization_id, v_row.order_id, p_actor, 'reversal', jsonb_build_object(
                'transaction_id', v_row.id, 'reason', p_reason
            ));
        end if;

        insert into crm_transactions (
            organization_id, type, direction, account_id, amount, currency, fx_rate, occurred_at,
            order_id, order_amount, client_id, staff_id, category_id, campaign_id, transfer_group_id,
            reversal_of, note, created_by
        ) values (
            v_row.organization_id, v_row.type, -v_row.direction, v_row.account_id, v_row.amount, v_row.currency,
            v_row.fx_rate, now(), v_row.order_id, v_row.order_amount, v_row.client_id, v_row.staff_id,
            v_row.category_id, v_row.campaign_id, v_row.transfer_group_id, v_row.id, p_reason, p_actor
        ) returning * into v_new;

        if v_row.id = v_tx.id then
            v_result := v_new;
        end if;
    end loop;
    perform set_config('crm.internal', coalesce(v_prev, ''), true);
    return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Issuing an order = recognizing revenue and accruing master commissions
-- ---------------------------------------------------------------------------

-- p_fx_rate: rate of the order's currency to base on the issue date (ignored
-- for base-currency orders). Revenue and costs are frozen in base currency.
create or replace function crm_issue_order(
    p_order_id uuid,
    p_fx_rate numeric default null,
    p_issued_at timestamptz default null,
    p_actor uuid default null
) returns crm_orders
language plpgsql as $$
declare
    v_order crm_orders;
    v_rate numeric;
    v_bad_line text;
    v_materials numeric;
    v_unlinked numeric;
    v_item record;
    v_staff record;
    v_rule crm_commission_rules;
    v_line_net_base numeric;
    v_line_materials numeric;
    v_base_amount numeric;
    v_amount numeric;
    v_labor numeric := 0;
    v_prev text := current_setting('crm.internal', true);
begin
    select * into v_order from crm_orders where id = p_order_id for update;
    if not found then
        raise exception 'Заказ не найден';
    end if;
    if v_order.status in ('issued', 'cancelled') then
        raise exception 'Заказ уже выдан или отменён';
    end if;
    if not exists (select 1 from crm_order_items where order_id = v_order.id) then
        raise exception 'В заказе нет услуг';
    end if;

    select i.name into v_bad_line
    from crm_order_items i
    join crm_order_item_staff s on s.order_item_id = i.id
    where i.order_id = v_order.id
    group by i.id, i.name
    having sum(s.share_percent) <> 100
    limit 1;
    if v_bad_line is not null then
        raise exception 'Доли мастеров по услуге «%» должны в сумме составлять 100%%', v_bad_line;
    end if;

    v_rate := case when v_order.currency = crm_base_currency(v_order.organization_id) then 1 else p_fx_rate end;
    if v_rate is null or v_rate <= 0 then
        raise exception 'Укажите курс % на дату выдачи', v_order.currency;
    end if;

    select coalesce(sum(total_cost_base), 0), coalesce(sum(total_cost_base) filter (where order_item_id is null), 0)
    into v_materials, v_unlinked
    from crm_order_materials where order_id = v_order.id;

    for v_item in
        select * from crm_order_items where order_id = v_order.id order by sort_order, created_at, id
    loop
        -- The order-level discount and unlinked materials are spread over
        -- lines in proportion to each line's price.
        v_line_net_base := round((v_item.total - case when v_order.subtotal > 0
            then round(v_order.discount_amount * v_item.total / v_order.subtotal, 2) else 0 end) * v_rate, 2);
        v_line_materials := coalesce((select sum(total_cost_base) from crm_order_materials where order_item_id = v_item.id), 0)
            + case when v_order.subtotal > 0 then round(v_unlinked * v_item.total / v_order.subtotal, 2) else 0 end;

        for v_staff in
            select s.staff_id, s.share_percent, st.pay_scheme
            from crm_order_item_staff s
            join crm_staff st on st.id = s.staff_id
            where s.order_item_id = v_item.id
        loop
            continue when v_staff.pay_scheme = 'salary';

            -- Most specific active rule wins (false sorts before true).
            select * into v_rule
            from crm_commission_rules r
            where r.organization_id = v_order.organization_id
              and r.is_active
              and (r.staff_id = v_staff.staff_id or r.staff_id is null)
              and (r.category_id = v_item.category_id or r.category_id is null)
            order by (r.staff_id is null), (r.category_id is null)
            limit 1;
            continue when not found;

            v_base_amount := case v_rule.base
                when 'net_price' then v_line_net_base
                when 'net_minus_materials' then greatest(v_line_net_base - v_line_materials, 0)
            end;
            v_amount := case
                when v_rule.base = 'fixed' then round(v_rule.fixed_amount * v_staff.share_percent / 100, 2)
                else round(v_base_amount * v_rule.percent / 100 * v_staff.share_percent / 100, 2)
            end;
            continue when v_amount = 0;

            insert into crm_payroll_entries (
                organization_id, staff_id, kind, amount, order_id, order_item_id, details, created_by
            ) values (
                v_order.organization_id, v_staff.staff_id, 'commission', v_amount, v_order.id, v_item.id,
                jsonb_build_object(
                    'rule_id', v_rule.id, 'base', v_rule.base, 'percent', v_rule.percent,
                    'fixed_amount', v_rule.fixed_amount, 'base_amount', v_base_amount,
                    'line_materials_base', v_line_materials, 'share_percent', v_staff.share_percent,
                    'line_name', v_item.name, 'order_number', v_order.number
                ),
                p_actor
            );
            v_labor := v_labor + v_amount;
        end loop;
    end loop;

    perform set_config('crm.internal', 'on', true);
    update crm_orders
    set status = 'issued',
        issued_at = coalesce(p_issued_at, now()),
        fx_rate_at_issue = v_rate,
        revenue_base = round(total * v_rate, 2),
        materials_cost_base = v_materials,
        labor_cost_base = v_labor,
        updated_by = coalesce(p_actor, updated_by)
    where id = v_order.id
    returning * into v_order;
    perform set_config('crm.internal', coalesce(v_prev, ''), true);

    if v_order.lead_id is not null then
        update crm_leads
        set status = 'completed', closed_at = coalesce(closed_at, now()), updated_by = coalesce(p_actor, updated_by)
        where id = v_order.lead_id and status <> 'lost';
    end if;
    return v_order;
end;
$$;

-- Undoes an issue made by mistake: revenue is un-recognized and the
-- commissions are reversed (new negative entries, history kept).
create or replace function crm_reopen_order(
    p_order_id uuid,
    p_actor uuid default null,
    p_reason text default null
) returns crm_orders
language plpgsql as $$
declare
    v_order crm_orders;
    v_prev text := current_setting('crm.internal', true);
begin
    select * into v_order from crm_orders where id = p_order_id for update;
    if not found then
        raise exception 'Заказ не найден';
    end if;
    if v_order.status <> 'issued' then
        raise exception 'Заказ не выдан';
    end if;

    insert into crm_payroll_entries (
        organization_id, staff_id, kind, amount, order_id, order_item_id, details, reversal_of, note, created_by
    )
    select e.organization_id, e.staff_id, e.kind, -e.amount, e.order_id, e.order_item_id, e.details, e.id,
           coalesce(p_reason, 'Заказ возвращён в работу'), p_actor
    from crm_payroll_entries e
    where e.order_id = v_order.id
      and e.kind = 'commission'
      and e.reversal_of is null
      and not exists (select 1 from crm_payroll_entries r where r.reversal_of = e.id);

    perform set_config('crm.internal', 'on', true);
    update crm_orders
    set status = 'ready',
        issued_at = null,
        fx_rate_at_issue = null,
        revenue_base = null,
        materials_cost_base = null,
        labor_cost_base = null,
        updated_by = coalesce(p_actor, updated_by)
    where id = v_order.id
    returning * into v_order;
    perform set_config('crm.internal', coalesce(v_prev, ''), true);

    insert into crm_order_history (organization_id, order_id, user_id, event, details)
    values (v_order.organization_id, v_order.id, p_actor, 'reopened', jsonb_build_object('reason', p_reason));

    if v_order.lead_id is not null then
        update crm_leads
        set status = 'order_created', closed_at = null, updated_by = coalesce(p_actor, updated_by)
        where id = v_order.lead_id and status = 'completed';
    end if;
    return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- Default reference data for an organization that turns the CRM on.
-- Idempotent: safe to call again; never overwrites what the owner edited.
-- ---------------------------------------------------------------------------

create or replace function crm_seed_organization(p_organization_id uuid) returns void
language plpgsql as $$
begin
    insert into crm_settings (organization_id) values (p_organization_id) on conflict do nothing;

    insert into crm_sources (organization_id, key, name, is_paid, sort_order) values
        (p_organization_id, 'instagram_ads', 'Instagram реклама', true, 10),
        (p_organization_id, 'instagram_organic', 'Instagram (органика)', false, 20),
        (p_organization_id, 'telegram', 'Telegram', false, 30),
        (p_organization_id, 'google_maps', 'Google Maps', false, 40),
        (p_organization_id, 'yandex_maps', 'Яндекс Карты', false, 50),
        (p_organization_id, 'referral', 'Рекомендация', false, 60),
        (p_organization_id, 'repeat', 'Повторный клиент', false, 70),
        (p_organization_id, 'other', 'Другое', false, 80)
    on conflict do nothing;

    insert into crm_service_categories (organization_id, key, name, sort_order) values
        (p_organization_id, 'ppf', 'PPF / бронеплёнка', 10),
        (p_organization_id, 'polishing', 'Полировка', 20),
        (p_organization_id, 'ceramic', 'Керамика', 30),
        (p_organization_id, 'dry_cleaning', 'Химчистка', 40),
        (p_organization_id, 'tinting', 'Тонировка', 50),
        (p_organization_id, 'body_repair', 'Кузовной ремонт', 60),
        (p_organization_id, 'painting', 'Покраска', 70),
        (p_organization_id, 'pdr', 'PDR / удаление вмятин без покраски', 80),
        (p_organization_id, 'electrical', 'Автоэлектрика', 90),
        (p_organization_id, 'mechanics', 'Механика', 100),
        (p_organization_id, 'other', 'Другие услуги', 110)
    on conflict do nothing;

    insert into crm_expense_categories (organization_id, key, name, kind) values
        (p_organization_id, 'materials', 'Материалы (закупка)', 'materials'),
        (p_organization_id, 'rent', 'Аренда', 'opex'),
        (p_organization_id, 'ads', 'Реклама', 'marketing'),
        (p_organization_id, 'utilities', 'Коммунальные услуги', 'opex'),
        (p_organization_id, 'other', 'Прочие расходы', 'opex')
    on conflict do nothing;

    insert into crm_accounts (organization_id, name, kind, currency) values
        (p_organization_id, 'Наличные UZS', 'cash', 'UZS'),
        (p_organization_id, 'Наличные USD', 'cash', 'USD'),
        (p_organization_id, 'Перевод UZS', 'bank_transfer', 'UZS'),
        (p_organization_id, 'Карта UZS', 'card', 'UZS')
    on conflict do nothing;

    insert into crm_roles (organization_id, key, name, is_system, permissions) values
        (p_organization_id, 'admin', 'Администратор', true, array[
            'dashboard.view', 'leads.manage', 'clients.manage', 'vehicles.manage', 'orders.manage',
            'orders.issue', 'payments.record', 'finance.view', 'finance.manage', 'staff.manage',
            'payroll.view', 'payroll.manage', 'marketing.view', 'messages.send', 'settings.manage'
        ]),
        (p_organization_id, 'manager', 'Менеджер', true, array[
            'leads.manage', 'clients.manage', 'vehicles.manage', 'orders.manage', 'orders.issue',
            'payments.record', 'messages.send'
        ]),
        (p_organization_id, 'cashier', 'Кассир', true, array[
            'payments.record', 'finance.view', 'finance.manage', 'payroll.view', 'payroll.manage'
        ]),
        (p_organization_id, 'viewer', 'Наблюдатель', true, array[
            'dashboard.view', 'finance.view', 'marketing.view'
        ])
    on conflict do nothing;
end;
$$;
