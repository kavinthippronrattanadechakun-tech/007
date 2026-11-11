begin;
do $$
declare u uuid;pid text:='sold-email-'||gen_random_uuid();oid uuid;bid uuid;mail text:='sold.'||replace(gen_random_uuid()::text,'-','')||'@example.com';
begin
 select id into u from public.profiles limit 1;
 insert into public.products(id,title,price,active,delivery_type,duration_days) values(pid,'Sold email search fixture',1,true,'code',1);
 insert into public.email_stock_batches(product_id,email,password,remaining,delivery_info) values(pid,mail,'fake-password',0,'') returning id into bid;
 insert into public.orders(user_id,product_id,price,status,delivery,stock_batch_id,created_at,customer_email)
 values(u,pid,1,'delivered','Mail: '||mail||E'\nPassword: fake-password',bid,now()-interval '48 hours','recipient@example.test') returning id into oid;
 if not exists(select 1 from public.admin_order_list(upper(mail),'expired',0) where id=oid) then raise exception 'sold email not found case-insensitively';end if;
 update public.email_stock_batches set email='edited-'||mail where id=bid;
 if not exists(select 1 from public.admin_order_list(mail,'expired',0) where id=oid) then raise exception 'historical sold email lost after source edit';end if;
 if exists(select 1 from public.admin_order_list(mail,'active',0) where id=oid) then raise exception 'status filter ignored';end if;
 if not exists(select 1 from public.admin_order_list('recipient@example.test','expired',0) where id=oid) then raise exception 'delivery recipient not searchable';end if;
 if has_function_privilege('authenticated','public.admin_order_list(text,text,integer)','execute') then raise exception 'admin search exposed';end if;
 perform set_config('test.sold_mail',mail,true);
end$$;
set local role service_role;
select count(*) as service_role_matching_sold_email from public.admin_order_list(current_setting('test.sold_mail'),'expired',0);
rollback;
