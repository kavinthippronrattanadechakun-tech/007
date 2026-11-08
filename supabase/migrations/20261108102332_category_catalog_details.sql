alter table public.product_categories
 add column description text not null default '' check(length(description)<=5000),
 add column image_url text not null default '' check(image_url='' or image_url ~ '^https://');
grant insert(description,image_url),update(description,image_url) on public.product_categories to authenticated;
-- Only the server can read aggregate inventory; no delivery data is exposed.
create function public.catalog_stock_counts()
 returns table(product_id text,available bigint) language sql stable security invoker set search_path='' as $$
 select p.id,coalesce(s.n,0)+coalesce(b.n,0) from public.products p
 left join (select product_id,count(*) n from public.stock where order_id is null group by product_id) s on s.product_id=p.id
 left join (select product_id,sum(remaining) n from public.email_stock_batches group by product_id) b on b.product_id=p.id;
$$;
revoke all on function public.catalog_stock_counts() from public,anon,authenticated;
grant execute on function public.catalog_stock_counts() to service_role;
