alter table public.products add column image_url text not null default '' check (image_url = '' or (image_url ~ '^https://' and length(image_url) <= 2048));
alter table public.products add constraint product_title_length check (length(btrim(title)) between 1 and 200);
alter table public.products add constraint product_description_length check (length(description) <= 5000);
create table public.store_settings (
 id boolean primary key default true check (id),
 brand_name text not null default 'PREMIUM HUB' check (length(btrim(brand_name)) between 1 and 80),
 hero_title text not null default 'พรีเมียมในแบบที่คุณเลือก' check (length(btrim(hero_title)) between 1 and 200),
 hero_description text not null default 'ร้านค้าออนไลน์ภาษาไทย • กระเป๋าเงิน • อัปโหลดหลักฐานการโอน • ติดตามคำสั่งซื้อ' check (length(hero_description) <= 2000),
 announcement text not null default 'เปิดขายเฉพาะสินค้าที่มีสิทธิ์จำหน่ายอย่างถูกต้อง' check (length(announcement) <= 1000),
 contact_text text not null default '' check (length(contact_text) <= 1000),
 footer_text text not null default '© PremiumHub · ร้านอิสระ ไม่ได้เป็นตัวแทนอย่างเป็นทางการของแบรนด์ที่ระบุ · รับเคลมตามเงื่อนไขที่ประกาศ' check (length(footer_text) <= 2000)
);
insert into public.store_settings(id) values(true);
alter table public.store_settings enable row level security;
revoke all on public.store_settings from anon, authenticated;
grant select on public.store_settings to anon, authenticated;
grant update (brand_name,hero_title,hero_description,announcement,contact_text,footer_text) on public.store_settings to authenticated;
create policy "settings public read" on public.store_settings for select to anon,authenticated using(true);
create policy "settings admin update" on public.store_settings for update to authenticated
 using(exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin))
 with check(exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin));
revoke insert,update,delete on public.products from anon,authenticated;
grant insert(id,title,description,price,active,delivery_type,image_url), update(title,description,price,active,delivery_type,image_url) on public.products to authenticated;
create policy "products admin insert" on public.products for insert to authenticated
 with check(exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin));
create policy "products admin update" on public.products for update to authenticated
 using(exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin))
 with check(exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin));
alter table public.stock add constraint stock_secret_length check (length(btrim(secret)) between 1 and 16384);
alter table public.stock add constraint stock_product_secret_unique unique(product_id,secret);
revoke all on public.stock from anon,authenticated;
grant select,delete on public.stock to authenticated;
grant insert(product_id,secret),update(secret) on public.stock to authenticated;
create policy "stock admin read" on public.stock for select to authenticated
 using(exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin));
create policy "stock admin insert" on public.stock for insert to authenticated
 with check(order_id is null and exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin));
create policy "stock admin update unsold" on public.stock for update to authenticated
 using(order_id is null and exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin))
 with check(order_id is null and exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin));
create policy "stock admin delete unsold" on public.stock for delete to authenticated
 using(order_id is null and exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('product-images','product-images',true,5000000,array['image/jpeg','image/png','image/webp']);
create policy "product images admin upload" on storage.objects for insert to authenticated
 with check(bucket_id='product-images' and exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin));
create policy "product images admin read" on storage.objects for select to authenticated
 using(bucket_id='product-images' and exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin));
create policy "product images admin delete" on storage.objects for delete to authenticated
 using(bucket_id='product-images' and exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin));
