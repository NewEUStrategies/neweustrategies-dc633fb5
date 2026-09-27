# Wdrożenie: funkcje organizatora wydarzeń - naprawa po #404 i migracje wdrażalne przez Lovable

**Data:** 2026-09-27
**Status:** SZKIC - nie scalać i nie wdrażać, dopóki lista kontrolna niżej nie jest odhaczona.
**Poprzednik:** PR #404 (scalony 2026-09-26). Ten PR jest NOWĄ zmianą, nie kontynuacją #404.

Siedem funkcji organizatora (nabór prelegentów, faktury firmowe i zbiorcze, lejek
Google Ads, plan sali, kopiowanie edycji, raport dla sponsorów, skaner offline
i bilet w portfelu) weszło do `main` z PR #404. Scalenie zostawiło stan, którego
nie da się wdrożyć. Ten PR go naprawia.

---

## 1. Co jest zepsute na `main` i dlaczego

1. **Zdublowane wersje migracji.** Konflikty #404 z `main` rozstrzygnięto
   w edytorze GitHuba (commit `6897212`). W `supabase/migrations` zostały PARY
   plików o tych samych wersjach `20260926100000`-`20260926140000` (nasze
   i `main`), a w `drizzle/migrations` pary indeksów `0055`-`0064`. Wersje
   z `main` są już zapisane na produkcji jako wykonane, więc nasze pliki o tych
   samych wersjach nigdy by się nie wykonały.
2. **Kod funkcji utracony w edytorze konfliktów.** Pliki z konfliktem
   rozstrzygnięto w większości na stronę `main` (m.in. `RegistrationPayAction`,
   `PublicRegistrationForm`, `EventPackagesPurchase`, `RegistrationsListPanel`,
   `EventSponsorTiers`, `EventSponsorsSection`, `migrationLaneParity.ts`).
3. **Pliki za duże dla Lovable.** Produkcja jest aplikowana z pasa
   Lovable/drizzle. Lovable wdrożył dotąd pliki do ok. 52 KB
   (`0057_event_group_guests_follow_lead.sql`), a odmawia plików 62-199 KB:
   naszych ośmiu oraz `20260926153100_event_participant_foundation.sql` (#406)
   i `20260926180000_event_registration_gaps_part3.sql` (#407).
4. **Typy obcięte do bazy.** Lovable po każdej zmianie przegenerowuje
   `src/integrations/supabase/types.ts` z produkcji. Obiekty niewdrożonych
   migracji znikają z typów, co daje błędy kompilacji m.in. w `seatingApi.ts`,
   `cfpApi.ts`, `eventInvoicesApi.ts`, `sponsorReportApi.ts`,
   `OnsiteDevicesPanel.tsx`, `OnsiteLogPanel.tsx`, `EventMePanel.tsx`
   i `EventHomeAdsPanel`. Na trwałe znika to dopiero po wdrożeniu migracji.

Wdrożone już na produkcji (przez Lovable, bez zmian nazw):
`20260926085900_crm_consent_source_event.sql` (pas `0065`) i
`20260926090000_event_organizer_foundation.sql` (pas `0066`).

## 2. Zakres tego PR (lista kontrolna)

- [ ] Unikalne wersje naszych migracji po wszystkim, co jest na `main`
      (`20260927000100`+, pas drizzle po `0067` z #407), bez usuwania plików
      już obecnych na `main` (repozytorium jest forward-only: duplikaty
      rejestrowane jako `drizzleOnly`).
- [ ] Podział migracji większych niż 45 KB na części cięte na granicach
      instrukcji SQL (nasze osiem oraz pliki #406 i #407), z bramką rozmiaru
      w testach CI, żeby problem nie wrócił.
- [ ] Przywrócony kod funkcji organizatora z plików rozstrzygniętych
      w edytorze konfliktów oraz wpisy w `types.ts`.
- [ ] Nowa migracja: kontakt z wydarzenia trafia do HubSpot z imieniem
      i nazwiskiem (uwaga przeglądu Codex do #404).
- [ ] Budżet rozmiaru paczek (`check:bundle`) po funkcjach organizatora.
- [ ] Kopiowanie wydarzenia z poprzedniej edycji (migracja klonu).
- [ ] Poprawki z przeglądu adwersaryjnego funkcji.
- [ ] Zielone CI i pełny `events-harness`.

## 3. Wdrożenie produkcji (po scaleniu)

- **Nie uruchamiaj ręcznie** w edytorze SQL starych plików
  `20260926100000_event_cfp.sql` ... `20260926170000_event_clone.sql`. Ten PR
  zmienia ich wersje i dzieli je na części; ręczne wykonanie rozjechałoby się
  z rejestrem migracji.
- Po scaleniu zastosuj z panelu Lovable migracje z pasa drizzle. Dokładna lista
  części i kolejność (wersji supabase, nie numerów drizzle) jest w części 2:
  `docs/WDROZENIE_FUNKCJE_ORGANIZATORA_CZ2_2026-09-27.md`, sekcja 3.
- Po wdrożeniu Lovable przegeneruje `types.ts` z bazy - od tej chwili typy
  zawierają obiekty funkcji organizatora i błędy kompilacji z pkt 1.4 znikają.

## 4. Zmiany na `main` od bazy funkcji organizatora (przejrzane 2026-09-27)

- **#403 i #405** (`claude/events-module-known-issues-4gi7k2`): goście grupy
  idą za prowadzącym, kod rabatowy pakietu per miejsce, zamknięcie gości przez
  prowadzącego, zwrot kodu przy anulowaniu zamówienia pakietu, miejsce z planu
  dla prowadzącego, ponowna wysyłka biletów, stronicowanie partnerów w podglądzie.
- **#406** (`claude/events-module-optimization-a670js`): fundament funkcji
  uczestnika - `event_participant_settings`, zapisane sesje (`event_session_saves`),
  dziennik doręczeń (`event_message_deliveries`), pola przypomnień i SMS w
  zgłoszeniu, pomocniki `_event_safe_timezone`, `_event_effective_end`,
  `_event_participant_release`; poprawki D0 (pełny zwrot czyści kod QR, częściowy
  go zostawia); rodzaje powiadomień `event`/`billing`; sloty torów A (plan,
  kalendarz, przypomnienia), B (oferty z listy rezerwowej, przekazanie, zwrot)
  i C (certyfikat, ankieta).
- **#407** (część 3 braków): wpłata bez miejsca i przed akceptacją, bilet z puli
  planu, zawiadomienie o odwołanym bilecie, awans za zwrot, dzwonki przez
  `enqueue_notification`, migracja `20260926180000` / pas `0067`, rejestr pasów
  `0055`-`0066`.
- **#408** (`claude/eloquent-galileo-xoofu4`, scalony 2026-09-27): karta
  prelegenta - wyśrodkowane koło, pełny kadr, ścieżki po kliknięciu, inicjały
  przy braku miniatury.
- Wdrożenia Lovable: nasze `20260926085900` i `20260926090000` jako pas
  `0065`/`0066`; kilkukrotna regeneracja `types.ts` z bazy produkcyjnej.

## 5. Otwarte PR-y przejrzane przed scaleniem

- **#408** - opisany wyżej; w chwili przeglądu otwarty, potem scalony. Nie
  dubluje naboru prelegentów (dotyczy wyglądu karty, nie przyjęcia na listę
  mówców ani materiałów prelegenta). Klucze w `i18n-event-front` nie kolidują
  z etykietami zakładki naboru przeniesionymi tam przy odchudzaniu paczek.
- **#387** (szkic) - wyłącznie dokument ze zleceniem aktualizacji zależności,
  bez kodu; brak nakładania się.
- **#388** (szkic, przestarzały) - rejestr pasów `0034`/`0035`; brak
  nakładania się, ale potwierdza zasadę forward-only: plików migracji z `main`
  nie usuwamy, duplikaty rejestrujemy jako `drizzleOnly`. Ten PR tak robi.

## 6. Audyt nakładania się z #403-#408 - wnioski

Czterech niezależnych mapujących (po jednym na zestaw zmian) i sceptyczni
weryfikatorzy każdego zgłoszenia (62 pozycje).

- **Brak duplikatów funkcji.** Żadna funkcja, tabela, RPC, typ maila, rodzaj
  powiadomienia ani korzeń i18n nie jest zrobiony podwójnie. „Plan" w #406 to
  osobisty plan agendy, nie plan sali; lista rezerwowa sesji to nie lista
  rezerwowa biletów; eksport kalendarza (tor A) to nie przepustka Wallet.
- **Scalenia w edytorze GitHuba zepsuły też #406** (`575e14987`): na `main`
  `EventMePanel` i `ParticipantTicketsPanel` używają nieimportowanych
  komponentów, `tx-copy` nie ma 5 etykiet, rejestry zdarzeń domenowych i
  inwalidacji nie mają wpisów #406. Ten PR przywraca te linie.
- **Już zrobione po stronie #407** (zostaje ich wersja): test prośby o fakturę
  w kasie, łańcuch liczników maili 31->35->36->47->50, atrapy harnessu
  (`enqueue_notification`, `event_rsvps`).
- **Dostosowania naszych funkcji** (druga runda poprawek w tym PR):
  - faktury: bilety z puli planu (`plan_ticket_claims`) poza fakturą kartową,
    osobno opłacone miejsca gości jako źródła, liczba miejsc z zamówienia,
    znacznik „wymaga korekty" po zwrocie/anulowaniu źródła, własność przez
    `_event_registration_actor`, polityka szkiców/oczekujących;
  - nabór prelegentów: przy cofnięciu przyjęcia `_event_participant_release`
    i ochrona przed anulowaniem cudzego zgłoszenia;
  - skaner offline: odmowa offline nie zapisuje obecności (przed torem C),
    tagi CRM `event:<slug>` obok `attended:<slug>`; Wallet: częściowy zwrot
    zostawia bilet w portfelu, `callerSupabase` w trasach portfela;
  - lejek Ads: opłacone pakiety jako konwersje, bilety z puli planu poza
    „opłaconymi", tytuł wydarzenia w osi czasu CRM, sprzątanie retencji z crona;
  - plan sali: kolejność blokad jak w części 3 (zgłoszenie przed przydziałem),
    `useAllSponsors` zamiast własnego stronicowania;
  - kopiowanie edycji: ustawienia uczestnika z #406, `_event_safe_timezone`
    dla strefy źródła;
  - wspólne pomocniki: `@/lib/files/downloadBlob` zamiast czterech własnych
    funkcji pobierania, `eventEffectiveEnd()` / `_event_effective_end()`;
  - most CRM: stan per intencja - wynik `skipped` z check-inu nie nadpisuje
    błędu naboru; deduplikacja wpisu osi czasu po własnym wierszu audytu.

## 7. Uwagi z przeglądu adwersaryjnego - status

| Obszar                  | Uwagi                                     | Stan                                                                                                                       |
| ----------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Nabór prelegentów       | 7                                         | część 1 w PR (zgody z jawnego zaznaczenia, cofnięcie przyjęcia, publiczne materiały); reszta w drugiej rundzie             |
| Faktury                 | 10 (1 krytyczna)                          | część 1 w PR (korekty od stanu po korektach, cena netto, jeden nabywca, operator płatności, PDF); reszta w drugiej rundzie |
| Lejek Ads               | 11 + 1                                    | druga runda                                                                                                                |
| Plan sali               | 5                                         | druga runda                                                                                                                |
| Raport sponsora         | 6 (1 poważna: filtr botów a zaufany host) | druga runda                                                                                                                |
| Skaner offline i Wallet | 10 + 1                                    | jedna w PR (zwolnienie adresu pliku w Safari); reszta w drugiej rundzie                                                    |
| Między funkcjami        | 4 (budżet paczek krytyczny)               | budżet paczek w PR (wpis XIX); most CRM, tagi, oś czasu w drugiej rundzie                                                  |
