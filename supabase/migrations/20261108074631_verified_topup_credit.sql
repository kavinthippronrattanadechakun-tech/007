alter table public.topups add column verification_provider text not null default 'manual' check(verification_provider in ('manual','easyslip')),
 add column transfer_at timestamptz;
create unique index topups_bank_reference_normalized_unique on public.topups(lower(btrim(bank_reference))) where bank_reference is not null;
create function public.reserve_topup(p_id uuid,p_user_id uuid,p_amount integer,p_path text,p_hash text)
 returns uuid language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.profiles where id=p_user_id for update;
 if not found then raise exception 'Profile not found';end if;
 if p_amount<1 or p_amount>100000 or p_path not like p_user_id::text||'/%' or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid topup';end if;
 if (select count(*) from public.topups where user_id=p_user_id and created_at>now()-interval '1 minute')>=5 then raise exception 'Too many topups';end if;
 insert into public.topups(id,user_id,amount,slip_path,slip_hash) values(p_id,p_user_id,p_amount,p_path,p_hash);
 return p_id;
end$$;
revoke all on function public.reserve_topup(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.reserve_topup(uuid,uuid,integer,text,text) to service_role;
create function public.credit_verified_topup(p_id uuid,p_reference text,p_amount integer,p_transfer_at timestamptz,p_account_number text,p_bank_name text,p_account_name text)
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
 update public.topups set status='approved',bank_reference=p_reference,verification_provider='easyslip',transfer_at=p_transfer_at,verified_at=now() where id=t.id;
 update public.profiles set balance=balance+t.amount where id=t.user_id;
 if not found then raise exception 'Wallet not found';end if;
 insert into public.wallet_ledger(user_id,delta,source_type,source_id) values(t.user_id,t.amount,'topup',t.id);
 return jsonb_build_object('ok',true,'already_credited',false);
end$$;
revoke all on function public.credit_verified_topup(uuid,text,integer,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.credit_verified_topup(uuid,text,integer,timestamptz,text,text,text) to service_role;
