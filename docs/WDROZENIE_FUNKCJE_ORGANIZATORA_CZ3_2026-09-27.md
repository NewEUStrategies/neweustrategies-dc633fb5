# Wdrożenie: funkcje organizatora wydarzeń, część 3 - poprawki z przeglądu po wdrożeniu migracji

**Data:** 2026-09-27
**Poprzednik:** PR #413 (scalony 2026-09-27, `31ffc3890`). To NOWA zmiana, nie kontynuacja #413.
**Notatki poprzednich części:** `docs/WDROZENIE_FUNKCJE_ORGANIZATORA_2026-09-27.md` (część 1, #410),
`docs/WDROZENIE_FUNKCJE_ORGANIZATORA_CZ2_2026-09-27.md` (część 2, #413: cięcie migracji, lista wdrożenia).

## 1. Stan po scaleniu #413

- Na `main` są wszystkie migracje funkcji organizatora, pocięte na części do 45 KB.
- Wdrożenie wykonuje Lovable. **Kolejność z notatki części 2 (sekcja 3.2) jest nieaktualna**
  od wdrożenia skanera offline 2026-09-27 ok. 15:54 UTC. Obowiązuje kolejność z sekcji 2.4 niżej.
- Plików migracji z `main` nie zmieniamy: mogą zostać zastosowane w każdej chwili. Każda zmiana
  SQL w tym PR idzie do NOWEJ pary migracji (supabase + bliźniak drizzle), z numerem po
  najnowszej migracji na gałęzi, do 45 KB, **bez wpisu w `_journal.json`** (powód: sekcja 2.2).

## 2. Stan żywej bazy i kolejność reszty wdrożenia

Sprawdzone 2026-09-27 ok. 16:10 UTC, wyłącznie zapytaniami `SELECT` (katalog PostgreSQL,
`drizzle.__drizzle_migrations`, `cron.job`, liczniki wierszy). Na bazie niczego nie zmieniano.

### 2.1. Co jest zastosowane

Z 33 plików listy części 2 zastosowanych jest **6**, a nie 2. Zostało **27** plików
(plus jedno ponowne zastosowanie, sekcja 2.4).

| Zapis drizzle (id) | Plik pasa drizzle                          | Migracja supabase                                        |
| ------------------ | ------------------------------------------ | -------------------------------------------------------- |
| 68                 | `0067_event_registration_gaps_part3`       | `20260926180000_event_registration_gaps_part3.sql`       |
| 69                 | `0068_event_person_crm_sync_lead_names`    | `20260927000900_event_person_crm_sync_lead_names.sql`    |
| 70                 | `0069_event_registration_gaps_part3_part2` | `20260926180001_event_registration_gaps_part3_part2.sql` |
| 71                 | `0070_event_registration_gaps_part3_part3` | `20260926180002_event_registration_gaps_part3_part3.sql` |
| 72                 | `0071_event_scanner_offline`               | `20260926150000_event_scanner_offline.sql`               |
| 73                 | `0072_event_scanner_offline_part2`         | `20260926150001_event_scanner_offline_part2.sql`         |

Hasz każdego zapisu jest równy sha256 pliku z repozytorium. Treść 54 funkcji z plików od
`20260926085900` porównana na produkcji (md5 `prosrc`) z każdą wersją z obu pasów: każda
odpowiada **ostatniemu zastosowanemu plikowi**, dryfu brak. Wyjątki zgodne z opisem części 2:
`admin_event_features_save` i `admin_event_person_crm_retry` mają treść z zapisu Lovable `0066`
(bez komentarzy).

### 2.2. Dlaczego inaczej niż w notatce części 2

Lovable stosuje migracje migratorem drizzle, a ten wykonuje **każdy** wpis
`drizzle/migrations/meta/_journal.json`, którego baza jeszcze nie ma, w kolejności dziennika.
Wpisy `0067`-`0070` stały w dzienniku od #407/#413, więc pierwsze wdrożenie po scaleniu #413
(skaner, zapis `0071`) wykonało je przy okazji, **przed** fundamentem uczestnika z #406
(`20260926153100`-`153300`), który w dzienniku nie stoi.

Wniosek na resztę PR: bliźniak drizzle nowej migracji **nie dostaje wpisu w dzienniku**. Tak
stoją już bliźniaki funkcji organizatora (`0057_event_cfp` ...). Wpis oznaczałby wykonanie przy
najbliższym wdrożeniu czegokolwiek, bez względu na kolejność.

### 2.3. Skutki na produkcji

1. **Pełny zwrot za bilet kończy się błędem.** `payments_apply_event_ticket_outcome`
   i `_event_apply_outcome_to_group` (z `180000`/`180002`) wołają `_event_participant_release`,
   której jeszcze nie ma (powstaje w `153100`). Zwrot częściowy i wpłaty działają. Dziś bez
   skutków: na produkcji są 2 wydarzenia i **0 zgłoszeń**. Znika po kroku 1 z sekcji 2.4.
   Inne odwołania do obiektów z fundamentu: brak (sprawdzone na katalogu).
2. **Kolejność z notatki części 2 cofnęłaby kod z #407.** `153200` (#406) definiuje
   `payments_apply_event_ticket_outcome` starszą treścią niż `180002`, a żaden późniejszy plik jej
   nie przywraca. Dowód (sekcja 2.6): na kolejności z notatki pada asercja
   `pula: pierwsza wplata zajmuje jedyne miejsce z puli`. Dlatego `180002` idzie ponownie zaraz
   po `153200`.
3. **Plików `180000` i `180001` nie stosujemy ponownie.** `180000` ma jednorazowe dopięcie
   `ticket_code_sent_at` dla zgłoszeń zwróconych częściowo. Ponowne wykonanie oznaczyłoby jako
   wysłane bilety wydane po 15:54, zanim wyśle je cron. Dziś takich zgłoszeń jest 0, ale zasada
   zostaje. `20260927000900` też jest zastosowany i nic go nie nadpisuje.
4. Kolumny `ticket_revoked_*` stoją w `event_registrations` fizycznie przed `lang`/`remind_*`
   (odwrotnie niż w odtworzeniu w kolejności wersji). To się nie cofnie i nie zmienia zachowania.
   Kod nie używa pozycji kolumn.

### 2.4. Kolejność reszty wdrożenia (Lovable, plik po pliku)

Plik kolejności dla dowodu: `scripts/deploy-order/produkcja.txt`. Jeden plik na raz, każdy po poprzednim.

| Krok | Plik                                                     | Uwagi                                          |
| ---- | -------------------------------------------------------- | ---------------------------------------------- |
| 1    | `20260926153100_event_participant_foundation.sql`        | przywraca pełny zwrot (pkt 2.3.1)              |
| 2    | `20260926153101_event_participant_foundation_part2.sql`  |                                                |
| 3    | `20260926153200_event_participant_defect_fixes.sql`      | nadpisuje `payments_apply_...` starszą treścią |
| 4    | `20260926180002_event_registration_gaps_part3_part3.sql` | **PONOWNIE**, zaraz po kroku 3 (pkt 2.3.2)     |
| 5    | `20260926153300_notification_kind_event_billing.sql`     |                                                |
| 6    | `20260926160000_event_ticket_wallet.sql`                 | bilet w portfelu                               |
| 7    | `20260926183100_event_participant_part3_followups.sql`   | #411                                           |
| 8    | `20260927000100_event_cfp.sql`                           | nabór prelegentów, część 1/6                   |
| 9    | `20260927000101_event_cfp_part2.sql`                     | nabór prelegentów, część 2/6                   |
| 10   | `20260927000102_event_cfp_part3.sql`                     | nabór prelegentów, część 3/6                   |
| 11   | `20260927000103_event_cfp_part4.sql`                     | nabór prelegentów, część 4/6                   |
| 12   | `20260927000104_event_cfp_part5.sql`                     | nabór prelegentów, część 5/6                   |
| 13   | `20260927000105_event_cfp_part6.sql`                     | nabór prelegentów, część 6/6                   |
| 14   | `20260927000200_event_invoices.sql`                      | faktury, część 1/5                             |
| 15   | `20260927000201_event_invoices_part2.sql`                | faktury, część 2/5                             |
| 16   | `20260927000202_event_invoices_part3.sql`                | faktury, część 3/5                             |
| 17   | `20260927000203_event_invoices_part4.sql`                | faktury, część 4/5                             |
| 18   | `20260927000204_event_invoices_part5.sql`                | faktury, część 5/5                             |
| 19   | `20260927000300_event_ads_funnel.sql`                    | lejek Google Ads, część 1/2                    |
| 20   | `20260927000301_event_ads_funnel_part2.sql`              | lejek Google Ads, część 2/2                    |
| 21   | `20260927000400_event_seating.sql`                       | plan sali, część 1/3                           |
| 22   | `20260927000401_event_seating_part2.sql`                 | plan sali, część 2/3                           |
| 23   | `20260927000402_event_seating_part3.sql`                 | plan sali, część 3/3                           |
| 24   | `20260927000500_event_sponsor_report.sql`                | raport dla sponsorów, część 1/2                |
| 25   | `20260927000501_event_sponsor_report_part2.sql`          | raport dla sponsorów, część 2/2                |
| 26   | `20260927000800_event_clone.sql`                         | kopiowanie wydarzenia, część 1/3               |
| 27   | `20260927000801_event_clone_part2.sql`                   | kopiowanie wydarzenia, część 2/3               |
| 28   | `20260927000802_event_clone_part3.sql`                   | kopiowanie wydarzenia, część 3/3               |

POMIŃ (już zastosowane): `20260926180000`, `20260926180001`, `20260927000900`, `20260926150000`,
`20260926150001`.

Panel przy każdym kroku dopisze kopię pliku jako kolejny numer pasa drizzle (`0073_...`). Bramka
pasów (`src/lib/ci/migrationLaneParity.ts`, w `check:ci-gates`) rozpoznaje takie kopie po treści
i nie czerwieni już `main` (sekcja 3).

### 2.5. Instrukcje zależne od istniejących danych (27 plików)

| Plik                | Instrukcja                                                                      | Stan produkcji                                 |
| ------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| `153100`            | `UPDATE event_registrations SET lang` (z profilu) + 3 CHECK na nowych kolumnach | 0 zgłoszeń; wartości `pl`/`en` z `CASE`        |
| `153300`            | `notifications_kind_check ... NOT VALID`, `enabled_event` z DEFAULT             | nie waliduje starych wierszy                   |
| `180002` (ponownie) | `SELECT _event_plan_seat_link_backfill()`                                       | idempotentne (tylko `registration_id IS NULL`) |
| `000301`            | `cron.schedule('event-ads-retention-prune')`                                    | `pg_cron` jest; blok łapie wyjątki             |
| `000500`            | UNIQUE `event_home_ads (tenant_id, id)`, FK `sponsor_id`                        | `id` to klucz główny; `sponsor_id` nowa, NULL  |
| `000800`            | FK i CHECK `events.previous_edition_id`                                         | kolumna nowa, NULL                             |

Każdy klucz obcy z tych plików do tabel już istniejących ma na produkcji pasujący indeks
unikalny (22 cele sprawdzone), z wyjątkiem `event_home_ads (tenant_id, id)`, który zakłada sam
`000500` przed użyciem. Brak polityk RLS, grantów i triggerów na istniejących tabelach, które
mogłyby się zderzyć (trigger `event_registrations_release_seats` ma `DROP ... IF EXISTS`).
Zadanie `event-plan-seat-release` z `180001` jest w `cron.job`.

### 2.6. Dowód kolejności (PostgreSQL 16)

`bash scripts/deploy-order-proof.sh scripts/deploy-order/produkcja.txt`: dwie świeże bazy
z atrapami harnessu wydarzeń, `ref` w kolejności wersji, `nes` w kolejności produkcyjnej
(zastosowane jak w 2.1, potem 2.4). Porównanie `pg_dump` (kanon: kolejność kolumn i pozycji
pominięta) i asercje runtime harnessu na bazie `nes`.

| Kolejność                    | `--schema-only`                        | `--data-only`          | Asercje runtime                  |
| ---------------------------- | -------------------------------------- | ---------------------- | -------------------------------- |
| sekcja 2.4                   | identyczne (sha256 `b77ab12f830165a0`) | identyczne (106 tabel) | 3711 OK                          |
| notatka części 2 (bez kr. 4) | różne (`payments_apply_...`)           | różne                  | pada `pula: pierwsza wplata ...` |

`20260926153300` jest poza zestawem harnessu (rodzaje powiadomień na atrapie) i jest pomijany
w obu bazach. Sprawdza go ręczna kontrola w 2.7.

### 2.7. Zapytanie weryfikujące po wdrożeniu

`scripts/deploy-order/weryfikacja-po-wdrozeniu.sql`: tylko odczyt, wygenerowane przez skrypt
dowodu z bazy `ref`. Obejmuje funkcje (md5 treści bez komentarzy `--`), tabele, kolumny
i triggery zakładane przez pliki nowsze od `20260926140000`. **Pusty wynik = stan zgodny.**

- Przed krokiem 1 (stan z 16:10 UTC) zapytanie zwraca dokładnie obiekty pozostałych plików:
  199 funkcji, 29 tabel, 9 kolumn i 26 triggerów brakuje, 11 funkcji ma inną treść (te, które
  zmieniają kroki 3, 7, 8-13 i 24-25). Funkcje skanera, `180000`-`180002` i `000900` są zgodne.
- Ręcznie dla `153300`: `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname =
'notifications_kind_check'` ma zawierać `'event'` i `'billing'`, a kolumna
  `notification_preferences.enabled_event` ma istnieć.

Przy nowych migracjach tego PR plik trzeba wygenerować ponownie:
`DEPLOY_PROOF_WRITE_VERIFY=scripts/deploy-order/weryfikacja-po-wdrozeniu.sql bash scripts/deploy-order-proof.sh scripts/deploy-order/produkcja.txt`.

## 3. Zakres tego PR (lista kontrolna)

- [x] Sprawdzenie żywej bazy przed wdrożeniem (tylko odczyt): stan oczekiwany a stan produkcji,
      instrukcje zależne od istniejących danych, zapytanie weryfikujące po wdrożeniu; osobno plik
      `20260926183100_event_participant_part3_followups` z #411 (sekcja 2).
- [x] Bramka pasów: zapisy wdrożenia `0071`/`0072` w rejestrze; kopie z panelu rozpoznawane po
      treści, żeby kolejne kroki wdrożenia nie czerwieniły `main`.
- [ ] Skaner offline i Wallet, część 2: przepełnienie kolejki, wygasanie poświadczenia,
      czyszczenie listy przy zmianie poświadczenia, odświeżanie parowania, zakres urządzenia,
      limit per token, `callerSupabase`, `downloadBlob`.
- [ ] Lejek Google Ads: uwagi przeglądu (atrybucja między kartami, zgoda, pakiety jako konwersje,
      ROAS, parser kosztów, liczba grup raportu) i dostosowania do #403-#407.
- [ ] Plan sali: uwagi przeglądu (kolejność blokad, geometria, eksport CSV bez e-maili, metryki,
      komunikat o miejscu).
- [ ] Kopiowanie edycji: ustawienia uczestnika z #406, `_event_safe_timezone`.
- [ ] Most CRM: stan per intencja (check-in nie nadpisuje błędu naboru), deduplikacja osi czasu.
- [ ] Odświeżanie publicznej listy prelegentów po potwierdzeniu udziału i po zmianach mówców
      w agendzie; komentarz a działanie `useViewerCard`.
- [ ] Niezależny przegląd całego PR i poprawki.
- [ ] Zielone CI i pełny `events-harness`.

## 4. Wdrożenie produkcji (po scaleniu)

Najpierw kroki z sekcji 2.4 (te, których jeszcze nie ma), potem nowe pary migracji z tego PR
w kolejności wersji. Lista zostanie wpisana tutaj, gdy migracje będą gotowe, a zapytanie
z 2.7 wygenerowane ponownie. Starych, niepociętych plików nie uruchamiaj ręcznie w edytorze SQL.
