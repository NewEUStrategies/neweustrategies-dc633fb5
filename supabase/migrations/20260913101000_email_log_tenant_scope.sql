-- ZAKRES NAJEMCY W DZIENNIKACH POCZTY (email_send_log, auth_email_events).
--
-- PO CO. Oba dzienniki są dziś PŁASKIE: nie mają kolumny najemcy, a RLS mówi na
-- nich wyłącznie „service_role może wszystko" (20260728154925:44-64 i
-- 20260728193308:34-39). Panele `/admin/newsletter/system-emails`,
-- `/admin/newsletter/auth-logs` i `/admin/newsletter/outbox` czytają je klientem
-- serwisowym PO bramce roli - a bramka roli liczy rolę w najemcy WOŁAJĄCEGO
-- (`user_roles` po `profiles.tenant_id`) i nie mówi NIC o tym, czyje są wiersze.
-- Efekt: admin jednej organizacji widzi adresy odbiorców, nazwy szablonów i
-- komunikaty dostawcy WSZYSTKICH organizacji, a w dzienniku webhooka auth także
-- `recipient_domain`, `subject`, `redirect_to` i `action_url_host`, czyli domeny
-- cudzych najemców. Potwierdzenie roli w najemcy X nie jest zgodą na dane
-- najemcy Y - ta migracja daje wierszowi najemcę, żeby dało się to w ogóle
-- wyrazić w zapytaniu i w polityce.
--
-- KOLEJNOŚĆ MA ZNACZENIE. Kolumna i backfill wchodzą TU, przed filtrem
-- `.eq("tenant_id", …)` w kodzie panelu. Odwrotna kolejność czyści operatorowi
-- panel z całej historii, bo każdy wiersz sprzed migracji ma `tenant_id IS NULL`.
-- Łatanie tego przez `OR tenant_id IS NULL` w filtrze albo w polityce jest
-- WYKLUCZONE: zostawiłoby na stałe furtkę „wiersz bez najemcy widzi każdy
-- admin", czyli dokładnie tę klasę, którą ta migracja zamyka.

-- ── 1) KOLUMNY ──────────────────────────────────────────────────────────────
-- Idempotentnie (wzorzec z 20260728154925:69-73), bo oba dzienniki dostały już
-- raz kolumnę „po fakcie" i ta migracja ma dać się odtworzyć od zera.
--
-- ON DELETE CASCADE, tak jak `email_suppressions.tenant_id`
-- (20260725120000:313): skasowanie najemcy ma zabrać ze sobą adresy e-mail jego
-- odbiorców. Utrata w tym momencie wierszy `status = 'sent'` (czyli części
-- zabezpieczenia przed podwójną wysyłką, indeks `idx_email_send_log_message_sent_unique`)
-- jest bez znaczenia: razem z najemcą znikają też jego wiadomości w kolejce.
ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.auth_email_events
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.email_send_log.tenant_id IS
  'Najemca, do którego należy wpis dziennika. NULL = wiersz historyczny, którego nie dało się jednoznacznie przypisać - świadomie niewidoczny dla ról klienckich.';
COMMENT ON COLUMN public.auth_email_events.tenant_id IS
  'Najemca zdarzenia webhooka auth. NULL = zdarzenie sprzed migracji albo bez dopasowania po message_id.';

-- ── 2) BACKFILL ────────────────────────────────────────────────────────────
-- DLACZEGO NIE `email_resolve_tenant_for_address()`. Gotowy resolver
-- (20260731120000:84-121) kończy się `RETURN public.email_default_tenant_id()`
-- w dwóch gałęziach (`:97` i `:119`), a `email_default_tenant_id()` (`:67-79`)
-- oddaje najemcę z flagą `is_default`. Użyty we wsadowym UPDATE wsypałby
-- WSZYSTKIE nierozstrzygalne adresy do najemcy domyślnego - i ten sam wyciek
-- wróciłby „legalnie, zgodnie z RLS", tyle że w jedną stronę: admin najemcy
-- domyślnego dostałby cudzych odbiorców na własność. Dlatego najemca domyślny
-- jako ostatnia deska ratunku jest tu ŚWIADOMIE ODRZUCONY, a kaskada kończy się
-- na NULL-u.
--
-- KASKADA: (a) jednoznaczny subskrybent newslettera, (b) jednoznaczne konto
-- w `profiles`, (c) NULL. „Jednoznaczny" znaczy `count(DISTINCT tenant_id) = 1`
-- - adres obecny w dwóch organizacjach nie daje odpowiedzi, więc nie udajemy, że
-- daje. Kolejność (a) przed (b) odwzorowuje gałęzie resolvera (`:100-117`):
-- dziennik poczty jest w przeważającej części ruchem newsletterowym.
--
-- `(array_agg(DISTINCT tenant_id))[1]`, a NIE `min(tenant_id)`: Postgres nie zna
-- agregatu `min()` dla typu `uuid`, więc oczywistszy zapis wywróciłby migrację
-- na `function min(uuid) does not exist`. Wybór elementu jest tu i tak
-- jednoznaczny, bo `HAVING` przepuszcza wyłącznie grupy o JEDNEJ wartości.
--
-- Reszta zostaje NULL = „nieprzypisane", czyli niewidoczne dla admina KAŻDEGO
-- najemcy. NULL jest tu bezpieczniejszy niż zgadywanie: ślad nie znika (czyta go
-- `service_role` i dren kolejki), ale nie ma najemcy, któremu wolno go pokazać.
-- Fail closed, nie „pokaż wszystkim".

-- (a) jednoznaczny subskrybent
UPDATE public.email_send_log AS l
   SET tenant_id = s.tid
  FROM (
    SELECT lower(btrim(email)) AS e, (array_agg(DISTINCT tenant_id))[1] AS tid
      FROM public.newsletter_subscribers
     GROUP BY 1
    HAVING count(DISTINCT tenant_id) = 1
  ) AS s
 WHERE l.tenant_id IS NULL
   AND lower(btrim(l.recipient_email)) = s.e;

-- (b) jednoznaczne konto
UPDATE public.email_send_log AS l
   SET tenant_id = p.tid
  FROM (
    SELECT lower(btrim(email)) AS e, (array_agg(DISTINCT tenant_id))[1] AS tid
      FROM public.profiles
     WHERE email IS NOT NULL AND tenant_id IS NOT NULL
     GROUP BY 1
    HAVING count(DISTINCT tenant_id) = 1
  ) AS p
 WHERE l.tenant_id IS NULL
   AND lower(btrim(l.recipient_email)) = p.e;

-- `auth_email_events` NIE MA surowego adresu - tylko `recipient_masked`
-- i `recipient_domain` (20260728193308:11-12), więc dopasowanie po adresie jest
-- tu niemożliwe z definicji. Jedyne uczciwe źródło to `message_id` wspólny
-- z dziennikiem wysyłek, który właśnie dostał najemcę wyżej.
UPDATE public.auth_email_events AS e
   SET tenant_id = l.tenant_id
  FROM public.email_send_log AS l
 WHERE e.message_id = l.message_id
   AND l.tenant_id IS NOT NULL
   AND e.tenant_id IS NULL;

-- ── 3) DLACZEGO NIE `NOT NULL` ─────────────────────────────────────────────
-- Kaskada z punktu 2 z założenia NIE POKRYWA wszystkich wierszy: adres spoza
-- `newsletter_subscribers` i `profiles` (np. jednorazowy odbiorca formularza
-- kontaktowego albo adres obecny w dwóch organizacjach) zostaje bez najemcy.
-- `SET NOT NULL` teraz wywróciłby tę migrację i oblał `check:sql-migration-replay`.
-- Stan docelowy (`email_suppressions.tenant_id NOT NULL`, 20260725120000:313)
-- osiągamy w trzech etapach - zapisane tutaj, żeby etap (iii) nie zginął:
--   (i)   ta migracja: kolumna + backfill + indeksy + polityki;
--   (ii)  ścieżki zapisu (`transactional.server.ts`, `queueDrain.server.ts`,
--         trasy `/platform/email/*`) zaczynają kolumnę wypełniać przy insercie;
--   (iii) po wygaśnięciu retencji ogona - osobna migracja
--         `ALTER TABLE … ALTER COLUMN tenant_id SET NOT NULL`.
--
-- MAILE AUTORYZACYJNE: decyzja podjęta świadomie i zapisana tutaj, bo dotyczy
-- etapu (ii). Webhook auth nie zna dziś najemcy w ogóle, a przy świeżej
-- rejestracji profilu jeszcze nie ma w chwili hooka - resolver wpadłby więc
-- w fallback na najemcę domyślnego. Wybieramy NULL, nie fallback, z tego samego
-- powodu co w punkcie 2: „nie wiem, czyje to jest" nie może oznaczać „pokaż to
-- adminowi najemcy domyślnego". Cena jest znana i akceptowana: reset hasła
-- i magic link dla adresu, którego nie ma jeszcze w żadnym profilu, nie pojawią
-- się w panelu do czasu, aż webhook nauczy się czytać najemcę z hosta
-- (`redirect_to`) - a host jest wejściem z zewnątrz, więc będzie WSKAZÓWKĄ
-- wymagającą mapowania na `tenants.domain`, nigdy autoryzacją.

-- ── 4) INDEKSY POD NOWY PREDYKAT ───────────────────────────────────────────
-- Oba panele czytają okno czasu posortowane `created_at DESC` i od teraz
-- filtrują po najemcy. Bez tych indeksów zapytania spadają na
-- `idx_email_send_log_created` (sam `created_at`), czyli skanują ruch całej
-- platformy, żeby oddać wiersze jednej organizacji.
CREATE INDEX IF NOT EXISTS email_send_log_tenant_created_idx
  ON public.email_send_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_email_events_tenant_created_idx
  ON public.auth_email_events (tenant_id, created_at DESC);

-- `idx_email_send_log_message_sent_unique` (20260728154925:80-81,
-- `ON (message_id) WHERE status = 'sent'`) zostaje CELOWO GLOBALNY i nietknięty:
-- to on chroni przed podwójną wysyłką po wygaśnięciu VT, a dren kolejki pracuje
-- bez kontekstu użytkownika. Gdyby wciągnąć do niego najemcę, ta sama wiadomość
-- mogłaby wyjść dwa razy.

-- ── 5) RLS: OBRONA W GŁĄB ──────────────────────────────────────────────────
-- Polityki service_role zostają - dren kolejki, webhook dostawcy i panel czytają
-- dalej kluczem serwisowym. DOKŁADAMY politykę klieńcką, żeby granica najemcy
-- istniała także w bazie, a nie wyłącznie w TypeScripcie: pomyłka w handlerze ma
-- odbić się o RLS, a nie o nic.
--
-- DLACZEGO WĘZIEJ NIŻ `email_suppressions`. Wzorzec z 20260725120000:369-372
-- dopuszcza `is_staff()`, czyli TAKŻE rolę `author`. Tu odwzorowujemy bramkę
-- APLIKACJI, a paneli dziennika pilnuje `requireAdmin` (admin/super_admin) -
-- autor treści nie ma do nich wstępu i nie ma powodu, żeby baza dawała mu więcej
-- niż aplikacja. Dziennik niesie surowe adresy odbiorców, więc szerszy zasięg
-- byłby tu kosztem bez pokrycia w żadnej ścieżce produktowej.
--
-- `(select …)` wokół wywołań: InitPlan liczy je RAZ na zapytanie, a nie raz na
-- wiersz dziennika, który rośnie liniowo z ruchem całej platformy.
REVOKE ALL ON public.email_send_log FROM PUBLIC, anon;
REVOKE ALL ON public.auth_email_events FROM PUBLIC, anon;
GRANT SELECT ON public.email_send_log TO authenticated;
GRANT SELECT ON public.auth_email_events TO authenticated;

DROP POLICY IF EXISTS email_send_log_admin_select ON public.email_send_log;
CREATE POLICY email_send_log_admin_select
  ON public.email_send_log FOR SELECT TO authenticated
  USING (
    tenant_id = (select public.current_tenant_id())
    AND (
      (select public.has_role(auth.uid(), 'admin'::public.app_role))
      OR (select public.is_super_admin())
    )
  );

DROP POLICY IF EXISTS auth_email_events_admin_select ON public.auth_email_events;
CREATE POLICY auth_email_events_admin_select
  ON public.auth_email_events FOR SELECT TO authenticated
  USING (
    tenant_id = (select public.current_tenant_id())
    AND (
      (select public.has_role(auth.uid(), 'admin'::public.app_role))
      OR (select public.is_super_admin())
    )
  );

-- Wiersz z `tenant_id IS NULL` nie spełnia predykatu żadnej z tych polityk -
-- to jest zamierzone i jest to ta sama decyzja co w punkcie 2. Zapis pozostaje
-- wyłącznie dla `service_role`: polityki klienckie są tylko na SELECT.
