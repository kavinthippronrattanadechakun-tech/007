alter table public.topups drop constraint topups_slip_hash_key;
create unique index topups_active_slip_hash_unique on public.topups(slip_hash) where status in ('pending','approved');
create index topups_slip_hash_history_idx on public.topups(slip_hash);
alter table public.topups add column retry_of uuid references public.topups(id),add column rejection_code text;
create index topups_retry_of_idx on public.topups(retry_of) where retry_of is not null;
create table public.verified_slip_receipts (
 slip_hash text primary key check(slip_hash ~ '^[0-9a-f]{64}$'),
 user_id uuid not null references auth.users(id),
 reference text not null unique check(reference ~ '^[A-Z0-9_-]{6,200}$'),
 amount integer not null check(amount between 1 and 100000),
 transfer_at timestamptz not null,
 bank_code text not null check(bank_code ~ '^[0-9]{3}$'),
 account_number text not null check(account_number ~ '^[0-9]{5,40}$'),
 verified_at timestamptz not null default now()
);
create index verified_slip_receipts_user_idx on public.verified_slip_receipts(user_id);
alter table public.verified_slip_receipts enable row level security;
revoke all on public.verified_slip_receipts from anon,authenticated;
grant select,insert on public.verified_slip_receipts to service_role;
create or replace function public.reserve_topup(p_id uuid,p_user_id uuid,p_amount integer,p_path text,p_hash text)
 returns uuid language plpgsql security invoker set search_path='' as $$
declare previous_id uuid;
begin
 if p_amount is null or p_amount<1 or p_amount>100000 or p_path is null or p_path not like p_user_id::text||'/%' or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid topup';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_hash,0));
 perform 1 from public.topups where slip_hash=p_hash order by created_at,id for update;
 if exists(select 1 from public.topups t where t.slip_hash=p_hash and (t.status='approved' or exists(select 1 from public.wallet_ledger l where l.source_type='topup' and l.source_id=t.id))) then raise exception 'Slip already credited';end if;
 if exists(select 1 from public.topups where slip_hash=p_hash and user_id<>p_user_id) then raise exception 'Slip belongs to another user';end if;
 if exists(select 1 from public.topups t join public.slipok_gate g on g.owner_id=t.id where t.slip_hash=p_hash and g.lease_until>now()) then raise exception 'Slip is processing';end if;
 perform 1 from public.profiles where id=p_user_id for update;
 if not found then raise exception 'Profile not found';end if;
 if (select count(*) from public.topups where user_id=p_user_id and created_at>now()-interval '1 minute')>=5 then raise exception 'Too many topups';end if;
 select id into previous_id from public.topups where slip_hash=p_hash order by created_at desc,id desc limit 1;
 update public.topups set status='rejected',rejection_code='superseded' where slip_hash=p_hash and status='pending';
 insert into public.topups(id,user_id,amount,slip_path,slip_hash,retry_of) values(p_id,p_user_id,p_amount,p_path,p_hash,previous_id);
 return p_id;
end$$;

create or replace function public.lock_slipok_check(p_id uuid,p_day integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare start_date date:=public.slipok_period(p_day);g public.slipok_gate%rowtype;u public.slipok_usage%rowtype;
begin
 perform 1 from public.topups where id=p_id and status='pending' for update;
 if not found then raise exception 'Topup not pending';end if;
 select * into g from public.slipok_gate where id=true for update;
 if g.lease_until>now() then return jsonb_build_object('allowed',false,'reason','busy');end if;
 insert into public.slipok_usage(period_start) values(start_date) on conflict do nothing;
 select * into u from public.slipok_usage where period_start=start_date for update;
 if u.used>=99 then return jsonb_build_object('allowed',false,'reason','quota');end if;
 if u.paused and u.paused_until>now() then return jsonb_build_object('allowed',false,'reason','provider_pause');end if;
 update public.slipok_usage set paused=false,paused_until=null where period_start=start_date;
 if exists(select 1 from public.slipok_checks where topup_id=p_id) then return jsonb_build_object('allowed',false,'reason','already_attempted');end if;
 insert into public.slipok_checks(topup_id,period_start) values(p_id,start_date);
 update public.slipok_gate set owner_id=p_id,lease_until=now()+interval '2 minutes' where id=true;
 return jsonb_build_object('allowed',true);
end$$;
