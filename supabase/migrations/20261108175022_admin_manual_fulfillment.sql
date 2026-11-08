alter table public.orders add column fulfillment_type text check(fulfillment_type in('manual','code')),
 add column delivered_at timestamptz,add column delivered_by uuid references auth.users(id);
update public.orders o set fulfillment_type=case when o.stock_batch_id is not null or o.stock_item_id is not null then 'code' when o.status='processing' then 'manual' else p.delivery_type end from public.products p where p.id=o.product_id;
alter table public.orders alter column fulfillment_type set not null;
create index orders_manual_pending_idx on public.orders(created_at desc) where fulfillment_type='manual' and status='processing';
create index orders_delivered_by_idx on public.orders(delivered_by) where delivered_by is not null;
create or replace function public.snapshot_order_expiry() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 select duration_days,delivery_type into new.duration_days,new.fulfillment_type from public.products where id=new.product_id;
 new.expires_at:=case when new.duration_days is not null then new.created_at+new.duration_days*interval '24 hours' else null end;
 return new;
end$$;
create function public.admin_fulfill_order(p_order uuid,p_actor uuid,p_delivery text default '') returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.orders%rowtype;
begin
 if not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Admin required';end if;
 if p_delivery is null or length(p_delivery)>16384 then raise exception 'Invalid delivery';end if;
 select * into o from public.orders where id=p_order for update;if not found then raise exception 'Order not found';end if;
 if o.fulfillment_type<>'manual' then raise exception 'Not manual order';end if;
 if o.status='delivered' then return jsonb_build_object('ok',true,'already_delivered',true,'delivered_at',o.delivered_at);end if;
 if o.status<>'processing' then raise exception 'Order not pending';end if;
 update public.orders set status='delivered',delivered_at=now(),delivered_by=p_actor,
 delivery=case when btrim(p_delivery)<>'' then p_delivery else delivery end where id=o.id;
 return jsonb_build_object('ok',true,'already_delivered',false,'delivered_at',now());
end$$;
revoke all on function public.admin_fulfill_order(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_fulfill_order(uuid,uuid,text) to service_role;

drop function public.admin_order_list(text,text,integer);
drop function private.admin_order_rows(text,text,integer);
create function private.admin_order_rows(p_query text default '',p_status text default '',p_offset integer default 0)
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
 or (p_status='restocked' and a.action='restock') or (p_status='removed' and a.action='remove')) and (p_query='' or position(lower(p_query) in lower(coalesce(u.email,'')||' '||o.id::text||' '||p.title))>0)
 order by o.created_at desc,o.id desc limit 51 offset greatest(0,least(p_offset,100000));
$$;

revoke all on function private.admin_order_rows(text,text,integer) from public,anon,authenticated;
grant execute on function private.admin_order_rows(text,text,integer) to service_role;
create function public.admin_order_list(p_query text default '',p_status text default '',p_offset integer default 0)
 returns table(id uuid,user_id uuid,user_email text,product_title text,price integer,status text,delivery text,customer_email text,created_at timestamptz,duration_days integer,expires_at timestamptz,inventory_action text,fulfillment_type text,delivered_at timestamptz)
 language sql stable security invoker set search_path='' as $$
 select * from private.admin_order_rows(p_query,p_status,p_offset);
$$;
revoke all on function public.admin_order_list(text,text,integer) from public,anon,authenticated;
grant execute on function public.admin_order_list(text,text,integer) to service_role;
