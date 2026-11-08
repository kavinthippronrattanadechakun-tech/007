begin;
do $$
declare u uuid;pid text:='expiry-test-'||gen_random_uuid();oid uuid;original timestamptz;n integer;start_at timestamptz:='2026-12-31 23:30:00+00';
begin
 select id into u from public.profiles limit 1;
 insert into public.products(id,title,price,active,delivery_type,duration_days) values(pid,'Expiry test',1,true,'manual',1);
 foreach n in array array[1,7,30] loop
  update public.products set duration_days=n where id=pid;
  insert into public.orders(user_id,product_id,price,status,created_at) values(u,pid,1,'processing',start_at) returning id into oid;
  if not exists(select 1 from public.orders where id=oid and duration_days=n and extract(epoch from expires_at-created_at)=n*86400) then raise exception 'duration % not exact hours',n;end if;
 end loop;
 select expires_at into original from public.orders where id=oid;
 update public.products set duration_days=7 where id=pid;
 if (select expires_at from public.orders where id=oid)<>original then raise exception 'historical expiry changed';end if;
 -- A day remains 24 hours across DST, independent of the database session timezone.
 perform set_config('TimeZone','America/New_York',true);
 update public.products set duration_days=1 where id=pid;
 insert into public.orders(user_id,product_id,price,status,created_at) values(u,pid,1,'processing','2026-03-08 00:00:00-05') returning id into oid;
 if (select extract(epoch from expires_at-created_at) from public.orders where id=oid)<>86400 then raise exception 'DST changed day length';end if;
 update public.products set duration_days=null where id=pid;
 insert into public.orders(user_id,product_id,price,status,created_at) values(u,pid,1,'processing',start_at) returning id into oid;
 if exists(select 1 from public.orders where id=oid and (duration_days is not null or expires_at is not null)) then raise exception 'no duration got false expiry';end if;
 if has_function_privilege('authenticated','public.admin_order_list(text,text,integer)','execute') or has_function_privilege('authenticated','private.admin_customer_row(text)','execute') then raise exception 'private data exposed';end if;
end$$;
set local role service_role;
select count(*) as admin_order_lookup_executes from public.admin_order_list('__expiry_no_match__','',0);
rollback;
