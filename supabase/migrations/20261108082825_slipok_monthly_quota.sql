alter table public.topups drop constraint topups_verification_provider_check;
alter table public.topups add constraint topups_verification_provider_check check(verification_provider in ('manual','easyslip','slipverify','slipok'));
create table public.slipok_usage(period_start date primary key,used integer not null default 0 check(used between 0 and 99),paused boolean not null default false);
create table public.slipok_checks(topup_id uuid primary key references public.topups(id),period_start date not null references public.slipok_usage(period_start),state text not null default 'reserved' check(state in ('reserved','sent','finished')),created_at timestamptz not null default now());
create index slipok_checks_period_idx on public.slipok_checks(period_start);
create table public.slipok_gate(id boolean primary key default true check(id),owner_id uuid,lease_until timestamptz);
insert into public.slipok_gate(id) values(true);
alter table public.slipok_usage enable row level security;
alter table public.slipok_checks enable row level security;
alter table public.slipok_gate enable row level security;
revoke all on public.slipok_usage,public.slipok_checks,public.slipok_gate from anon,authenticated;
grant select,insert,update on public.slipok_usage,public.slipok_checks,public.slipok_gate to service_role;
create function public.slipok_period(p_day integer,p_now timestamptz default now()) returns date language plpgsql stable security invoker set search_path='' as $$
declare today date:=timezone('Asia/Bangkok',p_now)::date;month_start date;candidate date;
begin
 if p_day is null or p_day<1 or p_day>31 then raise exception 'Invalid cycle day';end if;
 month_start:=date_trunc('month',today)::date;
 candidate:=month_start+least(p_day-1,(extract(day from month_start+interval '1 month - 1 day')::integer)-1);
 if today<candidate then month_start:=(month_start-interval '1 month')::date;candidate:=month_start+least(p_day-1,extract(day from month_start+interval '1 month - 1 day')::integer-1);end if;
 return candidate;
end$$;
create function public.slipok_usage_status(p_day integer) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare start_date date:=public.slipok_period(p_day);next_month date:=(date_trunc('month',start_date)+interval '1 month')::date;u public.slipok_usage%rowtype;
begin
 select * into u from public.slipok_usage where period_start=start_date;
 return jsonb_build_object('period_start',start_date,'period_end',next_month+least(p_day-1,extract(day from next_month+interval '1 month - 1 day')::integer-1),'used',coalesce(u.used,0),'limit',99,'remaining',99-coalesce(u.used,0),'paused',coalesce(u.paused,false));
end$$;
create function public.lock_slipok_check(p_id uuid,p_day integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare start_date date:=public.slipok_period(p_day);g public.slipok_gate%rowtype;u public.slipok_usage%rowtype;
begin
 if not exists(select 1 from public.topups where id=p_id and status='pending') then raise exception 'Topup not pending';end if;
 select * into g from public.slipok_gate where id=true for update;
 if g.lease_until>now() then return jsonb_build_object('allowed',false,'reason','busy');end if;
 insert into public.slipok_usage(period_start) values(start_date) on conflict do nothing;
 select * into u from public.slipok_usage where period_start=start_date for update;
 if u.used>=99 or u.paused then return jsonb_build_object('allowed',false,'reason','quota');end if;
 if exists(select 1 from public.slipok_checks where topup_id=p_id) then return jsonb_build_object('allowed',false,'reason','already_attempted');end if;
 insert into public.slipok_checks(topup_id,period_start) values(p_id,start_date);
 update public.slipok_gate set owner_id=p_id,lease_until=now()+interval '2 minutes' where id=true;
 return jsonb_build_object('allowed',true);
end$$;
create function public.consume_slipok_check(p_id uuid,p_day integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.slipok_checks%rowtype;g public.slipok_gate%rowtype;used_count integer;
begin
 select * into g from public.slipok_gate where id=true for update;
 if g.owner_id is distinct from p_id or g.lease_until<=now() then return jsonb_build_object('allowed',false);end if;
 select * into c from public.slipok_checks where topup_id=p_id for update;
 if not found or c.state<>'reserved' or c.period_start<>public.slipok_period(p_day) then return jsonb_build_object('allowed',false);end if;
 update public.slipok_usage set used=used+1 where period_start=c.period_start and used<99 and not paused returning used into used_count;
 if not found then return jsonb_build_object('allowed',false);end if;
 update public.slipok_checks set state='sent' where topup_id=p_id;
 return jsonb_build_object('allowed',true,'used',used_count);
end$$;
create function public.finish_slipok_check(p_id uuid,p_pause boolean default false,p_hold boolean default false) returns void language plpgsql security invoker set search_path='' as $$
declare period date;
begin
 perform 1 from public.slipok_gate where id=true for update;
 select period_start into period from public.slipok_checks where topup_id=p_id;
 if p_pause and period is not null then update public.slipok_usage set paused=true where period_start=period;end if;
 update public.slipok_checks set state='finished' where topup_id=p_id;
 if not p_hold then update public.slipok_gate set owner_id=null,lease_until=null where id=true and owner_id=p_id;end if;
end$$;
revoke all on function public.slipok_period(integer,timestamptz),public.slipok_usage_status(integer),public.lock_slipok_check(uuid,integer),public.consume_slipok_check(uuid,integer),public.finish_slipok_check(uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.slipok_period(integer,timestamptz),public.slipok_usage_status(integer),public.lock_slipok_check(uuid,integer),public.consume_slipok_check(uuid,integer),public.finish_slipok_check(uuid,boolean,boolean) to service_role;

create or replace function public.credit_verified_topup(p_id uuid,p_reference text,p_amount integer,p_transfer_at timestamptz,p_account_number text,p_bank_name text,p_account_name text)
 returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.topups%rowtype;settings public.store_settings%rowtype;created timestamptz;
begin
 select * into t from public.topups where id=p_id for update;
 if not found then raise exception 'Topup not found';end if;
 if p_reference is null or p_reference !~ '^[A-Z0-9_-]{6,200}$' or p_amount is null or p_amount<>t.amount then raise exception 'Verification mismatch';end if;
 if t.status='approved' and t.bank_reference=p_reference then return jsonb_build_object('ok',true,'already_credited',true);end if;
 if t.status<>'pending' then raise exception 'Topup already reviewed';end if;
 select * into settings from public.store_settings where id=true for share;
 if not found or p_account_number is null or p_bank_name is null or p_account_name is null or regexp_replace(settings.bank_account_number,'[ -]','','g')<>p_account_number or settings.bank_name<>p_bank_name or settings.bank_account_name<>p_account_name then raise exception 'Receiver settings changed';end if;
 select created_at into created from public.profiles where id=t.user_id;
 if p_transfer_at is null or p_transfer_at>now()+interval '5 minutes' or p_transfer_at<greatest(now()-interval '24 hours',created-interval '5 minutes') then raise exception 'Invalid transfer time';end if;
 update public.topups set status='approved',bank_reference=p_reference,verification_provider=case when t.verification_provider in ('slipverify','slipok') then t.verification_provider else 'easyslip' end,transfer_at=p_transfer_at,verified_at=now() where id=t.id;
 update public.profiles set balance=balance+t.amount where id=t.user_id;
 if not found then raise exception 'Wallet not found';end if;
 insert into public.wallet_ledger(user_id,delta,source_type,source_id) values(t.user_id,t.amount,'topup',t.id);
 return jsonb_build_object('ok',true,'already_credited',false);
end$$;
revoke all on function public.credit_verified_topup(uuid,text,integer,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.credit_verified_topup(uuid,text,integer,timestamptz,text,text,text) to service_role;
