-- Publiczne adresy plików pod domeną marki (bliźniak pasa drizzle
-- `0021_brand_media_urls_on_canonical_domain`).
--
-- PO CO BLIŹNIAK. Ten SQL pojechał dotąd WYŁĄCZNIE pasem drizzle, a cała
-- warstwa dowodowa repozytorium (`check:sql-*`, pgTAP, `supabase db start`)
-- czyta `supabase/migrations/`. Środowisko odtworzone z tego pasa - CI e2e,
-- staging, każda nowa baza - nie ma funkcji `public.brand_media_url_text`
-- w ogóle, więc techniczny host magazynu wraca do treści i ustawień.
--
-- POWTÓRNE WYKONANIE JEST BEZPIECZNE. `create or replace` nadpisuje funkcję
-- tą samą treścią, a wszystkie `update` są zawężone predykatem
-- `like '%/storage/v1/%/public/media/%'`: po pierwszym przebiegu nie ma już
-- wiersza, który by mu odpowiadał. Dlatego ten plik wolno dołożyć do pasa,
-- który jedzie na tę samą produkcję - inaczej niż 0001, gdzie hurtowy UPDATE
-- był bezwarunkowy i drugie wykonanie cofałoby decyzje użytkowników.
--
-- DATOWNIK NIE ODPOWIADA CHWILI WYKONANIA NA PASIE DRIZZLE (2026-09-14 20:10).
-- Musi być PÓŹNIEJSZY od najnowszej wersji obecnej w zdalnej historii
-- (20260915090000), bo przyrostowy `supabase db push` bez `--include-all`
-- pomija wersje starsze od niej - dokładnie tak zniknęły 0011 i 0012
-- (patrz uzasadnienie wpisu 0013 w `src/lib/ci/migrationLaneParity.ts`).
-- Wszystkie publiczne adresy plików prezentujemy pod domeną marki.
-- Techniczny host magazynu przestaje pojawiać się w treściach i ustawieniach;
-- trasa /media/$ nadal serwuje pliki z magazynu (także warianty rozmiarowe).
create or replace function public.brand_media_url_text(_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when _value is null then null
    else regexp_replace(
      regexp_replace(
        _value,
        'https?://[A-Za-z0-9._-]+/storage/v1/object/public/media/',
        'https://neweuropeanstrategies.com/media/',
        'g'
      ),
      'https?://[A-Za-z0-9._-]+/storage/v1/render/image/public/media/',
      'https://neweuropeanstrategies.com/media/',
      'g'
    )
  end
$$;

grant execute on function public.brand_media_url_text(text) to authenticated, service_role;

update public.icon_library set url_default = public.brand_media_url_text(url_default)
  where url_default like '%/storage/v1/%/public/media/%';
update public.profiles set avatar_url = public.brand_media_url_text(avatar_url)
  where avatar_url like '%/storage/v1/%/public/media/%';
update public.profiles set cover_url = public.brand_media_url_text(cover_url)
  where cover_url like '%/storage/v1/%/public/media/%';
update public.author_profiles set avatar_url = public.brand_media_url_text(avatar_url)
  where avatar_url like '%/storage/v1/%/public/media/%';
update public.clubs set cover_image_url = public.brand_media_url_text(cover_image_url)
  where cover_image_url like '%/storage/v1/%/public/media/%';
update public.posts set cover_image_url = public.brand_media_url_text(cover_image_url)
  where cover_image_url like '%/storage/v1/%/public/media/%';

update public.posts set builder_data = public.brand_media_url_text(builder_data::text)::jsonb
  where builder_data::text like '%/storage/v1/%/public/media/%';
update public.posts set blocks_data = public.brand_media_url_text(blocks_data::text)::jsonb
  where blocks_data::text like '%/storage/v1/%/public/media/%';
update public.pages set builder_data = public.brand_media_url_text(builder_data::text)::jsonb
  where builder_data::text like '%/storage/v1/%/public/media/%';
update public.site_settings set value = public.brand_media_url_text(value::text)::jsonb
  where value::text like '%/storage/v1/%/public/media/%';
update public.newsletter_settings
  set popup_showcase_images = public.brand_media_url_text(popup_showcase_images::text)::jsonb
  where popup_showcase_images::text like '%/storage/v1/%/public/media/%';

-- Historia zmian jest przywracalna do treści na żywo, więc też ujednolicamy.
update public.content_revisions set snapshot = public.brand_media_url_text(snapshot::text)::jsonb
  where snapshot::text like '%/storage/v1/%/public/media/%';
update public.site_settings_revisions set value = public.brand_media_url_text(value::text)::jsonb
  where value::text like '%/storage/v1/%/public/media/%';

-- Publiczne adresy w bibliotece mediów.
update public.media set public_url = public.brand_media_url_text(public_url)
  where public_url like '%/storage/v1/%/public/media/%';
