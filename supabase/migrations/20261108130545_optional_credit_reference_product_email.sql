alter table public.products add column requires_customer_email boolean not null default false;
grant insert(requires_customer_email),update(requires_customer_email) on public.products to authenticated;
create or replace function public.admin_credit_wallet(p_id uuid,p_actor uuid,p_user uuid,p_amount integer,p_reference text,p_note text)
 returns jsonb language plpgsql security invoker set search_path='' as $$
declare old public.admin_wallet_credits%rowtype;bal bigint;ref text:=upper(btrim(coalesce(p_reference,'')));memo text:=coalesce(nullif(btrim(p_note),''),'เติมเงินโดยแอดมิน');
begin
 if not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Admin required';end if;
 if p_id is null or p_user is null or p_amount is null or p_amount not between 1 and 100000 or (ref<>'' and ref !~ '^[A-Z0-9_-]{6,200}$') or length(memo)>1000 then raise exception 'Invalid credit';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,1));
 select * into old from public.admin_wallet_credits where id=p_id;
 if found then
  if old.admin_id<>p_actor or old.user_id<>p_user or old.amount<>p_amount or old.reference<>ref or old.note<>memo then raise exception 'Request conflict';end if;
  return jsonb_build_object('ok',true,'already_credited',true,'id',p_id);
 end if;
 select balance into bal from public.profiles where id=p_user for update;
 if not found then raise exception 'Customer not found';end if;
 insert into public.topups(id,user_id,amount,slip_path,slip_hash,bank_reference,status,reviewed_by,verified_at)
 values(p_id,p_user,p_amount,'admin/manual/'||p_id,replace(p_id::text,'-','')||replace(p_id::text,'-',''),nullif(ref,''),'approved',p_actor,now());
 update public.profiles set balance=balance+p_amount where id=p_user;
 insert into public.wallet_ledger(user_id,delta,source_type,source_id) values(p_user,p_amount,'topup',p_id);
 insert into public.admin_wallet_credits(id,admin_id,user_id,amount,note,reference) values(p_id,p_actor,p_user,p_amount,memo,ref);
 return jsonb_build_object('ok',true,'already_credited',false,'id',p_id,'balance',bal+p_amount);
end$$;
revoke all on function public.admin_credit_wallet(uuid,uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.admin_credit_wallet(uuid,uuid,uuid,integer,text,text) to service_role;

create or replace function public.buy_product(p_product_id text,p_email text default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype;w public.profiles%rowtype;s public.stock%rowtype;
 b public.email_stock_batches%rowtype;o uuid;delivered text;st text;uid uuid;batch_id uuid;
begin
 uid:=auth.uid();if uid is null then raise exception 'Login required';end if;
 select * into p from public.products where id=p_product_id and active=true;
 if not found then raise exception 'Product unavailable';end if;
 if p.requires_customer_email and (p_email is null or length(p_email)>320 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Customer email required';end if;
 if not p.requires_customer_email then p_email:=null;end if;
 select * into w from public.profiles where id=uid for update;
 if not found or w.balance<p.price then raise exception 'Insufficient balance';end if;
 if p.delivery_type='code' then
  -- Wait for a concurrent buyer holding the same batch; recheck remaining after the lock.
  select * into b from public.email_stock_batches where product_id=p.id and remaining>0
   order by created_at,id limit 1 for update;
  if found then
   batch_id:=b.id;
   delivered:=concat_ws(E'\n','Mail: '||b.email,
    case when b.password<>'' then 'Password: '||b.password end,
    case when b.has_screen then 'Screen: '||b.screen end,
    case when b.has_screen and b.pin<>'' then 'Pin: '||b.pin end,
    case when b.delivery_info<>'' then 'ข้อมูลเพิ่มเติม: '||b.delivery_info end);
   update public.email_stock_batches set remaining=remaining-1,sold=sold+1 where id=b.id;
  else
   select * into s from public.stock where product_id=p.id and order_id is null
    order by id limit 1 for update skip locked;
   if not found then raise exception 'Out of stock';end if;
   delivered:=s.secret;
  end if;
  st:='delivered';
 else st:='processing';end if;
 update public.profiles set balance=balance-p.price where id=uid;
 insert into public.orders(user_id,product_id,price,customer_email,delivery,status,stock_batch_id)
  values(uid,p.id,p.price,left(p_email,320),delivered,st,batch_id) returning id into o;
 if p.delivery_type='code' and batch_id is null then update public.stock set order_id=o where id=s.id;end if;
 insert into public.wallet_ledger(user_id,delta,source_type,source_id) values(uid,-p.price,'order',o);
 return jsonb_build_object('order_id',o,'status',st,'delivery',delivered);
end $$;
revoke all on function public.buy_product(text,text) from public,anon;
grant execute on function public.buy_product(text,text) to authenticated;
