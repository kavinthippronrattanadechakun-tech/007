alter table public.products add column duration_days integer check(duration_days between 1 and 3650);
grant insert(duration_days),update(duration_days) on public.products to authenticated;
-- Initialize existing packages only when their title explicitly says 1, 7 or 30 days.
update public.products set duration_days=(regexp_match(title,'(?:^|[^0-9])(1|7|30)[[:space:]]*วัน'))[1]::integer
 where title ~ '(?:^|[^0-9])(1|7|30)[[:space:]]*วัน';
alter table public.orders add column duration_days integer check(duration_days between 1 and 3650),add column expires_at timestamptz;
update public.orders o set duration_days=p.duration_days,expires_at=o.created_at+p.duration_days*interval '24 hours'
 from public.products p where o.product_id=p.id and p.duration_days is not null;
create function public.snapshot_order_expiry() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 select duration_days into new.duration_days from public.products where id=new.product_id;
 new.expires_at:=case when new.duration_days is not null then new.created_at+new.duration_days*interval '24 hours' else null end;
 return new;
end$$;
revoke all on function public.snapshot_order_expiry() from public,anon,authenticated;
create trigger snapshot_order_expiry before insert on public.orders for each row execute function public.snapshot_order_expiry();
alter table public.orders add constraint order_expiry_shape check ((duration_days is null and expires_at is null) or (duration_days is not null and expires_at is not null and expires_at=created_at+duration_days*interval '24 hours'));
drop function public.admin_order_list(text,text,integer);
create function public.admin_order_list(p_query text default '',p_status text default '',p_offset integer default 0)
 returns table(id uuid,user_id uuid,user_email text,product_title text,price integer,status text,delivery text,customer_email text,created_at timestamptz,duration_days integer,expires_at timestamptz)
 language sql stable security invoker set search_path='' as $$
 select o.id,o.user_id,u.email::text,p.title,o.price,o.status,o.delivery,o.customer_email,o.created_at,o.duration_days,o.expires_at
 from public.orders o join auth.users u on u.id=o.user_id join public.products p on p.id=o.product_id
 where (p_status='' or o.status=p_status) and (p_query='' or position(lower(p_query) in lower(coalesce(u.email,'')||' '||o.id::text||' '||p.title))>0)
 order by o.created_at desc,o.id desc limit 51 offset greatest(0,least(p_offset,100000));
$$;
revoke all on function public.admin_order_list(text,text,integer) from public,anon,authenticated;
grant execute on function public.admin_order_list(text,text,integer) to service_role;
