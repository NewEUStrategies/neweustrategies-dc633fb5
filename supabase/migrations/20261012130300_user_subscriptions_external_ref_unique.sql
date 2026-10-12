-- ============================================================================
-- UPRAWNIENIE SUBSKRYPCYJNE: JEDEN WIERSZ NA KLUCZ OPERATORA
-- (`user_subscriptions.external_ref` UNIQUE, audyt PAY-10).
--
-- DEFEKT. Unikalnosci `external_ref` (identyfikator subskrypcji operatora albo
-- zamowienia) pilnowal wylacznie kod: `syncEntitlementState` i
-- `grantEntitlement` robily "odczytaj, a jak nie ma - wstaw". Dwa rownolegle
-- zdarzenia tej samej subskrypcji (`created` + `updated` bez wiersza) widzialy
-- oba "brak" i wstawialy DWA uprawnienia. Kod czytal potem zawsze najstarszy
-- wiersz (`order by created_at limit 1`), wiec pozniejsza rezygnacja albo
-- pauza trafiala tylko w niego - drugi wiersz zostawal `active` i dawal dostep
-- bez platnosci (`has_content_access` czyta dowolny aktywny wiersz).
--
-- ZMIANA.
--   1. Istniejace duplikaty neutralizujemy DETERMINISTYCZNIE. Wiersz kanoniczny
--      to najstarszy (`created_at`, potem `id`) - wlasnie jego aktualizowal
--      kazdy pisarz, wiec niesie biezacy stan. Pozostale:
--        * `external_ref := external_ref || '#dup:' || id` - zwalniaja klucz,
--          a slad pochodzenia zostaje czytelny dla audytu,
--        * `status := 'canceled'` (zwrot `refunded` zostaje - raporty odrozniaja
--          zwrot pieniedzy od rezygnacji),
--        * `canceled_at := coalesce(canceled_at, now())`.
--      Triggery AFTER na tabeli (`user_subscriptions_notify_trg` - tylko przejscie
--      W `active`, wiec tu milczy; `trg_user_subscriptions_emit_events` -
--      zdarzenie domenowe zmiany statusu) sa odporne na blad (EXCEPTION WHEN
--      OTHERS -> RETURN NEW) i odpalaja raz na zneutralizowany wiersz - to
--      prawdziwa zmiana stanu tego wiersza, wiec slad na szynie jest zasadny.
--      RLS nie dotyczy migracji (wlasciciel tabeli).
--   2. ZWYKLY (nie czesciowy) UNIQUE INDEX na `external_ref`. Indeks czesciowy
--      nie bylby arbitrem dla `ON CONFLICT (external_ref)` bez predykatu,
--      ktorego PostgREST nie przekazuje. NULL-e wciaz dozwolone (wiersze
--      nadane recznie / w testach pgTAP nie maja klucza operatora).
--
-- KOD. `syncEntitlementState` i `grantEntitlement` (src/lib/billing/) wstawiaja
-- wiersz i przegrany wyscig (23505) zamieniaja w aktualizacje TEGO SAMEGO
-- klucza z warunkiem `status <> 'refunded'` - zwrot jest ostateczny.
--
-- KOLEJNOSC WDROZENIA: dowolna. Stary kod pod indeksem dostaje 23505 tylko
-- w wyscigu, ktory wczesniej dawal duplikat (webhook ponawia); nowy kod bez
-- indeksu dziala jak dotad.
-- IDEMPOTENTNA: drugi przebieg nie znajduje duplikatow (rn > 1), indeks
-- IF NOT EXISTS.
-- ============================================================================

WITH ranked AS (
  SELECT us.id,
         row_number() OVER (
           PARTITION BY us.external_ref
           ORDER BY us.created_at, us.id
         ) AS rn
    FROM public.user_subscriptions us
   WHERE us.external_ref IS NOT NULL
)
UPDATE public.user_subscriptions AS us
   SET external_ref = us.external_ref || '#dup:' || us.id::text,
       status = CASE
                  WHEN us.status = 'refunded'::public.purchase_status THEN us.status
                  ELSE 'canceled'::public.purchase_status
                END,
       canceled_at = COALESCE(us.canceled_at, now())
  FROM ranked
 WHERE ranked.id = us.id
   AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_external_ref_key
  ON public.user_subscriptions (external_ref);

COMMENT ON INDEX public.user_subscriptions_external_ref_key IS
  'Jeden wiersz uprawnienia na klucz operatora (PAY-10). Arbiter ON CONFLICT (external_ref) - zwykly, nie czesciowy; NULL dozwolone. Duplikaty sprzed indeksu: external_ref z sufiksem #dup:<id>, status canceled (refunded zostaje).';
