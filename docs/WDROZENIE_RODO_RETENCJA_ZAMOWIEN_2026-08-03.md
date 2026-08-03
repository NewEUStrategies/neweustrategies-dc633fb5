# Wdrożenie: usunięcie konta nie niszczy dowodów księgowych (2026-08-03)

Zamknięcie **jedynego otwartego punktu P1** z `OCENA_FUNKCJI_TABELE_2026-08-03.md`
(Moduł: Konto i profil, wiersz „Usunięcie konta (RODO)"), otwartego trzy wydania
audytu z rzędu.

| Rekomendacja audytu                                                                                                                                           | Status      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `payment_orders.user_id ON DELETE CASCADE` → `SET NULL` + anonimizacja (art. 74 uor); wzorzec do skopiowania: `billing_documents.order_id ON DELETE SET NULL` | ✅ wdrożone |

---

## 1. Problem

`payment_orders.user_id` od definicji tabeli (`20260624172041`) było
`NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`. Żadna późniejsza
migracja tego nie ruszyła - `20260731220000` i `20260801135636` dotykają
wyłącznie kolumny `environment`, co potwierdziła weryfikacja audytu.

Skutek: `supabaseAdmin.auth.admin.deleteUser()` w `deleteMyAccount` kasował
KOMPLET zamówień użytkownika, czyli wewnętrzną ewidencję transakcji. Kolizja
obowiązków była rozstrzygana na korzyść tego słabszego:

- **art. 74 ust. 2 ustawy o rachunkowości** - dowody księgowe przechowuje się
  5 lat, licząc od początku roku następującego po roku obrotowym;
- **art. 17 ust. 3 lit. b RODO** - prawo do usunięcia danych NIE przysługuje w
  zakresie, w jakim przetwarzanie jest niezbędne do wypełnienia obowiązku
  prawnego. Kasowanie ewidencji nie było więc realizacją prawa podmiotu, tylko
  naruszeniem obowiązku po naszej stronie.

W repo istniał już poprawny wzorzec, tylko nie objął tej tabeli:
`billing_documents` ma `order_id ON DELETE SET NULL` i **świadomie żadnego FK**
na `user_id` („dokumenty księgowe muszą przetrwać usunięcie konta",
`20260723151000`), a `donations.user_id` jest `ON DELETE SET NULL`
(`20260713174428`).

## 2. Rozwiązanie - dwie warstwy

Ten sam układ obronny, co przy izolacji sandbox/live płatności: struktura w
bazie plus jawny krok w aplikacji. Żadna z warstw nie wystarcza sama.

### Baza: `20260803090000_payment_orders_gdpr_retention.sql`

1. **FK `CASCADE` → `SET NULL`**, `user_id` przestaje być `NOT NULL`. To
   gwarancja strukturalna: usunięcie konta z dashboardu, CLI czy skryptu też
   nie zabiera wiersza zamówienia.
2. **Kolumny retencyjne**: `subject_ref` (pseudonim SHA-256 kupującego),
   `anonymized_at`, `retention_until` (data końca obowiązkowej retencji),
   `retention_hold` (blokada czyszczenia na czas kontroli lub sporu).
   `CHECK payment_orders_anonymized_shape_chk` nie dopuszcza kształtu
   pośredniego: albo żywy właściciel, albo pseudonim BEZ identyfikatora.
3. **`anonymize_payment_orders_for_user(uuid)`** - jedno miejsce realizujące
   „SET NULL + anonimizacja", rozdzielające dwa światy:
   - zamówienia z jakimkolwiek śladem u operatora (`provider_intent_id` /
     `provider_session_id` / `provider_subscription_id`), zaksięgowane
     (`paid_at`) albo mające zależne wiersze (`billing_documents`,
     `b2b_coupon_redemptions`) → **ZOSTAJĄ** bez danych osobowych:
     `user_id = NULL`, `receipt_email = NULL`, metadane obcięte **allowlistą**
     do kluczy księgowych, pseudonim + znacznik anonimizacji;
   - porzucone szkice checkoutu (`pending`/`failed`/`canceled`, zero śladu u
     operatora, zero zależności) → **USUWANE**. Trzymanie ich 5 lat nie ma
     podstawy prawnej i łamałoby minimalizację oraz ograniczenie
     przechowywania (art. 5 ust. 1 lit. c i e RODO).

   Metadane obcinamy allowlistą, nie czarną listą: nowy klucz z danymi
   osobowymi dodany kiedyś w checkoucie ma wypaść domyślnie, a nie przetrwać,
   bo nikt nie pamiętał dopisać go do wyjątków. Substancja księgowa (kwota,
   waluta, daty, identyfikatory transakcji) siedzi w kolumnach, nie w jsonb.

4. **Trigger `BEFORE DELETE ON auth.users`** - siatka bezpieczeństwa dla
   ścieżek poza aplikacją. Fail-closed (bez `EXCEPTION WHEN OTHERS`): cicha
   utrata dowodów to dokładnie ten błąd, który zamykamy.
5. **`purge_expired_payment_orders()` + wpis pg_cron (3:35)** - po wygaśnięciu
   retencji pseudonimizowany dowód znika. Bez tego „anonimizacja" byłaby
   wieczystym składowaniem. Purge dotyka WYŁĄCZNIE wierszy zanonimizowanych -
   historia żywego klienta nie wyparowuje mu po pięciu latach z panelu - i
   pomija `retention_hold`.
6. **`REVOKE DELETE ... FROM authenticated`** - tabela i tak nie ma polityki
   DELETE, ale odebranie grantu czyni retencję niezależną od RLS.

`retention_until` liczy trigger `payment_orders_stamp_retention` z
`accounting_retention_until(coalesce(paid_at, created_at))`: rok obrotowy
rozstrzygany w strefie siedziby (`Europe/Warsaw`), termin = 31.12 roku R+5.
Data jest ZAWSZE przeliczana, bo `paid_at` bywa stemplowane dopiero webhookiem -
wydłużenie ponad ustawowe minimum wyraża się `retention_hold`, nie ręczną datą.

### Aplikacja

- `src/lib/billing/accountingRetention.server.ts` -
  `retainAccountingEvidence(userId)`, cienkie wywołanie RPC, które **rzuca z
  kontraktu**. Cicha porażka oznaczałaby konto usunięte z e-mailem osoby na
  dowodzie księgowym.
- `deleteMyAccount` (`src/lib/account.functions.ts`) - kolejność kroków jest
  częścią kontraktu: re-auth hasłem → anulowanie subskrypcji u operatora →
  anonimizacja zamówień → `deleteUser`. Zwraca `retainedOrders`, żeby UI mówił
  liczbą, ile dowodów zostało (art. 12 RODO).
- Warstwa uprawnień przyjęła zamówienie bez właściciela: `grantEntitlement` i
  `revokeOrderEntitlement` (`grant.server.ts`) oraz `fulfilOrder`
  (`oneTimeFulfilment.server.ts`) pomijają skutki „ludzkie" (uprawnienie, RSVP,
  dzwonek, mail) **bez rzucania** - webhook operatora nie może wpaść w
  nieskończoną pętlę ponowień na wierszu, który nigdy nie odzyska właściciela.
  Skutki księgowe (status zamówienia, dokument, efekty kuponu) dzieją się dalej.
- Panel zamówień biletowych (`ticketOrders.server.ts` +
  `AdminTicketOrdersPanel`) pokazuje „Konto usunięte" / „Account deleted"
  zamiast pustej komórki (`buyerAnonymized`).

### Przejrzystość (PL/EN)

- Molekuła `LegalRetentionNotice` (`src/components/molecules/`) - co zostaje i
  na jakiej podstawie; renderowana i w karcie „strefa niebezpieczna", i w
  dialogu potwierdzenia, żeby informacja trafiła do użytkownika PRZED
  kliknięciem, a nie w odpowiedzi na wniosek o dostęp (art. 12-13 RODO).
- Klucze `profile.security.danger.retention*` oraz komunikat po usunięciu z
  liczebnikiem (`deletedWithRetention`, pełna fleksja PL: `_one/_few/_many/_other`).
- Polityka prywatności (`src/lib/legal/content/privacy.ts`) - punkt „Usunięcie
  danych" mówi teraz wprost, że ewidencja transakcji zostaje, ale zostaje
  odcięta od tożsamości.

## 3. Czego świadomie NIE zmieniono

`billing_profiles.user_id` zostaje `ON DELETE CASCADE`. Tabela trzyma dane do
faktury (nazwa, NIP, adres), a nie sam dowód: wystawione faktury żyją u
operatora i w `billing_documents` (numer + trwałe linki). Usunięcie profilu
rozliczeniowego nie niszczy więc żadnego dokumentu, a jego zachowanie byłoby
przechowywaniem danych osobowych bez podstawy.

## 4. Bramki

- `src/__tests__/accountDeletionRetention.invariant.test.ts` - **statyczna
  bramka stanu końcowego** migracji (bez bazy). Sama obecność migracji
  naprawczej nic nie gwarantuje: dowolna późniejsza migracja mogłaby przywrócić
  `CASCADE`, a dokładnie ten scenariusz powtarzał się w audycie. Test parsuje
  migracje instrukcja po instrukcji (z uwzględnieniem kolejności
  `DROP CONSTRAINT` / `ADD CONSTRAINT` w pliku) i pilnuje, że ostatnia akcja to
  `SET NULL`, że `user_id` jest nullowalny, że anonimizacja jest SECURITY
  DEFINER z odebranym `EXECUTE` dla ról klienckich, że trigger na `auth.users`
  nie został zdjęty i że retencja ma termin oraz sprzątanie. Dodatkowo:
  kolejność kroków w `deleteMyAccount`.
- `src/lib/billing/__tests__/accountingRetention.server.test.ts` - kontrakt
  „rzuca przy awarii" + degradacja nietypowego ładunku RPC.
- `src/lib/billing/__tests__/grant.server.test.ts` - cztery przypadki
  zamówienia bez właściciela (grant/revoke, subskrypcja/zakup).
- Weryfikacja na żywym PostgreSQL 16 (szkielet stanu przed migracją +
  migracja): FK `confdeltype = 'n'`, pseudonim stabilny między zamówieniami
  jednej osoby, metadane obcięte (`attendee_name`, `note` wypadły; `label`,
  `event_id`, `quantity` zostały), porzucony szkic usunięty a szkic z
  wykorzystanym kuponem zachowany, `billing_documents.order_id` nietknięty,
  idempotencja anonimizacji i całej migracji, `purge` respektujący
  `retention_until` oraz `retention_hold`, `authenticated` bez prawa DELETE.
