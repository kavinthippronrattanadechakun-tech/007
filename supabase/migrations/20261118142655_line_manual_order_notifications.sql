-- Only the server may read LINE destinations, settings and delivery jobs.
create table public.line_destinations (
 id text primary key check(id ~ '^[UCR][0-9a-f]{32}$'),kind text not null check(kind in('user','group','room')),last_seen_at timestamptz not null default now()
);
create table public.line_settings (
 id boolean primary key default true check(id), enabled boolean not null default false,
 target_id text references public.line_destinations(id), updated_by uuid references auth.users(id),updated_at timestamptz not null default now()
);
insert into public.line_settings(id) values(true);
create table public.line_order_notifications (
 id uuid primary key default gen_random_uuid(),order_id uuid not null unique references public.orders(id),
 message text not null,target_id text,retry_key uuid not null default gen_random_uuid(),
 status text not null default 'pending' check(status in('pending','sending','sent','failed','skipped')),
 attempts integer not null default 0 check(attempts>=0),first_attempt_at timestamptz,
 lease_token uuid,locked_until timestamptz,next_attempt_at timestamptz not null default now(),
 last_error text,sent_at timestamptz,created_at timestamptz not null default now()
);
create index line_jobs_due_idx on public.line_order_notifications(next_attempt_at) where status in('pending','sending');
create index line_settings_updated_by_idx on public.line_settings(updated_by);
alter table public.line_destinations enable row level security;
alter table public.line_settings enable row level security;
alter table public.line_order_notifications enable row level security;
revoke all on public.line_destinations,public.line_settings,public.line_order_notifications from public,anon,authenticated;
grant select,insert,update on public.line_destinations,public.line_settings,public.line_order_notifications to service_role;
create function private.queue_manual_order_line() returns trigger language plpgsql security definer set search_path='' as $$
declare title text;buyer text;
begin
 if new.fulfillment_type='manual' and new.status='processing' then
  select p.title into title from public.products p where p.id=new.product_id;
  select email into buyer from auth.users where id=new.user_id;
  insert into public.line_order_notifications(order_id,message) values(new.id,
   concat_ws(E'\n','🛎️ คำสั่งซื้อใหม่ · ร้านต้องจัดส่งเอง', 'สินค้า: '||left(title,400),'ยอด: '||new.price||' บาท',
   'บัญชีลูกค้า: '||left(coalesce(buyer,'-'),320),case when new.customer_email is not null then 'เมลรับสินค้า: '||left(new.customer_email,320) end,
   'เลขคำสั่งซื้อ: '||new.id,'เปิดหลังบ้าน → รายการจัดส่งเอง', 'https://kingkeawlnwza.vercel.app/#admin/manual')) on conflict(order_id) do nothing;
 end if;
 return new;
end$$;
revoke all on function private.queue_manual_order_line() from public,anon,authenticated;
create trigger queue_manual_order_line after insert on public.orders for each row execute function private.queue_manual_order_line();
create function public.claim_line_order_notification(p_order uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg public.line_settings%rowtype;j public.line_order_notifications%rowtype;lease uuid:=gen_random_uuid();
begin
 select * into cfg from public.line_settings where id=true;
 if cfg.enabled is distinct from true or cfg.target_id is null then return null;end if;
 update public.line_order_notifications n set status='skipped',last_error=null where n.status in('pending','failed') and exists(select 1 from public.orders o where o.id=n.order_id and (o.status<>'processing' or o.fulfillment_type<>'manual'));
 update public.line_order_notifications set status='failed',last_error='retry_window_expired' where status in('pending','sending') and first_attempt_at<now()-interval '23 hours' and (locked_until is null or locked_until<now());
 update public.line_order_notifications set status='failed',last_error='attempts_exhausted' where status='sending' and locked_until<now() and attempts>=5;
 select n.* into j from public.line_order_notifications n join public.orders o on o.id=n.order_id
 where (p_order is null or n.order_id=p_order) and o.status='processing' and o.fulfillment_type='manual'
 and (n.status='pending' or (n.status='sending' and n.locked_until<now())) and n.next_attempt_at<=now() and n.attempts<5
 order by n.created_at,n.id limit 1 for update of n skip locked;
 if not found then return null;end if;
 update public.line_order_notifications set status='sending',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),target_id=coalesce(target_id,cfg.target_id),lease_token=lease,locked_until=now()+interval '1 minute' where id=j.id
 returning * into j;
 return jsonb_build_object('id',j.id,'order_id',j.order_id,'text',j.message,'to',j.target_id,'retry_key',j.retry_key,'lease_token',lease);
end$$;
create function public.finish_line_order_notification(p_id uuid,p_lease uuid,p_success boolean,p_error text default null,p_retryable boolean default true) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update public.line_order_notifications set status=case when p_success then 'sent' when p_retryable and attempts<5 then 'pending' else 'failed' end,
 sent_at=case when p_success then now() else null end,last_error=case when p_success then null else left(p_error,80) end,
 locked_until=null,lease_token=null,next_attempt_at=now()+interval '1 minute'*least(60,power(2,attempts)::integer)
 where id=p_id and lease_token=p_lease and status='sending';
 return found;
end$$;
revoke all on function public.claim_line_order_notification(uuid),public.finish_line_order_notification(uuid,uuid,boolean,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_line_order_notification(uuid),public.finish_line_order_notification(uuid,uuid,boolean,text,boolean) to service_role;
-- Explicit admin retry. Never re-send completed jobs or orders already delivered.
create function public.retry_line_order_notifications(p_actor uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Admin required';end if;
 update public.line_order_notifications n set status='pending',attempts=0,next_attempt_at=now(),last_error=null,
 retry_key=case when first_attempt_at<now()-interval '23 hours' then gen_random_uuid() else retry_key end,
 first_attempt_at=case when first_attempt_at<now()-interval '23 hours' then null else first_attempt_at end
 where n.status in('pending','failed') and exists(select 1 from public.orders o where o.id=n.order_id and o.status='processing' and o.fulfillment_type='manual');
end$$;
revoke all on function public.retry_line_order_notifications(uuid) from public,anon,authenticated;
grant execute on function public.retry_line_order_notifications(uuid) to service_role;
