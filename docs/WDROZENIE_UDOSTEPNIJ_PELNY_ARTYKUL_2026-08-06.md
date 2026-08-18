# Wdrożenie: „Udostępnij pełny artykuł" - bramka rejestracji + budżet 5 kliknięć

**Data:** 2026-08-06
**Migracja:** `supabase/migrations/20260806170000_share_full_article_click_budget.sql`
**Kontrakt pgTAP:** `supabase/tests/share_full_article_budget_test.sql` (25 asercji)

## 1. Czego dotyczy zmiana

Mechanika „Udostępnij pełny artykuł" (treść za paywallem otwierana linkiem)
istniała już jako moduł _Gift Articles_, ale jej reguły nie odpowiadały
zamówionej funkcjonalności:

| Wymaganie                              | Stan przed                                                    | Stan po                                                      |
| -------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| dostępne dla osób **zarejestrowanych** | wyłącznie płatny subskrybent (`can_gift_articles`)            | ustawienie `eligibility`, domyślnie `registered`             |
| link **jednego** użytkownika           | tak (unikalny per wpis + nadawca)                             | bez zmian, doprecyzowane w UI i testach                      |
| **do 5 kliknięć** w link               | cap 50, liczony od każdego wywołania RPC, nigdzie niepokazany | budżet 5, dedup po odbiorcy, widoczny dla nadawcy i odbiorcy |
| dotyczy **treści za paywallem**        | przycisk na każdym wpisie, także publicznym                   | przycisk i RPC wyłącznie dla `members` / `paid`              |

## 2. Reguły mechaniki (stan docelowy)

1. **Kto udostępnia.** `can_share_full_article()`: konto musi należeć do tenanta
   przeglądanego serwisu (tenant **domowy** z `profiles`, nie nagłówek
   `x-tenant-host` - nagłówek jest do podrobienia). Przy `eligibility =
'subscribers'` dochodzi warunek `can_gift_articles()` (aktywna subskrypcja
   albo warstwa `premium_content`). Anonim nigdy.
2. **Jeden link per artykuł i nadawca.** `create_gift_link` jest idempotentne:
   pierwsze otwarcie popovera tworzy kod, każde kolejne zwraca ten sam.
   Nowy kod powstaje wyłącznie po wygaśnięciu (TTL) albo cofnięciu przez
   redakcję.
3. **Budżet kliknięć = 5 (konfigurowalny).** Wartość jest **zamrażana na
   linku** (`post_gift_links.max_redemptions`) w chwili utworzenia - późniejsza
   zmiana suwaka w panelu nie zmienia obietnicy złożonej już rozesłanym linkom.
4. **Slot zużywa odbiorca, nie odświeżenie strony.** Rejestr
   `post_gift_redemptions` deduplikuje po `(link, tożsamość)`, gdzie tożsamość
   to konto (`u:<uid>`) albo pseudonim gościa (`v:<uuid>` z localStorage - ten
   sam, którym posługuje się metering). Powrót tej samej osoby podbija `hits`
   i **nie** zabiera kolejnego z 5 slotów.
5. **Nadawca i uprawniony czytają za darmo.** `reason = 'owner'` i
   `reason = 'entitled'` (`has_content_access`) omijają budżet - nikt nie marnuje
   slotu na osobę, która i tak ma dostęp.
6. **Limit miesięczny liczy artykuły**, nie wiersze linków
   (`count(DISTINCT post_id)` w okresie, także linki cofnięte). Rotacja linku dla
   tego samego wpisu nie konsumuje limitu drugi raz, a cofnięcie go nie zwraca -
   pętla „cofnij i wygeneruj" przestaje być źródłem darmowych budżetów.
   Dodatkowo nowy link dla wpisu udostępnionego już w tym okresie **dziedziczy
   zużycie** poprzedniego, więc rotacja po wygaśnięciu nie resetuje 5 kliknięć.
7. **Tylko treść za paywallem.** `create_gift_link` odmawia dla trybu
   `public` (`gift_post_not_gated`); treść na hasło pozostaje wykluczona na
   stałe (sekret autora nie chodzi linkiem).

## 3. Warstwa bazy

**Tabele**

- `gift_article_settings`: nowa kolumna `eligibility`
  (`registered` | `subscribers`, domyślnie `registered`),
  `max_redemptions_per_link` z nowym `DEFAULT 5`. Wiersze przy starej domyślnej
  (50) przestawione na 5; wartości ustawione świadomie (≠ 50) zostają.
- `post_gift_links`: nowa kolumna `max_redemptions` (budżet zamrożony na linku),
  backfill z efektywnego ustawienia tenanta - stare linki nie zostają „bez
  limitu".
- `post_gift_redemptions` (nowa): rejestr slotów -
  `(tenant_id, link_id, post_id, recipient_key, recipient_id, first_seen_at,
last_seen_at, hits)`, unikalny indeks `(link_id, recipient_key)`.
  **RLS: tylko redakcja tenanta.** Zapis wyłącznie przez SECURITY DEFINER -
  żadnej polityki INSERT dla roli klienta (bramka `check:sql-anon-insert`).
- `gift_events`: `CHECK` rozszerzony o typ `exhausted` (odbicie od wyczerpanego
  budżetu trafia do audytu).

**Funkcje** (wszystkie `SECURITY DEFINER`, `search_path = public`)

| Funkcja                              | Zmiana                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `gift_share_eligibility()`           | nowa - tryb bramki dla tenanta hosta                                                                         |
| `can_share_full_article()`           | nowa - członkostwo w tenancie + (opcjonalnie) subskrypcja                                                    |
| `gift_article_state(uuid)`           | + `eligibility`, `max_redemptions`, `redemption_count`, `redemptions_remaining`; limit liczony po artykułach |
| `create_gift_link(uuid)`             | bramka `eligibility`, wymóg paywalla, zamrożenie budżetu, carry-forward zużycia                              |
| `redeem_gift_link(uuid, text, uuid)` | + `_visitor_id`, + `reason`, dedup odbiorcy, egzekucja budżetu, audyt `exhausted`                            |
| `list_gift_links_admin(...)`         | + `max_redemptions`, `unique_recipients`                                                                     |
| `get_gift_stats_admin()`             | + `exhausted_links`, `unique_recipients`                                                                     |

`redeem_gift_link` zwraca `reason`: `ok` / `owner` / `entitled` / `exhausted` /
`expired` / `revoked` / `invalid`. Współbieżne wejścia serializuje
`pg_advisory_xact_lock` na linku + `SELECT ... FOR UPDATE`, więc budżetu nie da
się przeskoczyć wyścigiem.

**Prywatność (RODO).** Tożsamość odbiorcy nie wraca do nadawcy - popover pokazuje
wyłącznie zagregowany licznik. `recipient_key` dla gościa to pseudonim
przeglądarki, nie identyfikator osoby; wiersze kasują się kaskadowo z linkiem.

## 4. Warstwa klienta

**Model domeny** (`src/lib/gifting/model.ts`, zero React/Supabase):
`GiftEligibility`, `GiftClickBudget` + `giftClickBudget()`, `GiftRedeemReason` +
`normalizeRedeemReason()`, `giftBannerVariant()`, faza `budgetExhausted` w
`resolveGiftPhase()`, klucz błędu `notGated`.

**Dane** (`src/lib/gifting/hooks.ts`): budżet w stanie i w wyniku mutacji,
`_visitor_id` w `redeem`, klucz zapytania per tożsamość, tolerancja okna
wdrożeniowego (`42703` → odczyt starszego kształtu ustawień).

**Atomic design** (feature-local, jak `admin/builder/ui`):

```
components/gifting/
  atoms/GiftCopyButton.tsx        - akcja „Skopiuj link" (czysto prezentacyjna)
  atoms/GiftChannelLink.tsx       - jeden kanał udostępniania
  molecules/GiftClickBudgetMeter.tsx - budżet na atomie QuotaMeter (wspólnym z meteringiem)
  molecules/GiftShareChannels.tsx    - siatka 7 kanałów
  GiftArticleButton.tsx           - organizm: orkiestracja + efekty uboczne
  GiftBanner.tsx                  - baner odbiorcy (4 warianty)
```

**Międzymodułowość:** tożsamość gościa wyekstrahowana do
`src/lib/access/visitor.ts` (jedno źródło dla meteringu i budżetu kliknięć),
wskaźnik budżetu reużywa atom `QuotaMeter`, data odnowienia -
`formatMeterResetDate` z modułu meteringu.

**UI/UX:** nadawca widzi „2 z 5 - zostały 3" nad akcjami i stopkę „pierwszych 5
osób przeczyta pełną treść"; przy wyczerpaniu - stan terminalny z datą odnowienia
zamiast martwego przycisku kopiowania. Odbiorca dostaje osobne banery dla
`gifted` / `exhausted` / `expired` / `invalid`. Wszystko na tokenach
semantycznych, `rounded-[5px]`, siatka i responsywność jak reszta pasków
artykułu (popover `w-[320px] max-w-[calc(100vw-2rem)]`).

**i18n:** pełne PL/EN (`src/lib/i18n-gifting.ts`, `src/lib/i18n-gifting-admin.ts`),
z polskimi formami mnogimi (`_one/_few/_many/_other`). Parytet wymuszony typem
(`const en: typeof pl`) i bramką `check:i18n-parity`.

**Panel redakcji** (`/admin/gifting`): przełącznik „Kto może udostępniać",
budżet kliknięć z ostrzeżeniem przy 0, kolumna „Otwarcia" czytana z **linku**
(nie z bieżących ustawień) + liczba unikalnych odbiorców, kafle
„Wyczerpane budżety" i „Unikalni odbiorcy", filtr audytu „Odbicia".

## 5. Weryfikacja

- `supabase test db` → `share_full_article_budget_test.sql` (25 asercji).
- `vitest run` → 6678 testów, w tym rozszerzone `model.test.ts`,
  `admin-model.test.ts`, `GiftArticleButton.test.tsx`, `GiftBanner.test.tsx`.
- Bramki SQL: `check:sql-tenant-scope`, `check:sql-anon-insert`,
  `check:sql-owner-tenant-scope`, `check:sql-app-role`,
  `check:sql-migration-replay` - wszystkie zielone; snapshot autoryzacji
  przegenerowany (`generate:authz-snapshot`).
- `eslint` czysty, `tsc --noEmit` bez błędów w kodzie źródłowym.

## 6. Uwagi wdrożeniowe

- Wygenerowane typy Supabase (`src/integrations/supabase/types.ts`) zostały
  zaktualizowane ręcznie o obiekty tej migracji, żeby klient pozostał w pełni
  typowany (bez `any` i bez rzutowań przez `unknown`). Kolejna regeneracja
  odtworzy ten sam kształt.
- Kolejność wdrożenia jest odporna w obie strony: kod na produkcji przed
  migracją czyta starszy kształt ustawień i przyjmuje bezpieczne domyślne;
  migracja przed kodem nie psuje niczego, bo stary klient po prostu nie widzi
  nowych kolumn.
