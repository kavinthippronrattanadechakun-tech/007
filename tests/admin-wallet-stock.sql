begin;
do $$
declare a uuid;u uuid;req uuid:=gen_random_uuid();req2 uuid:=gen_random_uuid();bal bigint;ref text:='TEST'||replace(gen_random_uuid()::text,'-','');pid text:='test-'||gen_random_uuid();b uuid;r jsonb;txt text;
begin
 select id into a from public.profiles where is_admin limit 1;
 select id into u from public.profiles where not is_admin limit 1;
 u:=coalesce(u,a);
 select balance into bal from public.profiles where id=u;
 perform public.admin_credit_wallet(req,a,u,50,ref,'rollback verification');
 perform public.admin_credit_wallet(req,a,u,50,ref,'rollback verification');
 if (select balance from public.profiles where id=u)<>bal+50 or (select count(*) from public.wallet_ledger where source_id=req)<>1 then raise exception 'credit not exactly once';end if;
 begin perform public.admin_credit_wallet(req2,a,u,50,ref,'duplicate ref');raise exception 'duplicate reference allowed';exception when unique_violation then null;end;
 if (select balance from public.profiles where id=u)<>bal+50 then raise exception 'duplicate changed balance';end if;
 if u<>a then begin perform public.admin_credit_wallet(req2,u,u,50,'UNAUTHORIZED','bad actor');raise exception 'nonadmin allowed';exception when raise_exception then if sqlerrm<>'Admin required' then raise;end if;end;end if;
 insert into public.products(id,title,price,active,delivery_type) values(pid,'Rollback stock test',1,true,'code');
 insert into public.email_stock_batches(product_id,email,password,remaining,delivery_info,has_screen,screen,pin)
 values(pid,'test@example.com','test-password',1,'',true,'1','0123') returning id into b;
 insert into public.email_stock_batches(product_id,email,password,remaining,delivery_info,has_screen,screen,pin)
 values(pid,'test@example.com','test-password',1,'',true,'2','');
 perform set_config('request.jwt.claim.sub',u::text,true);
 r:=public.buy_product(pid,null);txt:=r->>'delivery';
 if txt<>E'Mail: test@example.com\nPassword: test-password\nScreen: 1\nPin: 0123' then raise exception 'bad delivery format: %',txt;end if;
 if (select remaining from public.email_stock_batches where id=b)<>0 then raise exception 'screen not consumed';end if;
 r:=public.buy_product(pid,null);if position('Pin:' in r->>'delivery')>0 or position('ข้อมูลเพิ่มเติม:' in r->>'delivery')>0 then raise exception 'empty fields leaked';end if;
 begin perform public.buy_product(pid,null);raise exception 'empty stock sold';exception when raise_exception then if sqlerrm<>'Out of stock' then raise;end if;end;
 if (select balance from public.profiles where id=u)<>bal+48 then raise exception 'wrong wallet debit';end if;
 if has_function_privilege('authenticated','public.admin_credit_wallet(uuid,uuid,uuid,integer,text,text)','execute') or has_function_privilege('anon','public.admin_order_list(text,text,integer)','execute') then raise exception 'admin RPC exposed';end if;
end$$;
rollback;
