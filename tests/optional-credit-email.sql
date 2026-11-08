begin;
do $$
declare a uuid;u uuid;req uuid:=gen_random_uuid();other uuid:=gen_random_uuid();bal bigint;pid text:='test-'||gen_random_uuid();r jsonb;
begin
 select id into a from public.profiles where is_admin limit 1;select id into u from public.profiles where not is_admin limit 1;u:=coalesce(u,a);
 select balance into bal from public.profiles where id=u;
 perform public.admin_credit_wallet(req,a,u,50,'','');perform public.admin_credit_wallet(req,a,u,50,'','');
 if (select balance from public.profiles where id=u)<>bal+50 then raise exception 'optional credit not idempotent';end if;
 perform public.admin_credit_wallet(other,a,u,50,null,null);
 if (select balance from public.profiles where id=u)<>bal+100 then raise exception 'second intentional credit blocked';end if;
 if exists(select 1 from public.topups where id in(req,other) and bank_reference is not null) then raise exception 'invented bank ref';end if;
 insert into public.products(id,title,price,active,delivery_type,requires_customer_email) values(pid,'Rollback email requirement',1,true,'manual',true);
 perform set_config('request.jwt.claim.sub',u::text,true);
 begin perform public.buy_product(pid,null);raise exception 'missing email allowed';exception when raise_exception then if sqlerrm<>'Customer email required' then raise;end if;end;
 if (select balance from public.profiles where id=u)<>bal+100 then raise exception 'missing email charged';end if;
 r:=public.buy_product(pid,'buyer@example.com');
 if not exists(select 1 from public.orders where id=(r->>'order_id')::uuid and customer_email='buyer@example.com') then raise exception 'required email not stored';end if;
 update public.products set requires_customer_email=false where id=pid;
 r:=public.buy_product(pid,'ignored@example.com');
 if not exists(select 1 from public.orders where id=(r->>'order_id')::uuid and customer_email is null) then raise exception 'disabled email retained';end if;
end$$;
rollback;
