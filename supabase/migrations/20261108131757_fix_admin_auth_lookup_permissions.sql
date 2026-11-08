-- Narrow, service-only private helpers read auth emails without granting access to auth.users.
create schema if not exists private;
grant usage on schema private to service_role;
create function private.admin_customer_row(p_email text)
 returns table(id uuid,email text,balance bigint) language sql stable security definer set search_path='' as $$
 select p.id,u.email::text,p.balance::bigint from public.profiles p join auth.users u on u.id=p.id where lower(u.email)=lower(btrim(p_email)) limit 1;
$$;
revoke all on function private.admin_customer_row(text) from public,anon,authenticated;
grant execute on function private.admin_customer_row(text) to service_role;
create or replace function public.admin_customer_lookup(p_email text)
 returns table(id uuid,email text,balance bigint) language sql stable security invoker set search_path='' as $$
 select * from private.admin_customer_row(p_email);
$$;
revoke all on function public.admin_customer_lookup(text) from public,anon,authenticated;
grant execute on function public.admin_customer_lookup(text) to service_role;
create function private.admin_order_rows(p_query text default '',p_status text default '',p_offset integer default 0)
 returns table(id uuid,user_id uuid,user_email text,product_title text,price integer,status text,delivery text,customer_email text,created_at timestamptz,duration_days integer,expires_at timestamptz)
 language sql stable security definer set search_path='' as $$
 select o.id,o.user_id,u.email::text,p.title,o.price,o.status,o.delivery,o.customer_email,o.created_at,o.duration_days,o.expires_at
 from public.orders o join auth.users u on u.id=o.user_id join public.products p on p.id=o.product_id
 where (p_status='' or o.status=p_status) and (p_query='' or position(lower(p_query) in lower(coalesce(u.email,'')||' '||o.id::text||' '||p.title))>0)
 order by o.created_at desc,o.id desc limit 51 offset greatest(0,least(p_offset,100000));
$$;

revoke all on function private.admin_order_rows(text,text,integer) from public,anon,authenticated;
grant execute on function private.admin_order_rows(text,text,integer) to service_role;
create or replace function public.admin_order_list(p_query text default '',p_status text default '',p_offset integer default 0)
 returns table(id uuid,user_id uuid,user_email text,product_title text,price integer,status text,delivery text,customer_email text,created_at timestamptz,duration_days integer,expires_at timestamptz)
 language sql stable security invoker set search_path='' as $$
 select * from private.admin_order_rows(p_query,p_status,p_offset);
$$;
revoke all on function public.admin_order_list(text,text,integer) from public,anon,authenticated;
grant execute on function public.admin_order_list(text,text,integer) to service_role;
