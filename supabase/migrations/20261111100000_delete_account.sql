-- Delete account (an App Store requirement). The delete-account Edge Function
-- removes the auth user, which cascades through profiles to everything the
-- person made, then deletes their files from Storage and their Mux videos.
--
-- Kept: payout records (with their Stripe ids, for tax and accounting) and
-- commissions, with the link to the person removed.

alter table public.payouts alter column profile_id drop not null;
alter table public.payouts drop constraint payouts_profile_id_fkey;
alter table public.payouts
  add constraint payouts_profile_id_fkey foreign key (profile_id) references public.profiles (id) on delete set null;

-- What the delete screen shows before you confirm.
create function public.account_deletion_summary()
returns table (handle text, post_count int, unpaid_cents int, payout_in_progress boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.handle,
         (select count(*)::int from public.posts where author_id = p.id),
         (select (b.pending_cents + greatest(b.available_cents, 0))::int from public.creator_balances(p.id) b),
         exists (select 1 from public.payouts where profile_id = p.id and status = 'processing')
  from public.profiles p
  where p.id = auth.uid()
$$;
revoke execute on function public.account_deletion_summary() from public, anon;
grant execute on function public.account_deletion_summary() to authenticated;

-- Service role: the files to remove once the account is gone. Raises
-- payout_in_progress while a payout is being sent, so it can finish first.
create function public.account_files(p_profile_id uuid)
returns table (bucket text, path text, mux_asset_id text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.payouts where profile_id = p_profile_id and status = 'processing') then
    raise exception 'payout_in_progress';
  end if;
  return query
    select 'post-media'::text, m.storage_path, null::text
    from public.post_media m join public.posts po on po.id = m.post_id
    where po.author_id = p_profile_id and m.storage_path is not null
    union all
    select null::text, null::text, m.mux_asset_id
    from public.post_media m join public.posts po on po.id = m.post_id
    where po.author_id = p_profile_id and m.mux_asset_id is not null
    union all
    select null::text, null::text, v.asset_id
    from public.video_uploads v
    where v.profile_id = p_profile_id and v.asset_id is not null and v.used_at is null;
end;
$$;
revoke execute on function public.account_files(uuid) from public, anon, authenticated;
grant execute on function public.account_files(uuid) to service_role;
