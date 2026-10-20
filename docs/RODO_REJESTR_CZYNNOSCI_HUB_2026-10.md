# Rejestr czynności przetwarzania - hub „Przychód i lejek” (art. 30 RODO)

**Status:** zatwierdzone przez administratora danych 2026-10-20; do wiadomości IOD.

**Administrator danych:** właściciel serwisu (operator platformy NES). Dane
kontaktowe administratora i IOD - w polityce prywatności serwisu (`/rodo`),
nie w tym dokumencie.

**Zakres:** czynności huba „Przychód i lejek” (`/admin/revenue`, wycinki
I0-S5, I9) oraz moduły, do których hub pisze. Dokument nie zawiera danych
konkretnych osób. Źródło prawdy o mechanizmach to migracje i testy wskazane
przy każdym wpisie. Dziennik wdrożenia: `docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md`
§21.2 (księga MRR) i §21.9 (przegląd po usunięciu konta).

**Decyzja administratora (2026-10-20, „zastosuj” dla Z-I9b-03/04/05):**
zatwierdza podstawę i retencję zanonimizowanej księgi MRR (wpis 1) oraz
redakcję lejka, szyny zdarzeń i modułów huba po usunięciu konta (wpisy 2-6).

## Wspólny mechanizm usunięcia konta

Usunięcie konta (`deleteMyAccount`, panel, CLI albo panel operatora bazy)
uruchamia kolejno:

1. `on_auth_user_deleted_retain_accounting` (BEFORE, `20260805090100`) -
   anonimizacja dowodów księgowych (`payment_orders`, `user_purchases`),
   pseudonim `subject_ref`.
2. `on_auth_user_deleted_redact_revenue` (BEFORE, `20261020160400`) -
   anonimizacja księgi MRR (wpis 1).
3. Kaskady kluczy obcych (profil, subskrypcje, nadania, ankiety retencji,
   wyświetlenia licznika, outbox CRM).
4. `on_auth_user_deleted_redact_hub` (AFTER, `20261020160700`, rozszerzony
   w `20261020160900`) - jeden pseudonim zastępczy konta (losowy UUID
   w wersji 8, bez zapisu mapowania) w lejku, dzienniku licznika, szynie
   i audycie; odcięcie CRM (konto i opiekun leada) i newslettera; wyjście ze
   ścieżek; autorzy konfiguracji huba, ustawień newslettera, automatyzacji,
   notatek CRM, punktów integracji i powiązań -> NULL; krawędzie grafu
   powiązań do konta usunięte. Od I9c ten sam punkt wejścia obejmuje też:
   - niewysłaną pocztę konta w kolejce (kroki ścieżek zapisów konta, digest)
     - wyjęta z kolejki, w dzienniku wysyłek stan `suppressed` z powodem
       `cancelled:account_deleted`, bez treści i z adresem `[redacted]`;
       poczta transakcyjna zostaje;
   - autorów i recenzentów w modułach spoza huba (zgłoszenia do klubów,
     kwoty wpłat za wydarzenia, kreator i CMS, zaproszenia, zgłoszenia
     użytkowników, kontakt, rekrutacja, zadania i import) -> NULL; dziennik
     zmian ról, zadania importu i moderację członka -> pseudonim konta;
   - dane własne konta bez klucza obcego (zakładki, „przeczytaj później”,
     notatki, zadania, zapisane wyszukiwania i widoki, kolejka powiadomień
     push, obserwacje - także obserwacje usuwanego autora przez innych)
     i powiadomienia innych osób o działaniu konta -> usunięte; historia
     czytania -> pseudonim (statystyki popularności bez osoby).

Druga warstwa dla poczty: dren kolejki przed wysyłką poczty związanej
z kontem albo zapisem pyta bazę (`email_queue_send_recheck`), czy zapis na
ścieżkę trwa, czy zgoda marketingowa obowiązuje i czy konto z włączonym
digestem istnieje - wypis albo usunięcie konta w trakcie cyklu zatrzymuje
wiadomość (stan `suppressed` z powodem `skipped:…`).

Błąd kroków 1, 2 i 4 przerywa usunięcie konta, więc konto nie znika bez
anonimizacji. Konta usunięte przed wdrożeniem domyka migracja jednorazowo
(`_revenue_ledger_redact_orphans`, `_hub_account_erase_orphans` - w I9c
z kolumnami modułów spoza huba). Dowód:
`supabase/tests/hub_i9b_revenue_ledger_erasure_test.sql`,
`supabase/tests/hub_i9b_account_erasure_sweep_test.sql`,
`supabase/tests/hub_i9c_account_erasure_mail_queue_test.sql`. Drugi z nich
skanuje generycznie każdą kolumnę uuid/text/jsonb tabel huba i - kontrolnie -
każdej tabeli z `tenant_id` (konto czytelnika, admina i redaktora) oraz
pilnuje, żeby każda kolumna uuid wzorca autora lub osoby bez klucza obcego
była redagowana albo miała uzasadnienie na liście.

## Odbiorcy widoczni w repozytorium

| Odbiorca                                              | Rola                                                                                                        | Gdzie w kodzie                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Supabase (baza danych, uwierzytelnianie)              | podmiot przetwarzający - przechowywanie                                                                     | `src/integrations/supabase/*`, `supabase/migrations/*`                  |
| Stripe (operator płatności)                           | odrębny administrator płatności; identyfikatory klienta, subskrypcji, zdarzeń                               | `src/lib/stripe.server.ts`, webhooki `payment_webhook_events`           |
| Resend przez bramkę Lovable (dostawca poczty)         | podmiot przetwarzający - wysyłka maili i zdarzenia doręczeń                                                 | `src/lib/email/provider.server.ts`, `email_apply_delivery_event`        |
| Punkty integracji skonfigurowane przez admina najemcy | odbiorcy zdarzeń szyny (webhook, Slack, HubSpot, CRM partnera) - wyłącznie te, które admin włączył w panelu | `integration_endpoints`, router `tg_route_domain_event_to_integrations` |

## 1. Księga MRR (przychód cykliczny)

| Pole                        | Wartość                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabele                      | `subscription_state_history`, `mrr_movements`, `dunning_cycles`, `mrr_daily_snapshots`, `revenue_event_marks`; migawka ceny i rabatu w `subscriptions`                                                                                                                                                                                                                                    |
| Cel                         | sprawozdawczość finansowa: MRR, most MRR, churn, NRR/GRR, kohorty, windykacja                                                                                                                                                                                                                                                                                                             |
| Podstawa - przed usunięciem | art. 6 ust. 1 lit. f RODO (prawnie uzasadniony interes: kontrola przychodu); dowody księgowe żyją osobno w module rozliczeń - art. 6 ust. 1 lit. c w zw. z art. 74 ust. 2 ustawy o rachunkowości (`payment_orders`, `billing_documents`)                                                                                                                                                  |
| Podstawa - po anonimizacji  | dane zanonimizowane nie są danymi osobowymi (motyw 26 RODO)                                                                                                                                                                                                                                                                                                                               |
| Kategorie osób              | subskrybenci płatnych planów                                                                                                                                                                                                                                                                                                                                                              |
| Kategorie danych            | przed usunięciem: identyfikator konta i subskrypcji, identyfikatory zdarzeń i cen operatora, status, kwoty, waluta, daty, warstwa, segment; po usunięciu: kwoty, waluta, daty, status, ilość, warstwa, interwał, segment, rodzaj i powód ruchu, cena katalogowa, losowy identyfikator subskrypcji                                                                                         |
| Odbiorcy                    | Supabase; Stripe jest źródłem danych (webhooki), nie odbiorcą księgi                                                                                                                                                                                                                                                                                                                      |
| Okres przechowywania        | przed usunięciem - przez trwanie konta; zanonimizowane agregaty - bez terminu (nie są danymi osobowymi)                                                                                                                                                                                                                                                                                   |
| Usunięcie / anonimizacja    | przy usunięciu subskrypcji lub konta: nowy losowy identyfikator subskrypcji wspólny dla historii, ruchów i cykli, bez `user_id`, zdarzeń operatora i ceny spoza katalogu; znaczniki konta usunięte (`20261020160400`, `_revenue_ledger_redact_subscription`); dowód: `hub_i9b_revenue_ledger_erasure_test.sql`, `revenue_subscription_history_test.sql`; Σ zamkniętych miesięcy bez zmian |

## 2. Uderzenia w paywall, licznik artykułów i lejek

| Pole                     | Wartość                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabele                   | `paywall_hits`, `metering_event_log`, `metered_views`; liczniki lejka liczone w zapytaniu (`_funnel_counts`)                                                                                                                                                                                                                                                                                                                                            |
| Cel                      | wykonanie usługi dostępu do treści według planu (limit artykułów, ściana płatności) i pomiar lejka: zasięg paywalla (PHR), konwersja paywalla (PSCR), konta aktywne                                                                                                                                                                                                                                                                                     |
| Podstawa                 | art. 6 ust. 1 lit. b RODO (umowa: dostęp do treści według planu - licznik i ściana) oraz lit. f (pomiar skuteczności oferty); zapis serwerowy niezależny od zgody analitycznej, bez identyfikatora przeglądarki w jawnej postaci (gość - skrót HMAC)                                                                                                                                                                                                    |
| Kategorie osób           | czytelnicy z kontem, goście (wyłącznie skrót)                                                                                                                                                                                                                                                                                                                                                                                                           |
| Kategorie danych         | identyfikator konta albo skrót gościa, treść, powód, wymagana warstwa, wariant, doba, liczba uderzeń; dziennik licznika: wynik, identyfikator przeglądarki gościa                                                                                                                                                                                                                                                                                       |
| Odbiorcy                 | Supabase                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Okres przechowywania     | przez trwanie konta; po usunięciu konta - wiersze z pseudonimem (dane zanonimizowane, liczniki zamkniętych okresów bez zmian). Retencja wierszy żywych kont nie jest ustalona w repozytorium (brak czyszczenia) - zgłoszenie Z-I9b-10                                                                                                                                                                                                                   |
| Usunięcie / anonimizacja | `paywall_hits.user_id` i `metering_event_log.user_id` -> pseudonim konta, `visitor_id` dziennika -> NULL (`20261020160500`, `_funnel_erase_account`); `metered_views` - kaskada; dowód: `hub_i9b_account_erasure_sweep_test.sql` (liczniki lejka zamkniętego okresu bez zmian). Konwersja paywalla usuniętego konta znika z licznika PSCR, bo moduł rozliczeń zeruje `payment_orders.user_id` - pseudonim na dowodzie księgowym identyfikowałby nabywcę |

## 3. Zdarzenia domenowe (szyna) i ich kopie

| Pole                     | Wartość                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabele                   | `domain_events`; kopie: `journey_event_inbox` (skrzynka ścieżek), `integration_deliveries` (dostawy integracji), `journey_enrollments.trigger_snapshot`; błędy: `domain_event_emit_errors`, `journey_engine_errors`, `workflow_runs.error`                                                                                                                                                                       |
| Cel                      | integracja modułów (ścieżki, automatyzacje, integracje, odświeżanie panelu), wyjaśnialność i diagnostyka                                                                                                                                                                                                                                                                                                         |
| Podstawa                 | art. 6 ust. 1 lit. f RODO (sprawne działanie usługi i jej diagnostyka); przekazanie do integracji - w zakresie, który admin najemcy włączył                                                                                                                                                                                                                                                                      |
| Kategorie osób           | użytkownicy kont, kontakty CRM, subskrybenci newslettera, personel                                                                                                                                                                                                                                                                                                                                               |
| Kategorie danych         | typ zdarzenia, czas, najemca, agregat, aktor, ładunek (identyfikatory, statusy, kwoty); e-mail, telefon, adres i treści zdejmuje sanityzacja przy zapisie (`domain_events_redact_payload`, `20260729123407`), imiona - trasa do skrzynki                                                                                                                                                                         |
| Odbiorcy                 | Supabase; punkty integracji włączone przez admina najemcy                                                                                                                                                                                                                                                                                                                                                        |
| Okres przechowywania     | szyna - 90 dni (`prune_domain_events`); skrzynka ścieżek - 30 dni po przetworzeniu (`journey_purge`, minimum 7); dostawy - 14 dni po doręczeniu, 30 dni martwe (`prune_integration_deliveries`); błędy silnika - 90 dni                                                                                                                                                                                          |
| Usunięcie / anonimizacja | zdarzenia osoby: nowy losowy identyfikator, agregat = pseudonim, bez aktora i korelacji, ładunek z białej listy kluczy nieosobowych (typ, czas, najemca, kwoty i klucze nieosobowe zostają); nieprzetworzone kopie pominięte (`skipped:account_deleted`, dostawa `dead`), więc konsument nie wyśle maila ani nie odtworzy leada; teksty błędów - `[redacted]` (`20261020160600`, `_domain_events_erase_account`) |

## 4. Ścieżki e-mail (automatyzacja komunikacji)

| Pole                     | Wartość                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabele                   | `journey_enrollments`, `journey_step_runs`, `journey_messages`, `journey_message_events` (otwarcia, kliknięcia, wypisy), `journey_node_daily_stats`; konfiguracja: `journey_definitions`, `journey_versions`, `journey_settings`, `journey_email_contents`; wysyłka: `email_send_log`, blokady: `email_suppressions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Cel                      | komunikacja marketingowa i serwisowa wyzwalana zdarzeniami (powitanie, porzucona kasa, przypomnienia) oraz pomiar jej skuteczności                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Podstawa                 | ścieżki `marketing`: art. 6 ust. 1 lit. a RODO (zgoda marketingowa kontaktu albo potwierdzona subskrypcja newslettera - `_journey_marketing_consent`; ostatnie słowo rejestru zgód wygrywa); ścieżki `service`: podstawa wpisana przez admina w polu „Podstawa prawna” (CHECK `journey_definitions_service_basis_check`); D-03: limit 3 maili marketingowych na 7 dni i cisza nocna 21:00-08:00; D-04: mail porzuconej kasy = marketing (wymaga zgody)                                                                                                                                                                                                                                                                                                                                                          |
| Kategorie osób           | kontakty CRM (w tym użytkownicy kont), subskrybenci newslettera                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Kategorie danych         | identyfikator kontaktu i konta, stan zapisu, kroki, wysłane wiadomości (identyfikator, wariant, język), otwarcia i kliknięcia (rodzaj, link, czas, znacznik otwarcia maszynowego - bez IP i UA), adres e-mail w logu wysyłek                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Odbiorcy                 | Supabase; Resend (wysyłka i zdarzenia doręczeń)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Okres przechowywania     | przez trwanie kontaktu CRM (usunięcie kontaktu kaskaduje zapisy, kroki, wiadomości i śledzenie); dziennik błędów silnika - 90 dni; `email_send_log` - retencja modułu poczty nieustalona w repozytorium (zgłoszenie Z-I9b-10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Usunięcie / anonimizacja | po usunięciu konta: zapis w toku -> `exited` z powodem `account_deleted` (koniec wysyłek, także serwisowych); zapis zostaje przy kontakcie CRM bez `user_id`, bez odwołania do zdarzenia, migawka wyzwalacza bez identyfikatorów (`20261020160600`, `_journeys_erase_account`); autorzy konfiguracji -> NULL (`20261020160700`); niewysłane kroki ścieżek zapisów konta wyjęte z kolejki poczty, w dzienniku wysyłek `suppressed`/`cancelled:account_deleted` z adresem `[redacted]` (`20261020160900`, `_hub_account_erase_mail_queue`); dren przed wysyłką kroku ścieżki sprawdza ponownie zapis (zakończony = pominięty) i zgodę marketingową (wypis w trakcie cyklu = pominięty) - `email_queue_send_recheck`; wypis -> `email_suppressions` (zostaje - dowód respektowania sprzeciwu, art. 21 ust. 3 RODO) |

## 5. CRM - kontakty, etapy i historia

| Pole                     | Wartość                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabele                   | `crm_leads` (w tym `user_id`, `lifecycle_stage` z huba), `crm_lead_stage_history`, `crm_tasks`, `crm_consent_log`, `member_crm_sync_pending`                                                                                                                                                                                                                                                                                              |
| Cel                      | obsługa relacji z kontaktami i partnerami, etapy cyklu życia (lejek sprzedaży), zadania personelu, dowód zgód                                                                                                                                                                                                                                                                                                                             |
| Podstawa                 | art. 6 ust. 1 lit. f RODO (relacje z kontaktami i partnerami, obsługa zapytań); zgoda marketingowa - art. 6 ust. 1 lit. a; rejestr zgód - art. 7 ust. 1 (wykazanie zgody)                                                                                                                                                                                                                                                                 |
| Kategorie osób           | kontakty z formularzy, wydarzeń, newslettera, rejestracji konta; personel (autorzy zmian i zadań)                                                                                                                                                                                                                                                                                                                                         |
| Kategorie danych         | e-mail, imię, nazwisko, telefon, firma, stanowisko, kraj, etap, cykl życia, tagi, wynik, powiązanie z kontem; historia etapów (źródło, aktor); zgody (treść, wersja, IP, UA)                                                                                                                                                                                                                                                              |
| Odbiorcy                 | Supabase; integracje CRM włączone przez admina najemcy (np. CRM partnera, HubSpot)                                                                                                                                                                                                                                                                                                                                                        |
| Okres przechowywania     | do sprzeciwu albo usunięcia kontaktu przez admina w `/admin/crm` (kaskada: zadania, notatki, historia etapów, zapisy na ścieżki); rejestr zgód - do przedawnienia roszczeń; automatyczna retencja kontaktów nieustalona w repozytorium (zgłoszenie Z-I9b-10)                                                                                                                                                                              |
| Usunięcie / anonimizacja | usunięcie konta odcina kontakt od konta (`crm_leads.user_id` -> NULL), aktor historii etapów -> NULL, outbox synchronizacji - kaskada (`20261020160700`); usunięcie konta personelu zeruje opiekuna leada (`crm_leads.owner_id`, `20261020160900`); kontakt CRM zostaje jako osobna czynność (może pochodzić z formularza, wydarzenia lub newslettera, a kaskada zabrałaby notatki i zadania personelu) - usuwa go admin na żądanie osoby |

## 6. Ankiety retencji (anulowanie subskrypcji)

| Pole                     | Wartość                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabele                   | `retention_feedback`; zdarzenia `retention_flow.*.v1`; znaczniki `revenue_event_marks` (`retention_abandoned`)                                                                            |
| Cel                      | zrozumienie przyczyn rezygnacji i oferta utrzymania (kupon) w przepływie anulowania                                                                                                       |
| Podstawa                 | art. 6 ust. 1 lit. f RODO (poprawa oferty, utrzymanie klienta); odpowiedź jest dobrowolna                                                                                                 |
| Kategorie osób           | subskrybenci anulujący plan                                                                                                                                                               |
| Kategorie danych         | powód z katalogu, komentarz (wolny tekst), wynik przepływu, pokazana i przyjęta oferta, kod kuponu u operatora                                                                            |
| Odbiorcy                 | Supabase; Stripe (kupon oferty utrzymania)                                                                                                                                                |
| Okres przechowywania     | przez trwanie konta                                                                                                                                                                       |
| Usunięcie / anonimizacja | kaskada z kontem (`retention_feedback.user_id ON DELETE CASCADE`); znaczniki `retention_abandoned` konta usunięte (`20261020160400`); zdarzenia `retention_flow.*` zredagowane jak wpis 3 |

## Wyjątki - dane, które zostają z innej podstawy

| Dane                                                                      | Podstawa                                                                                        | Mechanizm                                                                                 |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Dowody księgowe (`payment_orders`, `user_purchases`, `billing_documents`) | art. 6 ust. 1 lit. c i art. 17 ust. 3 lit. b RODO w zw. z art. 74 ust. 2 ustawy o rachunkowości | anonimizacja i pseudonim `subject_ref`, retencja do 31.12 piątego roku (`20260805090100`) |
| Kontakt CRM (`crm_leads`: e-mail, imię, nazwisko) i jego historia ścieżek | art. 6 ust. 1 lit. f / lit. a - osobna czynność CRM (wpis 5)                                    | usuwa admin w `/admin/crm` na żądanie osoby                                               |
| Subskrypcja newslettera (`newsletter_subscribers.email`)                  | art. 6 ust. 1 lit. a - zgoda niezależna od konta                                                | wypis linkiem albo w panelu                                                               |
| Rejestr zgód (`crm_consent_log`)                                          | art. 7 ust. 1 RODO - wykazanie zgody                                                            | bez zmian                                                                                 |
| Lista blokad poczty (`email_suppressions`)                                | art. 21 ust. 3 RODO - respektowanie sprzeciwu (adres nie może wrócić do wysyłek)                | bez zmian                                                                                 |
| Dziennik audytu (`audit_log`) - wpis i pseudonim aktora                   | art. 5 ust. 2 i art. 32 RODO - rozliczalność działań personelu                                  | uid -> pseudonim konta, IP własnych działań -> NULL, e-mail -> `[redacted]`               |

## Zgłoszenia do IOD (nieblokujące)

- **Z-I9b-10:** retencja danych żywych kont i kontaktów nieustalona
  w repozytorium: `paywall_hits`, `metering_event_log`, `crm_leads` (kontakty
  bez źródła poza kontem), `email_send_log`, `journey_message_events`,
  `audit_log`. Propozycja do decyzji: okresy w tym rejestrze i zadania
  czyszczące w harmonogramie panelu.
- **Z-I9b-11 (zamknięte 2026-10-20, I9c):** kolumny autora w modułach, do
  których hub nie pisze (`club_applications.reviewed_by`,
  `event_registrations.paid_amount_recorded_by` i pozostałe z przeglądu
  `20261020160900`) - przy usunięciu konta NULL (decyzja i kwota zostają),
  dzienniki rozliczalności - pseudonim konta, dane własne konta - usunięte.
  Kontrolny skan KAŻDEJ tabeli `public` z `tenant_id` (konto czytelnika,
  admina i redaktora) nie wykazuje śladów poza wyjątkami z tabeli wyżej.
- **Z-I9c-01 (do decyzji administratora danych):** zgłoszenie osoby do klubu
  (`club_applications.user_id`, NOT NULL, z danymi zgłoszenia: imię, e-mail,
  motywacja) zostaje z uid po usunięciu konta, bo wymaga decyzji o podstawie,
  a nie tylko mechanizmu: usunięcie zgłoszenia albo wyjątek jak kontakt CRM.
  Test przeglądu trzyma tę kolumnę na jawnej liście. Dziennik webhooków
  operatora płatności (`payment_webhook_events.user_id`) redaguje od I9c
  także wyzwalacz usunięcia konta - wcześniej tylko aplikacja przy
  zamknięciu konta (`20261013090100`).
