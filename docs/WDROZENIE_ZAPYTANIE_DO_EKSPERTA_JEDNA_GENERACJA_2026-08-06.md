# „Zapytanie do eksperta": jedna generacja, dwie dziury zamknięte, bramka CI (2026-08-06)

Zamknięcie pozycji **„Zapytanie do eksperta w dwóch równoległych generacjach"**. Funkcja
żyła w repo w dwóch zestawach nazw; klient wołał ten **bez** poprawek bezpieczeństwa,
a na świeżej bazie cała piątka wołanych RPC była martwa. Naprawy istniały od
`20260724090500` - w generacji, której nikt nie wołał.

## 1. Stan wyjściowy: dwa światy, jeden wołany

|                      | generacja „inmail" (WOŁANA przez klienta)                                                                 | generacja „expert_request" (nieużywana)                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| RPC                  | `my_inmail_quota`, `send_expert_inmail`, `resolve_expert_inmail`, `list_my_inmails`, `admin_list_inmails` | `my_expert_request_quota`, `send_expert_request`, `resolve_expert_request`, `list_my_expert_requests`, `admin_list_expert_requests` |
| tabela               | `public.expert_inmails`                                                                                   | `public.expert_requests`                                                                                                            |
| licznik puli         | `status <> 'cancelled'`                                                                                   | wszystkie wysłane w miesiącu                                                                                                        |
| serializacja wysyłek | brak                                                                                                      | `pg_advisory_xact_lock`                                                                                                             |
| pula                 | flagi `chat_inmail_quota_2/5` (Plus = 2, Pro = 5)                                                         | liczba `features.expert_request_quota` (Plus = 1, Pro = 3)                                                                          |

`src/lib/chat/useExpertRequests.ts` wołał wyłącznie lewą kolumnę.

### 1.1 Dziura P1: pula miesięczna do obejścia pętlą „wyślij → anuluj → wyślij"

Licznik pomijał `cancelled`, a wycofanie jest dostępne nadawcy: z UI
(`/profile/expert-requests`, skrzynka „Wysłane") oraz - co ważniejsze - wprost przez
Data API (`PATCH /expert_inmails?id=eq.…` z `{"status":"cancelled"}`; polityka
`"inmails: sender may cancel own request"` i grant `UPDATE` dla `authenticated` na to
pozwalają). Efekt: warstwa Plus z pulą 2 wysyłała **dowolnie wiele** zapytań - limit
sprzedawany w cenniku był fikcją, a eksperci dostawali nielimitowany strumień.

### 1.2 Dziura P1: brak serializacji (TOCTOU)

`count → check → INSERT` bez blokady. Dwa równoległe wywołania przy pozostałej puli 1
wstawiały dwa rekordy. Advisory lock istniał tylko w `send_expert_request`.

### 1.3 Rozjazd światów: 5 wołanych RPC martwych na świeżej bazie

`20260723180000` (blok „expert_request_quota") robi
`ALTER TABLE expert_inmails RENAME TO expert_requests` i `DROP`-uje pięć funkcji „inmail".
Produkcja tego **nigdy nie wykonała**: plik ma zdublowaną wersję (kolizja
`schema_migrations_pkey`), więc blok został scalony do pliku, którego wersja już siedzi
w ledgerze. Na świeżej bazie rename **JEST** stosowany, a dwie późniejsze migracje
(`20260724115134`, `20260724130000`) odtwarzają `send_expert_inmail` pod **starą** nazwą
tabeli. Stan końcowy migracji na świeżej bazie:

| RPC klienta                                                                         | co się dzieje                                                                |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `send_expert_inmail`                                                                | istnieje, ale ciało celuje w nieistniejącą tabelę → **42P01** przy wywołaniu |
| `my_inmail_quota`, `resolve_expert_inmail`, `list_my_inmails`, `admin_list_inmails` | nie istnieją wcale → **PGRST202**                                            |

Potwierdzone eksperymentalnie na Postgresie 16 (odwzorowane zależności obu światów,
migracja stosowana na każdym z nich osobno) oraz statycznie nową bramką CI - po usunięciu
migracji naprawczej raport wskazuje dokładnie te pięć pozycji.

## 2. Decyzje

1. **Jedna relacja fizyczna: `public.expert_inmails`.** To nazwa z produkcji i ze zrzutu
   typów (`src/integrations/supabase/types.ts`), więc zbieżność osiągamy **bez DDL na
   żywej tabeli** - to świeża baza cofa rename. Nazwa domenowa („expert request") żyje
   w API i UI. Rename tabeli na produkcji pozostaje osobną decyzją operatora (wymaga
   regeneracji zrzutu typów) - poza zakresem naprawy bezpieczeństwa.
2. **Jedna implementacja.** Logika mieszka w funkcjach o nazwach **domenowych**. Piątka
   „inmail" zostaje jako **cienkie delegaty** (jedno `SELECT`), bo to je woła klient:
   wdrożenie migracji nie jest sprzęgnięte z deployem frontu, a dwie generacje nie mogą
   się już rozjechać - nie ma drugiego ciała, w którym dałoby się zapomnieć poprawki.
3. **Pula: kanoniczna jest liczba `features.expert_request_quota`** (edytowalna per tenant
   w `/admin/membership`, pokazywana w cenniku), a dawne flagi boolowskie działają jako
   **podłoga** (`GREATEST`). Nikt nie traci puli już przyznanej: Plus zostaje przy 2,
   Pro przy 5, a tenant bez klucza liczbowego nie spada do zera (co wyłączyłoby funkcję).
4. **Wycofanie zużywa pulę.** Anulowanie jest wycofaniem zapytania, nie zwrotem limitu.
   To jedyna semantyka odporna na pętlę obejścia - i dlatego UI mówi o niej wprost
   **przed** kliknięciem, a nie po fakcie.

## 3. Co weszło

**Migracja `20260806160001_expert_request_single_generation.sql`**

- **Zbieżność relacji**: blok `DO` przemianowuje `expert_requests` → `expert_inmails`
  (tylko na świeżej bazie), zatrzymuje się głośno, gdy istnieją **obie** tabele (scalenie
  danych to decyzja operatora) albo **żadna** (przerwany łańcuch). Reszta migracji jest
  dzięki temu **statyczna** - widzą ją bramki CI analizujące treść migracji.
- **Nazwy obiektów zależnych** (indeksy, trigger `updated_at`, polityki) zbiegają się do
  jednego kształtu; nowy indeks `(sender_id, recipient_id, created_at DESC)` obsługuje
  antyspam.
- **Polityki RLS**: jeden kanoniczny zestaw, w którym **każda** ścieżka wiąże wiersz
  z `current_tenant_id()` (odczyt uczestników i admina, wycofanie nadawcy, odpowiedź
  odbiorcy, zapis admina; wstawka bezpośrednia nadal `WITH CHECK (false)`).
- **Granty**: `authenticated` traci `INSERT`/`UPDATE` na tabeli - zostaje `SELECT` pod
  RLS. Zapis przez Data API omijał maszynę stanów RPC: `PATCH {"status":"cancelled"}`
  wycofywał zapytanie **już zatwierdzone** (z żywą konwersacją), a odbiorca mógł postawić
  `answered` bez przejścia przez `approve`. Guard kolumnowy pilnuje KOLUMN, nie PRZEJŚĆ,
  więc jedyną bramką przejść jest `resolve_expert_request`. Polityki UPDATE zostają jako
  druga warstwa (gdyby grant kiedyś wrócił) - i tak samo testujemy je pgTAP-em rolą,
  która grant ma.
- **`my_expert_request_quota()`**: jedno źródło prawdy dla UI, bramki wysyłki i cennika.
  Pula = `GREATEST(expert_request_quota, dawne flagi)`, `used` = **wszystkie** wysłane
  w bieżącym miesiącu kalendarzowym w tym tenancie.
- **`send_expert_request(...)`**: `pg_advisory_xact_lock('expert_request:' || uid)`
  serializuje wysyłki nadawcy; bramki w kolejności - ten sam tenant, odbiorca
  ekspert/VIP, zgoda odbiorcy (`profiles.expert_requests_enabled`), moduł włączony
  w tenancie (`site_settings.community_modules`), walidacja treści, pula, antyspam
  **5 zapytań / 24 h do tego samego odbiorcy** (inwariant z migracji założycielskiej
  `20260723090707`, zgubiony po drodze; jedyny limit warstw „bezpośrednich").
- **`resolve_expert_request(...)`**: sprawdzenie tenanta **w ciele** (SECURITY DEFINER
  omija RLS) + maszyna stanów: `cancel`/`decline`/`approve` wyłącznie z `pending`,
  `answered` z `pending`/`approved`. Notatkę administracyjną zapisuje wyłącznie admin.
- **`list_my_expert_requests` / `admin_list_expert_requests`**: zawężone do tenanta
  domowego wołającego.
- **Guard kolumnowy** `expert_inmails_guard_update()` z jedną korektą: gałąź nadawcy
  zabraniała ruszać `responded_at`, a wycofanie przez RPC właśnie ten stempel stawia -
  „Wycofaj" w UI kończyło się wyjątkiem, choć ta sama zmiana statusu przez Data API
  przechodziła. Teraz stempel wolno postawić **wyłącznie** razem z przejściem na
  `cancelled`; pola wyniku zostają nietykalne.
- **Delegaty** `my_inmail_quota`, `send_expert_inmail`, `resolve_expert_inmail`,
  `list_my_inmails`, `admin_list_inmails` - `SECURITY INVOKER`, zero logiki, nazwy
  parametrów nietknięte (klient woła argumentami nazwanymi).

**Klient (PL/EN, atomic design)**

- `src/lib/chat/expertRequestErrors.ts` - jedno mapowanie odmów serwerowych na klucze
  i18n (11 klas). Wcześniej `ExpertRequestDialog` rozpoznawał cztery bramki z dziesięciu,
  a skrzynki i panel admina miały własne, jeszcze węższe - opt-out odbiorcy i wyłączony
  moduł tenanta lądowały w „Spróbuj ponownie".
- `src/components/chat/ExpertRequestCancelDialog.tsx` - potwierdzenie wycofania z jasną
  ceną operacji („pula nie wraca"), użyte w skrzynce „Wysłane".
- `ExpertRequestDialog` + `/profile/expert-requests` - komunikat
  `expertRequest.quota.cancelledCounts` przy pulach skończonych.
- Nowe klucze i18n w `src/lib/i18n-expert-request.ts` (PL i EN, parytet pilnuje
  `check:i18n-parity`).

**Bramka CI `check:rpc-contract`** (`src/lib/ci/rpcContract.ts` + `scripts/check-sql-rpc-contract.ts`)

Dwa sprawdzenia na stanie końcowym migracji:

1. każda nazwa z `supabase.rpc("…")` w kodzie ma funkcję w stanie końcowym (inaczej
   PGRST202),
2. żadne żywe ciało (ani zwrotka) nie wskazuje relacji, którą późniejsza migracja
   przemianowała albo usunęła (inaczej 42P01).

Bramka rozumie `DROP FUNCTION` (funkcja skasowana razem z tabelą nie jest wiszącą
referencją) i nie liczy `ALTER PUBLICATION … DROP TABLE` jako wycofania tabeli. Zbiór
„relacji osieroconych" wynika z samych migracji - nie ma ręcznej listy.

## 4. Weryfikacja

| Co                                                                                  | Jak                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| migracja stosuje się w OBU światach i zbiega je do jednej tabeli                    | Postgres 16 lokalnie: harness produkcyjny (`expert_inmails`) i świeży (`expert_requests`), migracja na każdym osobno                                                                                                     |
| 12 grup asercji behawioralnych (pula, pętla obejścia, tenant, guard, antyspam, ACL) | ten sam harness, oba światy - przechodzą identycznie                                                                                                                                                                     |
| pgTAP `supabase/tests/expert_request_single_generation_test.sql`                    | 29 asercji: kontrakt obiektów, ACL, parytet delegatu, pula, pętla obejścia, zamknięty zapis przez Data API, guard kolumnowy, maszyna stanów, dryf tenanta, moderacja, antyspam                                           |
| bramka wykrywa naprawiony defekt                                                    | usunięcie migracji naprawczej → `check:rpc-contract` wskazuje 4 brakujące RPC + `send_expert_inmail` → `public.expert_inmails`                                                                                           |
| jednostkowe                                                                         | `src/lib/ci/__tests__/rpcContract.test.ts` (16), `src/lib/chat/__tests__/expertRequestErrors.test.ts` (21), `src/components/chat/__tests__/expertRequestCancel.test.tsx` (6)                                             |
| pełny zestaw                                                                        | `bunx vitest run` - 618 plików / 6696 testów zielonych; `tsc --noEmit` czysty                                                                                                                                            |
| bramki SQL/authz                                                                    | `check:sql-tenant-scope`, `check:sql-app-role`, `check:sql-anon-insert`, `check:sql-migration-replay`, `check:sql-owner-tenant-scope`, `check:authz-snapshot`, `check:i18n-parity`, `check:permissions-parity` - zielone |

`check-db-contract.ts`: lista `SUPERSEDED` **wyzerowana**. Cztery obiekty generacji
„expert_request", które nie istniały w produkcji, powstają teraz w tej migracji, więc
bramka po-wdrożeniowa może wymagać kompletu.

## 5. Co się zmienia dla użytkownika

- Wycofanie zapytania **nie zwraca** puli - UI mówi to w dialogu wysyłki, w nagłówku
  skrzynki i w potwierdzeniu wycofania.
- Wycofanie przez „Wycofaj" **działa** (wcześniej guard kolumnowy odrzucał tę ścieżkę).
- Warstwy „bezpośrednie" (VIP i wyżej, eksperci, admin) nie widzą już CTA zapytania -
  `my_inmail_quota` zwraca teraz `direct: true`, zgodnie z tym, co
  `ExpertRequestButton` dokumentował od początku.
- Odmowy serwera mają konkretne komunikaty w PL i EN zamiast „Spróbuj ponownie".
- Pule pozostają bez zmian: Plus 2, Pro 5 (podłoga z dawnych flag), a admin może je
  podnieść liczbą `expert_request_quota` per tenant.
- Statusy zmienia wyłącznie RPC (maszyna stanów). Integracja, która pisałaby wprost do
  tabeli kluczem publikowalnym, dostanie `42501` - to zamierzone; ścieżka serwerowa
  (`service_role`) zachowuje pełny dostęp.

## 6. Dług do zamknięcia osobno

- **Nazwa fizyczna tabeli** została przy `expert_inmails`. Domknięcie: rename na
  produkcji + regeneracja `src/integrations/supabase/types.ts` + podmiana ciał dziesięciu
  funkcji. Bramka `check:rpc-contract` pilnuje, że taki rename nie osieroci już żadnego
  ciała po cichu.
- **`seed_chat_tier_flags`** nadal zasiewa dawne flagi `chat_inmail_quota_2/5` dla nowych
  tenantów. Dopóki tak jest, podłoga z punktu 2.3 nie ma jak wygasnąć - usunięcie flag
  z seeda (i z rejestru capabilities) to zmiana cennikowa, nie bezpieczeństwa.
