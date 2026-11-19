-- Edit future delivery notes without rewriting prior order snapshots.
create function public.admin_order_inventory_details(p_order uuid,p_actor uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;info text;
begin
 result:=public.admin_order_inventory(p_order,p_actor);
 select b.delivery_info into info from public.orders o join public.email_stock_batches b on b.id=o.stock_batch_id where o.id=p_order;
 return result||jsonb_build_object('delivery_info',coalesce(info,''));
end$$;
revoke all on function public.admin_order_inventory_details(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_order_inventory_details(uuid,uuid) to service_role;
create function public.admin_restock_with_details(p_order uuid,p_actor uuid,p_action text,p_password text default '',p_secret text default '',p_allow_early boolean default false,p_target_product text default null,p_delivery_info text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.orders%rowtype;b public.email_stock_batches%rowtype;s public.stock%rowtype;prior public.order_inventory_actions%rowtype;source_product text;target_id uuid;r jsonb;
begin
 if not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Admin required';end if;
 if p_delivery_info is not null and length(p_delivery_info)>16384 then raise exception 'Invalid delivery info';end if;
 if p_action is null or p_action not in('restock','remove') or p_password is null or length(p_password)>1000 or p_password ~ E'[\r\n]' or p_secret is null or length(p_secret)>16384 then raise exception 'Invalid inventory action';end if;
 perform pg_advisory_xact_lock(742031182026);
 select * into o from public.orders where id=p_order for update;
 if not found then raise exception 'Order not found';end if;
 select * into prior from public.order_inventory_actions where order_id=o.id;
 if found then
  if prior.action<>p_action then raise exception 'Order already processed';end if;
  return jsonb_build_object('ok',true,'already_processed',true,'action',prior.action);
 end if;
 if p_action='remove' then return public.admin_manage_order_inventory(p_order,p_actor,p_action,p_password,p_secret,p_allow_early);end if;
 if p_target_product is null or p_target_product='' then
  if o.stock_batch_id is null then return public.admin_manage_order_inventory(p_order,p_actor,p_action,p_password,p_secret,p_allow_early);end if;
  select product_id into p_target_product from public.email_stock_batches where id=o.stock_batch_id;
 end if;
 if o.status<>'delivered' then raise exception 'Order not delivered';end if;
 if (o.expires_at is null or o.expires_at>now()) and p_allow_early is distinct from true then raise exception 'Early confirmation required';end if;
 perform 1 from public.products where id=p_target_product and delivery_type='code' for share;
 if not found then raise exception 'Invalid target product';end if;
 if o.stock_batch_id is not null then
  select * into b from public.email_stock_batches where id=o.stock_batch_id for update;
  if not found then raise exception 'Stock not found';end if;
  if b.has_screen and b.remaining>0 then raise exception 'Stock already available';end if;
  source_product:=b.product_id;
  if source_product=p_target_product then
   r:=public.admin_manage_order_inventory(p_order,p_actor,p_action,p_password,p_secret,p_allow_early);
   if p_delivery_info is not null and coalesce((r->>'already_processed')::boolean,false)=false then update public.email_stock_batches set delivery_info=p_delivery_info where id=b.id;end if;
   return r;
  end if;
  if p_password<>'' and p_password<>b.password and exists(select 1 from public.orders x join public.email_stock_batches xb on xb.id=x.stock_batch_id where lower(xb.email)=lower(b.email) and x.id<>o.id and x.status='delivered' and (x.expires_at is null or x.expires_at>now()) and not exists(select 1 from public.order_inventory_actions z where z.order_id=x.id)) then raise exception 'Other customers active';end if;
  target_id:=private.receive_account_stock(p_target_product,b.email,case when p_password<>'' then p_password else b.password end,b.has_screen,b.screen,b.pin,coalesce(p_delivery_info,b.delivery_info),1);
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
revoke all on function public.admin_restock_with_details(uuid,uuid,text,text,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.admin_restock_with_details(uuid,uuid,text,text,text,boolean,text,text) to service_role;
