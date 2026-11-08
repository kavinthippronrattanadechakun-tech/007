alter table public.store_settings add column bank_topup_note text not null default '' check(length(bank_topup_note)<=2000);
grant update(bank_topup_note) on public.store_settings to authenticated;
