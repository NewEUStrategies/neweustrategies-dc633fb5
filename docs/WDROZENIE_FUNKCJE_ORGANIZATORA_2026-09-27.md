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
- Po scaleniu zastosuj z panelu Lovable migracje z pasa drizzle w kolejności
  numerów. Dokładna lista części i kolejność zostaną wpisane tutaj, gdy podział
  będzie gotowy.
- Po wdrożeniu Lovable przegeneruje `types.ts` z bazy - od tej chwili typy
  zawierają obiekty funkcji organizatora i błędy kompilacji z pkt 1.4 znikają.
