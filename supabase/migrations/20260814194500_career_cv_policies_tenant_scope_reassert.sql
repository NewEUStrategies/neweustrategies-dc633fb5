-- Rekrutacja: KANONICZNE odtworzenie polityk bucketu `career-cv` z wiązaniem
-- najemcy. Migracja naprawcza, nie nowa funkcjonalność.
--
-- CO SIĘ STAŁO. 20260814100000 (sekcja C) zawęziło trzy polityki bucketu
-- `career-cv` do najemcy: zapis wymusza ścieżkę `<tenant_id>/uploads/<data>/…`,
-- a odczyt i usuwanie sprawdzają `current_tenant_id()` obok `is_staff()`.
-- Powód był konkretny: `is_staff()` bada WYŁĄCZNIE rolę, nie najemcę, więc
-- redaktor najemcy A mógł podpisać i pobrać KAŻDE CV każdego najemcy.
--
-- Trzy godziny później platforma zapisała `20260814122512` - wygenerowany
-- odpowiednik `20260814090000` (stan PRZED zawężeniem) - który tę samą trójkę
-- polityk odtworzył w kształcie sprzed hardeningu:
--
--     career_cv_staff_read  USING (bucket_id = 'career-cv' AND public.is_staff())
--
-- czyli zdjął wiązanie najemcy z odczytu i usuwania CV oraz zgodę na ścieżkę bez
-- tenanta z zapisu. Stan końcowy bazy uratowała WYŁĄCZNIE kolejność plików:
-- `20260814122639` (wygenerowany bliźniak 20260814100000) sortuje się PO
-- `20260814122512` i wtórnie przywrócił zawężenie. Gdyby platforma
-- wygenerowała tylko ten pierwszy plik - albo gdyby bliźniak dostał wcześniejszy
-- znacznik czasu - izolacja najemców na plikach CV byłaby dziś otwarta na
-- produkcji, a żadna bramka by tego nie powiedziała.
--
-- DLACZEGO OSOBNA MIGRACJA, A NIE EDYCJA TAMTEGO PLIKU. Migracje są
-- forward-only: plik `20260814122512` jest już w `schema_migrations`, więc jego
-- edycja nie wykonałaby się nigdzie, a jedynie rozjechała repo z ledgerem
-- (ta sama zasada, którą opisuje bramka `check:sql-emit-actor`: naprawą jest
-- PÓŹNIEJSZY plik odtwarzający obiekt, nie zmiana zastosowanego).
--
-- Ta migracja czyni stan końcowy NIEZALEŻNYM od kolejności bliźniaków: po niej
-- kształt polityk jest zapisany w pliku, który sortuje się jako ostatni z całej
-- serii rekrutacyjnej. Klasę defektu (późniejsza migracja odtwarzająca politykę
-- BEZ wiązania najemcy, które wcześniejsza już nadała) pilnuje od teraz
-- blokująca bramka `check:sql-policy-tenant-regression`.
--
-- Treść jest 1:1 z sekcją C migracji 20260814100000 - celowo, żeby porównanie
-- obu plików było trywialne przy audycie. `DROP … IF EXISTS` + `CREATE` czyni ją
-- w pełni idempotentną, więc `supabase db reset` przechodzi bez zmiany stanu.

-- Zapis: anonim wgrywa z PUBLICZNEJ strony, więc tenant pochodzi z
-- przeglądanego hosta (`public_tenant_id()`), a nie z roli wołającego. Wymuszamy
-- dokładnie trzy segmenty katalogu, żeby nie dało się wgrać poza konwencję.
DROP POLICY IF EXISTS "career_cv_public_upload" ON storage.objects;
CREATE POLICY "career_cv_public_upload"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'career-cv'
  AND array_length(storage.foldername(name), 1) = 3
  AND (storage.foldername(name))[1] = public.public_tenant_id()::text
  AND (storage.foldername(name))[2] = 'uploads'
);

-- Odczyt: personel widzi WYŁĄCZNIE swojego tenanta. Tenant bierzemy z
-- `current_tenant_id()` (tenant DOMOWY wołającego), nie z nagłówka hosta -
-- inaczej admin najemcy A podmieniłby `x-tenant-host` i przeszedł bramkę.
-- Druga gałąź to pliki sprzed zmiany konwencji: ścieżka nie nosi tenanta, więc
-- prawo do niej wynika z istnienia zgłoszenia w tenancie wołającego.
DROP POLICY IF EXISTS "career_cv_staff_read" ON storage.objects;
CREATE POLICY "career_cv_staff_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'career-cv'
  AND public.is_staff()
  AND (
    (storage.foldername(name))[1] = public.current_tenant_id()::text
    OR EXISTS (
      SELECT 1
        FROM public.contact_messages m
       WHERE m.tenant_id = public.current_tenant_id()
         AND m.custom ->> 'cv_path' = storage.objects.name
    )
  )
);

DROP POLICY IF EXISTS "career_cv_staff_delete" ON storage.objects;
CREATE POLICY "career_cv_staff_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'career-cv'
  AND public.is_staff()
  AND (
    (storage.foldername(name))[1] = public.current_tenant_id()::text
    OR EXISTS (
      SELECT 1
        FROM public.contact_messages m
       WHERE m.tenant_id = public.current_tenant_id()
         AND m.custom ->> 'cv_path' = storage.objects.name
    )
  )
);
