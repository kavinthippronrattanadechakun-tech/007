alter table public.email_stock_batches
 add column password text not null default '' check(length(password)<=1000),
 add column has_screen boolean not null default false,
 add column screen text not null default '' check(length(screen)<=80),
 add column pin text not null default '' check(length(pin)<=20);
alter table public.email_stock_batches drop constraint email_stock_batches_delivery_info_check;
alter table public.email_stock_batches add constraint email_stock_info_length check(length(delivery_info)<=16384),
 add constraint email_stock_screen_shape check((has_screen and length(btrim(screen))>0 and remaining<=1) or (not has_screen and screen='' and pin=''));
drop index public.email_stock_product_email_unique;
create unique index email_stock_product_screen_unique on public.email_stock_batches(product_id,lower(email),lower(btrim(screen)));
grant insert(password,has_screen,screen,pin),update(password,has_screen,screen,pin) on public.email_stock_batches to authenticated;
create table public.admin_wallet_credits (
 id uuid primary key references public.topups(id),
 admin_id uuid not null references auth.users(id),
 user_id uuid not null references auth.users(id),
 amount integer not null check(amount between 1 and 100000),
 note text not null check(length(btrim(note)) between 1 and 1000),
 reference text not null,
 created_at timestamptz not null default now()
);
create index admin_wallet_credits_user_idx on public.admin_wallet_credits(user_id,created_at desc);
create index admin_wallet_credits_admin_idx on public.admin_wallet_credits(admin_id);
alter table public.admin_wallet_credits enable row level security;
revoke all on public.admin_wallet_credits from anon,authenticated;
grant select,insert on public.admin_wallet_credits to service_role;
create function public.admin_credit_wallet(p_id uuid,p_actor uuid,p_user uuid,p_amount integer,p_reference text,p_note text)
 returns jsonb language plpgsql security invoker set search_path='' as $$
declare old public.admin_wallet_credits%rowtype;bal bigint;ref text:=upper(btrim(p_reference));
begin
 if not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Admin required';end if;
 if p_id is null or p_user is null or p_amount is null or p_amount not between 1 and 100000 or ref is null or ref !~ '^[A-Z0-9_-]{6,200}$' or p_note is null or length(btrim(p_note)) not between 1 and 1000 then raise exception 'Invalid credit';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,1));
 select * into old from public.admin_wallet_credits where id=p_id;
 if found then
  if old.admin_id<>p_actor or old.user_id<>p_user or old.amount<>p_amount or old.reference<>ref or old.note<>btrim(p_note) then raise exception 'Request conflict';end if;
  return jsonb_build_object('ok',true,'already_credited',true,'id',p_id);
 end if;
 select balance into bal from public.profiles where id=p_user for update;
 if not found then raise exception 'Customer not found';end if;
 insert into public.topups(id,user_id,amount,slip_path,slip_hash,bank_reference,status,reviewed_by,verified_at)
 values(p_id,p_user,p_amount,'admin/manual/'||p_id,replace(p_id::text,'-','')||replace(p_id::text,'-',''),ref,'approved',p_actor,now());
 update public.profiles set balance=balance+p_amount where id=p_user;
 insert into public.wallet_ledger(user_id,delta,source_type,source_id) values(p_user,p_amount,'topup',p_id);
 insert into public.admin_wallet_credits(id,admin_id,user_id,amount,note,reference) values(p_id,p_actor,p_user,p_amount,btrim(p_note),ref);
 return jsonb_build_object('ok',true,'already_credited',false,'id',p_id,'balance',bal+p_amount);
end$$;
revoke all on function public.admin_credit_wallet(uuid,uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.admin_credit_wallet(uuid,uuid,uuid,integer,text,text) to service_role;
create function public.admin_customer_lookup(p_email text)
 returns table(id uuid,email text,balance bigint) language sql stable security invoker set search_path='' as $$
 select p.id,u.email::text,p.balance::bigint from public.profiles p join auth.users u on u.id=p.id where lower(u.email)=lower(btrim(p_email)) limit 1;
$$;
revoke all on function public.admin_customer_lookup(text) from public,anon,authenticated;
grant execute on function public.admin_customer_lookup(text) to service_role;
create function public.admin_order_list(p_query text default '',p_status text default '',p_offset integer default 0)
 returns table(id uuid,user_id uuid,user_email text,product_title text,price integer,status text,delivery text,customer_email text,created_at timestamptz)
 language sql stable security invoker set search_path='' as $$
 select o.id,o.user_id,u.email::text,p.title,o.price,o.status,o.delivery,o.customer_email,o.created_at
 from public.orders o join auth.users u on u.id=o.user_id join public.products p on p.id=o.product_id
 where (p_status='' or o.status=p_status) and (p_query='' or position(lower(p_query) in lower(coalesce(u.email,'')||' '||o.id::text||' '||p.title))>0)
 order by o.created_at desc,o.id desc limit 51 offset greatest(0,least(p_offset,100000));
$$;
revoke all on function public.admin_order_list(text,text,integer) from public,anon,authenticated;
grant execute on function public.admin_order_list(text,text,integer) to service_role;

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
