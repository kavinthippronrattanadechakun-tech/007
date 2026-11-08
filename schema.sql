-- Run in Supabase SQL Editor. Never expose service role key in browser.
create extension if not exists pgcrypto;
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade, is_admin boolean not null default false, balance integer not null default 0 check(balance>=0));
create function public.create_profile() returns trigger language plpgsql security definer set search_path=public as $$begin insert into public.profiles(id) values(new.id);return new;end$$;
create trigger new_user after insert on auth.users for each row execute function public.create_profile();
insert into public.profiles(id) select id from auth.users on conflict do nothing;
create table public.products(id text primary key,title text not null,description text not null default '',price integer not null check(price>0),active boolean not null default false,delivery_type text not null default 'manual' check(delivery_type in ('manual','code')));
create table public.topups(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),amount integer not null check(amount>0),slip_path text not null,slip_hash text not null unique,bank_reference text unique,status text not null default 'pending' check(status in ('pending','approved','rejected')),reviewed_by uuid references auth.users(id),created_at timestamptz not null default now());
create table public.orders(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),product_id text not null references public.products(id),price integer not null,customer_email text,delivery text,status text not null check(status in ('delivered','processing')),created_at timestamptz not null default now());
create table public.stock(id uuid primary key default gen_random_uuid(),product_id text not null references public.products(id),secret text not null,order_id uuid unique references public.orders(id));
create table public.wallet_ledger(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),delta integer not null,source_type text not null,source_id uuid not null,created_at timestamptz not null default now(),unique(source_type,source_id));
create index on public.orders(user_id,created_at desc);
create index on public.topups(user_id,created_at desc);
create index on public.stock(product_id) where order_id is null;
insert into public.products(id,title,description,price,active,delivery_type) values
('netflix30','Netflix 30 วัน','ต้องได้รับสิทธิ์จำหน่าย',95,false,'manual'),
('gpt4-1','ChatGPT หาร 4 · 1 วัน','ต้องได้รับสิทธิ์จำหน่าย',25,false,'manual'),
('gpt4-7','ChatGPT หาร 4 · 7 วัน','ต้องได้รับสิทธิ์จำหน่าย',50,false,'manual'),
('gpt4-30','ChatGPT หาร 4 · 30 วัน','ต้องได้รับสิทธิ์จำหน่าย',100,false,'manual'),
('gpt3-30','ChatGPT หาร 3 · 30 วัน','ต้องได้รับสิทธิ์จำหน่าย',125,false,'manual'),
('gptprivate-1','ChatGPT ส่วนตัว · 1 วัน','ต้องได้รับสิทธิ์จำหน่าย',50,false,'manual'),
('gptprivate-7','ChatGPT ส่วนตัว · 7 วัน','ต้องได้รับสิทธิ์จำหน่าย',150,false,'manual'),
('gptprivate-30','ChatGPT ส่วนตัว · 30 วัน','ต้องได้รับสิทธิ์จำหน่าย',300,false,'manual'),
('gemini7','Gemini Pro · 7 วัน','ใช้เมลลูกค้า ต้องได้รับสิทธิ์จำหน่าย',35,false,'manual'),
('gemini30','Gemini Pro · 30 วัน','ใช้เมลลูกค้า ต้องได้รับสิทธิ์จำหน่าย',70,false,'manual') on conflict(id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('slips','slips',false,5000000,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.topups enable row level security;
alter table public.orders enable row level security;
alter table public.stock enable row level security;
alter table public.wallet_ledger enable row level security;
create policy "profile self read" on public.profiles for select to authenticated using(id=auth.uid());
create policy "products public read" on public.products for select using(true);
create policy "topup self read" on public.topups for select to authenticated using(user_id=auth.uid());
create policy "order self read" on public.orders for select to authenticated using(user_id=auth.uid());
create policy "ledger self read" on public.wallet_ledger for select to authenticated using(user_id=auth.uid());
-- Admin writes use service role in server route; no direct user writes to balances, orders, stock or topups.
create or replace function public.review_topup(p_topup_id uuid,p_approve boolean,p_reference text,p_reviewer uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.topups%rowtype;
begin
 if not exists(select 1 from public.profiles where id=p_reviewer and is_admin) then raise exception 'Not admin';end if;
 select * into t from public.topups where id=p_topup_id for update;
 if not found or t.status<>'pending' then raise exception 'Already reviewed or not found';end if;
 if p_approve then
  if p_reference is null or length(trim(p_reference))<6 then raise exception 'Bank reference required';end if;
  update public.topups set status='approved',bank_reference=trim(p_reference),reviewed_by=p_reviewer where id=t.id;
  update public.profiles set balance=balance+t.amount where id=t.user_id;
  insert into public.wallet_ledger(user_id,delta,source_type,source_id) values(t.user_id,t.amount,'topup',t.id);
 else update public.topups set status='rejected',reviewed_by=p_reviewer where id=t.id;
 end if;
 return jsonb_build_object('ok',true);
end$$;
revoke all on function public.review_topup(uuid,boolean,text,uuid) from public,anon,authenticated;
grant execute on function public.review_topup(uuid,boolean,text,uuid) to service_role;
create or replace function public.buy_product(p_product_id text,p_email text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.products%rowtype; w public.profiles%rowtype; o uuid; s public.stock%rowtype; delivered text; st text;
begin
 if auth.uid() is null then raise exception 'Login required';end if;
 select * into p from public.products where id=p_product_id and active=true;
 if not found then raise exception 'Product unavailable';end if;
 select * into w from public.profiles where id=auth.uid() for update;
 if w.balance<p.price then raise exception 'Insufficient balance';end if;
 if p.delivery_type='code' then
  select * into s from public.stock where product_id=p.id and order_id is null order by id for update skip locked limit 1;
  if not found then raise exception 'Out of stock';end if;
  delivered:=s.secret;st:='delivered';
 else st:='processing';end if;
 update public.profiles set balance=balance-p.price where id=auth.uid();
 insert into public.orders(user_id,product_id,price,customer_email,delivery,status) values(auth.uid(),p.id,p.price,left(p_email,320),delivered,st) returning id into o;
 if p.delivery_type='code' then update public.stock set order_id=o where id=s.id;end if;
 insert into public.wallet_ledger(user_id,delta,source_type,source_id) values(auth.uid(),-p.price,'order',o);
 return jsonb_build_object('order_id',o,'status',st,'delivery',delivered);
end$$;
revoke all on function public.buy_product(text,text) from public,anon;
grant execute on function public.buy_product(text,text) to authenticated;
