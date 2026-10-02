-- pgTAP: każdy profil ma slug z imienia i nazwiska (migracja 20261002110000).
--
-- FINDING. Powiadomienia o rekomendacjach i poparciach sklejały adres
-- `/author/` || notification_profile_ref(odbiorca), a helper przy braku sluga
-- oddawał id - `/author/<uuid>` omija przekierowanie nie-autora na /people
-- i po F5 kończy się 404. Do tego generator gubił wielkie litery
-- ("Igor Miasnikow" -> "gor-iasnikow"), bo zamieniał znaki PRZED `lower()`.
--
-- Ten plik przypina kontrakt: pusty slug przy zapisie zastępuje slug z nazwy,
-- kolizja dostaje krótki sufiks czterech cyfr ("igor-miasnikow-4211"), a adres
-- w powiadomieniu niesie slug, nigdy id.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(14);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('f8a11111-1111-1111-1111-111111111111', 'slug-always', 'Slug Always Tenant');

INSERT INTO auth.users (id, email) VALUES
  ('f8000000-0000-0000-0000-0000000000a1', 'i1@slug.test'),
  ('f8000000-0000-0000-0000-0000000000a2', 'i2@slug.test'),
  ('f8000000-0000-0000-0000-0000000000a3', 'l@slug.test'),
  ('f8000000-0000-0000-0000-0000000000a4', 'd@slug.test'),
  ('f8000000-0000-0000-0000-0000000000a5', 'n@slug.test'),
  ('f8000000-0000-0000-0000-0000000000a6', 'k@slug.test'),
  ('f8000000-0000-0000-0000-0000000000a7', 'a@slug.test');

-- Profile zapisywane BEZ sluga - wszystkie poza K (własny nick) i A.
INSERT INTO public.profiles (id, email, first_name, last_name, display_name, slug, tenant_id) VALUES
  ('f8000000-0000-0000-0000-0000000000a1', 'i1@slug.test', 'Igor', 'Miasnikow', 'Igor Miasnikow', NULL,
   'f8a11111-1111-1111-1111-111111111111'),
  ('f8000000-0000-0000-0000-0000000000a2', 'i2@slug.test', 'Igor', 'Miasnikow', 'Igor Miasnikow', '',
   'f8a11111-1111-1111-1111-111111111111'),
  ('f8000000-0000-0000-0000-0000000000a3', 'l@slug.test', 'Łukasz', 'Żółć', NULL, NULL,
   'f8a11111-1111-1111-1111-111111111111'),
  ('f8000000-0000-0000-0000-0000000000a4', 'd@slug.test', NULL, NULL, 'Ewa Wyświetlana', NULL,
   'f8a11111-1111-1111-1111-111111111111'),
  ('f8000000-0000-0000-0000-0000000000a5', 'n@slug.test', NULL, NULL, NULL, NULL,
   'f8a11111-1111-1111-1111-111111111111'),
  ('f8000000-0000-0000-0000-0000000000a6', 'k@slug.test', 'Karol', 'Nick', 'Karol Nick', 'moj-wlasny-nick',
   'f8a11111-1111-1111-1111-111111111111'),
  ('f8000000-0000-0000-0000-0000000000a7', 'a@slug.test', 'Anna', 'Autorka', 'Anna Autorka', 'slug-always-autorka',
   'f8a11111-1111-1111-1111-111111111111');

-- ── Generator i wyzwalacz przy INSERT ───────────────────────────────────────
SELECT is(
  (SELECT slug FROM public.profiles WHERE id = 'f8000000-0000-0000-0000-0000000000a1'),
  'igor-miasnikow',
  'insert bez sluga: slug z imienia i nazwiska, z wielkimi literami (dotąd "gor-iasnikow")'
);
SELECT matches(
  (SELECT slug FROM public.profiles WHERE id = 'f8000000-0000-0000-0000-0000000000a2'),
  '^igor-miasnikow-[0-9]{4}$',
  'kolizja: krótki sufiks czterech cyfr ("igor-miasnikow-4211"), nie kolejny numer'
);
SELECT is(
  (SELECT slug FROM public.profiles WHERE id = 'f8000000-0000-0000-0000-0000000000a3'),
  'lukasz-zolc',
  'polskie znaki i wielkie litery: "Łukasz Żółć" -> "lukasz-zolc"'
);
SELECT is(
  (SELECT slug FROM public.profiles WHERE id = 'f8000000-0000-0000-0000-0000000000a4'),
  'ewa-wyswietlana',
  'bez imienia i nazwiska: slug z nazwy wyświetlanej'
);
SELECT matches(
  (SELECT slug FROM public.profiles WHERE id = 'f8000000-0000-0000-0000-0000000000a5'),
  '^user-[0-9]{4}$',
  'bez żadnej nazwy: "user-NNNN" - nigdy lokalna część adresu e-mail ani id'
);
SELECT is(
  (SELECT slug FROM public.profiles WHERE id = 'f8000000-0000-0000-0000-0000000000a6'),
  'moj-wlasny-nick',
  'własny nick zostaje nietknięty'
);

-- ── Wyzwalacz przy UPDATE ───────────────────────────────────────────────────
-- Wyczyszczenie pola "Nick" (SocialIdentityPanel zapisuje wtedy NULL): osoba
-- odzyskuje WŁASNY slug z nazwy, a nie "...-NNNN" przez kolizję z samą sobą.
UPDATE public.profiles SET slug = NULL WHERE id = 'f8000000-0000-0000-0000-0000000000a1';
SELECT is(
  (SELECT slug FROM public.profiles WHERE id = 'f8000000-0000-0000-0000-0000000000a1'),
  'igor-miasnikow',
  'wyczyszczony nick: slug z nazwy wraca, bez kolizji z własnym wierszem'
);
UPDATE public.profiles SET slug = '   ' WHERE id = 'f8000000-0000-0000-0000-0000000000a6';
SELECT is(
  (SELECT slug FROM public.profiles WHERE id = 'f8000000-0000-0000-0000-0000000000a6'),
  'karol-nick',
  'nick z samych spacji: zastąpiony slugiem z imienia i nazwiska'
);
SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE slug IS NULL OR btrim(slug) = ''),
  0,
  'żaden profil nie ma pustego sluga (uzupełnienie + wyzwalacz)'
);

-- ── Powiadomienia: slug, nigdy id ───────────────────────────────────────────
SELECT is(
  public.notification_profile_ref('f8000000-0000-0000-0000-0000000000a2'),
  (SELECT slug FROM public.profiles WHERE id = 'f8000000-0000-0000-0000-0000000000a2'),
  'notification_profile_ref: slug osoby'
);
SELECT is(
  public.notification_profile_ref('f8000000-0000-0000-0000-0000000000ff'),
  NULL,
  'notification_profile_ref: brak profilu -> NULL (powiadomienie bez linku), nigdy id'
);

-- Prawdziwa ścieżka: rekomendacja do moderacji trafia do odbiorcy (I2,
-- zapisanego bez sluga) z jego slugiem z nazwy w adresie.
INSERT INTO public.profile_recommendations
  (id, tenant_id, recipient_id, author_id, relationship, body, status) VALUES
  ('f8330000-0000-0000-0000-000000000001', 'f8a11111-1111-1111-1111-111111111111',
   'f8000000-0000-0000-0000-0000000000a2', 'f8000000-0000-0000-0000-0000000000a7',
   'colleague', 'Wspolpraca merytoryczna na najwyzszym poziomie.', 'pending');
SELECT ok(
  (SELECT bool_and(n.href ~ '^/author/igor-miasnikow-[0-9]{4}#r-f8330000-0000-0000-0000-000000000001-pending$')
          AND count(*) = 1
     FROM public.notifications n
    WHERE n.user_id = 'f8000000-0000-0000-0000-0000000000a2'
      AND n.kind = 'recommendation'),
  'powiadomienie o rekomendacji: /author/<slug z nazwy>, nie /author/<uuid>'
);

-- ── Uprawnienia ─────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.profiles_ensure_slug()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.profiles_ensure_slug()', 'EXECUTE'),
  'acl: funkcja wyzwalacza nie jest wołalna z API'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.profiles_generate_unique_slug(text, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.profiles_generate_unique_slug(text, uuid)', 'EXECUTE'),
  'acl: wariant generatora z wykluczeniem nie jest wołalny z API'
);

SELECT * FROM finish();
ROLLBACK;
