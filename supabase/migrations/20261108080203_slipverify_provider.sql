alter table public.topups drop constraint topups_verification_provider_check;
alter table public.topups add constraint topups_verification_provider_check check(verification_provider in ('manual','easyslip','slipverify'));
create or replace function public.credit_verified_topup(p_id uuid,p_reference text,p_amount integer,p_transfer_at timestamptz,p_account_number text,p_bank_name text,p_account_name text)
 returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.topups%rowtype;settings public.store_settings%rowtype;created timestamptz;
begin
 select * into t from public.topups where id=p_id for update;
 if not found then raise exception 'Topup not found';end if;
 if p_reference is null or p_reference !~ '^[A-Z0-9_-]{6,200}$' or p_amount is null or p_amount<>t.amount then raise exception 'Verification mismatch';end if;
 if t.status='approved' and t.bank_reference=p_reference then return jsonb_build_object('ok',true,'already_credited',true);end if;
 if t.status<>'pending' then raise exception 'Topup already reviewed';end if;
 select * into settings from public.store_settings where id=true for share;
 if not found or p_account_number is null or p_bank_name is null or p_account_name is null or regexp_replace(settings.bank_account_number,'[ -]','','g')<>p_account_number or settings.bank_name<>p_bank_name or settings.bank_account_name<>p_account_name then raise exception 'Receiver settings changed';end if;
 select created_at into created from public.profiles where id=t.user_id;
 if p_transfer_at is null or p_transfer_at>now()+interval '5 minutes' or p_transfer_at<greatest(now()-interval '24 hours',created-interval '5 minutes') then raise exception 'Invalid transfer time';end if;
 update public.topups set status='approved',bank_reference=p_reference,verification_provider=case when t.verification_provider='slipverify' then 'slipverify' else 'easyslip' end,transfer_at=p_transfer_at,verified_at=now() where id=t.id;
 update public.profiles set balance=balance+t.amount where id=t.user_id;
 if not found then raise exception 'Wallet not found';end if;
 insert into public.wallet_ledger(user_id,delta,source_type,source_id) values(t.user_id,t.amount,'topup',t.id);
 return jsonb_build_object('ok',true,'already_credited',false);
end$$;
revoke all on function public.credit_verified_topup(uuid,text,integer,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.credit_verified_topup(uuid,text,integer,timestamptz,text,text,text) to service_role;
