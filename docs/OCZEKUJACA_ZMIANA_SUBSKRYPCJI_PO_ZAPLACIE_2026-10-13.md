# Odrzucona dopłata opłacona później - harmonogram i data końca po `pending_update_applied` (2026-10-13)

Domknięcie luki po regule z PR #495 (przegląd #9/#41, audyt SUB-04): odrzucona
dopłata za zmianę natychmiastową **nie kasuje** zaplanowanej wcześniej zmiany
ani zaplanowanego końca. Kod: `src/lib/billing/stripeEvents.server.ts`
(mapowanie zdarzeń), `src/lib/billing/webhookDispatch.server.ts` (gałąź
`subscription.pending_update_applied`),
`src/lib/billing/subscriptionProvider.server.ts`
(`reconcileScheduleWithAppliedUpdate`, `markUpgradeCancelDate`,
`clearCancelDateAfterAppliedUpgrade`).

## Po co

Upgrade planu i dołożenie miejsc idą z `payment_behavior:
"pending_if_incomplete"`. Gdy karta odmówi, operator zostawia zmianę jako
oczekującą (`pending_update`), a my celowo **zachowujemy** dołączony
harmonogram (zaplanowany downgrade, zmniejszenie miejsc) - odnowienie ma pójść
po cenie, na którą klient się umówił.

Klient może jednak zapłacić odrzuconą fakturę później, w oknie oczekującej
zmiany (~23 h), np. inną kartą ze strony faktury. Operator stosuje wtedy zmianę
sam i wysyła `customer.subscription.pending_update_applied`: subskrypcja jest na
nowej cenie / liczbie miejsc, ale zachowany harmonogram na koniec okresu
zastosowałby STARĄ decyzję - klient płaciłby mniej, niż wybrał, a plan po cichu
spadałby przy odnowieniu.

To samo dotyczy daty końca `cancel_at` (panel operatora, portal klienta) przy
upgradzie PLANU. Udany upgrade zdejmuje ją od razu (`clearCancelDateAfterUpgrade`,
„zmiana planu = zostaję"), ale operator nie przyjmuje `cancel_at`
w oczekującej zmianie. Po odmowie i późniejszej zapłacie data zostawała, a
subskrypcja kończyła się w niej mimo opłaconego upgrade'u. Flaga
`cancel_at_period_end` tego problemu nie ma - jej zdjęcie jedzie w oczekującej
zmianie.

## Co robi

1. `customer.subscription.pending_update_applied` mapuje się na
   `subscription.pending_update_applied`: zwykły `SubscriptionData` plus, **w
   chwili zastosowania**: `scheduleId` (dołączony harmonogram),
   `latestInvoiceId` (faktura, której zapłata zastosowała zmianę) i `cancelAt`
   (data końca w sekundach, tylko gdy koniec zaplanowano DATĄ - przy fladze
   albo subskrypcji zakończonej `null`).
2. Dyspozytor najpierw rozstrzyga harmonogram, potem datę końca u operatora
   (klient środowiska zdarzenia, żywy stan), na końcu stosuje stan tym samym
   strażnikiem kolejności co każde `subscription.updated`
   (`claimSubscriptionEvent`, remis rozstrzygany żywym stanem). Zdarzenie jest
   `processed`, gdy cokolwiek zmieniło się u operatora. Na wdrożeniu
   produkcyjnym zdarzenie z piaskownicy (PAY-05) zostawia wyłącznie ślad
   księgowy lustra: bez odczytu i zmian u operatora.
3. Decyzja na następnej fazie harmonogramu (para pozycja-pozycja):

| Następna faza                                                  | Skutek                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| niższy plan (ranga `BILLING_CATALOG`)                          | `released` - zwolnienie (`schedule-release`, klucz z id)         |
| ta sama cena, mniej miejsc niż opłacono                        | `released`                                                       |
| inna, nie niższa cena (panel, migracja cennika), mniej miejsc  | `rewritten` - cena zostaje, ilość = opłacona                     |
| wyższy plan, tyle samo albo więcej miejsc, kształt nieczytelny | `kept` - bez zmian                                               |
| w migawce brak harmonogramu albo dziś steruje inny / żaden     | `not_attached` - bez zmian (bez migawki - bez pytania operatora) |
| pozycje u operatora już nie te z migawki                       | `superseded` - bez zmian                                         |
| fazy zaplanowano już od opłaconych pozycji (`nes_basis`)       | `superseded` - bez zmian (nowsza decyzja klienta)                |

Nowszą decyzję rozpoznaje odcisk pozycji `nes_basis` w metadanych
harmonogramu: `scheduleFromNextPeriod` zapisuje go w TYM SAMYM wywołaniu co
fazy - skrót cen i ilości subskrypcji, od których zaplanowano zmianę.
Harmonogram zachowany przy odmowie ma odcisk pozycji SPRZED dopłaty, a
downgrade / mniej miejsc zaplanowane już z nowego planu przepisują fazy
dołączonego harmonogramu w miejscu (ten sam identyfikator) z odciskiem
opłaconych pozycji. Kształt faz tego nie rozstrzyga: zmiana `items` na
subskrypcji z harmonogramem potrafi podzielić bieżącą fazę u operatora, więc
bieżąca faza harmonogramu z odmowy też niesie już nowe pozycje.

4. Data końca `cancel_at` - osobna sekcja niżej.
5. Błąd operatora (odmowa, zgubiona odpowiedź) **rzuca**: trasa odpowiada 500,
   zdarzenie w dzienniku zostaje `failed`, operator je ponawia. Ponowienie czyta
   żywy stan od nowa - zwolnienie / zdjęcie daty, które jednak weszło, nie idzie
   drugi raz, a znacznik strażnika nie jest zajęty, więc lustro też się domyka.
6. Wspólna lista typów (`stripeEventTypes.ts`, `STRIPE_WEBHOOK_EVENT_TYPES` -
   jedno źródło dla uzgodnienia i diagnostyki) zna typ
   `customer.subscription.pending_update_applied`: zdarzenie, którego nie ma
   w dzienniku (punkt odbioru bez tego typu, nieudana dostawa), wychodzi w
   raporcie uzgodnienia jako `event_missing` z przyciskiem „Napraw"
   (odtworzenie tą samą ścieżką co webhook: zdarzenie z `events.retrieve`, więc
   z fakturą i datą), a diagnostyka płatności ostrzega o punkcie odbioru, który
   tego typu nie subskrybuje (także nocna sonda piaskownicy,
   `classifyWebhookEndpoints`). Ponowienie z dziennika też normalizuje zapisane
   surowe zdarzenie od nowa. `pending_update_expired` - celowo nie (opcjonalne,
   sama migawka stanu): jego brak w punkcie odbioru byłby fałszywym alarmem.

### Data końca `cancel_at` po upgradzie opłaconym później

Zdjęcie złej daty jest gorsze niż ten błąd: obciąża klienta, który zdecydował
się odejść. Dlatego schodzi WYŁĄCZNIE data, której dotyczyła prośba o upgrade
w aplikacji, i tylko gdy od tamtej pory się nie zmieniła.

**Przy odmowie** (`changeSubscriptionPrice`, gałąź upgrade, koniec zaplanowany
datą; odmowa zwrócona z `pending_update` - karta, 3DS - albo RZUCONA przez
operatora z oczekującą zmianą) aplikacja zapisuje na FAKTURZE oczekującej
zmiany znacznik z żywego stanu sprzed prośby: `nes_upgrade_cancel_at`
(= `cancel_at`), `nes_upgrade_canceled_at` (= `canceled_at`, chwila ustawienia
końca) i `nes_upgrade_price` (cena docelowa prośby). Znakuje wyłącznie
oczekującą zmianę, której `subscription_items` niosą tę cenę: odmowa rzucona
mogła zostawić wcześniejszą oczekującą zmianę (dołożenie miejsc, zmiana spoza
aplikacji), a jej zapłata nie znaczy „zostaję". Klucz idempotencji
z subskrypcji, faktury, ceny i obu wartości. Faktura, nie subskrypcja:
zapis metadanych faktury nie jest aktualizacją subskrypcji (nie dotyka
oczekującej zmiany), a faktura wiąże znacznik z TĄ zapłatą - ponowna próba
upgrade'u unieważnia starą fakturę i wystawia nową (nowy znacznik). Błąd zapisu
jest logowany i **nie zmienia wyniku** (odmowa z linkiem do faktury); bez
znacznika data po zapłacie zostaje. Daty bez `canceled_at` nie znakujemy.
Dołożenie miejsc nigdy nie znakuje (więcej miejsc to nie „zostaję", tak jak
w ścieżce synchronicznej). Klucze `nes_*` faktury nie przesłaniają metadanych
subskrypcji w `customData` transakcji (`mapTransactionFromInvoice`).

**Po zapłacie** (`clearCancelDateAfterAppliedUpgrade`, tylko gdy migawka ma
`cancelAt`; migawka bez daty nie pyta operatora - data ustawiona po
zastosowaniu to nowsza decyzja):

| Żywy stan u operatora / faktura z migawki                                                                           | Skutek                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| migawka bez `latest_invoice`, faktura bez znacznika albo nieznana                                                   | `not_marked` - data zostaje (panel, dołożenie miejsc, błąd zapisu)                             |
| subskrypcja `canceled` / `incomplete_expired`                                                                       | `ended` - bez zmian                                                                            |
| brak zaplanowanego końca                                                                                            | `not_scheduled` - bez mutacji (zdjęty wcześniej albo przez klienta)                            |
| flaga `cancel_at_period_end` albo data inna niż w migawce                                                           | `kept_changed` - nowsza decyzja klienta                                                        |
| dołączony harmonogram                                                                                               | `kept_schedule` - datą steruje harmonogram (`end_behavior: cancel`)                            |
| faktura nie `paid` / nie `subscription_update` / innej subskrypcji; status nie `active` / `trialing`                | `kept_unverified`                                                                              |
| subskrypcja nie na cenie ze znacznika (`nes_upgrade_price`) albo znacznik bez ceny                                  | `kept_unverified` - zastosowana zmiana to nie upgrade z prośby                                 |
| znacznik inny niż żywe `cancel_at` albo `canceled_at` (także ponowne ustawienie TEJ SAMEJ daty), brak `canceled_at` | `kept_changed`                                                                                 |
| wszystko zgodne, ale od zapłaty (`status_transitions.paid_at`) minęło ponad 72 h albo brak `paid_at`                | `kept_stale` - dostawa spóźniona poza okno ponowień operatora                                  |
| wszystko zgodne                                                                                                     | `cleared` - `cancel_at: ""` + licznik `nes_ops_rev`, klucz `cancel-at-clear-applied` (poniżej) |

Klucz idempotencji zdjęcia (`cancel-at-clear-applied`) to skrót z subskrypcji,
faktury, zdejmowanej daty, żywego `canceled_at` i licznika `nes_ops_rev`, który
jedzie w parametrach zdjęcia - inna operacja w międzyczasie daje nowy klucz
zamiast odmowy operatora za ten sam klucz z innymi parametrami.

Każde `kept_*` / `not_marked` to `console.warn` z wartościami (klient zapłacił
za upgrade, a subskrypcja się skończy - do ręcznej oceny).

Okno 72 h od zapłaty to horyzont ponowień operatora (do 3 dni). Po zapłacie
lustro dostaje `customer.subscription.updated` z nową ceną i WCIĄŻ z datą, więc
do obsługi `pending_update_applied` klient widzi „kończy się" (z przyciskiem
„Wznów"). Dostawa spóźniona dłużej (naprawa z panelu uzgodnienia, ręczne
ponowienie z dziennika) trafia na klienta, który od dni widzi ten koniec i mógł
go przyjąć - takiej daty nie zdejmujemy bez człowieka (`kept_stale`).

Przy `cleared` i `not_scheduled` lustro dostaje migawkę bez zaplanowanego końca
(stan operatora, jak `cancelAtPeriodEnd` ścieżki synchronicznej) - bez
chwilowego „kończy się", przycisku „Wznów" i znacznika `canceled_at`
uprawnienia. Zdjęcie emituje własne `customer.subscription.updated` z nowszym
znacznikiem: ta sama cena (bez drugiego maila o upgradzie), status bez zmian
(bez CRM i dzwonka), okres przedłużony, jeśli data skracała bieżący okres.
Remis sekundy rozstrzyga żywy stan.

`customer.subscription.pending_update_expired` (zmiana wygasła bez zapłaty) to
zwykła migawka stanu (`subscription.updated` / `past_due` / `paused` jak przy
`customer.subscription.updated`): pozycje zostały stare, a harmonogram jest
dokładnie tym, na co klient się umówił.

## Konfiguracja operatora (wymagana)

Punkt odbioru webhooków (`/api/public/payments/webhook?env=live` i
`?env=sandbox`) musi subskrybować:

- `customer.subscription.pending_update_applied` - **wymagane**; bez niego
  harmonogram zachowany przy odmowie przeżyje opłacenie faktury i cofnie
  upgrade / dołożone miejsca przy odnowieniu, a data końca z portalu zakończy
  subskrypcję mimo opłaconego upgrade'u,
- `customer.subscription.pending_update_expired` - opcjonalne (tylko lustro
  stanu).

Pozostałe zdarzenia bez zmian (m.in. `invoice.paid` / `invoice.payment_succeeded`,
`charge.dispute.closed`, `refund.failed`).

## Ryzyka i ograniczenia

- **Ponowienie po błędzie a nowsza decyzja klienta.** Okno między
  zastosowaniem zmiany a udaną obsługą zdarzenia bywa długie (zapamiętane 5xx
  pod kluczem zwolnienia przez dobę, ponowienia operatora do 3 dni, naprawa
  z panelu; datę końca zdejmujemy tylko w pierwszych 72 h). Harmonogram
  założony w tym czasie zostaje (`not_attached`), a przepisany przez aplikację
  w miejscu - też (`superseded`, odcisk `nes_basis`). Nie odróżnimy jedynie
  harmonogramu z odciskiem sprzed
  dopłaty, którego fazy przepisano w tym oknie RĘCZNIE w panelu operatora
  (panel nie pisze naszych metadanych) - wtedy rozstrzyga następna faza jak
  dla harmonogramu z odmowy. Harmonogram bez odcisku (panel, zapis sprzed tej
  zmiany) rozstrzygamy samymi fazami.
- **Zapamiętany błąd 5xx.** Klucz zwolnienia jest deterministyczny (id
  harmonogramu), a operator pamięta pod kluczem także 5xx przez dobę - takie
  ponowienia dostaną ten sam błąd, aż klucz wygaśnie (operator ponawia
  zdarzenie do 3 dni). Odmowa sprzed wykonania (limit zapytań) i zgubiona
  odpowiedź nie są tym dotknięte.
- **Znacznik a cena.** Odmowa rzucona znakuje tylko oczekującą zmianę z ceną
  z prośby, a zdjęcie wymaga subskrypcji na cenie ze znacznika. Upgrade
  ponowiony w oknie na TĘ SAMĄ cenę (odmowa rzucona, a operator zostawił
  poprzednią oczekującą zmianę) przepisuje znacznik wartościami z chwili
  ponownej prośby. To nadal prośba klienta o ten upgrade.
- **Data końca a `canceled_at`.** Ponowne ustawienie TEJ SAMEJ daty po odmowie
  (portal: „wznów", potem „anuluj z końcem okresu") odróżnia wyłącznie
  `canceled_at`. Zakładamy, że operator wypełnia je przy zaplanowanym końcu
  i przesuwa przy każdym jego ustawieniu (dokumentacja opisuje to dla
  `cancel_at_period_end`: „czas ostatniego żądania"). Gdy założenie nie
  zachodzi, kod zawodzi BEZPIECZNIE: bez `canceled_at` nie ma znacznika ani
  zdjęcia, a `canceled_at` przesunięte przez samo zastosowanie zmiany daje
  `kept_changed` - data zostaje, jak przed tą zmianą (z logiem).
- **Znacznik na otwartej fakturze.** Zakładamy, że operator przyjmuje
  metadane faktury po finalizacji (dokumentacja blokuje po finalizacji kwoty
  i pola rozliczenia). Odrzucony zapis = brak znacznika = data zostaje.
  Faktura opłacona, zanim znacznik zdążył się zapisać, też kończy się
  `not_marked`.
- **Data należąca do harmonogramu** (`end_behavior: cancel` z panelu) zostaje
  (`kept_schedule`), choć udany upgrade zwalnia każdy dołączony harmonogram -
  rozstrzygnięcie harmonogramu po zapłacie zwalnia wyłącznie sprzeczny.
- **Zdjęcie daty krótszej niż okres nowej ceny nie obciąża przedłużenia od
  razu** (wspólne ze ścieżką synchroniczną `clearCancelDateAfterUpgrade`).
  Katalog uznaje zmianę interwału za upgrade (`plus_monthly` -> `plus_annual`,
  `business_2w` -> `business_quarterly`). Okres nowej ceny zaczyna się wtedy
  w chwili zmiany i - wg dokumentacji operatora (data przed końcem okresu
  skraca `items.current_period_end` do niej) - kończy w dniu daty, więc
  faktura upgrade'u obejmuje tylko czas do daty. Zdjęcie daty przedłuża okres
  i tworzy prorację przedłużenia, a ta bez
  `proration_behavior: "always_invoice"` czeka na NASTĘPNĄ fakturę, czyli
  zwykle odnowienie po roku (klient płaci wtedy ok. dwóch cen rocznych).
  Natychmiastowe obciążenie (`always_invoice` albo osobna faktura) to
  obciążenie poza sesją klienta, także z webhooka, z własną odmową i 3DS (bez
  `pending_if_incomplete`, którego operator przy `cancel_at` nie przyjmuje).
  To osobna decyzja rozliczeniowa dla obu ścieżek, dlatego jest poza zakresem
  tej zmiany. Dziś każde zdjęcie
  przedłużające okres zostawia `console.warn` („current period extended") ze
  starym i nowym końcem okresu, do ręcznego zafakturowania. Koniec okresu
  w lustrze domyka zdarzenie `customer.subscription.updated` samego zdjęcia.
- **Zapamiętany błąd 5xx** zdjęcia daty - jak przy zwolnieniu harmonogramu
  (klucz z subskrypcji, faktury, daty, `canceled_at` i `nes_ops_rev`). Operator pamięta go
  przez dobę, a okno zdjęcia trwa 72 h, więc ponowienia po wygaśnięciu klucza
  wciąż zdejmują datę.
- **Okno 72 h** liczymy zegarem aplikacji od `paid_at` faktury. Dostawa po
  oknie zostawia datę (`kept_stale`, log): klient, który zapłacił za upgrade,
  a subskrypcja się kończy, wymaga wtedy ręcznej oceny (np. kontaktu
  i zdjęcia daty w panelu operatora).
- **Flaga `cancel_at_period_end`** schodzi razem z oczekującą zmianą tylko
  wtedy, gdy operator stosuje ją po zapłacie (dokumentacja wymienia ją wśród
  atrybutów oczekującej zmiany, obiekt `pending_update` jej nie pokazuje) - ta
  ścieżka jest bez zmian.
- **Cena spoza katalogu** w następnej fazie nie ma rangi: przy tej samej lub
  większej liczbie miejsc harmonogram zostaje (nie zwalniamy na domysł).
