-- Odczyt z bucketu `club-media` był otwarty dla KAŻDEGO zalogowanego
-- użytkownika (jedyny warunek: bucket_id). Zawężamy go do właściciela pliku
-- oraz aktywnych członków klubu (w tym samym tenancie), w którego wpisie plik
-- faktycznie występuje jako załącznik.
create or replace function public.club_media_path_readable(_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_posts p
    join public.club_members m
      on m.club_id = p.club_id
     and m.tenant_id = p.tenant_id
     and m.user_id = auth.uid()
     and m.status = 'active'
    where p.tenant_id = public.current_tenant_id()
      and p.attachments @> jsonb_build_array(jsonb_build_object('path', _path))
  )
$$;

revoke all on function public.club_media_path_readable(text) from public;
grant execute on function public.club_media_path_readable(text) to authenticated;

drop policy if exists "club media member read" on storage.objects;

create policy "club media member read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'club-media'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.club_media_path_readable(name)
  )
);