begin;
do $$
declare a uuid;u uuid;p text:='info-'||gen_random_uuid();t text:='info-target-'||gen_random_uuid();b uuid;o uuid;o2 uuid;dest uuid;r jsonb;old text:='ข้อมูลที่ส่งให้ลูกค้าเดิม';
begin
 select id into a from public.profiles where is_admin limit 1;select id into u from public.profiles limit 1;
 insert into public.products(id,title,price,active,delivery_type,duration_days) values(p,p,1,true,'code',1),(t,t,1,true,'code',1);
 insert into public.email_stock_batches(product_id,email,password,remaining,sold,delivery_info) values(p,'restock-info@example.com','pass',0,3,'old info') returning id into b;
 insert into public.orders(user_id,product_id,price,status,delivery,stock_batch_id,created_at) values(u,p,1,'delivered',old,b,now()-interval '48 hours') returning id into o;
 if public.admin_order_inventory_details(o,a)->>'delivery_info'<>'old info' then raise exception 'not prefilling current notes';end if;
 perform public.admin_restock_with_details(o,a,'restock','','',false,null,'new info');
 if (select delivery_info from public.email_stock_batches where id=b)<>'new info' or (select remaining from public.email_stock_batches where id=b)<>1 then raise exception 'same-product notes failed';end if;
 perform public.admin_restock_with_details(o,a,'restock','','',false,null,'should not overwrite');
 if (select delivery_info from public.email_stock_batches where id=b)<>'new info' or (select remaining from public.email_stock_batches where id=b)<>1 then raise exception 'retry changed stock';end if;
 if (select delivery from public.orders where id=o)<>old then raise exception 'old snapshot changed';end if;
 insert into public.orders(user_id,product_id,price,status,delivery,stock_batch_id,created_at) values(u,p,1,'delivered',old,b,now()-interval '48 hours') returning id into o2;
 perform public.admin_restock_with_details(o2,a,'restock','','',false,null,'');
 if (select delivery_info from public.email_stock_batches where id=b)<>'' then raise exception 'clear failed';end if;
 insert into public.orders(user_id,product_id,price,status,delivery,stock_batch_id,created_at) values(u,p,1,'delivered',old,b,now()-interval '48 hours') returning id into o2;
 r:=public.admin_restock_with_details(o2,a,'restock','','',false,t,'target-only info');dest:=(r->>'target_id')::uuid;
 if (select delivery_info from public.email_stock_batches where id=dest)<>'target-only info' or (select remaining from public.email_stock_batches where id=dest)<>1 then raise exception 'cross-product notes failed';end if;
 if (select delivery_info from public.email_stock_batches where id=b)<>'' or (select remaining from public.email_stock_batches where id=b)<>2 then raise exception 'cross-product altered source';end if;
 if has_function_privilege('authenticated','public.admin_restock_with_details(uuid,uuid,text,text,text,boolean,text,text)','execute') or has_function_privilege('anon','public.admin_order_inventory_details(uuid,uuid)','execute') then raise exception 'RPC exposed';end if;
end$$;
rollback;
