begin;
do $$
declare a uuid;u uuid;p text:='restock-'||gen_random_uuid();p2 text:='legacy-'||gen_random_uuid();b uuid;sid uuid;o uuid;o2 uuid;shared_order uuid;active_order uuid;r jsonb;before_balance bigint;old_delivery text;
begin
 select id into a from public.profiles where is_admin limit 1;select id into u from public.profiles where not is_admin limit 1;u:=coalesce(u,a);
 update public.profiles set balance=balance+100 where id=u;
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.products(id,title,price,active,delivery_type,duration_days) values(p,'Restock test',1,true,'code',1),(p2,'Legacy restock test',1,true,'code',1);
 insert into public.email_stock_batches(product_id,email,password,remaining,delivery_info,has_screen,screen,pin) values(p,'screen@example.com','old-pass',1,'',true,'1','0123') returning id into b;
 r:=public.buy_product(p,null);o:=(r->>'order_id')::uuid;old_delivery:=r->>'delivery';
 begin perform public.admin_manage_order_inventory(o,a,'restock','new-pass','');raise exception 'active order restocked';exception when raise_exception then if sqlerrm<>'Early confirmation required' then raise;end if;end;
 update public.orders set created_at=now()-interval '48 hours',expires_at=now()-interval '24 hours' where id=o;
 if not (public.admin_order_inventory(o,a)->>'can_restock')::boolean then raise exception 'expired order not restockable';end if;
 select balance into before_balance from public.profiles where id=u;
 perform public.admin_manage_order_inventory(o,a,'restock','new-pass','');perform public.admin_manage_order_inventory(o,a,'restock','new-pass','');
 if (select remaining from public.email_stock_batches where id=b)<>1 then raise exception 'restock double counted';end if;
 if (select delivery from public.orders where id=o)<>old_delivery then raise exception 'old delivery changed';end if;
 if (select balance from public.profiles where id=u)<>before_balance then raise exception 'restock changed wallet';end if;
 begin perform public.admin_manage_order_inventory(o,a,'remove','','');raise exception 'conflicting action allowed';exception when raise_exception then if sqlerrm<>'Order already processed' then raise;end if;end;
 r:=public.buy_product(p,null);o2:=(r->>'order_id')::uuid;if position('Password: new-pass' in r->>'delivery')=0 then raise exception 'new credentials not delivered';end if;
 perform public.admin_manage_order_inventory(o2,a,'remove','','');if (select remaining from public.email_stock_batches where id=b)<>0 then raise exception 'removed stock returned';end if;
 -- Shared account: one expired customer may return their unit, but cannot rotate another active customer's password.
 insert into public.email_stock_batches(product_id,email,password,remaining,delivery_info) values(p,'shared@example.com','shared-pass',2,'') returning id into b;
 r:=public.buy_product(p,null);shared_order:=(r->>'order_id')::uuid;r:=public.buy_product(p,null);active_order:=(r->>'order_id')::uuid;
 update public.orders set created_at=now()-interval '48 hours',expires_at=now()-interval '24 hours' where id=shared_order;
 begin perform public.admin_manage_order_inventory(shared_order,a,'restock','rotated','');raise exception 'active credentials rotated';exception when raise_exception then if sqlerrm<>'Other customers active' then raise;end if;end;
 perform public.admin_manage_order_inventory(shared_order,a,'restock','','');if (select remaining from public.email_stock_batches where id=b)<>1 then raise exception 'shared unit not restored';end if;
 if (select password from public.email_stock_batches where id=b)<>'shared-pass' then raise exception 'shared password changed';end if;
 -- Legacy stock keeps a permanent order source link even after reuse.
 insert into public.stock(product_id,secret) values(p2,'old-legacy-secret') returning id into sid;
 r:=public.buy_product(p2,null);o:=(r->>'order_id')::uuid;if (select stock_item_id from public.orders where id=o) is distinct from sid then raise exception 'missing legacy source snapshot';end if;
 update public.orders set created_at=now()-interval '48 hours',expires_at=now()-interval '24 hours' where id=o;
 perform public.admin_manage_order_inventory(o,a,'restock','','new-legacy-secret');r:=public.buy_product(p2,null);o2:=(r->>'order_id')::uuid;
 if r->>'delivery'<>'new-legacy-secret' then raise exception 'legacy credentials not updated';end if;
 perform public.admin_manage_order_inventory(o,a,'restock','','new-legacy-secret');if (select order_id from public.stock where id=sid) is distinct from o2 then raise exception 'old retry re-released sold stock';end if;
 if u<>a then begin perform public.admin_manage_order_inventory(o2,u,'remove','','');raise exception 'nonadmin allowed';exception when raise_exception then if sqlerrm<>'Admin required' then raise;end if;end;end if;
 if has_function_privilege('authenticated','public.admin_manage_order_inventory(uuid,uuid,text,text,text,boolean)','execute') then raise exception 'inventory RPC exposed';end if;
 update public.orders set created_at=now()-interval '48 hours',expires_at=now()-interval '24 hours' where id=o2;
 perform set_config('test.order',o2::text,true);perform set_config('test.admin',a::text,true);
end$$;
set local role service_role;
select (public.admin_manage_order_inventory(current_setting('test.order')::uuid,current_setting('test.admin')::uuid,'restock','','service-role-secret')->>'ok')::boolean as service_role_restock_succeeds;
select count(*) from public.admin_order_list('__no_test_orders__','expired',0);
rollback;
