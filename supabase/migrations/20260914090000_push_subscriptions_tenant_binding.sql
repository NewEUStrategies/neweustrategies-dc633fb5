-- ============================================================================
-- push_subscriptions: przywrócenie wiązania najemcy z profilem właściciela
-- ============================================================================
--
-- PO CO TA MIGRACJA.
--
-- Potok Web Push ma DWIE połowy i obie muszą mówić o tym samym najemcy:
--
--   (A) NADAWANIE. `enqueue_notification` (stan końcowy: 20260812091000:139)
--       bierze `notifications.tenant_id` z PROFILU odbiorcy
--       (`profiles.tenant_id`), a trigger `tg_notifications_enqueue_push`
--       (20260713092000:105-108) przepisuje tego najemcę do zadania w kolejce,
--       sprawdzając subskrypcje WYŁĄCZNIE po `user_id`.
--
--   (B) DORĘCZANIE. Dyspozytor `processPushJobs`
--       (src/lib/notifications/dispatch.server.ts:232-240) dobiera urządzenia
--       po PARZE `tenant_id` + `user_id`, gdzie najemca pochodzi z zadania,
--       czyli znów z profilu.
--
-- Połowa (A) nie ma jak sprawdzić warunku, który rozstrzyga połowa (B) - i to
-- jest cały mechanizm awarii: kolejkujemy pracę, która z definicji nie ma
-- odbiorcy, a nigdzie nie powstaje błąd.
--
-- PRZYCZYNA ŹRÓDŁOWA. Wiązanie najemcy subskrypcji z profilem ISTNIAŁO i
-- zostało skasowane. Polityka `push_subscriptions_own_insert`
-- (20260713070354:37-39) miała
--
--     WITH CHECK (user_id = auth.uid() AND tenant_id = public.current_tenant_id())
--
-- czyli dokładnie "najemca subskrypcji = najemca profilu" (`current_tenant_id()`
-- to `SELECT tenant_id FROM profiles WHERE id = auth.uid()`, 20260626180412:1).
-- Pojednanie dwóch równoległych światów push skasowało cztery polityki
-- `push_subscriptions_own_*` jako "duble" (20260713071043:26-29, powtórnie
-- 20260713210000:61-64), zostawiając jedyną politykę stanu końcowego
-- "push subs owner all" (20260713092000:67-71), która sprawdza SAM `user_id`.
-- Razem z nimi zniknął jedyny mechanizm wiążący najemcę - i nic go nie zastąpiło.
--
-- Od tej pory `push_subscriptions.tenant_id` pochodzi wyłącznie z DEFAULT
-- `public.public_tenant_id()` (tabela: 20260712224438:204-221), a to jest
-- najemca PRZEGLĄDANEJ WITRYNY, rozstrzygany z hosta żądania
-- (20260805090000:481). Przeglądarka nosi poświadczenie krawędzi
-- `x-tenant-assert` (cookie -> nagłówek: src/integrations/supabase/
-- tenant-host-fetch.ts), więc gałąź "zalogowany bez poświadczenia wraca do
-- swojego najemcy domowego" NIE ZADZIAŁA: `request_verified_host()` zwraca host
-- i `public_tenant_id()` oddaje najemcę TEJ DOMENY. Klient
-- (src/lib/notifications/push.ts:92-103) kolumny nie podaje.
--
-- SKUTEK. Członek najemcy X, który włączył push na domenie najemcy Y (typowo:
-- wspólna domena platformy), ma subskrypcję z `tenant_id` = Y i zadania z
-- `tenant_id` = X. Dyspozytor nie znajduje ANI JEDNEGO urządzenia,
-- `devices === 0` daje `p_dead: true` (dispatch.server.ts:280) i zadanie
-- przechodzi w status 'dead' bez ani jednej próby wysyłki; po 14 dniach
-- sprząta je `prune_push_queue`. W logach i w panelu wygląda to DOKŁADNIE tak
-- samo jak pusta kolejka, więc awaria jest trwała i niema.
--
-- Druga, niezależna droga do tego samego stanu: `onConflict: "endpoint"` w
-- kliencie NIE odświeża `tenant_id` (kolumny nie ma w ładunku), więc wiersz
-- zapisany przed utwardzeniem hostów (20260805090000) albo przed zmianą
-- najemcy użytkownika zostaje z nieaktualnym najemcą NA ZAWSZE - ponowne
-- włączenie pusha go nie naprawia.
--
-- CO ROBIMY. Wracamy do wiązania, tym razem w miejscu, którego nie da się
-- zgubić przy porządkowaniu polityk: trigger BEFORE przypinający
-- `NEW.tenant_id` do najemcy WŁAŚCICIELA. Wzorcem jest BLIŹNIACZA tabela tego
-- samego modułu - `notification_preferences_pin_identity`
-- (20260712190000:181-205) - razem z jej zasadą "pas i szelki": pin w triggerze
-- plus jawny, samodokumentujący warunek najemcy w RLS. Do tego backfill (bo
-- niedoręczalne są wiersze JUŻ ISTNIEJĄCE) i domknięcie przeniesienia konta
-- między najemcami (bo pin jest migawką z chwili zapisu, nie żywym złączeniem).
--
-- CZEGO ŚWIADOMIE NIE ROBIMY.
--   * Nie zdejmujemy DEFAULT `public_tenant_id()`. Kolumna jest NOT NULL i musi
--     mieć wartość także dla wiersza, którego właściciel nie ma profilu; po tej
--     migracji DEFAULT jest już tylko siatką awaryjną, co mówi COMMENT niżej.
--   * Nie wskrzeszamy zadań, które zdążyły umrzeć jako 'dead'.
--     `claim_push_jobs` bierze wyłącznie 'pending', a statusu 'dead' nie da się
--     odróżnić od śmierci z 404/410 ani od trwale odrzuconego ładunku - w
--     schemacie nie ma pola, które by je rozdzieliło. Masowe odpalenie
--     zaległych pushów byłoby spamem, a treść i tak nie przepadła: powiadomienie
--     in-app powstaje PRZED kolejkowaniem i jest nietknięte.
--
-- Idempotentne: każdy krok jest `CREATE OR REPLACE` / `DROP ... IF EXISTS` /
-- `IF NOT EXISTS`, a backfill ma warunek `IS DISTINCT FROM`, więc drugi przebieg
-- aktualizuje zero wierszy.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Trigger: najemca subskrypcji = najemca profilu właściciela
-- ----------------------------------------------------------------------------
-- ŚWIADOMA RÓŻNICA WOBEC WZORCA. `notification_preferences_pin_identity`
-- zamraża na UPDATE stan poprzedni (`NEW.tenant_id := OLD.tenant_id`), bo tam
-- wiersz jest per-użytkownik i najemca nie ma prawa się zmienić. Tutaj
-- zamrożenie byłoby KONSERWACJĄ BŁĘDU: upsert klienta (onConflict "endpoint")
-- idzie właśnie ścieżką UPDATE, więc to jest jedyny moment, w którym stary
-- wiersz z najemcą wziętym z hosta może się naprawić. Dlatego obie gałęzie
-- wyprowadzają najemcę na nowo z profilu.
--
-- Z `NEW.user_id`, nie z `auth.uid()`: ten sam endpoint bywa przepisywany
-- między kontami (współdzielona przeglądarka), a zapis robi też service_role
-- (brak auth.uid()). Najemca ma być funkcją WŁAŚCICIELA WIERSZA.
--
-- SECURITY DEFINER jest tu potrzebny NIE dla `push_subscriptions` (ciało
-- triggera nie podlega RLS tej tabeli), tylko dla odczytu `public.profiles`:
-- jako INVOKER podlegałby polityce "Profiles authenticated read" i przy zapisie
-- w imieniu innego konta albo po zaostrzeniu tej polityki cicho zwracałby NULL.
-- To ten sam powód, dla którego `current_tenant_id()` jest SECURITY DEFINER.
--
-- `pg_temp` NA KOŃCU ścieżki zgodnie z 20260830120000: bez tego Postgres
-- przeszukuje schemat tymczasowy wołającego JAKO PIERWSZY, a ciało wykonuje się
-- z uprawnieniami właściciela funkcji.
--
-- Awaryjność celowo miękka: brak profilu zostawia wartość, którą wiersz już ma
-- (DEFAULT przy INSERT, stan poprzedni przy UPDATE). Push jest kanałem
-- pomocniczym i nie wolno mu wywrócić zapisu ustawień powiadomień - ta sama
-- zasada, co w `tg_notifications_enqueue_push` (kolejka nigdy nie blokuje
-- powiadomienia in-app).
CREATE OR REPLACE FUNCTION public.push_subscriptions_pin_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT p.tenant_id INTO v_tenant
    FROM public.profiles p
   WHERE p.id = NEW.user_id;

  IF v_tenant IS NOT NULL THEN
    NEW.tenant_id := v_tenant;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.push_subscriptions_pin_tenant() IS
  'Przypina push_subscriptions.tenant_id do profiles.tenant_id WŁAŚCICIELA wiersza (NEW.user_id), przy INSERT i przy UPDATE. Utrzymuje zgodność z kluczem adresata dyspozytora (tenant_id, user_id), który pochodzi z notifications.tenant_id, czyli z tego samego profilu. Brak profilu zostawia wartość dotychczasową - push nigdy nie wywraca zapisu.';

DROP TRIGGER IF EXISTS push_subscriptions_pin_tenant ON public.push_subscriptions;
CREATE TRIGGER push_subscriptions_pin_tenant
  BEFORE INSERT OR UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.push_subscriptions_pin_tenant();

-- ----------------------------------------------------------------------------
-- 2) Pas i szelki: jawny warunek najemcy w RLS
-- ----------------------------------------------------------------------------
-- Pin z punktu 1 i tak gwarantuje zgodność; polityka jest tu po to, żeby
-- kontrakt był WIDOCZNY w definicji tabeli i żeby skasowanie go znowu
-- wymagało świadomej decyzji, a nie przeszło jako sprzątanie dubli. Dokładnie
-- tak zginęło wiązanie poprzednim razem: żyło WYŁĄCZNIE w polityce.
--
-- Kształt wzięty wprost z akapitu "PROPONOWANA POLITYKA", który zostawił
-- supabase/tests/module12_notifications_rls_test.sql - razem z jego
-- uzasadnieniem, dlaczego USING zostaje BEZ tenanta: osierocony wiersz musi
-- pozostać widoczny i USUWALNY, inaczej trzyma zakładnika w UNIQUE (endpoint)
-- i przeglądarka nigdy nie zasubskrybuje się ponownie. Tenant wiąże wyłącznie
-- WITH CHECK, czyli każdy ZAPIS stempluje bieżący tenant domowy. Ta asymetria
-- jest UDOKUMENTOWANA w scripts/check-sql-owner-tenant-scope.ts (JUSTIFIED),
-- bo bramka owner-tenant-scope słusznie pyta o nią przy każdym przebiegu.
--
-- `current_tenant_id()`, a nie podzapytanie inline na `profiles`: funkcja jest
-- SECURITY DEFINER, więc widzi profil DOKŁADNIE tak jak trigger z punktu 1.
-- Podzapytanie inline (wzorzec `notification_preferences`) podlega RLS na
-- `profiles` i po jej zaostrzeniu rozjechałoby się z pinem.
--
-- Jedyne odstępstwo od tamtej propozycji: warunek jest TOLERANCYJNY (COALESCE),
-- a nie twardą równością. Trigger przy braku profilu zostawia wartość
-- dotychczasową, więc twarda równość z NULL-em odrzucałaby wiersz, który pin
-- właśnie zaakceptował - polityka nie może mieć innego zdania niż trigger.
DROP POLICY IF EXISTS "push subs owner all" ON public.push_subscriptions;
CREATE POLICY "push subs owner all" ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = COALESCE((SELECT public.current_tenant_id()), tenant_id)
  );

-- ----------------------------------------------------------------------------
-- 3) Backfill: istniejące subskrypcje wracają do najemcy właściciela
-- ----------------------------------------------------------------------------
-- Bez tego naprawa obejmuje wyłącznie NOWE subskrypcje, a niedoręczalne są
-- dokładnie te JUŻ ISTNIEJĄCE.
--
-- BEZ jawnego LOCK TABLE: migracje w tym repo aplikowane są instrukcja po
-- instrukcji, poza blokiem transakcyjnym (patrz scripts/pgtap-local/run.sh,
-- który odtwarza kolejność Supabase CLI), a `LOCK TABLE` poza transakcją jest
-- błędem składniowym i wywala cały plik. Wyścig i tak nie szkodzi: równoległy
-- upsert klienta przechodzi przez trigger z punktu 1, który liczy DOKŁADNIE tę
-- samą wartość z tego samego profilu, więc kolejność zapisów nie zmienia wyniku.

-- `p.tenant_id IS NOT NULL` jest pasem, a nie ozdobą: kolumna jest dziś NOT NULL
-- (20260531181120:36), ale gdyby kiedykolwiek ją rozluźniono, bez tego warunku
-- backfill zapisałby NULL-a do kolumny NOT NULL i wywrócił migrację zamiast po
-- cichu pominąć wiersz. UPDATE przechodzi przez trigger z punktu 1, który liczy
-- tę samą wartość z tego samego profilu - wyniki są zgodne, idempotencja
-- zachowana. NIE dotykamy `last_seen_at` (miara świeżości urządzenia) ani
-- `failed_at`; na tabeli nie ma triggera `updated_at`.
UPDATE public.push_subscriptions ps
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE p.id = ps.user_id
   AND p.tenant_id IS NOT NULL
   AND ps.tenant_id IS DISTINCT FROM p.tenant_id;

-- Sieroty (właściciel bez wiersza w `profiles`) ZOSTAJĄ bez zmian i są
-- raportowane. Nie kasujemy i nie zgadujemy, bo `enqueue_notification` dla
-- użytkownika bez profilu też spada na `public_tenant_id()` - dotychczasowa
-- wartość jest dla takiego wiersza tak samo dobrym przybliżeniem jak każda inna.
DO $$
DECLARE
  v_orphans integer;
BEGIN
  SELECT count(*) INTO v_orphans
    FROM public.push_subscriptions ps
    LEFT JOIN public.profiles p ON p.id = ps.user_id
   WHERE p.id IS NULL;

  IF v_orphans > 0 THEN
    RAISE NOTICE
      'push_subscriptions: % subskrypcji bez profilu wlasciciela - tenant zostawiony bez zmian. Kontrola: SELECT ps.id, ps.user_id FROM public.push_subscriptions ps LEFT JOIN public.profiles p ON p.id = ps.user_id WHERE p.id IS NULL;',
      v_orphans;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4) Domknięcie przeniesienia konta między najemcami
-- ----------------------------------------------------------------------------
-- Pin z punktu 1 jest MIGAWKĄ z chwili zapisu, nie żywym złączeniem. Bez tego
-- kroku przeniesienie użytkownika do innego najemcy osierociłoby jego
-- subskrypcje dokładnie tak, jak robił to DEFAULT z hosta - i naprawiałoby się
-- dopiero wtedy, gdy użytkownik sam wejdzie w ustawienia i przełączy suwak.
--
-- Przeniesienie ISTNIEJE i jest legalne: `profiles_pin_tenant_id`
-- (20260812102500:78-84) rzuca 'profiles.tenant_id is immutable' WŁAŚCICIELOWI,
-- ale jawnie zwalnia `is_service_role_caller()` i `super_admin`. Tą furtką
-- chodzi przyjęcie zaproszenia (src/lib/admin/invitations.functions.ts:401-406,
-- `supabaseAdmin.from("profiles").upsert({ tenant_id: inv.tenant_id, … })`)
-- i masowe provisionowanie.
--
-- Dlaczego TRIGGER, a nie poprawka w `invitations.functions.ts`: przeniesienie
-- idzie rolą serwerową i może paść także ręcznie z konsoli Supabase. Trigger
-- łapie każdego poruszającego - to ta sama zasada "pin w bazie zamiast
-- dyscypliny w kliencie", która stoi za całą tą migracją.
--
-- ZAKRES CELOWO WĄSKI - tylko `push_subscriptions`. Bliźniacza
-- `notification_preferences` ma ten sam defekt osierocenia, ale NIE DA SIĘ go
-- domknąć stąd: jej `notification_preferences_pin_identity` na UPDATE robi
-- bezwarunkowo `NEW.tenant_id := OLD.tenant_id`, więc każdy UPDATE z tego
-- miejsca zostałby po cichu cofnięty. To osobny defekt i osobna migracja.
CREATE OR REPLACE FUNCTION public.tg_profiles_repin_push_subscriptions()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.push_subscriptions ps
     SET tenant_id = NEW.tenant_id
   WHERE ps.user_id = NEW.id
     AND ps.tenant_id IS DISTINCT FROM NEW.tenant_id;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.tg_profiles_repin_push_subscriptions() IS
  'Po przeniesieniu konta między najemcami przepina subskrypcje push właściciela, żeby klucz adresata dyspozytora (tenant_id, user_id) nadal zgadzał się z notifications.tenant_id. Bez tego pin z push_subscriptions_pin_tenant zostaje migawką sprzed przeniesienia i push cichnie.';

DROP TRIGGER IF EXISTS profiles_repin_push_subscriptions ON public.profiles;
CREATE TRIGGER profiles_repin_push_subscriptions
  AFTER UPDATE OF tenant_id ON public.profiles
  FOR EACH ROW
  WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id)
  EXECUTE FUNCTION public.tg_profiles_repin_push_subscriptions();

-- ----------------------------------------------------------------------------
-- 5) Indeks pod zapytanie dyspozytora (i sprzątnięcie dubla)
-- ----------------------------------------------------------------------------
-- Stan zastany: DWA identyczne indeksy częściowe na (user_id) WHERE failed_at
-- IS NULL - `idx_push_subscriptions_user` (20260712224438:223-224) i
-- `push_subscriptions_user_live_idx` (20260713071043:31-32, powtórnie
-- 20260713210000:68-69) - pozostałość po pojednaniu dwóch światów. Każdy zapis
-- subskrypcji utrzymywał oba, a żaden nie pokrywał filtra dyspozytora.
--
-- Jeden indeks złożony obsługuje OBA wzorce odczytu: dyspozytora
-- (user_id + tenant_id) i trigger kolejkujący, który pyta po samym `user_id` -
-- kolumna wiodąca jest ta sama, więc kasacja dubli niczego nie odbiera.
-- Obie kasowane nazwy nie są referencjonowane nigdzie poza migracjami, które je
-- tworzą.
CREATE INDEX IF NOT EXISTS push_subscriptions_user_tenant_live_idx
  ON public.push_subscriptions (user_id, tenant_id) WHERE failed_at IS NULL;

DROP INDEX IF EXISTS public.idx_push_subscriptions_user;
DROP INDEX IF EXISTS public.push_subscriptions_user_live_idx;

COMMENT ON COLUMN public.push_subscriptions.tenant_id IS
  'Najemca WŁAŚCICIELA subskrypcji (profiles.tenant_id), przypinany triggerem push_subscriptions_pin_tenant przy INSERT i UPDATE oraz przepinany triggerem profiles_repin_push_subscriptions po przeniesieniu konta. NIE jest to najemca przeglądanej witryny: DEFAULT public_tenant_id() to wyłącznie wartość awaryjna dla wiersza bez profilu. Dyspozytor (processPushJobs) dobiera urządzenia po parze (tenant_id, user_id) wywiedzionej z notifications.tenant_id, czyli z tego samego profilu.';
