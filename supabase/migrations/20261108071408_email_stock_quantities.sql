create table public.email_stock_batches (
 id uuid primary key default gen_random_uuid(),
 product_id text not null references public.products(id),
 email text not null check(length(email)<=320 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 delivery_info text not null check(length(btrim(delivery_info)) between 1 and 16384),
 remaining integer not null check(remaining between 0 and 100000),
 sold integer not null default 0 check(sold>=0),
 created_at timestamptz not null default now()
);
create unique index email_stock_product_email_unique on public.email_stock_batches(product_id,lower(email));
create index email_stock_available_idx on public.email_stock_batches(product_id,created_at,id) where remaining>0;
alter table public.email_stock_batches enable row level security;
revoke all on public.email_stock_batches from anon,authenticated;
grant select,delete on public.email_stock_batches to authenticated;
grant insert(product_id,email,delivery_info,remaining),update(email,delivery_info,remaining) on public.email_stock_batches to authenticated;
create policy "email stock admin read" on public.email_stock_batches for select to authenticated
 using(exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin));
create policy "email stock admin insert" on public.email_stock_batches for insert to authenticated
 with check(sold=0 and exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin));
create policy "email stock admin update" on public.email_stock_batches for update to authenticated
 using(exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin))
 with check(exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin));
create policy "email stock admin delete unused" on public.email_stock_batches for delete to authenticated
 using(sold=0 and exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin));
alter table public.orders add column stock_batch_id uuid references public.email_stock_batches(id);
create index orders_stock_batch_idx on public.orders(stock_batch_id) where stock_batch_id is not null;
create function public.email_stock_totals(p_product_id text)
 returns table(available bigint,sold bigint) language sql stable security invoker set search_path='' as $$
 select coalesce(sum(b.remaining),0),coalesce(sum(b.sold),0) from public.email_stock_batches b where b.product_id=p_product_id;
$$;
revoke all on function public.email_stock_totals(text) from public,anon;
grant execute on function public.email_stock_totals(text) to authenticated;
-- Keep the existing guarded wallet transaction; add quantity-based delivery.
create or replace function public.buy_product(p_product_id text,p_email text default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype;w public.profiles%rowtype;s public.stock%rowtype;
 b public.email_stock_batches%rowtype;o uuid;delivered text;st text;uid uuid;batch_id uuid;
begin
 uid:=auth.uid();if uid is null then raise exception 'Login required';end if;
 select * into p from public.products where id=p_product_id and active=true;
 if not found then raise exception 'Product unavailable';end if;
 select * into w from public.profiles where id=uid for update;
 if not found or w.balance<p.price then raise exception 'Insufficient balance';end if;
 if p.delivery_type='code' then
  -- Wait for a concurrent buyer holding the same batch; recheck remaining after the lock.
  select * into b from public.email_stock_batches where product_id=p.id and remaining>0
   order by created_at,id limit 1 for update;
  if found then
   batch_id:=b.id;delivered:='อีเมล: '||b.email||E'\n'||b.delivery_info;
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
