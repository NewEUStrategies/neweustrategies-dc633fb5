# Panel uczestnika wydarzeń - profil, networking, bilety, koszyk

## Stan obecny (audyt)

Zalogowany użytkownik wchodząc na `/events/<slug>` widzi dziś tylko **kartę-wizytówkę**
(zdjęcie, stanowisko, firma) z linkiem „Edytuj”, który wyprowadza go do globalnego
`/profile/edit`. Nie ma z poziomu wydarzenia:

- edycji profilu **na to konkretne wydarzenie** (widoczność w katalogu istnieje w bazie,
  ale nie ma dla niej ekranu uczestnika),
- zarządzania **dostępnością i spotkaniami** - RPC są gotowe
  (`event_meeting_directory`, `event_my_availability`, `event_meetings_mine`,
  zaproszenia/odpowiedzi/przełożenia), brakuje wyłącznie warstwy UI dla uczestnika,
- podglądu **własnej rejestracji** przy wydarzeniu (dziś tylko `/profile/tickets`
  i link `manage?token=` z maila),
- wejścia do wydarzeń z **droplisty pod avatarem**,
- sekcji **„Wydarzenia”** w globalnym profilu,
- **koszyka** - zakup biletu idzie od razu do Stripe Checkout, nie da się zebrać
  kilku biletów/wydarzeń.

## Co zbuduję

### 1. `/events/$slug/me` - panel uczestnika wydarzenia (nowa zakładka „Moje”)
Widoczna tylko dla zalogowanych, zakładki w istniejącym `EventPortalShell`:

- **Profil na wydarzenie** - zdjęcie/imię z profilu (read-only skrót + link),
  edytowalne: widoczność w katalogu uczestników, krótkie bio na wydarzenie,
  tagi zainteresowań/celu udziału, zgoda na kontakt.
- **Networking** - przełącznik obecności w katalogu, siatka slotów dostępności
  (dodaj/usuń), lista moich spotkań (zaproszenia przychodzące/wychodzące,
  akceptuj / odrzuć / przełóż / odwołaj), wolne sloty rozmówcy.
- **Moja rejestracja** - status, typ biletu, kwota/zwrot, QR do wejścia,
  kanały e-mail/SMS, powód anulowania, „Opłać teraz” gdy nieopłacone.

### 2. Globalny profil: sekcja „Wydarzenia”
Nowa grupa w `ProfileNav` + trasy:

- `/profile/events` - oś czasu: **nadchodzące / w trakcie / historia**, każde
  wydarzenie z rolą (uczestnik/prelegent), statusem zgłoszenia i skrótem do
  panelu wydarzenia,
- `/profile/events/tickets` - wszystkie bilety (płatne i darmowe): status
  płatności, faktura, QR, anulowanie, „dokończ płatność”,
  (istniejący `/profile/tickets` staje się przekierowaniem, żeby nie zepsuć linków).

### 3. Droplista pod avatarem
Dodaję pozycje `Wydarzenia` (`/profile/events`) i `Moje bilety`
(`/profile/events/tickets`) do rejestru `AccountMenuWidget` (PL/EN, ikona),
domyślnie widoczne dla zalogowanych.

### 4. „Mój koszyk”
- Koszyk klienta (localStorage + kontekst, scalany po zalogowaniu) na pozycje
  biletowe: wydarzenie, typ biletu, faza cenowa, ilość, kod rabatowy.
- Ikona koszyka z licznikiem w headerze i w mobile bottom bar.
- `/cart` - podsumowanie, walidacja faz/limitu miejsc po stronie bazy przed
  płatnością, jedno przejście do Stripe Checkout dla wielu pozycji,
  darmowe bilety kończą się rejestracją bez płatności.

## Szczegóły techniczne

- Warstwa danych: wyłącznie istniejące RPC (`event_meeting_*`,
  `event_my_registrations`, `event_registration_set_channels`,
  `event_meeting_directory_visibility_set`). Nowe pola profilu na wydarzenie
  (bio/tagi/zgoda) i pozycje koszyka wymagają jednej migracji
  (`event_people`/`event_registrations` rozszerzenie + `cart_items` z RLS
  `auth.uid()` i GRANT-ami) - migrację pokażę do zatwierdzenia osobno.
- Atomic design: nowe molekuły/organizmy w `src/components/events/participant/`
  i `src/components/profile/events/`, trasy tylko montują organizmy.
- i18n PL/EN w `src/lib/i18n-event-front.ts`, `i18n-profile.ts` i nowym
  `i18n-cart.ts`; zero twardych napisów.
- Wielotenantowość: każde zapytanie idzie przez RPC z `tenant_id` z sesji;
  koszyk trzyma `tenant_id` przy zapisie.
- Testy: vitest dla reducera koszyka, mapowania spotkań i widoków paneli;
  e2e (Playwright) dla ścieżki „bilet do koszyka → checkout → moje bilety”.

## Kolejność wdrożenia

1. Panel uczestnika wydarzenia (profil + networking + rejestracja)
2. Sekcja „Wydarzenia” w globalnym profilu + droplista avatara
3. Koszyk i checkout wielopozycyjny
