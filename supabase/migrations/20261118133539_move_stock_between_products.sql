-- Inventory changes are serialized with one another; buyers retain normal row locks.
create table public.stock_transfers (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),
 kind text not null check(kind in('account','code')),source_id uuid not null,
 from_product_id text not null references public.products(id),to_product_id text not null references public.products(id),
 quantity integer not null check(quantity between 1 and 100000),order_id uuid references public.orders(id),created_at timestamptz not null default now()
);
create index stock_transfers_actor_idx on public.stock_transfers(actor_id);
create index stock_transfers_order_idx on public.stock_transfers(order_id) where order_id is not null;
create index stock_transfers_from_idx on public.stock_transfers(from_product_id);
create index stock_transfers_to_idx on public.stock_transfers(to_product_id);
alter table public.stock_transfers enable row level security;
revoke all on public.stock_transfers from public,anon,authenticated;
grant select,insert on public.stock_transfers to service_role;
create function private.receive_account_stock(p_product text,p_email text,p_password text,p_has_screen boolean,p_screen text,p_pin text,p_info text,p_quantity integer) returns uuid language plpgsql security invoker set search_path='' as $$
declare b public.email_stock_batches%rowtype;result uuid;
begin
 perform 1 from public.products where id=p_product and delivery_type='code' for share;
 if not found then raise exception 'Invalid target product';end if;
 if p_quantity is null or p_quantity<1 or p_quantity>100000 then raise exception 'Invalid quantity';end if;
 select * into b from public.email_stock_batches where product_id=p_product and lower(email)=lower(p_email) and lower(btrim(screen))=lower(btrim(p_screen)) for update;
 if found then
  if b.password is distinct from p_password or b.pin is distinct from p_pin or b.delivery_info is distinct from p_info or b.has_screen is distinct from p_has_screen then raise exception 'Target credentials differ';end if;
  if b.remaining+p_quantity>100000 or (p_has_screen and b.remaining+p_quantity>1) then raise exception 'Target stock full';end if;
  update public.email_stock_batches set remaining=remaining+p_quantity where id=b.id;
  return b.id;
 end if;
 insert into public.email_stock_batches(product_id,email,password,has_screen,screen,pin,delivery_info,remaining)
 values(p_product,p_email,p_password,p_has_screen,p_screen,p_pin,p_info,p_quantity) returning id into result;
 return result;
end$$;
revoke all on function private.receive_account_stock(text,text,text,boolean,text,text,text,integer) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.receive_account_stock(text,text,text,boolean,text,text,text,integer) to service_role;
create function public.admin_move_stock(p_id uuid,p_kind text,p_from_product text,p_target_product text,p_actor uuid,p_expected_remaining integer default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.email_stock_batches%rowtype;s public.stock%rowtype;target_id uuid;qty integer;
begin
 if not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Admin required';end if;
 if p_kind is null or p_kind not in('account','code') or p_from_product is null or p_target_product is null or p_from_product=p_target_product then raise exception 'Invalid target product';end if;
 perform pg_advisory_xact_lock(742031182026);
 perform 1 from public.products where id=p_target_product and delivery_type='code' for share;
 if not found then raise exception 'Invalid target product';end if;
 if p_kind='account' then
  select * into b from public.email_stock_batches where id=p_id for update;
  if not found or b.product_id<>p_from_product or b.remaining<1 then raise exception 'Source stock changed';end if;
  if p_expected_remaining is null or b.remaining<>p_expected_remaining then raise exception 'Source stock changed';end if;
  qty:=b.remaining;
  target_id:=private.receive_account_stock(p_target_product,b.email,b.password,b.has_screen,b.screen,b.pin,b.delivery_info,qty);
  update public.email_stock_batches set remaining=0 where id=b.id;
 else
  select * into s from public.stock where id=p_id for update;
  if not found or s.product_id<>p_from_product or s.order_id is not null then raise exception 'Source stock changed';end if;
  qty:=1;target_id:=s.id;
  update public.stock set product_id=p_target_product where id=s.id;
 end if;
 insert into public.stock_transfers(actor_id,kind,source_id,from_product_id,to_product_id,quantity) values(p_actor,p_kind,p_id,p_from_product,p_target_product,qty);
 return jsonb_build_object('ok',true,'quantity',qty,'target_id',target_id);
end$$;
revoke all on function public.admin_move_stock(uuid,text,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.admin_move_stock(uuid,text,text,text,uuid,integer) to service_role;
create function public.admin_restock_to_product(p_order uuid,p_actor uuid,p_action text,p_password text default '',p_secret text default '',p_allow_early boolean default false,p_target_product text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.orders%rowtype;b public.email_stock_batches%rowtype;s public.stock%rowtype;prior public.order_inventory_actions%rowtype;source_product text;target_id uuid;
begin
 if not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Admin required';end if;
 if p_action is null or p_action not in('restock','remove') or p_password is null or length(p_password)>1000 or p_password ~ E'[\r\n]' or p_secret is null or length(p_secret)>16384 then raise exception 'Invalid inventory action';end if;
 perform pg_advisory_xact_lock(742031182026);
 select * into o from public.orders where id=p_order for update;
 if not found then raise exception 'Order not found';end if;
 select * into prior from public.order_inventory_actions where order_id=o.id;
 if found then
  if prior.action<>p_action then raise exception 'Order already processed';end if;
  return jsonb_build_object('ok',true,'already_processed',true,'action',prior.action);
 end if;
 if p_action='remove' or p_target_product is null or p_target_product='' then return public.admin_manage_order_inventory(p_order,p_actor,p_action,p_password,p_secret,p_allow_early);end if;
 if o.status<>'delivered' then raise exception 'Order not delivered';end if;
 if (o.expires_at is null or o.expires_at>now()) and p_allow_early is distinct from true then raise exception 'Early confirmation required';end if;
 perform 1 from public.products where id=p_target_product and delivery_type='code' for share;
 if not found then raise exception 'Invalid target product';end if;
 if o.stock_batch_id is not null then
  select * into b from public.email_stock_batches where id=o.stock_batch_id for update;
  if not found then raise exception 'Stock not found';end if;
  if b.has_screen and b.remaining>0 then raise exception 'Stock already available';end if;
  source_product:=b.product_id;
  if source_product=p_target_product then return public.admin_manage_order_inventory(p_order,p_actor,p_action,p_password,p_secret,p_allow_early);end if;
  if p_password<>'' and p_password<>b.password and exists(select 1 from public.orders x join public.email_stock_batches xb on xb.id=x.stock_batch_id where lower(xb.email)=lower(b.email) and x.id<>o.id and x.status='delivered' and (x.expires_at is null or x.expires_at>now()) and not exists(select 1 from public.order_inventory_actions z where z.order_id=x.id)) then raise exception 'Other customers active';end if;
  target_id:=private.receive_account_stock(p_target_product,b.email,case when p_password<>'' then p_password else b.password end,b.has_screen,b.screen,b.pin,b.delivery_info,1);
 elsif o.stock_item_id is not null then
  select * into s from public.stock where id=o.stock_item_id for update;
  if not found then raise exception 'Stock not found';end if;
  if s.order_id is distinct from o.id then raise exception 'Stock already available';end if;
  source_product:=s.product_id;
  if source_product=p_target_product then return public.admin_manage_order_inventory(p_order,p_actor,p_action,p_password,p_secret,p_allow_early);end if;
  insert into public.stock(product_id,secret) values(p_target_product,case when p_secret<>'' then p_secret else s.secret end) returning id into target_id;
 else raise exception 'No stock source';end if;
 insert into public.order_inventory_actions(order_id,actor_id,action) values(o.id,p_actor,'restock');
 insert into public.stock_transfers(actor_id,kind,source_id,from_product_id,to_product_id,quantity,order_id) values(p_actor,case when o.stock_batch_id is not null then 'account' else 'code' end,coalesce(o.stock_batch_id,o.stock_item_id),source_product,p_target_product,1,o.id);
 return jsonb_build_object('ok',true,'already_processed',false,'action','restock','target_id',target_id,'target_product_id',p_target_product);
end$$;
revoke all on function public.admin_restock_to_product(uuid,uuid,text,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.admin_restock_to_product(uuid,uuid,text,text,text,boolean,text) to service_role;
