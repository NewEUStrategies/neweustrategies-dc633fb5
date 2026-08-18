# Wdrożenie: domknięcie P0/P1 z audytu brutalnego (2026-07-31)

**Data:** 2026-07-31 · **Baza:** `d86c147` (main po PR #114–#123) · **Gałąź:** `claude/platform-audit-assumptions-3lgp5s`

Ten dokument zamyka trzy ostatnie otwarte ustalenia z `AUDYT_BRUTALNY_REWIZJA_ZALOZEN_2026-07-30.md`,
zweryfikowane jako **nienaprawione** przy przeglądzie najnowszego main (pozostałe P0 — `get_chat_peers`,
`community-cron`, suppression, runner newslettera, darowizny, SSR trackera, paginacje — były już
domknięte PR-ami #115–#123 i tego dokumentu nie dotyczą).

Zasady wdrożenia (spełnione): bez `any`/`as any` poza jawnie komentowanym castem dla kolumn spoza
`types.ts` (konwencja repo); i18n PL/EN nie dotyczy (zmiany serwerowe + gate CI); `tsc --noEmit`
czysto; `eslint` czysto na zmienionych plikach.

---

## 1. [P0] Izolacja sandbox/live w ścieżce płatności jednorazowych

**Ustalenie (audyt §4.1):** ścieżka subskrypcyjna dopasowuje zdarzenia webhooka po
`subscriptions.environment = env`, ale ścieżka **jednorazowa** nie miała bezpiecznika — `payment_orders`
nie miało kolumny `environment`, a `fulfilOrder()` dobierało zamówienie po samym `order_id` i nadawało
uprawnienie bez sprawdzenia środowiska. Ryzyko: przy sandboxowym webhooku wpiętym w produkcję zakup
kartą testową realizował realne zamówienie i odblokowywał płatną treść. `environment` był dodatkowo
sterowany przez klienta (`resolveEnvironment` ufał wartości z żądania).

**Naprawa (obrona dwuwarstwowa, jak subskrypcje):**

| Warstwa                  | Plik                                                                          | Zmiana                                                                                                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB                       | `supabase/migrations/20260731220000_payment_orders_environment_isolation.sql` | Kolumna `environment text NOT NULL DEFAULT 'live' CHECK (in ('sandbox','live'))` + indeks. Backfill istniejących wierszy do `'live'` (zamówienia produkcyjne); `DEFAULT 'live'` jest fail-closed dla zapomnianego stempla.      |
| Serwer (autorytatywność) | `src/lib/billing/paddleTransaction.server.ts`                                 | `resolveEnvironment()` w produkcji zwraca **zawsze `'live'`**, ignorując wartość klienta (poza produkcją honoruje żądanie dla testów). Klient nie wymusi już `'sandbox'`.                                                       |
| Serwer (stempel)         | `src/lib/billing/checkout.functions.ts`                                       | Środowisko rozstrzygane serwerowo **przed** insertem zamówienia i stemplowane na `payment_orders.environment`; ta sama wartość idzie do transakcji dostawcy (order.environment ≡ env transakcji).                               |
| Serwer (guard)           | `src/lib/billing/oneTimeFulfilment.server.ts`                                 | `fulfilOrder()` czyta `environment` i **pomija realizację** przy niezgodności ze środowiskiem webhooka (odpowiednik `.eq("environment", env)` subskrypcji). `fulfilOneTimeTransaction(txn, env)` przewleka `env` z dyspozytora. |
| Serwer (przekazanie)     | `src/lib/billing/webhookDispatch.server.ts`                                   | Przekazuje `env` do `fulfilOneTimeTransaction`.                                                                                                                                                                                 |

**Test:** `src/lib/billing/__tests__/oneTimeFulfilment.event.test.ts` — nowy przypadek „POMIJA zamówienie
z innego środowiska (sandbox webhook vs live order)": brak nadania uprawnienia, brak księgowania,
brak RSVP. Zaktualizowano istniejące przypadki o parametr `env`. (4/4 zielone.)

---

## 2. [P1/RODO] Zamknięcie furtki Big Five w CRM

**Ustalenie (audyt §4.6):** `crm.functions.ts` czytał `personality_results` klientem **service-role**
(`admin`), omijając RLS, którą migracja `20260711120000` celowo ustawiła jako prywatną nawet dla
adminów tenanta (dane psychometryczne). Wynik był wystawiany staffowi CRM bez zgody i bez celu
przetwarzania.

**Naprawa:** usunięcie odczytu i pola w całości (Big5 nie jest CRM-owi potrzebny):

- `src/lib/crm.functions.ts` — usunięto blok `admin.from("personality_results")` z `Promise.all`,
  destrukturyzację `personalityRes` i pole `personality` ze zwrotki; komentarz nagłówkowy odnotowuje
  powód RODO.
- `src/components/admin/crm/ProfileSyncCard.tsx` — usunięto typ `Big5`, pole w kontrakcie, render
  `<Big5Panel>` oraz całą funkcję `Big5Panel` (i nieużywany już import `useMemo`).

Warstwa DB pozostaje jak była (REVOKE z `20260711120000`); zmiana usuwa **aplikacyjne obejście** tej
decyzji. Wynik testu osobowości i tak nie zasilał niczego innego (rekomendacje go nie czytają).

---

## 3. [P1] Statyczny gate CI na anonimowe INSERT-y

**Ustalenie (audyt §4.9):** cztery tabele intake przez ~30 dni przyjmowały INSERT wprost przez
PostgREST (m.in. fabrykacja zgód RODO w `crm_consent_log`), bo polityka przetrwała churn migracji.
Zamknięto je ręcznie (`20260730130000`/`20260730140000`), ale bez gate'u ta **klasa** błędu wraca.

**Naprawa:** `scripts/check-sql-anon-insert.ts` (wzorem `check-sql-tenant-scope.ts`, wspólny parser
`scripts/lib/sqlMigrations`), wpięty w `package.json` (`check:sql-anon-insert`) i **blokujący w CI**
(`.github/workflows/ci.yml`, obok pozostałych gate'ów SQL). Dwa inwarianty na **stanie końcowym**
polityk (CREATE/DROP liczone po kolei, migracje forward-only):

- **A (wszystkie tabele):** żadna polityka INSERT-capable z rolą `anon`/`public` nie może mieć
  **permisywnego** checku INSERT (`WITH CHECK` sprowadzającego się do `true`, albo jego braku).
  Polityki z realnym warunkiem (`auth.role()='service_role'`, `has_role(...)`) i DENY (`false`) są OK —
  precyzyjna ekstrakcja `WITH CHECK`/`USING` z bilansowaniem nawiasów eliminuje fałszywe trafienia.
- **B (tabele intake):** `contact_messages`, `crm_consent_log`, `related_post_clicks`,
  `builder_experiment_events`, `analytics_events`, `web_vitals` — żadnej nie-DENY polityki INSERT dla
  roli klienta (zapis wyłącznie przez service_role).

**Dowód nie-pustości (self-test):** wstrzyknięcie permisywnej polityki `FOR INSERT TO anon WITH CHECK (true)`
→ gate **failuje** (inwariant A + B na `contact_messages`); po usunięciu → **przechodzi**. Na bieżącym
main: `✓ OK (517 polityk w stanie końcowym, 6 tabel intake chronionych)`.

---

## Weryfikacja

| Sprawdzenie                                         | Wynik                            |
| --------------------------------------------------- | -------------------------------- |
| `tsc --noEmit`                                      | czysto                           |
| `eslint` (pliki zmienione)                          | czysto                           |
| `oneTimeFulfilment.event.test.ts` (+ env-mismatch)  | 4/4                              |
| `check:sql-anon-insert` (+ self-test wstrzyknięcia) | OK / poprawnie failuje           |
| `vitest run` (pełny)                                | 3665 pass / 50 skip / **0 fail** |

## Stan listy P0/P1 po tej sesji

Wszystkie P0 z audytu domknięte (env isolation był ostatni). P1: Big Five ✅, gate anon-insert ✅.
Pozostają celowo poza zakresem tej sesji ustalenia P2 (import WP niszczący 2. język, dedup mediów,
peeking w A/B, jedność zgód, `funnelStats` pętlą, saved views leadów) — do osobnego wdrożenia.
