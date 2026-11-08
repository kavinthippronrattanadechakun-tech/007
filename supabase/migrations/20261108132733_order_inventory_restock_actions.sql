alter table public.orders add column stock_item_id uuid references public.stock(id);
create index orders_stock_item_idx on public.orders(stock_item_id) where stock_item_id is not null;
update public.orders o set stock_item_id=s.id from public.stock s where s.order_id=o.id;
create function public.remember_order_stock_item() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.order_id is not null and new.order_id is distinct from old.order_id then
  update public.orders set stock_item_id=new.id where id=new.order_id;
 end if;
 return new;
end$$;
revoke all on function public.remember_order_stock_item() from public,anon,authenticated;
create trigger remember_order_stock_item after update of order_id on public.stock for each row execute function public.remember_order_stock_item();
create table public.order_inventory_actions (
 order_id uuid primary key references public.orders(id),
 actor_id uuid not null references auth.users(id),
 action text not null check(action in ('restock','remove')),
 created_at timestamptz not null default now()
);
create index order_inventory_actions_actor_idx on public.order_inventory_actions(actor_id);
alter table public.order_inventory_actions enable row level security;
revoke all on public.order_inventory_actions from public,anon,authenticated;
grant select,insert on public.order_inventory_actions to service_role;
create function public.admin_order_inventory(p_order uuid,p_actor uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare o public.orders%rowtype;b public.email_stock_batches%rowtype;s public.stock%rowtype;a text;others integer;
begin
 if not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Admin required';end if;
 select * into o from public.orders where id=p_order;if not found then raise exception 'Order not found';end if;
 select action into a from public.order_inventory_actions where order_id=o.id;
 if o.stock_batch_id is not null then
  select * into b from public.email_stock_batches where id=o.stock_batch_id;
  select count(*) into others from public.orders x where x.stock_batch_id=b.id and x.id<>o.id and x.status='delivered' and (x.expires_at is null or x.expires_at>now()) and not exists(select 1 from public.order_inventory_actions z where z.order_id=x.id);
  return jsonb_build_object('kind','account','email',b.email,'screen',b.screen,'has_screen',b.has_screen,'remaining',b.remaining,'active_others',others,'action',a,'can_restock',o.status='delivered' and o.expires_at<=now() and a is null and b.id is not null);
 end if;
 select * into s from public.stock where id=o.stock_item_id;
 return jsonb_build_object('kind',case when s.id is null then 'manual' else 'code' end,'secret',s.secret,'action',a,'can_restock',o.status='delivered' and o.expires_at<=now() and a is null and s.id is not null,'active_others',0);
end$$;
revoke all on function public.admin_order_inventory(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_order_inventory(uuid,uuid) to service_role;
create function public.admin_manage_order_inventory(p_order uuid,p_actor uuid,p_action text,p_password text default '',p_secret text default '') returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.orders%rowtype;b public.email_stock_batches%rowtype;s public.stock%rowtype;prior text;
begin
 if not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Admin required';end if;
 if p_action is null or p_action not in('restock','remove') or p_password is null or length(p_password)>1000 or p_password ~ E'[\r\n]' or p_secret is null or length(p_secret)>16384 then raise exception 'Invalid inventory action';end if;
 select * into o from public.orders where id=p_order for update;if not found then raise exception 'Order not found';end if;
 select action into prior from public.order_inventory_actions where order_id=o.id;
 if found then
  if prior<>p_action then raise exception 'Order already processed';end if;
  return jsonb_build_object('ok',true,'already_processed',true,'action',prior);
 end if;
 if o.status<>'delivered' then raise exception 'Order not delivered';end if;
 if p_action='restock' then
  if o.expires_at is null or o.expires_at>now() then raise exception 'Order not expired';end if;
  if o.stock_batch_id is not null then
   select * into b from public.email_stock_batches where id=o.stock_batch_id for update;
   if not found then raise exception 'Stock not found';end if;
   if b.remaining>=100000 or (b.has_screen and b.remaining>=1) then raise exception 'Stock already available';end if;
   if p_password<>'' and p_password<>b.password and exists(select 1 from public.orders x where x.stock_batch_id=b.id and x.id<>o.id and x.status='delivered' and (x.expires_at is null or x.expires_at>now()) and not exists(select 1 from public.order_inventory_actions a where a.order_id=x.id)) then raise exception 'Other customers active';end if;
   update public.email_stock_batches set remaining=remaining+1,password=case when p_password<>'' then p_password else password end where id=b.id;
  elsif o.stock_item_id is not null then
   select * into s from public.stock where id=o.stock_item_id for update;
   if not found then raise exception 'Stock not found';end if;
   if s.order_id is distinct from o.id then raise exception 'Stock already available';end if;
   update public.stock set order_id=null,secret=case when p_secret<>'' then p_secret else secret end where id=s.id;
  else raise exception 'No stock source';end if;
 end if;
 insert into public.order_inventory_actions(order_id,actor_id,action) values(o.id,p_actor,p_action);
 return jsonb_build_object('ok',true,'already_processed',false,'action',p_action);
end$$;
revoke all on function public.admin_manage_order_inventory(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_manage_order_inventory(uuid,uuid,text,text,text) to service_role;

drop function public.admin_order_list(text,text,integer);
drop function private.admin_order_rows(text,text,integer);
create function private.admin_order_rows(p_query text default '',p_status text default '',p_offset integer default 0)
 returns table(id uuid,user_id uuid,user_email text,product_title text,price integer,status text,delivery text,customer_email text,created_at timestamptz,duration_days integer,expires_at timestamptz,inventory_action text)
 language sql stable security definer set search_path='' as $$
 select o.id,o.user_id,u.email::text,p.title,o.price,o.status,o.delivery,o.customer_email,o.created_at,o.duration_days,o.expires_at,a.action
 from public.orders o join auth.users u on u.id=o.user_id join public.products p on p.id=o.product_id left join public.order_inventory_actions a on a.order_id=o.id
 where (p_status='' or o.status=p_status or (p_status='expired' and o.expires_at<=now() and a.order_id is null)) and (p_query='' or position(lower(p_query) in lower(coalesce(u.email,'')||' '||o.id::text||' '||p.title))>0)
 order by o.created_at desc,o.id desc limit 51 offset greatest(0,least(p_offset,100000));
$$;

revoke all on function private.admin_order_rows(text,text,integer) from public,anon,authenticated;
grant execute on function private.admin_order_rows(text,text,integer) to service_role;
create function public.admin_order_list(p_query text default '',p_status text default '',p_offset integer default 0)
 returns table(id uuid,user_id uuid,user_email text,product_title text,price integer,status text,delivery text,customer_email text,created_at timestamptz,duration_days integer,expires_at timestamptz,inventory_action text)
 language sql stable security invoker set search_path='' as $$
 select * from private.admin_order_rows(p_query,p_status,p_offset);
$$;
revoke all on function public.admin_order_list(text,text,integer) from public,anon,authenticated;
grant execute on function public.admin_order_list(text,text,integer) to service_role;
