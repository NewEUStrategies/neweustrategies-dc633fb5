# Wdrożenie: własny checkout darowizn - podstawa modelu, spójność i optymalizacja

Data: 2026-08-06
Zakres: wiersz „Darowizny" (MODUŁ 14) z `docs/OCENA_FUNKCJI_TABELE_2026-08-06_R2.md`
oraz **korekta 1** z tego samego audytu (statyczny import modala kasy).

Audyt postawił trzy zarzuty i trzy rekomendacje:

| Zarzut audytu                                                        | Odpowiedź w tym wdrożeniu                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Podstawa prawno-podatkowa zmiany modelu **nieudokumentowana w repo** | §1 tego dokumentu + odsyłacze z kodu (`donations.server.ts` i in.) |
| `DonationForm` importuje dialog kasy statycznie (korekta 1)          | §3 - `LazyEmbeddedCheckoutDialog` w 4 miejscach + leniwe SDK       |
| Brak testu ścieżki cyklicznej                                        | §5 - 17 testów księgi darowizn + 8 testów formularza               |

Przy okazji zamknięte zostały trzy defekty wykryte podczas prac (§2) i rozjazd
międzymodułowy, przez który trzy powierzchnie serwisu prowadziły darczyńcę
w dwa różne miejsca (§4).

---

## 1. Podstawa prawno-podatkowa modelu

> **Zastrzeżenie.** Poniższe to udokumentowanie przesłanek, na których oparto
> DECYZJE TECHNICZNE (co wolno wystawić w kasie, jakie pola wysyłamy do
> operatora, czego świadomie nie liczymy). Nie jest to opinia podatkowa.
> Każda zmiana pozycji oznaczonej **[do potwierdzenia]** wymaga stanowiska
> doradcy podatkowego organizacji przed wdrożeniem.

### 1.1 Dlaczego wcześniej NIE MOGLIŚMY zbierać u siebie

Do 31.07.2026 darowizny żyły na zewnętrznej zbiórce (zrzutka.pl), a panel
`/admin/donations` został wycięty jako wydmuszka -
patrz `docs/WDROZENIE_DAROWIZNY_LINK_ZEWNETRZNY_2026-07-31.md`.

Powód był umowny, nie podatkowy: serwis rozliczał się wtedy przez operatora
działającego w modelu **Merchant of Record** (Paddle). MoR kupuje i odsprzedaje
we własnym imieniu licencje na oprogramowanie i treści cyfrowe; jego Acceptable
Use Policy wyklucza zbiórki, darowizny i crowdfunding, bo w tym modelu operator
musiałby stać się stroną czynności, która nie jest sprzedażą. Przycisk
darowizny otwierający checkout MoR łamał więc umowę z operatorem.

### 1.2 Co się zmieniło

Warstwa płatności serwisu przeszła na **Stripe jako zwykłego dostawcę usług
płatniczych** (acquirer/PSP), a nie sprzedawcę. Konsekwencje istotne dla tego
modułu:

1. **Stroną umowy darowizny jest organizacja, nie operator.** Środki trafiają
   na rachunek organizacji, operator wyłącznie przetwarza płatność. Darowizna
   nie jest odsprzedażą niczego, więc nie narusza katalogu kategorii MoR - ten
   katalog przestał obowiązywać razem z modelem MoR.
2. **Umowa darowizny** (art. 888 § 1 Kodeksu cywilnego): darczyńca zobowiązuje
   się do bezpłatnego świadczenia kosztem swojego majątku. Kluczowe dla kodu:
   **brak świadczenia wzajemnego**. Dlatego darowizna w tym serwisie **nie
   nadaje dostępu do treści** - i nie może nadawać, bo wtedy przestałaby być
   darowizną, a stałaby się sprzedażą.
3. Wyjątek świadomie utrzymany: trigger `tg_donations_grant_supporter`
   (`20260714130000`) nadaje status „supporter" na 12 miesięcy. Status jest
   **oznaczeniem honorowym w społeczności**, nie dostępem do płatnych treści -
   `membership_tiers` rozdziela te dwie rzeczy. **[do potwierdzenia]** czy
   zakres uprawnień tieru „supporter" pozostaje wyłącznie symboliczny; gdyby
   kiedykolwiek objął treści płatne, świadczenie przestaje być nieodpłatne
   i model podatkowy się zmienia.

### 1.3 VAT - dlaczego sesja kasy nie liczy podatku

Opodatkowaniu VAT podlega odpłatna dostawa towarów i odpłatne świadczenie usług
(art. 5 ust. 1 pkt 1 ustawy o VAT; art. 2 ust. 1 lit. c dyrektywy 2006/112/WE).
Warunkiem jest **bezpośredni związek** między świadczeniem a wynagrodzeniem
(utrwalona linia TSUE, m.in. C-16/93 _Tolsma_). Darowizna bez świadczenia
wzajemnego tego związku nie ma, więc pozostaje **poza zakresem VAT**.

Odbicie w kodzie (`src/lib/billing/donations.server.ts`):

- **brak `automatic_tax`** - nie ma podstawy opodatkowania do wyliczenia,
- **brak `managed_payments`** - operator nie wchodzi w rolę sprzedawcy,
- **brak faktury** - wystawiamy potwierdzenie wpłaty, nie dokument sprzedaży,
- `line_items.price_data.product_data` opisuje wpłatę jako „Darowizna", nie
  jako produkt (treść w języku darczyńcy - ramka kasy nie dziedziczy naszego
  i18n).

**[do potwierdzenia]** Gdyby organizacja zdecydowała się na świadczenia
wzajemne dla darczyńców (gadżety, dostęp, wyróżnienia komercyjne), powyższe
przestaje obowiązywać dla tej części kwoty i sesja musi wrócić do trybu
podatkowego.

### 1.4 Podatek dochodowy

- **Po stronie darczyńcy:** odliczenie darowizny od podstawy opodatkowania
  (art. 26 ust. 1 pkt 9 ustawy o PIT; art. 18 ust. 1 ustawy o CIT) zależy od
  celu z art. 4 ustawy o działalności pożytku publicznego i od statusu
  obdarowanego. **[do potwierdzenia]** czy organizacja spełnia te przesłanki -
  do czasu potwierdzenia serwis **nie obiecuje odliczenia** w żadnym
  komunikacie. Obecne teksty (`src/lib/i18n-donate.ts`, `src/lib/i18n-support.ts`)
  mówią wyłącznie o wsparciu pracy analitycznej i o braku uprawnień.
- **Po stronie obdarowanego:** darowizna otrzymana przez osobę prawną jest
  przychodem w rozumieniu CIT (ustawa o podatku od spadków i darowizn dotyczy
  osób fizycznych - art. 1 ust. 1). Ewidencja: tabela `public.donations` jest
  rejestrem pomocniczym, nie księgą rachunkową; **[do potwierdzenia]** sposób
  ujęcia wpłat w księgach organizacji.
- **Dowód wpłaty:** dla odliczenia liczy się dowód wpłaty na rachunek. Rejestr
  trzyma `provider_intent_id`, `provider_session_id`, kwotę, walutę i
  `paid_at` - komplet do uzgodnienia z wyciągiem operatora.

### 1.5 Wsparcie miesięczne a prawo konsumenckie

Wsparcie cykliczne to subskrypcja u operatora (`mode: "subscription"`,
interwał miesięczny). Darowizna nie jest umową sprzedaży, ale obciążenie
odnawialne wymaga jasnej informacji przed zawarciem: formularz pokazuje w
trybie miesięcznym komunikat o pobieraniu wpłaty **do momentu rezygnacji** i o
możliwości odwołania w dowolnej chwili (`donate.recurringNote`, PL/EN).
**[do potwierdzenia]** kanał rezygnacji - obecnie kontakt z redakcją;
docelowo warto dać samoobsługę w profilu darczyńcy.

### 1.6 Dane osobowe (RODO)

| Dana                 | Podstawa / decyzja techniczna                                                           |
| -------------------- | --------------------------------------------------------------------------------------- |
| `donor_email`        | Podawany dobrowolnie, na potwierdzenie wpłaty. Normalizowany (lowercase), limit 320 zn. |
| `message`            | Dobrowolny, limit 500 zn.; **nigdy** nie trafia do publicznych statystyk                |
| `user_id`            | Tylko dla zalogowanego darczyńcy (rejestr w profilu + status wspierającego)             |
| Adres IP             | **Nie jest zapisywany.** Limit prób pracuje na solonym skrócie SHA-256 (§2.4)           |
| Publiczne statystyki | Wyłącznie sumy i kwoty ostatnich pozycji - zero PII (`getDonationsPublicStats`)         |
| Usunięcie konta      | `donations.user_id` ma `ON DELETE SET NULL` - dowód wpłaty zostaje, tożsamość znika     |

### 1.7 Przeciwdziałanie nadużyciom

- Sufit pojedynczej wpłaty: `DONATION_MAX_CENTS` = 50 000 j. waluty (ochrona
  przed pomyłką w kwocie i przed praniem pieniędzy przez „darowiznę"),
  administrator może go tylko obniżyć.
- Limit prób: 10 sesji / 10 minut na podmiot - publiczny formularz nie może być
  darmowym generatorem sesji u operatora.
- Kwota, waluta i zakres są walidowane **wyłącznie na serwerze**; pole w
  przeglądarce jest sugestią interfejsu.

---

## 2. Naprawione defekty księgi darowizn

### 2.1 Brak daty zapłaty przy wpłacie jednorazowej

`settleDonation()` ustawiał `status='paid'`, ale **nie** `paid_at` - panel
pokazywał pustą datę, a eksport księgowy nie miał kiedy zaksięgować wpłaty
(ścieżka cykliczna datę ustawiała, więc rejestr był niespójny sam ze sobą).
Teraz data jest ustawiana, z dwoma niuansami:

- pochodzi ze zdarzenia operatora, gdy je znamy (`settlement.paidAt`,
  uzgodnienie ze Stripe przekazuje `session.created`),
- jest ustawiana **tylko gdy jest pusta** - ponowione dostarczenie webhooka nie
  przesuwa daty księgowania na moment ponowienia.

### 2.2 Ponowiony webhook wskrzeszał zwróconą darowiznę

Łatka księgująca leciała bez filtra statusu, więc spóźnione ponowienie po
zwrocie ustawiało z powrotem `status='paid'` - a trigger nadania statusu
wspierającego reaguje właśnie na przejście statusu. Teraz każda ścieżka
księgująca ma `status <> 'refunded'`, a `settleDonation()` zwraca `false`, gdy
nic nie ruszyła (wywołujący raportuje `skipped` zamiast udawać sukces).

### 2.3 Wyścig dwóch webhooków gubił wpłatę cykliczną

`recordRecurringDonationPayment()` odczytywał kotwicę, widział `pending` i
robił `UPDATE ... WHERE status='pending'`. Gdy równolegle dostarczony webhook
zdążył wcześniej, aktualizacja trafiała w zero wierszy - a funkcja i tak
zwracała `settled`. Druga faktura znikała z rejestru. Teraz zero zaktualizowanych
wierszy oznacza „to jednak odnowienie" i wpłata dopisuje własny wiersz
(idempotentnie, na unikacie `(provider, provider_intent_id)`).

### 2.4 Pozostałe

- **Deklaracja cykliczności przy checkoucie:** wiersz `pending` dostaje
  `recurring` od razu, więc porzucona subskrypcja nie udaje wpłaty jednorazowej.
- **Zalogowany darczyńca był anonimowy:** `createDonationCheckout` nie czytał
  tożsamości, więc `donations.user_id` zostawało puste - wpłata nie pojawiała
  się w „Twoje wsparcie" w profilu i nie nadawała statusu wspierającego, mimo że
  baza i trigger były na to gotowe od `20260714130000`. Nowy
  `optionalUserIdFromRequest()` czyta bearer **miękko** (brak tokenu = darowizna
  anonimowa) i weryfikuje podpis - podrobiony token nie podszyje się pod konto.
- **Surowy adres IP w `rate_limits`:** klucz limitu jest teraz solonym skrótem
  (`requestRateSubject`), zgodnie z konwencją strażnika logowania. Sam limiter
  to wspólny `rateLimit()` zamiast lokalnej kopii wywołania RPC.
- **Sumowanie dwóch walut:** publiczne statystyki dodawały grosze do centów i
  podawały walutę pierwszego wiersza. Teraz sumujemy wyłącznie wpłaty w walucie
  zbiórki (ta sama, w której wyrażony jest cel), a skan jest stronicowany do
  20 000 wierszy z jawną flagą `truncated`.

---

## 3. Korekta 1 - kasa przestaje jechać do każdego czytelnika

`EmbeddedCheckoutDialog` ciągnie `@stripe/react-stripe-js`, a montowany jest
w czterech miejscach; trzy z nich renderują się zwykłemu czytelnikowi (paywall
wpisu, formularz darowizny, przycisk biletu).

- **`LazyEmbeddedCheckoutDialog`** (`src/components/checkout/`) - granica
  `React.lazy` + `Suspense` o **identycznym kontrakcie** co modal, więc miejsca
  montowania zmieniają wyłącznie import. Dopóki nie ma sesji, komponent nie
  renderuje nic i nie pobiera chunku; po pierwszym otwarciu zostaje zamontowany,
  żeby Radix dograł animację zamknięcia.
- **`checkoutDialogChunk.ts`** - jedyne miejsce znające ścieżkę importu.
  `prefetchEmbeddedCheckoutDialog()` rozgrzewa chunk w momencie deklaracji
  zapłaty (hover/klik), więc pobranie kodu idzie **równolegle** z tworzeniem
  sesji, a nie po niej.
- **`src/lib/stripe.ts`** - `getStripe()` ładuje `@stripe/stripe-js`
  dynamicznie. Ten moduł eksportuje też czyste helpery środowiska
  (`getStripeEnvironment`, `isPaymentsConfigured`) importowane przez paywall,
  banery i karty rozliczeń - przy statycznym imporcie SDK jechało razem z nimi.

Podmienione miejsca montowania: `DonationForm`, `Paywall`,
`EventTicketPurchase`, `AdminPaymentsDiagnosticsPanel`.

---

## 4. Jedno źródło prawdy o celu darowizny

Po przełączeniu modułu na własną kasę serwis mówił trzema głosami: `/donate`
otwierało nasz formularz, a `/support` i CTA widgetu CMS miały adres zbiórki
zewnętrznej **wpisany w kodzie** - ten sam użytkownik trafiał raz tu, raz tam.

`src/lib/billing/donationTarget.ts` (czysty, client-safe) rozstrzyga to raz:

| Konfiguracja           | Cel                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `enabled: false`       | brak celu - powierzchnia nie zaprasza do wpłaty                                     |
| `provider: "stripe"`   | `/donate` - nawigacja wewnętrzna                                                    |
| `provider: "external"` | adres z ustawień (pusty → stała awaryjna), nowa karta z `rel="noopener noreferrer"` |

Konsumenci: `DonationForm`, `DonationCta` (widget CMS, 6 wariantów), karta
wpłaty na `/support`. Konfigurację czyta wspólny `donationsConfigQueryOptions`
(jeden `queryKey`, `staleTime` 5 min), więc trzy powierzchnie na jednej stronie
kosztują jeden odczyt. Do czasu odpowiedzi obowiązuje domyślka „własna kasa" -
`/donate` samo zdegraduje się do linku, gdy najemca zbiera zewnętrznie.

Serwerowo `getDonationsConfig` i `getDonationsPublicStats` siedzą za
`edgeTtlCache` (60 s, klucz per host), a uzgodnienie ze Stripe unieważnia wpis
statystyk, żeby administrator widział skutek kliknięcia od razu.

### Interfejs formularza (PL/EN)

- przełącznik częstotliwości na wspólnym atomie `SegmentedControl` (nowy
  rozmiar `lg` dla powierzchni publicznych) - `role="radiogroup"` zamiast
  ręcznie sklejanych przycisków,
- pasek celu jako `role="progressbar"` z `aria-valuenow` i wyłączoną animacją
  przy `prefers-reduced-motion`,
- widoczny zakres kwoty (`donate.range`) + `aria-invalid` i blokada wysyłki
  poza zakresem - błąd widać przed round-tripem,
- komunikat błędu w `role="alert"` o stałej wysokości (brak skoku layoutu),
- licznik znaków wiadomości, `autoComplete`/`inputMode` na polach,
- nowe klucze PL/EN: `donate.frequency`, `donate.recurringNote`, `donate.range`,
  `donate.newTab`, `donate.checkoutTitleMonthly`, `paymentsBanner.loading`,
  `support.externalLead/externalCta/externalNote/closed`.

---

## 5. Testy

| Plik                                                          | Co pokrywa                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billing/__tests__/donationsLedger.server.test.ts` (17)       | Miniaturowa tabela `donations` z prawdziwymi filtrami i unikatami: otwarcie kasy (cykliczność, konto, kasowanie osieroconego wiersza, limit), księgowanie jednorazowe (data zapłaty, ponowienie, ochrona zwrotu, brak identyfikatorów), **ścieżka cykliczna** (pierwsza wpłata, odnowienie, duplikat faktury, kotwica po subskrypcji, fallback kwoty, wyścig webhooków), stan subskrypcji |
| `billing/__tests__/donationTarget.test.ts` (4)                | Rozstrzyganie celu dla wszystkich trybów konfiguracji                                                                                                                                                                                                                                                                                                                                     |
| `donations/__tests__/DonationForm.test.tsx` (8)               | Wsparcie miesięczne end-to-end w UI, informacja o cykliczności, granice kwoty, błąd serwera, degradacja trybów                                                                                                                                                                                                                                                                            |
| `donations/__tests__/DonationCta.test.tsx` (4)                | CTA widgetu: link wewnętrzny, nasza kasa, zbiórka zewnętrzna, moduł wyłączony                                                                                                                                                                                                                                                                                                             |
| `checkout/__tests__/LazyEmbeddedCheckoutDialog.test.tsx` (1)  | Dowód leniwości: licznik importów modułu kasy - 0 przed sesją, 1 po niej                                                                                                                                                                                                                                                                                                                  |
| `billing/__tests__/donationRecurring.test.ts` (3, istniejący) | Rozpoznanie darowizny w dyspozytorze webhooka (bez zmian)                                                                                                                                                                                                                                                                                                                                 |

Wynik lokalny: `vitest run` - 6242 testy zielone; jedyna czerwona pozycja
(`authzSnapshotParity`) jest **wcześniejsza niż to wdrożenie** i dotyczy
rozjazdu snapshotu bramek `profiles_guard_verification` z migracjami -
sprawdzone na czystym drzewie przed zmianami.

---

## 6. Czego świadomie NIE zmieniono

- **Zewnętrzna zbiórka zostaje jako tryb awaryjny** - jeden przełącznik
  w panelu wraca do niej bez wdrożenia kodu.
- **Brak migracji SQL.** Schemat z `20260805194031` (statusy, `recurring`,
  `paid_at`, `provider_subscription_id`, unikat `(provider, provider_intent_id)`)
  wystarcza; nowe zachowania to poprawki zapisu, nie zmiany struktury.
- **Panel `/admin/donations` pozostaje po polsku** - zgodnie z konwencją całego
  panelu administracyjnego; i18n obejmuje powierzchnie publiczne.
- **Agregacja statystyk zostaje po stronie aplikacji** (stronicowany skan
  zamiast RPC): przy obecnym wolumenie odczyt schodzi do jednego zapytania na
  60 s na izolat, a RPC wymagałoby migracji i regeneracji typów bazy.
  Do rewizji, gdy rejestr przekroczy kilka tysięcy wpłat - flaga `truncated`
  jest właśnie sygnałem, że ten moment nadszedł.

## 7. Otwarte pozycje dla organizacji

1. **[do potwierdzenia]** status podatkowy organizacji i wynikające z niego
   prawo darczyńcy do odliczenia (§1.4) - do czasu potwierdzenia serwis nie
   składa żadnej obietnicy podatkowej.
2. **[do potwierdzenia]** ujęcie wpłat w księgach i okres przechowywania
   dowodów (§1.4, §1.6).
3. **[do potwierdzenia]** zakres tieru „supporter" - musi pozostać honorowy,
   inaczej darowizna staje się świadczeniem wzajemnym (§1.2).
4. Samoobsługowa rezygnacja ze wsparcia miesięcznego w profilu darczyńcy (§1.5).
