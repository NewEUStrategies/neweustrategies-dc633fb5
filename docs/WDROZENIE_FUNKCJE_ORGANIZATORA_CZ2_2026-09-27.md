# Wdrożenie: funkcje organizatora wydarzeń, część 2 - migracje wdrażalne przez Lovable i domknięcie przeglądu

**Data:** 2026-09-27
**Poprzednik:** PR #410 (scalony 2026-09-27, `8a671a933`). To NOWA zmiana, nie kontynuacja #410.
**Notatka części 1:** `docs/WDROZENIE_FUNKCJE_ORGANIZATORA_2026-09-27.md` (tło, zmiany na `main`,
audyt nakładania się, status przeglądu do chwili scalenia #410).

## 1. Stan po scaleniu #410

- Na `main` jest narzędzie do cięcia migracji (`scripts/split-migration.ts`,
  `src/lib/ci/migrationSplit*.ts`) i bramka rozmiaru (`migrationSize.gate`), która jest
  **czerwona celowo**: wskazuje dziewięć niewdrożonych migracji ponad limit Lovable
  (siedem funkcji organizatora - bilet w portfelu `20260926160000` mieści się w limicie -
  oraz `20260926153100` z #406 i `20260926180000` z #407).
- Dopóki te pliki nie są pocięte, Lovable ich nie wdroży, a panele naboru prelegentów, faktur,
  planu sali, raportu sponsora, lejka Ads i skanera nie mają tabel w bazie.

## 2. Zakres tego PR (lista kontrolna)

- [x] Domknięcie narzędzia do cięcia po dwóch recenzjach (lekser: `\r` w komentarzu, dowód na
      cięciu wewnątrz treści `$$`, `E'...\'...'` i zagnieżdżone `/* */`; odmowa cięcia migracji
      już wdrożonej; kroki po cięciu w CLI).
- [x] **Pocięcie dziewięciu migracji na części do 45 KiB** na granicach instrukcji SQL, bliźniaki
      drizzle, dziennik, migawki, rejestr pasów; dowód równoważności `pg_dump --schema-only`
      przed i po; bramka rozmiaru zielona (lista i dowód - sekcja 3).
- [ ] Skaner offline i Wallet, część 2: przepełnienie kolejki, wygasanie poświadczenia,
      czyszczenie listy przy zmianie poświadczenia, odświeżanie parowania, zakres urządzenia,
      limit per token, `callerSupabase`, `downloadBlob`.
- [ ] Lejek Google Ads: uwagi przeglądu i dostosowania do #403-#407.
- [ ] Plan sali: uwagi przeglądu (kolejność blokad, geometria, eksport CSV, metryki).
- [ ] Kopiowanie edycji: ustawienia uczestnika z #406, `_event_safe_timezone`.
- [ ] Most CRM: stan per intencja (check-in nie nadpisuje błędu naboru), deduplikacja osi czasu.
- [ ] Odświeżanie publicznej listy prelegentów po potwierdzeniu udziału i po zmianach mówców
      w agendzie; komentarz a działanie `useViewerCard`.
- [ ] Zielone CI i pełny `events-harness`.

## 3. Wdrożenie produkcji (po scaleniu)

### 3.1. Już wdrożone - nie uruchamiaj ponownie

- `20260926085900_crm_consent_source_event.sql` i `20260926090000_event_organizer_foundation.sql`
  (zapisy wdrożenia Lovable `0065` i `0066`).
- Część 2 braków z `main`: `20260926100000_event_group_guests_follow_lead`,
  `20260926110000_event_package_coupon_per_seat`,
  `20260926120000_event_group_lead_closes_admitted_guests`,
  `20260926130000_event_package_order_cancel_returns_coupon`,
  `20260926140000_event_group_lead_plan_seat` (zapisy Lovable `0057`, `0058`, `0062`-`0064`).
- Starsze migracje (wersje do linii bazowej `20260926100000`) - lista wdrożonych plików ponad
  limit jest w `src/lib/ci/migrationDeployed.ts`; tych plików narzędzie nie tnie (forward-only).
- **Uwaga na `main` po #409** (`75e051424`, stan z 27.09 ok. 14:30): wdrożone pliki
  `20260926100000`/`110000`/`120000` dostały tam nowe wersje `...0001`, a obok naszych
  `20260927000400_event_seating` i `20260927000500_event_sponsor_report` leżą ich kopie
  `20260926130001_event_seating.sql` i `20260926140001_event_sponsor_report.sql` (pozostałość
  konfliktu zmian nazw). Tych plików nie wdrażaj - do rozstrzygnięcia przy scaleniu `main` z tym
  PR (wdrożone wracają do swoich wersji, kopie znikają).

### 3.2. Do zastosowania z panelu Lovable - w tej kolejności

Każdy plik to osobna migracja, stosowana w całości i dopiero po poprzedniej. Kolejność to
kolejność WERSJI supabase (tak odtwarzają ją CI, `check:sql-migration-replay` i
`events-harness`), a nie numerów drizzle: nasze bliźniaki `0057`-`0064` wchodzą po `0067`-`0070`
z #407. Pliki `_partN` to części jednej migracji pociętej narzędziem
(`scripts/split-migration.ts`); ich SQL wykonywalny sklejony po kolei jest równy SQL-owi
migracji sprzed podziału. Migracje #406 i #411 nie mają bliźniaka drizzle - dla nich stosuje się
plik supabase. `20260926183100_event_participant_part3_followups.sql` (#411, 26 638 B) dopina
kontrakty Fundamentu do kodu z `20260926180000`, więc idzie po jej trzech częściach.

| #   | Pas drizzle (plik do zastosowania)             | Bliźniak supabase                                        | Rozmiar drizzle |
| --- | ---------------------------------------------- | -------------------------------------------------------- | --------------- |
| 1   | `0062_event_scanner_offline.sql`               | `20260926150000_event_scanner_offline.sql`               | 32 836 B        |
| 2   | `0062_event_scanner_offline_part2.sql`         | `20260926150001_event_scanner_offline_part2.sql`         | 28 110 B        |
| 3   | - (tylko supabase, #406)                       | `20260926153100_event_participant_foundation.sql`        | 36 694 B\*      |
| 4   | - (tylko supabase, #406)                       | `20260926153101_event_participant_foundation_part2.sql`  | 30 821 B\*      |
| 5   | - (tylko supabase, #406)                       | `20260926153200_event_participant_defect_fixes.sql`      | 27 699 B\*      |
| 6   | - (tylko supabase, #406)                       | `20260926153300_notification_kind_event_billing.sql`     | 9 084 B\*       |
| 7   | `0063_event_ticket_wallet.sql`                 | `20260926160000_event_ticket_wallet.sql`                 | 8 405 B         |
| 8   | `0067_event_registration_gaps_part3.sql`       | `20260926180000_event_registration_gaps_part3.sql`       | 45 372 B        |
| 9   | `0069_event_registration_gaps_part3_part2.sql` | `20260926180001_event_registration_gaps_part3_part2.sql` | 27 169 B        |
| 10  | `0070_event_registration_gaps_part3_part3.sql` | `20260926180002_event_registration_gaps_part3_part3.sql` | 39 172 B        |
| 11  | - (tylko supabase, #411)                       | `20260926183100_event_participant_part3_followups.sql`   | 26 638 B\*      |
| 12  | `0057_event_cfp.sql`                           | `20260927000100_event_cfp.sql`                           | 35 658 B        |
| 13  | `0057_event_cfp_part2.sql`                     | `20260927000101_event_cfp_part2.sql`                     | 45 386 B        |
| 14  | `0057_event_cfp_part3.sql`                     | `20260927000102_event_cfp_part3.sql`                     | 38 135 B        |
| 15  | `0057_event_cfp_part4.sql`                     | `20260927000103_event_cfp_part4.sql`                     | 45 558 B        |
| 16  | `0057_event_cfp_part5.sql`                     | `20260927000104_event_cfp_part5.sql`                     | 41 883 B        |
| 17  | `0057_event_cfp_part6.sql`                     | `20260927000105_event_cfp_part6.sql`                     | 18 899 B        |
| 18  | `0058_event_invoices.sql`                      | `20260927000200_event_invoices.sql`                      | 35 491 B        |
| 19  | `0058_event_invoices_part2.sql`                | `20260927000201_event_invoices_part2.sql`                | 32 033 B        |
| 20  | `0058_event_invoices_part3.sql`                | `20260927000202_event_invoices_part3.sql`                | 38 823 B        |
| 21  | `0058_event_invoices_part4.sql`                | `20260927000203_event_invoices_part4.sql`                | 43 447 B        |
| 22  | `0058_event_invoices_part5.sql`                | `20260927000204_event_invoices_part5.sql`                | 26 481 B        |
| 23  | `0059_event_ads_funnel.sql`                    | `20260927000300_event_ads_funnel.sql`                    | 39 199 B        |
| 24  | `0059_event_ads_funnel_part2.sql`              | `20260927000301_event_ads_funnel_part2.sql`              | 26 535 B        |
| 25  | `0060_event_seating.sql`                       | `20260927000400_event_seating.sql`                       | 39 511 B        |
| 26  | `0060_event_seating_part2.sql`                 | `20260927000401_event_seating_part2.sql`                 | 42 343 B        |
| 27  | `0060_event_seating_part3.sql`                 | `20260927000402_event_seating_part3.sql`                 | 30 632 B        |
| 28  | `0061_event_sponsor_report.sql`                | `20260927000500_event_sponsor_report.sql`                | 37 908 B        |
| 29  | `0061_event_sponsor_report_part2.sql`          | `20260927000501_event_sponsor_report_part2.sql`          | 29 018 B        |
| 30  | `0064_event_clone.sql`                         | `20260927000800_event_clone.sql`                         | 34 677 B        |
| 31  | `0064_event_clone_part2.sql`                   | `20260927000801_event_clone_part2.sql`                   | 45 670 B        |
| 32  | `0064_event_clone_part3.sql`                   | `20260927000802_event_clone_part3.sql`                   | 34 301 B        |
| 33  | `0068_event_person_crm_sync_lead_names.sql`    | `20260927000900_event_person_crm_sync_lead_names.sql`    | 16 396 B        |

\* rozmiar pliku supabase (pas drizzle nie ma bliźniaka). Każdy plik obu pasów ma najwyżej
46 080 B (45 KiB) - poniżej 52 653 B, które Lovable już wdrożył.

- Nie uruchamiaj ręcznie w edytorze SQL starych, niepociętych wersji ani plików sprzed
  przenumerowania (`20260926100000_event_cfp.sql` ... `20260926170000_event_clone.sql`).
- Po wdrożeniu Lovable przegeneruje `src/integrations/supabase/types.ts` z bazy - od tej chwili
  typy zawierają obiekty funkcji organizatora.

### 3.3. Dowód równoważności podziału (PostgreSQL 16)

`bash scripts/split-migration-proof.sh <plik> 0d04c2d78` dla każdej pociętej migracji: dwie
świeże bazy z tym samym stanem poprzedzającym (atrapy harnessu i wszystkie wcześniejsze
migracje modułu), jedna dostaje oryginał sprzed podziału (`0d04c2d78`), druga części po kolei.

| Migracja                                       | Części | Stan poprzedzający | `pg_dump --schema-only`            | `--data-only` |
| ---------------------------------------------- | ------ | ------------------ | ---------------------------------- | ------------- |
| `20260926150000_event_scanner_offline`         | 2      | 126 migracji OK    | identyczne (sha256 `abb55b3ea858`) | identyczne    |
| `20260926153100_event_participant_foundation`  | 2      | 128 migracji OK    | identyczne (sha256 `fd6631faabf7`) | identyczne    |
| `20260926180000_event_registration_gaps_part3` | 3      | 132 migracji OK    | identyczne (sha256 `32d8002f4c9f`) | identyczne    |
| `20260927000100_event_cfp`                     | 6      | 135 migracji OK    | identyczne (sha256 `62f54d8821ae`) | identyczne    |
| `20260927000200_event_invoices`                | 5      | 141 migracji OK    | identyczne (sha256 `4a5aaa6fb529`) | identyczne    |
| `20260927000300_event_ads_funnel`              | 2      | 146 migracji OK    | identyczne (sha256 `0ce21d004540`) | identyczne    |
| `20260927000400_event_seating`                 | 3      | 148 migracji OK    | identyczne (sha256 `4886b073f9c3`) | identyczne    |
| `20260927000500_event_sponsor_report`          | 2      | 151 migracji OK    | identyczne (sha256 `94bbc6e2a8ee`) | identyczne    |
| `20260927000800_event_clone`                   | 3      | 153 migracji OK    | identyczne (sha256 `c42c51b99cbe`) | identyczne    |

Pas drizzle: część k każdego bliźniaka ma ten sam SQL wykonywalny co część k pasa supabase
(`check:migration-lanes`, dowód (4) w `src/lib/ci/migrationSplit.ts`).
