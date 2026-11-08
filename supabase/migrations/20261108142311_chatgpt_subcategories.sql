alter table public.products add column subcategory text not null default '' check(subcategory in('','share4','share3','private'));
grant insert(subcategory),update(subcategory) on public.products to authenticated;
update public.products p set subcategory=case
 when p.title ~ 'หาร[[:space:]]*4' then 'share4'
 when p.title ~ 'หาร[[:space:]]*3' then 'share3'
 when p.title like '%ส่วนตัว%' then 'private'
 else '' end
 from public.product_categories c where p.category_id=c.id and lower(btrim(c.name))='chatgpt';
