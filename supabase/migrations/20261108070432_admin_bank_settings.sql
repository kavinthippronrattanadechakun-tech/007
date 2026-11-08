alter table public.store_settings
 add column bank_name text not null default '' check (length(bank_name)<=100),
 add column bank_account_name text not null default '' check (length(bank_account_name)<=120),
 add column bank_account_number text not null default '' check (bank_account_number='' or bank_account_number ~ '^[0-9 -]{5,40}$'),
 add constraint bank_details_complete check (
  (btrim(bank_name)='' and btrim(bank_account_name)='' and bank_account_number='') or
  (length(btrim(bank_name))>0 and length(btrim(bank_account_name))>0 and length(regexp_replace(bank_account_number,'[^0-9]','','g'))>=5)
 );
grant update(bank_name,bank_account_name,bank_account_number) on public.store_settings to authenticated;
