create table public.product_categories (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(btrim(name)) between 1 and 80),
 sort_order integer not null default 0 check(sort_order between 0 and 100000)
);
create unique index product_categories_name_unique on public.product_categories(lower(btrim(name)));
alter table public.product_categories enable row level security;
revoke all on public.product_categories from anon,authenticated;
grant select on public.product_categories to anon,authenticated;
grant insert(name,sort_order),update(name,sort_order) on public.product_categories to authenticated;
create policy "categories public read" on public.product_categories for select to anon,authenticated using(true);
create policy "categories admin insert" on public.product_categories for insert to authenticated
 with check(exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin));
create policy "categories admin update" on public.product_categories for update to authenticated
 using(exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin))
 with check(exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin));
alter table public.products add column category_id uuid references public.product_categories(id);
create index products_category_idx on public.products(category_id);
grant insert(category_id),update(category_id) on public.products to authenticated;
insert into public.product_categories(name,sort_order) values('Netflix',10),('ChatGPT',20),('Gemini',30);
update public.products p set category_id=c.id from public.product_categories c
 where p.category_id is null and ((c.name='Netflix' and p.title ilike '%netflix%') or (c.name='ChatGPT' and p.title ilike '%chatgpt%') or (c.name='Gemini' and p.title ilike '%gemini%'));
