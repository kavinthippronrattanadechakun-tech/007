-- Search the immutable delivery snapshot so the sold email remains searchable after stock edits or reuse.
create or replace function private.admin_order_rows(p_query text default '',p_status text default '',p_offset integer default 0)
 returns table(id uuid,user_id uuid,user_email text,product_title text,price integer,status text,delivery text,customer_email text,created_at timestamptz,duration_days integer,expires_at timestamptz,inventory_action text,fulfillment_type text,delivered_at timestamptz)
 language sql stable security definer set search_path='' as $$
 select o.id,o.user_id,u.email::text,p.title,o.price,o.status,o.delivery,o.customer_email,o.created_at,o.duration_days,o.expires_at,a.action,o.fulfillment_type,o.delivered_at
 from public.orders o join auth.users u on u.id=o.user_id join public.products p on p.id=o.product_id left join public.order_inventory_actions a on a.order_id=o.id
 where (p_status='' or o.status=p_status
 or (p_status='expired' and o.status='delivered' and o.expires_at<=now() and a.order_id is null)
 or (p_status='active' and o.status='delivered' and (o.expires_at is null or o.expires_at>now()) and a.order_id is null)
 or (p_status='pending_restock' and o.status='delivered' and a.order_id is null)
 or (p_status='manual_pending' and o.fulfillment_type='manual' and o.status='processing')
 or (p_status='manual_delivered' and o.fulfillment_type='manual' and o.status='delivered')
 or (p_status='manual_all' and o.fulfillment_type='manual')
 or (p_status='restocked' and a.action='restock') or (p_status='removed' and a.action='remove')) and (p_query='' or position(lower(p_query) in lower(coalesce(u.email,'')||' '||o.id::text||' '||p.title||' '||coalesce(o.customer_email,'')||' '||coalesce(o.delivery,'')))>0)
 order by o.created_at desc,o.id desc limit 51 offset greatest(0,least(p_offset,100000));
$$;

revoke all on function private.admin_order_rows(text,text,integer) from public,anon,authenticated;
grant execute on function private.admin_order_rows(text,text,integer) to service_role;
