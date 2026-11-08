alter table public.slipok_usage add column paused_until timestamptz;
create or replace function public.slipok_usage_status(p_day integer) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare start_date date:=public.slipok_period(p_day);next_month date:=(date_trunc('month',start_date)+interval '1 month')::date;u public.slipok_usage%rowtype;
begin
 select * into u from public.slipok_usage where period_start=start_date;
 return jsonb_build_object('period_start',start_date,'period_end',next_month+least(p_day-1,extract(day from next_month+interval '1 month - 1 day')::integer-1),'used',coalesce(u.used,0),'limit',99,'remaining',99-coalesce(u.used,0),'paused',coalesce(u.paused and u.paused_until>now(),false));
end$$;
create or replace function public.lock_slipok_check(p_id uuid,p_day integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare start_date date:=public.slipok_period(p_day);g public.slipok_gate%rowtype;u public.slipok_usage%rowtype;
begin
 if not exists(select 1 from public.topups where id=p_id and status='pending') then raise exception 'Topup not pending';end if;
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
create or replace function public.finish_slipok_check(p_id uuid,p_pause boolean default false,p_hold boolean default false) returns void language plpgsql security invoker set search_path='' as $$
declare period date;current_owner uuid;
begin
 select owner_id into current_owner from public.slipok_gate where id=true for update;
 select period_start into period from public.slipok_checks where topup_id=p_id;
 if current_owner=p_id and period is not null then update public.slipok_usage set paused=p_pause,paused_until=case when p_pause then now()+interval '30 seconds' else null end where period_start=period;end if;
 update public.slipok_checks set state='finished' where topup_id=p_id;
 if not p_hold then update public.slipok_gate set owner_id=null,lease_until=null where id=true and owner_id=p_id;end if;
end$$;