# Katalog benefitów i cen: wszystkie progi członkostwa według segmentu (stan 2026-09-09)

Jeden dokument do pobrania z **pełnym zakresem benefitów każdego progu subskrypcji**, w podziale
na segmenty odbiorców (indywidualny, firmowy, akademicki — w tym kadra akademicka — oraz
zespołowy), wraz z **cenami miesięcznymi i rocznymi**.

Benefity klubu dyskusyjnego i to, co daje sama przynależność, mają osobną sekcję **§9** — z twardo
oddzieloną częścią §9.7, w której benefity **sformułowałem sam**, bo funkcje istnieją w platformie,
ale katalog ich nie sprzedaje.

Zestawienie łączy trzy źródła prawdy, które w repozytorium żyją osobno:

| Źródło                                 | Co z niego pochodzi                                                                                                     | Gdzie leży                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Katalog handlowy **v6.2** (22.08.2026) | copy benefitów, statusy egzekwowania, ceny wywoławcze progów sprzedawanych w rozmowie, kalendarz zobowiązań             | `docs/cennik-nes-v6.2.html`                                                                                            |
| Baza: `membership_tiers`               | klucz progu, ranga, segment (`audience_key`), `benefits` (copy na karcie `/pricing`), `features` (flagi bramek)         | `supabase/migrations/20260722230000_pricing_catalog_v3_retention.sql`, `…20260822095000_catalog_v61_benefits_copy.sql` |
| Baza: `access_plans`                   | **ceny faktycznie sprzedawane** i interwały (to z nich `catalogSync.server.ts` odtwarza produkty u operatora płatności) | `supabase/migrations/20260730194653_…sql`, `…20260822094000_catalog_v61_products_and_verification.sql`                 |

Ceny katalogu v6.2 i ceny w `access_plans` **nie są dziś tożsame** dla progów Członek, Członek Pro
i Zespół — rozjazd jest wypunktowany w §13. Wszędzie niżej podaję obie liczby, żeby dokument nie
udawał, że decyzja cenowa jest zamknięta.

---

## 0. Jak czytać ten dokument

**Statusy egzekwowania** (legenda katalogu v6.2, bilans po wdrożeniu: **47 `[B]` / 0 `[B?]` / 21 `[P]` / 3 `[N]`**):

| Znak | Znaczenie                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------- |
| `B`  | bramka istnieje i działa — realny punkt egzekwowania w platformie (SQL `SECURITY DEFINER` / RLS / funkcja serwerowa) |
| `B?` | bramka do dopisania — **kategoria dziś pusta**, zostaje w legendzie na przyszłe pozycje                              |
| `P`  | zobowiązanie procesowe — pilnuje go kalendarz i redakcja, nie kod; każde ma liczbę albo termin (§11)                 |
| `N`  | funkcja do zbudowania — dziś obietnica bez kodu (wszystkie trzy pozycje `N` to warstwa odpowiedzi na archiwum)       |

**Ranga** (`membership_tiers.rank`) jest tym, czym platforma faktycznie bramkuje kluby, wydarzenia,
treści i zasoby biblioteki (`min_tier_rank`). Nazwa handlowa progu nie bramkuje niczego.

**Flagi `features`** dzielą się na egzekwowane i dekoracyjne — pełny rejestr w §12.

---

## 1. Segmenty odbiorców (`pricing_audiences`)

`/pricing` grupuje karty progów po `membership_tiers.audience_key`.

| Klucz        | Nazwa PL           | Nazwa EN           | Obietnica segmentu                                                                                                        | Pasek zaufania                                 | Ikona            | Kolejność |
| ------------ | ------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------- | --------- |
| `individual` | Dla Ciebie         | For you            | Pełen dostęp do analiz, briefingów i społeczności ekspertów — w rytmie, który wybierasz.                                  | —                                              | `user`           | 0         |
| `business`   | Dla firm           | For business       | Monitoring regulacyjny i wczesne ostrzeganie dla public affairs, strategii i zarządów — z licencją dla całej organizacji. | Faktura · Umowa roczna · Wdrożenie z opiekunem | `building-2`     | 10        |
| `academic`   | Program Akademicki | Academic Programme | Ta sama wiedza, niższy próg wejścia.                                                                                      | —                                              | `graduation-cap` | 20        |
| `team`       | Dla zespołów       | For teams          | Jedna subskrypcja, wspólny dostęp — zarządzasz miejscami w jednym panelu.                                                 | —                                              | `users`          | 30        |

Przydział progów do segmentów (`seed_pricing_defaults`):

- `individual` → `reader`, `supporter`, `member`, `pro`, `vip`
- `business` → `corporate`, `partner`, `partner_general`, `presidents_circle` (oraz wycofany `business`)
- `academic` → `student`, `educator`, `ngo`
- `team` → `team`

---

## 2. Tabela zbiorcza: progi, rangi, ceny miesięczne i roczne

| #   | Klucz               | Nazwa w bazie (karta `/pricing`)                   | Nazwa w katalogu v6.2                              | Segment    | Ranga | Cena mies. — katalog v6.2         | Cena roczna — katalog v6.2 | Cena mies. — `access_plans`                           | Cena roczna — `access_plans` | Tryb CTA               |
| --- | ------------------- | -------------------------------------------------- | -------------------------------------------------- | ---------- | ----- | --------------------------------- | -------------------------- | ----------------------------------------------------- | ---------------------------- | ---------------------- |
| 1   | `reader`            | Essential                                          | Czytelnik                                          | individual | 0     | 0 zł                              | 0 zł                       | — (brak planu, konto bezpłatne)                       | —                            | `auto`                 |
| —   | `supporter`         | Wspierający                                        | _(wycofany)_                                       | individual | 5     | darowizna                         | darowizna                  | —                                                     | —                            | `auto`                 |
| 2   | `member`            | Plus                                               | Członek                                            | individual | 10    | **39 zł**                         | **390 zł** (−17 %)         | **59 zł**                                             | **590 zł** (−17 %)           | `auto`                 |
| 3   | `pro`               | Pro                                                | Członek Pro                                        | individual | 20    | **119 zł**                        | **1 190 zł** (−17 %)       | **129 zł**                                            | **1 290 zł** (−17 %)         | `auto`                 |
| 4   | `vip`               | VIP                                                | Rada Instytutu                                     | individual | 25    | rozmowa                           | **od 6 000 zł/rok**        | — (brak planu samoobsługowego)                        | —                            | `auto`                 |
| 5   | `team`              | Zespół                                             | Zespół                                             | team       | 25    | **89 zł / miejsce** (3–20 miejsc) | — (rozliczenie miesięczne) | **99 zł / miejsce**; **79 zł / miejsce od 11 miejsc** | —                            | `contact`              |
| —   | `corporate`         | Enterprise                                         | _(brak w v6.2 — patrz §13.3)_                      | business   | 30    | rozmowa                           | rozmowa                    | —                                                     | —                            | `auto`                 |
| —   | `business`          | Partner Biznesowy                                  | _(wycofany, ranga 28 → 30)_                        | business   | 28    | **990 zł** (oraz 590 zł / 2 tyg.) | **2 490 zł / kwartał**     | 990 zł                                                | 2 490 zł / kwartał           | `auto`                 |
| 6   | `partner`           | Strategic Partner                                  | Partner Instytucjonalny                            | business   | 40    | rozmowa                           | **od 24 000 zł/rok**       | —                                                     | —                            | `auto`                 |
| 7   | `partner_general`   | Partner Generalny                                  | Partner Strategiczny                               | business   | 50    | rozmowa                           | **od 60 000 zł/rok**       | —                                                     | —                            | `auto`                 |
| 8   | `presidents_circle` | President's Circle                                 | Krąg Założycieli                                   | business   | 60    | na zaproszenie                    | **od 120 000 zł/rok**      | —                                                     | —                            | `none` (bez przycisku) |
| A1  | `student`           | Student i Doktorant                                | Stawka studencka                                   | academic   | 10    | **19 zł**                         | **190 zł** (wg katalogu)   | **19 zł**                                             | — (brak planu rocznego)      | `auto`                 |
| A2  | `educator`          | Kadra Akademicka                                   | Stawka akademicka                                  | academic   | 10    | **29 zł**                         | **290 zł** (wg katalogu)   | **29 zł**                                             | — (brak planu rocznego)      | `auto`                 |
| A3  | `ngo`               | Organizacja Non-profit                             | _(stawka preferencyjna −50 % w progu partnerskim)_ | academic   | 20    | preferencyjnie, na fakturę        | preferencyjnie, na fakturę | —                                                     | —                            | `auto`                 |
| P1  | `decision_lab`      | Decision Lab _(wpis techniczny, `active = false`)_ | Decision Lab — miejsce w cyklu                     | —          | 0     | —                                 | **16 000 zł jednorazowo**  | —                                                     | 16 000 zł (`one_time`)       | `none`                 |

Rangi kanoniczne (`src/lib/billing/tierRanks.ts`, parytet z seedem wymuszony testem
`tierCatalogParity.test.ts`): `reader` 0 · `supporter` 5 · `member`/`student`/`educator` 10 ·
`pro`/`ngo` 20 · `vip`/`team` 25 · `business` 28 (wycofana) · `corporate` 30 · `partner` 40 ·
`partner_general` 50 · `presidents_circle` 60.

### 2.1 Pełna lista planów płatnych w `access_plans` (to, co realnie idzie do operatora płatności)

| Plan                              | Interwał    | Cena               | `tier_key`     | Uwagi                                                                                                                                                                  |
| --------------------------------- | ----------- | ------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plus — miesięcznie                | `month`     | 59,00 zł           | `member`       |                                                                                                                                                                        |
| Plus — rocznie                    | `year`      | 590,00 zł          | `member`       | oszczędność 16,7 % wobec 12 × 59 zł                                                                                                                                    |
| Pro — miesięcznie                 | `month`     | 129,00 zł          | `pro`          |                                                                                                                                                                        |
| Pro — rocznie                     | `year`      | 1 290,00 zł        | `pro`          | oszczędność 16,7 % wobec 12 × 129 zł                                                                                                                                   |
| Student i Doktorant — miesięcznie | `month`     | 19,00 zł           | `student`      | brak wariantu rocznego w bazie                                                                                                                                         |
| Kadra Akademicka — miesięcznie    | `month`     | 29,00 zł           | `educator`     | brak wariantu rocznego w bazie                                                                                                                                         |
| Zespół — za miejsce, miesięcznie  | `month`     | 99,00 zł / miejsce | `team`         | próg wolumenowy: `volume_threshold_seats = 11`, `volume_price_cents = 7900` → **79 zł za każde miejsce w zamówieniu** od 11. miejsca (`tiers_mode volume` u operatora) |
| Partner Biznesowy — co 2 tygodnie | `two_weeks` | 590,00 zł          | `business`     | próg wycofany (§13.4)                                                                                                                                                  |
| Partner Biznesowy — miesięcznie   | `month`     | 990,00 zł          | `business`     | próg wycofany                                                                                                                                                          |
| Partner Biznesowy — kwartalnie    | `quarter`   | 2 490,00 zł        | `business`     | próg wycofany                                                                                                                                                          |
| Decision Lab — miejsce w cyklu    | `one_time`  | 16 000,00 zł       | `decision_lab` | produkt jednorazowy, nie nadaje rangi                                                                                                                                  |

Progi `vip`, `corporate`, `partner`, `partner_general`, `presidents_circle` i `ngo` **nie mają
wiersza w `access_plans`** — są sprzedawane w rozmowie i nadawane przez `membership_grants`
albo `member_organizations`.

---

## 3. Segment „Dla Ciebie" (`individual`)

### 3.1 Czytelnik / Essential — `reader`, ranga 0, **0 zł**

Konto w ekosystemie NES. Bez karty płatniczej, bez zobowiązania.
Benefitem tego progu nie jest liczba artykułów, tylko konto.

| Benefit                                                           | Status | Punkt egzekwowania                                                                          |
| ----------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| Konto NES: obserwowane tematy, zapisane analizy, historia lektury | `B`    | `user_bookmarks`, `user_follows`                                                            |
| 0 analiz bez konta, 5 analiz miesięcznie po rejestracji           | `B`    | `metering_settings`: `enabled = true`, `anon_monthly_limit = 0`, `member_monthly_limit = 5` |
| Policy papers we fragmentach z kluczowymi wnioskami               | `B`    | `has_content_access`                                                                        |
| Cotygodniowy przegląd geopolityczny: 52 wydania rocznie           | `B`    | newsletter, podwójna zgoda                                                                  |
| 3 pytania do archiwum miesięcznie                                 | `N`    | warstwa odpowiedzi — funkcja nie istnieje                                                   |
| Otwarte dyskusje społeczności                                     | `B`    | RLS komentarzy                                                                              |
| Wydarzenia                                                        | —      | zaproszenia na wydarzenia otwarte, bez wstępu na członkowskie                               |
| Kluby dyskusyjne                                                  | —      | widzi katalog, panel zaproszenia do członkostwa                                             |
| Korespondencja z ekspertami                                       | —      | brak                                                                                        |

**Flagi `features`:** `{}` — próg nie niesie żadnej flagi. `early_access` została z niego zdjęta
migracją `20260822093000`; flagi czatu są usuwane defensywnie (`seed_chat_tier_flags`).

**Rozstrzygnięcie otwarte:** jedna darmowa analiza bez konta. Decyzja: **zostaje zero**, dopóki
pomiar ruchu z wyszukiwarki nie wykaże realnego kosztu SEO.

### 3.2 Członek / Plus — `member`, ranga 10, **39 zł/mies. lub 390 zł/rok** (katalog) · **59 zł / 590 zł** (baza)

Pełne archiwum, wszystkie wydarzenia członkowskie i jedno wydarzenie biletowane w roku.
Zniżka procentowa zniknęła z tego progu: zniżka jest obietnicą warunkową, którą członek musi
aktywować, a przy odnowieniu nie ma jej w bilansie, jeżeli nie została użyta. Wliczony bilet ma tę
samą wartość księgową i nieporównanie wyższą wartość w momencie decyzji o przedłużeniu.

| Benefit                                                                                   | Status | Punkt egzekwowania                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Pełne archiwum analiz i policy papers, bez limitu                                         | `B`    | `has_content_access`                                                                                                                     |
| Wszystkie briefingi członkowskie online w roku, wraz z nagraniami                         | `B`    | `rsvp_event`, `get_event_access`                                                                                                         |
| **1 wliczony bilet rocznie** na wydarzenie biletowane, w tym „Geopolityczna Gra Mocarstw" | `B`    | `features.included_event_tickets = 1`, `my_ticket_allowance`, `claim_included_event_ticket`, `plan_ticket_claims`; bramka w `rsvp_event` |
| Pogłębiony digest członkowski: **44 wydania rocznie**                                     | `P`    | cykl redakcyjny — tygodniowo poza sierpniem i przełomem roku                                                                             |
| **1 zapytanie do eksperta miesięcznie**                                                   | `B`    | `my_expert_request_quota`, flaga `chat_inmail_quota_2` obniżona do 1                                                                     |
| 20 pytań do archiwum miesięcznie                                                          | `N`    | warstwa odpowiedzi — funkcja nie istnieje                                                                                                |
| Czat i wiadomości z innymi członkami                                                      | `B`    | `get_or_create_direct_conversation`, flaga `chat_enabled`                                                                                |
| Kluby: obserwator w jednym klubie otwartym                                                | `B`    | `CLUB_OBSERVER_TIER_RANK = 10` (`hubAccess`), `clubs.min_tier_rank` per klub                                                             |
| Narzędzia cytowania: Chicago, APA, BibTeX                                                 | `B`    | komponent cytowań                                                                                                                        |
| Panel „Analiza Tygodnia": mapy, wykresy, dane                                             | `B`    | treść bramkowana rangą                                                                                                                   |
| Podcast „Depesza Dyplomaty" w całości, wywiady i materiały wideo                          | `B`    | treść bramkowana rangą                                                                                                                   |
| Rezygnacja w każdej chwili, bez okresu wypowiedzenia                                      | `B`    | `changeSubscriptionPlan`                                                                                                                 |

**Flagi `features`:** `events_members`, `recordings`, `member_library`, `premium_content`,
`chat_enabled`, `chat_inmail_quota_2`, `expert_request_quota = 1`, `included_event_tickets = 1`.
**Bez `early_access`** — wczesny dostęp przeniesiony na próg Pro (`20260822093000`).

### 3.3 Członek Pro / Pro — `pro`, ranga 20, **119 zł/mies. lub 1 190 zł/rok** (katalog) · **129 zł / 1 290 zł** (baza)

Klub dyskusyjny, monitoring regulacyjny i cztery zamknięte briefingi w roku. Klub jest głównym
argumentem tego progu, ale członkostwo w klubie nie ma wartości bez zaprojektowanego pierwszego
tygodnia — dlatego onboarding jest pozycją katalogową z terminem w godzinach.

| Benefit                                                                                                                 | Status | Punkt egzekwowania                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| Wszystko z progu Członek, **w tym ten sam jeden bilet rocznie — nie drugi**                                             | `B`    | dziedziczenie rangi; pula liczy **MAKSIMUM** z warstw, nie sumę (`my_ticket_allowance`)                                 |
| Kluby: pełne członkostwo w jednym klubie do wyboru                                                                      | `B`    | `club_list`, `CLUB_TIER_RANK = 20`, `club_members`                                                                      |
| Onboarding klubowy: przypisanie w **48 godzin** od zakupu, imienne powitanie w wątku, pytanie otwierające od moderatora | `P`    | mierzone odsetkiem członków aktywnych w pierwszych 14 dniach                                                            |
| Kluby: wątki, dokumenty, ankiety, kalendarz klubu                                                                       | `B`    | RLS `club_threads`, `club_documents`, `club_thread_polls`                                                               |
| **4 zamknięte briefingi Pro rocznie**: marzec, czerwiec, wrzesień, grudzień                                             | `B`    | flaga `pro_briefings`, `get_event_access`                                                                               |
| **4 noty foresightowe rocznie**, publikowane w ostatnim tygodniu kwartału                                               | `P`    | cykl wydawniczy z datami w kalendarzu redakcyjnym                                                                       |
| **3 zapytania do eksperta miesięcznie**                                                                                 | `B`    | `my_expert_request_quota`, flaga `chat_inmail_quota_5` obniżona do 3                                                    |
| Pytania do archiwum bez limitu                                                                                          | `N`    | warstwa odpowiedzi — funkcja nie istnieje                                                                               |
| Monitoring regulacyjny: tracker legislacyjny UE z alertami                                                              | `B`    | RLS `eu_policy_follows` (flaga `regulatory_monitoring`)                                                                 |
| Priorytet pytań w sesjach Q&A z ekspertami                                                                              | `B`    | `list_qa_questions` (flaga `qa_priority`)                                                                               |
| Linki podarunkowe: **3 pełne analizy miesięcznie** dla osób spoza platformy                                             | `B`    | `can_gift_articles`, `create_gift_link` (flaga `gift_links`)                                                            |
| Wczesny dostęp do raportów: **72 godziny** przed publikacją otwartą                                                     | `B`    | polityka „Early access reads scheduled posts" na `posts.publish_at`, okno `early_access_window()`, flaga `early_access` |
| Spotkania prowadzone w **regule Chatham House**                                                                         | `B`    | `events.chatham_house` + flaga `chatham_house_events` (`rsvp_event`, `get_event_access`)                                |
| Wydarzenia o ograniczonej liczbie miejsc, z kolejką rezerwową                                                           | `B`    | `events.capacity`, `rsvp_event` (degradacja do waitlist), `assertSeatAvailable`                                         |

**Flagi `features`:** `events_members`, `recordings`, `member_library`, `premium_content`,
`qa_priority`, `pro_briefings`, `working_groups`, `regulatory_monitoring`, `gift_links`,
`early_access`, `chatham_house_events`, `chat_enabled`, `chat_inmail_quota_5`,
`expert_request_quota = 3`, `included_event_tickets = 1`.

**Komunikacja karty:** na `/pricing` różnicę wobec progu Członek komunikują **trzy** pozycje — klub
dyskusyjny, monitoring regulacyjny, cztery zamknięte briefingi. Pozostałe dziewięć trafia do
rozwijanej listy szczegółowej: fence zbudowany z dwunastu elementów nie jest czytelny.

### 3.4 Rada Instytutu / VIP — `vip`, ranga 25, **od 6 000 zł/rok** (rozmowa)

Dwa Decision Laby, Zjazd Rady i prawo głosu wobec rekomendacji przed publikacją.

| Benefit                                                                                                                                                | Status | Punkt egzekwowania                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------ |
| Wszystko z progu Członek Pro                                                                                                                           | `B`    | dziedziczenie rangi                                                      |
| **2 Decision Laby rocznie** w roli obserwatora                                                                                                         | `B`    | `club_events.min_tier_rank = 25` (`club_events_list`, `club_event_rsvp`) |
| **Zjazd Rady raz w roku** oraz **2 kolacje eksperckie**                                                                                                | `P`    | kalendarz konwenignu, trzy pozycje w roku                                |
| Sounding board: rekomendacje udostępniane **10 dni roboczych** przed publikacją, z prawem komentarza                                                   | `P`    | rejestr komentarzy, procedura programowa                                 |
| Zgłoszenie tematu badawczego: nabór **do 30 września**, rozstrzygnięcie rady programowej **do 31 października**, jeden temat rocznie wchodzi do agendy | `P`    | procedura z terminami                                                    |
| Korespondencja z ekspertami **bez limitu**, kanałem bezpośrednim                                                                                       | `B`    | flaga `chat_direct_gated`                                                |
| Kluby: członkostwo we wszystkich klubach otwartych dla Rady                                                                                            | `B`    | `clubs.min_tier_rank = 25`                                               |
| **4 godziny konsultacji analitycznych rocznie**, jednostka 30 minut, reakcja 5 dni roboczych                                                           | `P`    | rejestr godzin; niewykorzystane nie przechodzą na kolejny rok            |
| Osobisty opiekun i onboarding **w 7 dni** od przystąpienia                                                                                             | `P`    | obsługa relacyjna                                                        |

**Flagi `features`:** zakres Pro + `vip_concierge`, `chat_direct_gated`, `included_event_tickets = 1`.

**Granica wpływu (treść wiążąca, do umieszczenia w katalogu i umowie wzorcowej):** komentarz członka
Rady do rekomendacji jest rejestrowany i rozpatrywany przez zespół badawczy. **Nie daje prawa do
zmiany treści, usunięcia wniosku ani wstrzymania publikacji.** Autorstwo, metodyka i wnioski
pozostają wyłączną kompetencją NES. Zgłoszenie tematu badawczego jest wnioskiem, nie zleceniem:
rada programowa rozstrzyga o przyjęciu i może odmówić bez uzasadnienia.

### 3.5 Wspierający — `supporter`, ranga 5 _(próg wycofany)_

Darowizna **nie jest progiem członkostwa i nie daje pakietu benefitów** — od wdrożenia v6.2 pasek
darowizny na `/pricing` jest bezwarunkowy i prowadzi na własną ścieżkę wpłat (`SupporterStrip.tsx`),
niezależnie od tego, czy wiersz progu istnieje w bazie. Historyczny zakres wiersza: aktualizacje dla
wspierających (`supporter_updates`, flaga dekoracyjna) i status wspierającego przez 12 miesięcy od
darowizny.

---

## 4. Segment „Program Akademicki" (`academic`)

Wspólne dla stawek ulgowych (`student`, `educator`):

- **ten sam zakres treściowy co próg Członek**, ale **zamiast wliczonego biletu — zniżka 50 %** na
  wydarzenia biletowane `B` (`features.event_ticket_discount_pct = 50`). Powód jest arytmetyczny, nie
  uznaniowy: przy składce studenckiej 190 zł rocznie bilet o cenie katalogowej 300 zł to sprzedaż
  poniżej kosztu krańcowego uczestnictwa, a student jest jednocześnie grupą, która skorzysta z niego
  najchętniej.
- **weryfikacja jest AUTOMATYCZNA** tam, gdzie domena uczelni figuruje na liście
  `verification_domains` z oznaczeniem akademickim `B` (`my_academic_domain_verification`,
  `verification_domains.academic = true`). Legitymacja albo dokument afiliacyjny to **wyjątek dla
  domen spoza listy**, nie reguła.

### 4.1 Stawka studencka — `student`, ranga 10, **19 zł/mies.** (190 zł/rok wg katalogu)

Pełny zakres progu Członek w cenie studenckiej, z weryfikacją raz w roku.

| Benefit                                                                                         | Status | Punkt egzekwowania                                               |
| ----------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------- |
| Pełny zakres progu Członek, bez limitów, na komputerze i telefonie                              | `B`    | ranga 10, `has_content_access`                                   |
| Wszystkie briefingi członkowskie online wraz z nagraniami                                       | `B`    | `rsvp_event`, `get_event_access`                                 |
| **Zniżka 50 % na wydarzenia biletowane**, zamiast biletu wliczonego                             | `B`    | `features.event_ticket_discount_pct = 50`, `my_ticket_allowance` |
| Cotygodniowy przegląd i pogłębiony digest członkowski                                           | `P`    | cykl redakcyjny: 52 + 44 wydania rocznie                         |
| Dostęp do materiałów edukacyjnych NES, w tym EuroChallenge                                      | `B`    | treść bramkowana rangą                                           |
| Czat i wiadomości z innymi członkami                                                            | `B`    | flaga `chat_enabled`                                             |
| Weryfikacja automatyczna adresem w domenie uczelni; legitymacja wyłącznie dla domen spoza listy | `B`    | `my_academic_domain_verification`                                |

**Flagi `features`:** `events_members`, `recordings`, `member_library`, `premium_content`,
`chat_enabled`, `event_ticket_discount_pct = 50`. Bez `early_access`, bez `included_event_tickets`.

### 4.2 Kadra akademicka — `educator`, ranga 10, **29 zł/mies.** (290 zł/rok wg katalogu)

Dla wykładowców i pracowników naukowych — z licencją dydaktyczną i prawem cytowania.

| Benefit                                                                                                  | Status | Punkt egzekwowania                                                                             |
| -------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| **Wszystko ze stawki studenckiej**, oraz:                                                                | `B`    | ta sama ranga 10                                                                               |
| Materiały dydaktyczne: kluczowe wnioski i słowniczek pojęć przy analizach                                | `B`    | treść bramkowana rangą                                                                         |
| **Licencja do wykorzystania treści na zajęciach**                                                        | `P`    | licencja umowna, flaga `teaching_licence` (dekoracyjna — nie ma bramki i nie powinna jej mieć) |
| **Prawo cytowania analiz w publikacjach naukowych**                                                      | `P`    | licencja umowna                                                                                |
| Zniżka 50 % na wydarzenia biletowane, zamiast biletu wliczonego                                          | `B`    | `features.event_ticket_discount_pct = 50`                                                      |
| Priorytetowe zaproszenia na seminaria akademickie NES                                                    | `P`    | kalendarz konwenignu                                                                           |
| Weryfikacja automatyczna adresem w domenie uczelni; dokument afiliacyjny wyłącznie dla domen spoza listy | `B`    | `my_academic_domain_verification`                                                              |

**Flagi `features`:** jak `student` + `teaching_licence`.

### 4.3 Organizacja non-profit — `ngo`, ranga 20, **stawka preferencyjna, na fakturę**

Zakres progu Pro dla małego zespołu organizacji pozarządowej lub think-tanku non-profit.
Katalog v6.2 wycenia to jako **stawkę preferencyjną minus 50 %** wobec progu Partner Instytucjonalny,
po weryfikacji KRS lub statutu.

| Benefit                                                          | Status | Punkt egzekwowania                                    |
| ---------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| Zakres progu Członek Pro dla małego zespołu                      | `B`    | ranga 20                                              |
| **3 zapytania do eksperta miesięcznie**                          | `B`    | `expert_request_quota = 3`, `my_expert_request_quota` |
| Monitoring regulacyjny (tracker UE z alertami)                   | `B`    | RLS `eu_policy_follows`                               |
| Wczesny dostęp 72 h, reguła Chatham House, wydarzenia limitowane | `B`    | `early_access`, `chatham_house_events`                |
| **1 wliczony bilet rocznie**                                     | `B`    | `included_event_tickets = 1`                          |
| Wspólna biblioteka i archiwum dla organizacji                    | `B`    | `member_resources`                                    |
| Faktura wystawiana na organizację                                | `B`    | `billing_documents`                                   |
| Wyróżnienie jako partner misyjny NES                             | `P`    | obsługa redakcyjna                                    |
| Weryfikacja na podstawie KRS lub statutu                         | `P`    | procedura weryfikacji                                 |

**Flagi `features`:** `events_members`, `recordings`, `member_library`, `premium_content`,
`qa_priority`, `pro_briefings`, `working_groups`, `corporate_seats`, `regulatory_monitoring`,
`gift_links`, `early_access`, `chatham_house_events`, `chat_enabled`,
`expert_request_quota = 3`, `included_event_tickets = 1`.

---

## 5. Segment „Dla zespołów" (`team`)

### 5.1 Zespół — `team`, ranga 25, **89 zł/mies. za miejsce, 3–20 miejsc** (katalog) · **99 zł/miejsce** (baza)

Pełny zakres Pro dla każdego miejsca, jedna faktura, wspólne wejście do klubów. Rabat nie jest
argumentem za tym progiem, tylko jego skutkiem — argumentem jest to, że zespół wchodzi do klubów
razem i w jednym terminie.

| Benefit                                                                             | Status | Punkt egzekwowania                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pełny zakres Członka Pro dla **każdego miejsca**                                    | `B`    | `organization_seats`, ranga per miejsce                                                                                                                                                      |
| Onboarding zespołowy: przypisanie wszystkich miejsc do klubów **w 7 dni** od zakupu | `P`    | mierzone odsetkiem miejsc aktywnych w pierwszych 14 dniach                                                                                                                                   |
| **3 wliczone bilety rocznie na organizację**, niezależnie od liczby miejsc          | `B`    | `features.included_event_tickets_org = 3`, pula wspólna liczona per organizacja, kolejność zgłoszeń                                                                                          |
| **Wejścia rangi 25**: kluby i treści otwarte dla Rady Instytutu                     | `B`    | `membership_tiers.rank = 25` dla progu `team`                                                                                                                                                |
| Korespondencja z ekspertami: **3 zapytania miesięcznie na miejsce**                 | `B`    | `my_expert_request_quota` per użytkownik                                                                                                                                                     |
| Kluby: jedno członkostwo klubowe na miejsce                                         | `B`    | `club_members`, ranga miejsca                                                                                                                                                                |
| Panel miejsc: zapraszanie, odbieranie, przenoszenie między osobami                  | `B`    | `member_organizations`, `organization_seats`, `org_add_seat`                                                                                                                                 |
| Wspólna biblioteka i archiwum organizacji                                           | `B`    | `member_resources`                                                                                                                                                                           |
| Jedna zbiorcza faktura dla całego zespołu                                           | `B`    | `billing_documents`                                                                                                                                                                          |
| **Rabat wolumenowy od 11 miejsc: 79 zł za miejsce**                                 | `B`    | `access_plans.volume_threshold_seats = 11` / `volume_price_cents = 7900`; cena schodkowa u operatora (`tiers_mode volume`) — obejmuje **wszystkie** miejsca w zamówieniu, nie tylko nadwyżkę |

**Flagi `features`:** zakres Pro + `corporate_seats`, `chat_direct_gated`,
`included_event_tickets_org = 3`.

**Korekta wobec v6.1 (bilet na organizację, nie na miejsce):** v6.1 dawała jeden bilet rocznie na
KAŻDE miejsce. Przy dwudziestu miejscach po 89 zł przychód roczny wynosi 21 360 zł, a ekspozycja to
dwadzieścia biletów — 6 000 zł przy bilecie za 300 zł (28 % przychodu progu) i 10 000 zł przy 500 zł,
blisko połowy. Pula jest więc organizacyjna: **trzy bilety rocznie**, konsumowane w kolejności zgłoszeń.

**Ranga Zespołu — rozstrzygnięcie zamknięte:** zostaje 25. Zejście do 20 zgadzałoby się z hasłem
„pełny zakres Pro", ale zabrałoby miejscom zespołowym kluby i treści bramkowane rangą 25.

---

## 6. Segment „Dla firm" / Instytucje (`business`)

Strona `/partnerstwo`, bez cen na karcie. Zmiana konstrukcyjna wobec v6: **wycena alternatywna** —
partner widzi, ile zapłaciłby za te same rzeczy osobno (wzorzec ECRI/CEPS, gdzie grupa zadaniowa dla
podmiotu spoza członkostwa jest wyceniona na 5 000 EUR).

### 6.1 Enterprise — `corporate`, ranga 30 _(w bazie; katalog v6.2 tego progu nie wymienia — §12.3)_

Pula miejsc Pro dla organizacji, wspólna biblioteka i opiekun wdrożenia.

| Benefit                                                                       | Status    | Punkt egzekwowania                                                            |
| ----------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------- |
| Pula miejsc z pełnym zakresem Pro dla każdego użytkownika                     | `B`       | `member_organizations`, `organization_seats`                                  |
| Wspólna biblioteka materiałów i archiwum dla organizacji                      | `B`       | `member_resources`                                                            |
| Kwartalny briefing dla organizacji                                            | `P`       | kalendarz konwenignu                                                          |
| Panel administracyjny do zarządzania miejscami i uprawnieniami                | `B`       | `org_add_seat`, RLS `is_org_owner`                                            |
| Faktura i umowa roczna z opiekunem wdrożenia                                  | `B` / `P` | `billing_documents` + obsługa relacyjna                                       |
| Korespondencja bezpośrednia z ekspertami                                      | `B`       | flaga `chat_direct_gated`                                                     |
| **1 wliczony bilet rocznie** (na osobę nominowaną)                            | `B`       | `included_event_tickets = 1`                                                  |
| Wczesny dostęp 72 h, Chatham House, monitoring regulacyjny, linki podarunkowe | `B`       | `early_access`, `chatham_house_events`, `regulatory_monitoring`, `gift_links` |

### 6.2 Partner Instytucjonalny / Strategic Partner — `partner`, ranga 40, **od 24 000 zł/rok**

| Benefit                                                                                                                                    | Status        | Punkt egzekwowania                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------- |
| **Do 10 osób nominowanych** z pełnym zakresem Pro                                                                                          | `B`           | `member_organizations`, ranga 40 per miejsce                                     |
| **1 Decision Lab rocznie z dwoma miejscami** dla osób nominowanych — cena dla podmiotu spoza partnerstwa: **16 000 zł za miejsce w cyklu** | `B` (korekta) | `access_plans.tier_key = decision_lab`, produkt jednorazowy w katalogu operatora |
| Sounding board dla osób nominowanych, na zasadach identycznych jak dla Rady, z tą samą granicą wpływu                                      | `P` (nowe)    | procedura programowa, 10 dni roboczych przed publikacją                          |
| **4 briefingi zamknięte** dla organizacji w roku                                                                                           | `P`           | kalendarz konwenignu, kwartalnie                                                 |
| Wszystkie kluby dyskusyjne dla osób nominowanych                                                                                           | `B`           | `clubs.min_tier_rank = 40`                                                       |
| Korespondencja z ekspertami **bez limitu** dla osób nominowanych                                                                           | `B`           | flaga `chat_direct_gated`                                                        |
| **8 godzin konsultacji analitycznych rocznie**, jednostka 30 minut, reakcja 5 dni roboczych                                                | `P`           | rejestr godzin                                                                   |
| Faktura, umowa roczna, opiekun wdrożenia                                                                                                   | `B` / `P`     | `billing_documents` + obsługa relacyjna                                          |
| Organizacje pozarządowe i think-tanki non-profit: **stawka preferencyjna minus 50 %** po weryfikacji KRS lub statutu                       | `P`           | procedura weryfikacji (próg `ngo`)                                               |

**Flagi `features`:** zakres Pro + `corporate_seats`, `strategic_partner`, `chat_direct_gated`,
`included_event_tickets = 1`.

### 6.3 Partner Strategiczny / Partner Generalny — `partner_general`, ranga 50, **od 60 000 zł/rok**

**Wszystko z progu Partner Instytucjonalny**, a ponadto:

| Benefit                                                                                                               | Status        | Punkt egzekwowania                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Do 25 osób nominowanych**, bez dopłaty za miejsce                                                                   | `B`           | `member_organizations`, ranga 50                                                                                                                                |
| **1 własna grupa zadaniowa rocznie**: cykl **4 spotkań** zakończony raportem sygnowanym wspólnie przez NES i partnera | `P` (nowe)    | cykl uzgadniany indywidualnie                                                                                                                                   |
| **2 dedykowane briefingi** szyte na miarę w roku                                                                      | `P`           | terminy uzgadniane                                                                                                                                              |
| **20 godzin dostępu do analityka rocznie**                                                                            | `P`           | rejestr godzin                                                                                                                                                  |
| **Prywatny mikroserwis klubowy** dla organizacji                                                                      | `B` (korekta) | `CLUB_MINISITE_TIER_RANK = TIER_RANKS.partner_general` (50); do 22.08 stała wskazywała rangę 20, więc funkcja sprzedawana w tym progu przysługiwała każdemu Pro |
| **1 slot prelegencki** na konferencji NES w roku                                                                      | `P`           | konferencja roczna                                                                                                                                              |
| **2 kolacje eksperckie** na poziomie zarządu w roku                                                                   | `P`           | wiosna, jesień                                                                                                                                                  |

**Flagi `features`:** jak `partner` + `general_partner`.

### 6.4 Krąg Założycieli / President's Circle — `presidents_circle`, ranga 60, **od 120 000 zł/rok, na zaproszenie**

Karta bez ceny i bez przycisku (`cta_mode = 'none'`).

| Benefit                                                           | Status | Punkt egzekwowania               |
| ----------------------------------------------------------------- | ------ | -------------------------------- |
| **Bez limitu osób**                                               | `B`    | `member_organizations`, ranga 60 |
| Dedykowany analityk prowadzący                                    | `P`    | obsługa relacyjna                |
| Współsygnowane badania i publikacje                               | `P`    | procedura wydawnicza             |
| Miejsce w panelu recenzenckim publikacji                          | `P`    | procedura wydawnicza             |
| Udział w **dorocznym posiedzeniu agendy strategicznej** instytutu | `P`    | IV kwartał                       |

**Granica wpływu na agendę:** fundatorzy zgłaszają obszary i priorytety badawcze na dorocznym
posiedzeniu. **Wybór tematów, metodyka i wnioski pozostają wyłączną kompetencją zespołu badawczego i
rady programowej.** Żaden fundator nie ma wglądu w tekst przed publikacją poza trybem sounding
board, który sam w sobie nie daje prawa do zmiany treści. Zapis obowiązuje niezależnie od wysokości
składki i nie podlega negocjacji w umowie indywidualnej.

**Jawność finansowania nie jest benefitem.** Wymienienie partnera na liście finansujących nie jest
korzyścią z tytułu składki, tylko wymogiem jawności; lista jest publikowana niezależnie od woli
partnera. W v6 pozycja figurowała w katalogu jako benefit — usunięcie jej stamtąd podnosi
wiarygodność oferty u odbiorcy instytucjonalnego.

### 6.5 Partner Biznesowy — `business`, ranga 28 _(próg wycofany)_

Samoobsługowa subskrypcja dla firm w trzech cyklach: **590 zł / 2 tygodnie**, **990 zł / miesiąc**,
**2 490 zł / kwartał**. Zakres: pełny Pro dla konta firmowego, cykliczny briefing sektorowy, status
partnera biznesowego, zaproszenia na wydarzenia i wybrane Decision Labs.

Ranga 28 została **przemapowana na 30** migracją `20260822090000` (kluby, wydarzenia, reguły treści i
zasoby biblioteki) — bez zmiany dostępu dla kogokolwiek. **Nie wprowadzać rangi 28 ponownie.**

---

## 7. Produkt jednorazowy: Decision Lab

| Pozycja      | Wartość                                                                                                                                                                                                                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cena         | **16 000 zł** jednorazowo (interwał `one_time`)                                                                                                                                                                                                                                                                                    |
| Uzasadnienie | trzy czwarte odpowiednika ECRI/CEPS: 5 000 EUR × 4,3122 zł/EUR = 21 561 zł; 16 000 / 21 561 = 74,2 % (v6.1 podawała 12 000 zł = 55,7 % — korekta arytmetyczna audytu)                                                                                                                                                              |
| Zakres       | jedno miejsce w pełnym cyklu Decision Lab — **cztery zamknięte sesje robocze**; raport końcowy z rekomendacjami dla organizacji; praca w gronie analityków, praktyków i decydentów prowadzona przez ekspertów NES; materiały robocze, notatki i nagrania z każdej sesji; faktura na organizację, zakup jednorazowy bez subskrypcji |
| Ważne        | `tier_key = 'decision_lab'` to **wpis techniczny** mostka plan → warstwa: `rank = 0`, `features = {}`, `active = false`, `cta_mode = 'none'`. **Zakup miejsca w cyklu nie nadaje żadnej rangi w drabince.** Partnerzy instytucjonalni mają miejsca wliczone w składkę.                                                             |

---

## 8. Macierz przekrojowa: kluby, korespondencja z ekspertami, pytania do archiwum

Tych trzech rzeczy nie da się odtworzyć newsletterem ani modelem ogólnym — dlatego one, a nie
archiwum, niosą różnicowanie progów.

| Próg                    | Kluby dyskusyjne                                                          | Korespondencja z ekspertami         | Pytania do archiwum |
| ----------------------- | ------------------------------------------------------------------------- | ----------------------------------- | ------------------- |
| Czytelnik               | katalog widoczny, wejście zablokowane                                     | brak                                | 3 miesięcznie       |
| Członek                 | obserwator w jednym klubie otwartym                                       | 1 zapytanie miesięcznie             | 20 miesięcznie      |
| Członek Pro             | pełne członkostwo w jednym klubie, onboarding w 48 h                      | 3 zapytania miesięcznie             | bez limitu          |
| Rada Instytutu          | wszystkie kluby otwarte dla Rady, 2 Decision Laby rocznie jako obserwator | kanał bezpośredni, bez limitu       | bez limitu          |
| Zespół                  | jedno członkostwo na miejsce, onboarding zespołowy w 7 dni                | 3 zapytania miesięcznie na miejsce  | bez limitu          |
| Partner Instytucjonalny | wszystkie kluby dla nominowanych, 1 Decision Lab z dwoma miejscami        | bez limitu dla nominowanych         | bez limitu          |
| Partner Strategiczny    | prywatny mikroserwis klubowy, 1 własna grupa zadaniowa rocznie            | bez limitu plus 20 godzin analityka | bez limitu          |
| Krąg Założycieli        | udział w kształtowaniu agendy klubów (w granicach z §6.4)                 | dedykowany analityk prowadzący      | bez limitu          |

Kolumna „pytania do archiwum" to **jedyne trzy pozycje `N`** całego katalogu: warstwa odpowiedzi na
własnym archiwum nie istnieje i wymaga istotnej pracy inżynierskiej.

**Mechanika do zachowania przy migracji:** bramka klubowa jest miękka na liście i twarda w bazie.
Osoba, której wygasło członkostwo, ale która należy do klubu, widzi swój klub, a nie cennik
(`resolveClubHubAccess`: członkostwo bije plan). Nie zmieniać.

**Pełny rozkład tego, co daje sama przynależność do klubu — role, ścieżki wejścia, dorobek, sieć
ludzi i moderacja — jest w §9.** Tam też, w §9.7, benefity klubowe, które istnieją w platformie, ale
których katalog dziś nie sprzedaje.

---

## 9. Kluby dyskusyjne i przynależność

Sekcja rozstrzyga to, czego katalog v6.2 nie rozstrzyga: **co dokładnie kupuje się razem z klubem**.
Katalog wymienia klub trzema wierszami (obserwator, pełne członkostwo, onboarding), a platforma ma
pod nim moduł zbudowany w 38 migracjach. Dlatego sekcja jest **rozdzielona na dwie części** i granica
jest twarda:

- **§9.1–§9.6 — benefity udokumentowane.** Każda pozycja ma punkt egzekwowania w kodzie albo bazie.
  Cytat z katalogu albo odczyt z repozytorium; nic tu nie jest moim sformułowaniem.
- **§9.7 — benefity SFORMUŁOWANE PRZEZE MNIE.** Funkcje istnieją i są zabramkowane, ale **katalog ich
  nie sprzedaje** — nie ma dla nich ani wiersza copy, ani przypisania do progu. Propozycje są
  oznaczone `[PROPOZYCJA]` i wymagają decyzji redakcyjnej przed wpisaniem do cennika.

### 9.1 Jak się wchodzi do klubu i co znaczy status

Klub ma **dwie niezależne osie**: widoczność (`clubs.visibility`) i politykę wstępu
(`clubs.join_policy`). Klub `public + invite` to publiczna wizytówka zamkniętego grona — kombinacja
poprawna i częsta, której model jednoosiowy by nie wyraził.

| Wymiar             | Wartości                                                | Znaczenie dla członka                                                           |
| ------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Widoczność         | `public` · `members` · `private` · `secret`             | kto w ogóle widzi, że klub istnieje i co w nim napisano                         |
| Polityka wstępu    | `open` · `request` · `invite`                           | wchodzi się samodzielnie / przez zgłoszenie / wyłącznie z imiennego zaproszenia |
| Próg planu         | `clubs.min_tier_rank` ∈ {0, 10, 20, 25, 30, 40, 50, 60} | od której rangi plan w ogóle obejmuje ten klub                                  |
| Atrybucja          | `attributed` · `chatham` · `anonymous_allowed`          | czy pod wpisem stoi nazwisko, czy rygor Chatham House                           |
| Kto zakłada tematy | `members` · `moderators` · `staff_only`                 | czy członek prowadzi własne wątki, czy odpowiada w cudzych                      |
| Tryb moderacji     | `post` · `pre` · `trusted`                              | czy wpis idzie na tablicę od razu, czy po zatwierdzeniu                         |

**Trzy ścieżki wejścia** (`B`):

| Ścieżka   | Jak działa                                                                                                                                                                                                                                                                                     | Punkt egzekwowania                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `open`    | wejście samodzielne w granicach progu planu                                                                                                                                                                                                                                                    | `club_capabilities`, `clubs.min_tier_rank`                                                                     |
| `request` | **zgłoszenie z profilem zawodowym** — 22 pola (stanowisko, seniority, branża, doświadczenie w latach, kompetencje, języki, specjalizacja, motywacja, cele, wkład, dostępność, źródło polecenia, zgoda). Komisja rozpatruje bez rozmowy wstępnej, dlatego formularz jest dłuższy niż kontaktowy | `club_apply_submit`, walidacja `applyValidation.ts`, panel „Zgłoszenia" (`admin.community.clubs.applications`) |
| `invite`  | **imienne zaproszenie z tokenem** (`/club/join/:token`); cykl życia: `pending` → `accepted` / `declined` / `expired` / `revoked`; osobno zaproszenia segmentowe dla całych grup odbiorców                                                                                                      | `club_invitations` (A2), zaproszenia segmentowe (A27)                                                          |

**Status członkostwa** (`club_members.status`): `active` · `pending` · `invited` · `banned` · `left`.

**Kluczowy benefit przynależności, którego katalog nie nazywa (patrz §9.7):**
**członkostwo bije plan.** Osoba, której wygasła subskrypcja, ale która należy do klubu, widzi swój
klub, a nie cennik — `resolveClubHubAccess` i `resolveClubMinisiteAccess` rozstrzygają członkostwo i
zaproszenie **przed** rangą planu. Bramka na liście jest miękka (dokłada panel z zachętą i **nie
zabiera ani jednego wiersza**), twarda siedzi w `club_capabilities` w bazie.

### 9.2 Głos w dyskusji: co wolno której roli

Role klubowe: **`lead`** (prowadzi klub) · **`moderator`** · **`member`** · **`observer`**.
Autoryzację rozstrzyga **wyłącznie** `public.club_capabilities()`; macierz w
`src/lib/clubs/capabilityMatrix.ts` jest dokumentacją zachowania bazy, nie jego źródłem.

| Zdolność                                | `lead`                                         | `moderator` | `member`                   | `observer`                                  | nie-członek             |
| --------------------------------------- | ---------------------------------------------- | ----------- | -------------------------- | ------------------------------------------- | ----------------------- |
| Czytanie (`can_read`)                   | tak                                            | tak         | tak                        | **tak**                                     | zależnie od widoczności |
| Założenie tematu (`can_post_thread`)    | tak                                            | tak         | zależnie od `who_can_post` | **nie** (obserwator jest z definicji cichy) | nie                     |
| Odpowiedź (`can_reply`)                 | tak                                            | tak         | tak                        | **nie**                                     | nie                     |
| Reakcja (`can_react`)                   | tak                                            | tak         | tak                        | **nie**                                     | nie                     |
| Moderacja (`can_moderate`)              | tak                                            | tak         | nie                        | nie                                         | nie                     |
| Zarządzanie strukturą (`can_manage`)    | **nie** — struktura należy wyłącznie do staffu | nie         | nie                        | nie                                         | nie                     |
| Zapraszanie (`can_invite`)              | **tak**                                        | nie         | nie                        | nie                                         | nie                     |
| Skład klubu (`can_see_members`)         | tak                                            | tak         | tak                        | **tak**                                     | zależnie od widoczności |
| Ujawnienie autora (`can_reveal_author`) | **nie**                                        | **nie**     | nie                        | nie                                         | nie                     |

Dwie rzeczy w tej macierzy są kontrintuicyjne i obie są celowe. **Zapraszanie należy wyłącznie do
prowadzącego klub i do staffu** — moderator moderuje, ale nie poszerza grona. **Tożsamości autora
anonimowej wypowiedzi nie ujawnia nawet `lead`**, tylko `admin` / `super_admin`: lead jest stroną
dyskusji, więc dostęp do tożsamości byłby konfliktem interesu.

**Różnica obserwator ↔ pełny członek jest więc konkretna, nie stopniowa:** obserwator (próg Członek,
ranga 10) **czyta klub, ale w nim nie mówi**. Pełne członkostwo (próg Członek Pro, ranga 20) daje
głos: odpowiedzi, reakcje, własne wątki w granicach `who_can_post`.

### 9.3 Czym się w klubie pracuje

| Benefit                                                                                                                                                                                                             | Status | Punkt egzekwowania                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| **Sześć rodzajów wątku**: dyskusja, pytanie, **stanowisko**, materiał, ogłoszenie, **ankieta**                                                                                                                      | `B`    | `club_threads.kind`, RLS `club_threads`                                                            |
| **Stanowiska klubu**: `support` / `oppose` / `abstain` z uzasadnieniem do 1000 znaków — mapa stanowisk, nie licznik lajków                                                                                          | `B`    | `club_stances`                                                                                     |
| **Reakcje semantyczne** w zamkniętym słowniku: „wnosi wartość", „dowód", „pytanie", „zgoda", „sprzeciw", „dzięki" — reakcja jest tu **daną** (ranking, reputacja, mapa stanowisk), nie ekspresją jak emoji w czacie | `B`    | `club_reactions`                                                                                   |
| **Wątek zakotwiczony** w pozycji legislacyjnej UE, wpisie albo wydarzeniu — dyskusja w rytmie procesu, nie w rytmie newsów                                                                                          | `B`    | `club_threads.anchor_type` (`eu_policy_item`, `post`, `event`)                                     |
| **Przestrzeń robocza wątku**: materiały (dokument, zbiór danych, link, notatka, nagranie), kamienie milowe (milestone, spotkanie, termin, publikacja) i pytania do wątku (otwarte / odpowiedziane / odrzucone)      | `B`    | A28 `club_thread_*` (RPC-only)                                                                     |
| **Wzmianki (@)** z powiadomieniem i deterministyczną kolejnością zdarzeń                                                                                                                                            | `B`    | A22, A17                                                                                           |
| **Licznik nieprzeczytanych** i sygnał „tu coś się wydarzyło od twojej ostatniej wizyty"                                                                                                                             | `B`    | `club_my_memberships.unread_count` (A18), `membershipSignals.ts`                                   |
| **Wpis anonimowy** tam, gdzie klub na to pozwala; tożsamości nie ujawnia ani moderator, ani prowadzący klub — wyłącznie `admin` / `super_admin`                                                                     | `B`    | `club_threads.is_anonymous`, `clubs.attribution_mode`, `can_reveal_author`, `club_anonymity_salts` |

### 9.4 Dorobek klubu: materiały i produkty

Podział materiał/produkt odpowiada na jedyne pytanie, które odróżnia think tank od forum: **co ten
klub wytworzył.**

| Warstwa                                         | Rodzaje                                                                                                            | Status |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| **Materiały** (wejście do pracy klubu)          | briefing przedsesyjny, analiza, notatka ze spotkania, zbiór danych, stanowisko, materiał prawny, prezentacja, inne | `B`    |
| **Produkty** (wyjście — powierzchnia „Dorobek") | nota z dyskusji, policy brief, scenariusz, memo, agenda badawcza, wniosek publiczny, memo decyzyjne                | `B`    |

Każdy dokument ma widoczność (`club` / `moderators`), status (`draft` / `published` / `archived`),
język (pl / en / mixed), wersję, etykietę źródła, przypięcie i licznik pobrań — `club_documents`,
`club_documents_list` (A28, A29).

**Kalendarz klubu** (`B`, `club_events` + `club_event_rsvps`): terminy w ośmiu rodzajach — spotkanie,
briefing, deadline, konsultacja, publikacja, **głosowanie**, warsztat, inne — z RSVP i statusem
(`scheduled` / `cancelled` / `done`). Obok niego **harmonogram etapów** (`club_milestones`): rytm
pracy klubu rozpisany na kamienie milowe. Pojedynczy termin ma **własny próg rangi**: `club_events.min_tier_rank`, dokładany **na
wierzchu** bramki klubu, nigdy zamiast niej. To jest punkt egzekwowania katalogowej pozycji
**„2 Decision Laby rocznie w roli obserwatora"** dla progu Rada Instytutu (ranga 25) — bez tego progu
jedynym sposobem zawężenia wstępu byłoby zakładanie osobnego klubu na każdy Decision Lab.

**Pomiar dynamiki klubu** (`B`): klub widzi własny rytm (`insights`, A28) — pasek aktywności liczy
się z klubu, nie z liczby pobrań strony wątku.

### 9.5 Klub jako sieć ludzi, nie archiwum treści

Pięć bytów dołożonych w A32/A33 — wszystkie zabramkowane tą samą bramką, co reszta modułu:

| Benefit                                                                                                                                                                                                                       | Status | Punkt egzekwowania                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| **Ogłoszenia „szukam / oferuję"**: jedna linia jako pretekst do odezwania się („szukam kontaktu w MON", „mogę udostępnić analizę X"), z datą ważności i stanem „załatwione"; rozmowa idzie do DM, nie pod ogłoszenie          | `B`    | `club_board_notices` (`seeking` / `offering`, `open` / `closed` / `removed`)        |
| **Zadeklarowana kompetencja w tym klubie** — deklaracja jest zawężona do klubu, nie globalna: ten sam człowiek jest ekspertem od amunicji w klubie obronnym i zwykłym członkiem gdzie indziej. Zasila katalog ekspertów klubu | `B`    | `club_member_expertise`, `/club/:slug/experts`                                      |
| **„Poproś o zdanie"** — prośba o opinię ze śladem, nie zaginionym DM-em                                                                                                                                                       | `B`    | `club_expert_pings`                                                                 |
| **„Poznaj członka"** — rotacja tygodniowa z archiwum przedstawień                                                                                                                                                             | `B`    | `club_member_spotlight`, `/club/:slug/spotlight`                                    |
| **Skład klubu z twarzami**: kto pisze w klubie, ten w tym klubie **jest** (naprawa A32 §7 — klub referencyjny pokazywał „0 członków" przy siedmiu piszących)                                                                  | `B`    | `club_members`, roster (A34)                                                        |
| **Specjalizacje i tematy klubu** jako osobne powierzchnie wejścia i dopasowania                                                                                                                                               | `B`    | `club_specializations`, `club_topics`, `/club/specialization/:slug`, `clubMatch.ts` |

### 9.6 Prywatność, moderacja i dane osobowe

| Benefit                                                                                                                                                                                                                 | Status | Punkt egzekwowania                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------- |
| **Reguła Chatham House na dwóch poziomach**: w klubie jako tryb atrybucji (`attribution_mode = 'chatham'`) i na spotkaniu jako **bramka** (`events.chatham_house` + flaga `chatham_house_events`, od progu Członek Pro) | `B`    | `club_capabilities`, `rsvp_event`, `get_event_access`                             |
| **Moderacja adekwatna do klubu**: `post` (po fakcie), `pre` (przed publikacją), `trusted` (bez kolejki)                                                                                                                 | `B`    | `clubs.moderation_mode`, `club_capabilities.can_moderate`                         |
| **Zamknięta powierzchnia mutacji**: wszystkie tabele klubowe są RLS deny-all z odebranymi grantami dla `authenticated` — cały ruch idzie przez `SECURITY DEFINER` RPC                                                   | `B`    | A3/A4, A8 hardening                                                               |
| **„Kuluary" jako realny reżim zaufania** — jedyny z pięciu działów klubu referencyjnego, który przeżył czystkę A29, bo pozostałe cztery duplikowały rodzaj wątku, kotwicę albo powierzchnię dokumentów                  | `B`    | `club_groups` (dział dziedziczy albo nadpisuje widoczność i `who_can_post` klubu) |
| **Ślad klubowy w eksporcie RODO** (art. 15 i 20): członkostwa, tematy i odpowiedzi wołającego są w eksporcie danych osobowych i w jego manifeście                                                                       | `B`    | A23, `exportMyData`, `assertExportManifestMatches`                                |
| **Minisite klubu**: kuratorska strona klubu zamiast operacyjnej listy wątków — próg **rangi 50** (Partner Strategiczny), ale członkostwo i zaproszenie biją plan                                                        | `B`    | `CLUB_MINISITE_TIER_RANK = TIER_RANKS.partner_general`                            |

### 9.7 Benefity klubowe SFORMUŁOWANE PRZEZE MNIE — nie ma ich w katalogu

Poniższe funkcje **istnieją w platformie i są zabramkowane**, ale katalog v6.2 nie ma dla nich ani
jednego wiersza copy. To jest ta sama klasa zaniedbania, którą wdrożenie v6.2 nazwało wprost przy
regule Chatham House i limicie miejsc: _„obie funkcje były zbudowane, przetestowane i nieużywane w
sprzedaży"_. Formułuję je jako propozycje copy — **każda wymaga decyzji redakcyjnej**, bo katalog
jest dokumentem handlowym, a nie inwentarzem kodu.

Wszystkie propozycje są klasy `B` (bramka już istnieje), więc **żadna nie dokłada pozycji do
kalendarza zobowiązań z §11** — to jest ich najmocniejszy argument: zwiększają wartość progu bez
zwiększania obciążenia operacyjnego jednej osoby.

| #   | `[PROPOZYCJA]` copy do katalogu                                                                                   | Próg docelowy                      | Status | Punkt egzekwowania                                                             | Dlaczego warto                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **„Twoje członkostwo klubowe zostaje z Tobą — także po wygaśnięciu składki"**                                     | Członek Pro i wyżej                | `B`    | `resolveClubHubAccess`, `resolveClubMinisiteAccess` (członkostwo bije plan)    | najmocniejszy argument retencyjny, jaki ten moduł ma, i dziś w ogóle niewypowiedziany; adresuje wprost tezę katalogu, że członkostwo utrzymuje lepiej niż subskrypcja |
| 2   | **„Dorobek klubu: siedem rodzajów produktu — od noty z dyskusji do memo decyzyjnego"**                            | Członek Pro i wyżej                | `B`    | `club_documents.kind` (7 rodzajów produktu), powierzchnia „Dorobek"            | odpowiada na jedyne pytanie odróżniające think tank od forum; dziś katalog sprzedaje „wątki, dokumenty, ankiety, kalendarz" i milczy o wyjściu z pracy klubu          |
| 3   | **„Tablica «szukam / oferuję»: kontakt bez pretekstu jest trudniejszy niż kontakt z pretekstem"**                 | Członek Pro i wyżej                | `B`    | `club_board_notices`                                                           | networking nie załamuje się z braku ludzi, tylko z braku pretekstu — to jest benefit, za który płaci się w sieciach zawodowych osobno                                 |
| 4   | **„Katalog kompetencji klubu i «poproś o zdanie» — wiesz, kto realnie pracował nad sprawą"**                      | Członek Pro i wyżej                | `B`    | `club_member_expertise`, `club_expert_pings`, `/club/:slug/experts`            | najcenniejsza asymetria informacyjna w klubie; uzupełnia pozycję „korespondencja z ekspertami", która dziś mówi tylko o ekspertach NES, nie o członkach               |
| 5   | **„Stanowisko klubu: poparcie, sprzeciw albo wstrzymanie z uzasadnieniem — mapa stanowisk, nie licznik reakcji"** | Członek Pro i wyżej                | `B`    | `club_stances`, `club_threads.kind = 'position'`                               | pokazuje, że klub produkuje pozycję, a nie tylko rozmowę                                                                                                              |
| 6   | **„Wątek zakotwiczony w akcie prawnym UE — dyskusja w rytmie procesu legislacyjnego, nie w rytmie newsów"**       | Członek Pro i wyżej                | `B`    | `club_threads.anchor_type = 'eu_policy_item'`                                  | domyka obietnicę monitoringu regulacyjnego: tracker mówi, co się zmieniło, klub mówi, co z tym zrobić                                                                 |
| 7   | **„Przestrzeń robocza wątku: materiały, kamienie milowe i pytania w jednym miejscu"**                             | Członek Pro i wyżej                | `B`    | A28 `club_thread_*`                                                            | odpowiada na realny zarzut wobec forów: wspólne źródła pochowane w czterdziestu odpowiedziach                                                                         |
| 8   | **„Wpis anonimowy w klubie prowadzonym w rygorze Chatham House"**                                                 | Członek Pro i wyżej                | `B`    | `attribution_mode`, `is_anonymous`, `can_reveal_author`                        | katalog sprzedaje regułę Chatham House na spotkaniach, ale nie na tablicy klubu, choć klub ma dla niej własny tryb                                                    |
| 9   | **„Ankiety klubowe i głosowania w kalendarzu"**                                                                   | Członek Pro i wyżej                | `B`    | `club_threads.kind = 'poll'`, `club_thread_polls`, `club_events.kind = 'vote'` | tani mechanizm zaangażowania w pierwszych 14 dniach — a to jest wskaźnik przewidujący churn 90-dniowy (§14)                                                           |
| 10  | **„Poznaj członka: rotacja tygodniowa z archiwum przedstawień"**                                                  | Członek Pro i wyżej                | `B`    | `club_member_spotlight`                                                        | wprost pracuje na onboarding klubowy w 48 godzin, który katalog już sprzedaje jako pozycję `P`                                                                        |
| 11  | **„Twój ślad w klubie jest w eksporcie Twoich danych"**                                                           | od Członka                         | `B`    | A23, `exportMyData`                                                            | nie jest benefitem sprzedażowym, ale jest argumentem wiarygodnościowym u odbiorcy instytucjonalnego, który pyta o RODO przed podpisem                                 |
| 12  | **„Zgłoszenie do klubu rozpatruje komisja na podstawie profilu zawodowego"**                                      | ścieżka `request`, wszystkie progi | `B`    | `club_apply_submit`, 22 pola formularza, panel „Zgłoszenia"                    | selekcja jest wartością, nie przeszkodą: to ona odróżnia klub od grupy na komunikatorze i uzasadnia rygor Chatham House                                               |

**Czego świadomie NIE proponuję jako benefitu:** zdolności moderacyjnych i zarządczych (`can_moderate`,
`can_manage`, `can_invite`). To są **role operacyjne nadawane przez staff**, nie składniki oferty
kupowanej za składkę — sprzedawanie „zostań moderatorem" w cenniku odwróciłoby zależność między
zaufaniem a płatnością, a przy klubach prowadzonych w regule Chatham House jest to zależność, na
której stoi cały mechanizm.

### 9.8 Rozjazdy klubowe do rozstrzygnięcia

1. **`working_groups` jest flagą dekoracyjną, a katalog sprzedaje grupę zadaniową za 60 000 zł.**
   Flaga `working_groups` figuruje w `features` progów Pro, VIP, Enterprise i partnerskich, a rejestr
   capabilities opisuje ją wprost: „brak bramki — obecnie czysty benefit marketingowy". Jednocześnie
   próg Partner Strategiczny sprzedaje **„1 własną grupę zadaniową rocznie: cykl 4 spotkań zakończony
   raportem sygnowanym wspólnie"** jako pozycję `P`. Zobowiązanie procesowe jest w kalendarzu (§11),
   więc nie jest to obietnica bez pokrycia — ale flaga o tej nazwie na progu Pro sugeruje coś, czego
   próg Pro nie dostaje. Do decyzji: zdjąć flagę z niższych progów albo zmienić jej nazwę.
2. **Minisite: ranga 50 wobec obietnicy „prywatny mikroserwis klubowy dla organizacji".**
   Stała jest już poprawna (do 22.08 wskazywała rangę 20, czyli funkcję wycenioną w progu za 60 000 zł
   dostawał każdy Pro za 119 zł). Zostaje pytanie handlowe: czy Partner Instytucjonalny (ranga 40) ma
   mieć minisite, bo dziś nie ma — a katalog daje mu „wszystkie kluby dyskusyjne dla osób nominowanych".
3. **Obserwator z progu Członek wchodzi na razie do jednego klubu tematycznego, w trybie testu.**
   Argument za szerszym otwarciem: społeczność utrzymuje najlepiej ze wszystkich benefitów. Argument
   przeciw: dyskusja w regule Chatham House czerpie wartość z zamknięcia kręgu. Od v6.2 argument
   przeciw ma **własną bramkę** (`chatham_house_events` od progu Pro), więc obserwator może wejść do
   klubu, nie wchodząc na spotkania prowadzone w tej regule — otwarcie klubu przestało być decyzją
   „wszystko albo nic". **Które** kluby są otwarte dla obserwatora, rozstrzyga wyłącznie
   `clubs.min_tier_rank`, nie stała w kodzie.
4. **Ranga 25 w klubach ma dziś dwóch właścicieli**: próg Rada Instytutu i próg Zespół. Klub
   z `min_tier_rank = 25` wpuszcza więc również każde miejsce zespołowe. Jest to skutek zamierzony
   (katalog mówi wprost „Zespół daje zakres Pro plus wejścia rangi 25"), ale przy zakładaniu klubu
   zastrzeżonego dla Rady trzeba pamiętać, że ranga 25 nie jest tożsama z „tylko Rada".

---

## 10. Macierz konwenignu: bilet wliczony, reguła Chatham House, wydarzenia limitowane

| Próg                                      | Bilet wliczony w plan            | Reguła Chatham House | Wydarzenia limitowane       |
| ----------------------------------------- | -------------------------------- | -------------------- | --------------------------- |
| Czytelnik                                 | brak                             | brak                 | tylko otwarte               |
| Członek                                   | **1 rocznie**                    | brak                 | bez pierwszeństwa           |
| Stawki ulgowe (student, kadra akademicka) | **zniżka 50 % zamiast biletu**   | brak                 | bez pierwszeństwa           |
| Członek Pro                               | ten sam **1 rocznie, nie drugi** | tak                  | tak, z kolejką rezerwową    |
| Rada Instytutu                            | 1 rocznie                        | tak                  | tak, wraz z Decision Labami |
| Zespół                                    | **3 rocznie na organizację**     | tak                  | tak                         |
| Partnerzy i Krąg                          | 1 rocznie na osobę nominowaną    | tak                  | tak                         |

Pula biletów liczy **MAKSIMUM** z warstw, nie sumę (`my_ticket_allowance`), a wartość odstąpionego
biletu zapisuje się na wierszu konsumpcji (`plan_ticket_claims.face_value_cents`) — rachunek
ekspozycji robi się z danych, nie z szacunku.

Rok biletowy jest **członkowski (rocznicowy)**, nie kalendarzowy (`membership_year_window`).

---

## 11. Kalendarz zobowiązań rocznych — 21 pozycji `P`

Dwadzieścia jeden pozycji katalogu to zobowiązania, których system nie pilnuje. Pilnuje ich ten
kalendarz — **jeżeli pozycja nie ma tu wpisu, nie powinna znaleźć się w katalogu.**

| Zobowiązanie                              | Częstotliwość        | Termin                                                        | Progi objęte                          |
| ----------------------------------------- | -------------------- | ------------------------------------------------------------- | ------------------------------------- |
| Przegląd geopolityczny na e-mail          | 52 / rok             | co tydzień                                                    | od Czytelnika                         |
| Digest członkowski                        | 44 / rok             | co tydzień poza sierpniem i przełomem roku                    | od Członka                            |
| Briefingi członkowskie online             | wszystkie            | kalendarz wydarzeń                                            | od Członka                            |
| Wydarzenie biletowane z wliczonym biletem | 1 / rok              | rok członkowski (rocznicowy)                                  | od Członka, poza stawkami ulgowymi    |
| Bilety wliczone dla organizacji           | 3 / rok              | pula wspólna, kolejność zgłoszeń                              | Zespół                                |
| Zamknięte briefingi Pro                   | 4 / rok              | marzec, czerwiec, wrzesień, grudzień                          | od Pro                                |
| Nota foresightowa                         | 4 / rok              | ostatni tydzień kwartału                                      | od Pro                                |
| Onboarding klubowy                        | ciągle               | 48 godzin od zakupu                                           | od Pro                                |
| Onboarding zespołowy                      | ciągle               | 7 dni od zakupu                                               | Zespół                                |
| Decision Lab jako obserwator              | 2 / rok              | kalendarz Decision Labs                                       | Rada                                  |
| Zjazd Rady                                | 1 / rok              | termin ustalany w I kwartale                                  | Rada                                  |
| Kolacje eksperckie                        | 2 / rok              | wiosna, jesień                                                | Rada                                  |
| Udostępnienie rekomendacji do komentarza  | każda publikacja     | 10 dni roboczych przed publikacją                             | Rada, Partner Instytucjonalny i wyżej |
| Nabór tematów badawczych                  | 1 / rok              | zgłoszenia do 30 września, rozstrzygnięcie do 31 października | Rada i wyżej                          |
| Briefing zamknięty dla organizacji        | 4 / rok              | kwartalnie                                                    | Partner Instytucjonalny i wyżej       |
| Decision Lab z miejscami dla partnera     | 1 / rok              | kalendarz Decision Labs                                       | Partner Instytucjonalny i wyżej       |
| Własna grupa zadaniowa partnera           | 1 / rok, 4 spotkania | cykl uzgadniany indywidualnie                                 | Partner Strategiczny i wyżej          |
| Dedykowane briefingi partnera             | 2 / rok              | terminy uzgadniane                                            | Partner Strategiczny i wyżej          |
| Slot prelegencki na konferencji           | 1 / rok              | konferencja roczna                                            | Partner Strategiczny i wyżej          |
| Kolacje na poziomie zarządu               | 2 / rok              | wiosna, jesień                                                | Partner Strategiczny i wyżej          |
| Posiedzenie agendy strategicznej          | 1 / rok              | IV kwartał                                                    | Krąg Założycieli                      |

**Rachunek obciążenia:** dwadzieścia pozycji cyklicznych, w tym co najmniej piętnaście wydarzeń na
żywo lub online w roku oraz dwie serie wydawnicze o stałym rytmie. Przy jednej osobie operacyjnej to
górna granica wykonalności — każda nowa pozycja katalogu musi wskazać, którą pozycję z tej tabeli
zastępuje.

---

## 12. Rejestr flag `features`: co jest bramką, a co obietnicą

Źródło: `src/lib/billing/capabilities.ts` (`TIER_CAPABILITIES`). Pole `enforced` jest weryfikowane
maszynowo przez snapshot bramek (`src/lib/authz/authzSnapshot.generated.ts`) i test parytetu — bramka
dopisana bez `enforced: true` (albo odwrotnie) obleje CI.

### 11.1 Flagi egzekwowane (`B`)

| Flaga                   | Obszar     | Punkt egzekwowania                                                                |
| ----------------------- | ---------- | --------------------------------------------------------------------------------- |
| `premium_content`       | treść      | paywall treści (`has_content_access`) i linki podarunkowe                         |
| `regulatory_monitoring` | tracker    | obserwowanie pozycji i alerty (RLS `eu_policy_follows`)                           |
| `pro_briefings`         | wydarzenia | wstęp na briefingi członkowskie (`rsvp_event`, `get_event_access`)                |
| `recordings`            | wydarzenia | dostęp do URL nagrań (`get_event_access`)                                         |
| `qa_priority`           | Q&A        | priorytet i kolejność pytań w `/qa` (`list_qa_questions`)                         |
| `chat_enabled`          | czat       | rozpoczęcie rozmowy DM (`get_or_create_direct_conversation`) — Plus i wyżej       |
| `chat_direct_gated`     | czat       | bezpośredni DM z ekspertami i VIP-ami bez zapytania (VIP i wyżej)                 |
| `chat_inmail_quota_5`   | czat       | pula 5 InMaili miesięcznie (wygrywa z pulą 2)                                     |
| `chat_inmail_quota_2`   | czat       | pula 2 InMaili miesięcznie                                                        |
| `early_access`          | treść      | wczesny dostęp do wpisów zaplanowanych, okno `early_access_window()` = 72 h       |
| `chatham_house_events`  | wydarzenia | wejście i nagranie ze spotkania w regule Chatham House (`events.chatham_house`)   |
| `gift_links`            | treść      | tworzenie linków podarunkowych (`can_gift_articles`, `create_gift_link`) — od Pro |

### 11.2 Flagi liczbowe (limity, własne pole w panelu)

| Flaga                        | Znaczenie                                         | Wartości w katalogu                                                                                 |
| ---------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `expert_request_quota`       | pula zapytań do eksperta na miesiąc               | `member` = 1, `pro` = 3, `ngo` = 3                                                                  |
| `included_event_tickets`     | bilety wliczone **na członka** na rok członkowski | 1 dla `member`, `pro`, `vip`, `ngo`, `corporate`, `partner`, `partner_general`, `presidents_circle` |
| `included_event_tickets_org` | bilety wliczone **na organizację** na rok         | 3 dla `team`                                                                                        |
| `event_ticket_discount_pct`  | zniżka procentowa zamiast biletu                  | 50 dla `student`, `educator`                                                                        |

### 11.3 Flagi dekoracyjne (obietnica bez bramki — świadomie)

| Flaga                                                       | Dlaczego bez bramki                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `events_members`                                            | wydarzenia members bramkuje **ranga** (`min_tier_rank`), nie flaga |
| `member_library`                                            | bibliotekę bramkuje **ranga zasobu** (`min_tier_rank`)             |
| `corporate_seats`                                           | miejsca działają przez `member_organizations`, nie flagę           |
| `working_groups`                                            | czysty benefit marketingowy                                        |
| `vip_concierge`                                             | obsługa poza aplikacją                                             |
| `teaching_licence`                                          | licencja dydaktyczna egzekwowana umownie                           |
| `strategic_partner`, `general_partner`, `presidents_circle` | benefity relacyjne / poziom na zaproszenie                         |
| `supporter_updates`                                         | wysyłka kanałem newslettera                                        |

---

## 13. Rozjazdy i decyzje otwarte — czytać przed publikacją cennika

### 13.1 Ceny: katalog v6.2 ≠ `access_plans`

| Próg              | Katalog v6.2      | `access_plans` (to, co płaci klient) | Różnica                   |
| ----------------- | ----------------- | ------------------------------------ | ------------------------- |
| Członek           | 39 zł / 390 zł    | **59 zł / 590 zł**                   | +20 zł/mies., +200 zł/rok |
| Członek Pro       | 119 zł / 1 190 zł | **129 zł / 1 290 zł**                | +10 zł/mies., +100 zł/rok |
| Zespół            | 89 zł / miejsce   | **99 zł / miejsce**                  | +10 zł/miejsce            |
| Stawka studencka  | 19 zł             | 19 zł                                | zgodne                    |
| Stawka akademicka | 29 zł             | 29 zł                                | zgodne                    |

Katalog v6.2 deklaruje „struktura progów, ceny i rangi bez zmian wobec v6.1", ale **nowe ceny nie
zostały wprowadzone do `access_plans`** — jedyną zmianą cenową z 22.08 jest próg wolumenowy Zespołu
(79 zł od 11 miejsc) i cena Decision Labu (16 000 zł). Do rozstrzygnięcia właścicielskiego:
czy sprzedajemy według v6.2 (wtedy potrzebna migracja cen + resync katalogu operatora), czy katalog
ma być zaktualizowany do cen z bazy.

### 13.2 Brak planów rocznych dla stawek ulgowych

Katalog liczy zniżkę biletową od **składki studenckiej 190 zł rocznie**, ale w `access_plans`
istnieją wyłącznie plany miesięczne dla `student` (19 zł) i `educator` (29 zł). Wariant roczny
(190 zł / 290 zł) trzeba dopisać, jeżeli ma być sprzedawany.

### 13.3 Enterprise (`corporate`, ranga 30) nie ma odpowiednika w katalogu v6.2

Baza trzyma aktywny próg `corporate` w segmencie `business` z pełnym zestawem benefitów, a tabela
progów instytucjonalnych v6.2 zaczyna się od Partnera Instytucjonalnego (ranga 40). Ranga 30 jest
jednocześnie celem przemapowania wycofanej rangi 28. Decyzja: albo Enterprise wraca do katalogu jako
próg wejścia dla firm, albo wiersz idzie do `active = false`.

### 13.4 Nazwy handlowe w bazie ≠ nazwy w katalogu v6.2

Karty `/pricing` renderują `name_pl` z bazy (Essential, Plus, Pro, VIP, Enterprise, Strategic
Partner, Partner Generalny, President's Circle), a katalog i copy benefitów mówią o Czytelniku,
Członku, Członku Pro, Radzie Instytutu, Partnerze Instytucjonalnym, Partnerze Strategicznym i Kręgu
Założycieli. Nagłówki grup w `benefits` już używają nowej nomenklatury („Wszystko z progu
Czytelnik…"), więc na jednej karcie stoją dziś dwie konwencje nazewnicze. To zmiana copy, nie bramek.

### 13.5 Pozostałe rozstrzygnięcia z katalogu

- **Cena progu Członek** — albo schodzi do 25–29 zł jako próg masowej przynależności, albo zostaje
  39 zł i wliczony bilet oraz warstwa odpowiedzi muszą tę różnicę udźwignąć (kotwice rynkowe:
  przynależność ≈ 20 zł/mies., narzędzie pracy > 100 zł/mies., 70 % Polaków wydaje na wszystkie
  subskrypcje łącznie do 100 zł).
- **Wartość wliczonego biletu** — bilet wliczony w członkostwo za 390 zł rocznie musi mieć cenę
  katalogową **niższą** niż ta kwota; wymaga ustalenia ceny biletu konferencyjnego przed publikacją.
  Mechanizm jest gotowy i obojętny na tę liczbę (pula liczy sztuki, nie złotówki).
- **Cena miejsca w Decision Labie** — rozstrzygnięte: 16 000 zł, liczba wywoławcza, do potwierdzenia
  w rozmowie z pierwszym nabywcą spoza partnerstwa.
- **Ranga Zespołu** — rozstrzygnięte: 25, jako zapisana obietnica (zakres Pro + wejścia rangi 25).
- **Jedna darmowa analiza dla Czytelnika** — zostaje 0, dopóki pomiar SEO nie wykaże realnego kosztu.
- **Obserwator z progu Członek** — wchodzi na razie do jednego klubu tematycznego, w trybie testu.
  Od v6.2 argument „Chatham House czerpie wartość z zamknięcia kręgu" ma własną bramkę
  (`chatham_house_events` od progu Pro), więc otwarcie klubu przestało być decyzją „wszystko albo nic".

### 13.6 Jedna pozycja do zbudowania

**Warstwa odpowiedzi na archiwum** — trzy wiersze katalogu (3 pytania miesięcznie dla Czytelnika,
20 dla Członka, bez limitu od Pro), jedna funkcja, zero linii kodu. Jedyna pozycja `N` i jedyna
adresująca trend zagrażający całemu modelowi: wg Digital News Report 2026 tylko 4 % użytkowników
chatbotów przechodzi do źródła, wobec 19 % przy wyszukiwarce; Cloudflare podał, że na 28 400 stron
pobranych przez czołowego crawlera przypada jedno odesłanie zwrotne.

---

## 14. Wskaźniki, bez których ten katalog jest hipotezą

| Wskaźnik                                        | Cel     | Punkt odniesienia                                            |
| ----------------------------------------------- | ------- | ------------------------------------------------------------ |
| Odsetek odwiedzających, którzy zobaczyli bramkę | > 6 %   | mediana rynkowa 1,8 %; próg zdrowia wg Shorenstein Center    |
| Udział progu Członek Pro wśród płacących        | 50–70 % | rozkład docelowy w literaturze good-better-best              |
| Udział progów najwyższych                       | 10–30 % | tamże                                                        |
| Retencja roczna progów indywidualnych           | 80–85 % | poziom uznawany za zdrowy w sektorze stowarzyszeniowym       |
| Członkowie klubu aktywni w pierwszych 14 dniach | mierzyć | brak wartości docelowej; wskaźnik przewiduje churn 90-dniowy |

---

## 15. Gdzie to mieszka w repozytorium

**Katalog i ceny**

- `docs/cennik-nes-v6.2.html` — katalog handlowy v6.2 (22.08.2026), zastępuje v6.1
- `docs/WDROZENIE_KOREKT_AUDYTU_KATALOGU_V61_2026-08-22.md` — raport wdrożenia korekt audytu
- `supabase/migrations/20260722200000_pricing_audiences_faq.sql` — segmenty odbiorców, FAQ cennika
- `supabase/migrations/20260722230000_pricing_catalog_v3_retention.sql` — katalog progów v3 (nazwy, rangi, benefity, features) + seed planów
- `supabase/migrations/20260723160000_pricing_catalog_v4_benefits.sql` — copy benefitów progów indywidualnych (v4)
- `supabase/migrations/20260730191000_business_partner_catalog.sql`, `…20260730194653_…sql` — Partner Biznesowy (wycofany) i finalny seed planów
- `supabase/migrations/20260822090000_orphan_tier_rank_28_remap.sql` — przemapowanie rangi 28 → 30
- `supabase/migrations/20260822091000_plan_ticket_allowance.sql` — pula biletów wliczonych, `plan_ticket_claims`, `my_ticket_allowance`, `membership_year_window`
- `supabase/migrations/20260822092000_chatham_house_tier_benefit.sql` — bramka reguły Chatham House
- `supabase/migrations/20260822093000_early_access_publish_at_gate.sql` — wczesny dostęp 72 h na `posts.publish_at`
- `supabase/migrations/20260822094000_catalog_v61_products_and_verification.sql` — próg wolumenowy Zespołu, Decision Lab jako produkt, automatyczna weryfikacja domeny uczelni
- `supabase/migrations/20260822095000_catalog_v61_benefits_copy.sql` — aktualne copy benefitów na kartach
- `supabase/migrations/20260822096000_club_events_tier_gate.sql` — Decision Lab na `club_events.min_tier_rank`

**Kod**

- `src/lib/billing/capabilities.ts` — rejestr flag `features`: egzekwowane vs dekoracyjne, flagi liczbowe
- `src/lib/billing/tierRanks.ts` — rangi kanoniczne (`TIER_RANKS`)
- `src/lib/billing/catalog.ts`, `src/lib/billing/catalogSync.server.ts` — katalog planów i synchronizacja z operatorem płatności
- `src/lib/billing/membership.ts` — hub członkostwa: nadania (`membership_grants`), darowizny, organizacja i miejsca
- `src/lib/clubs/planTiers.ts` — progi planu dla klubów (`CLUB_PLAN_TIER_RANK`)
- `src/lib/clubs/hubAccess.ts` — `CLUB_TIER_RANK = 20`, `CLUB_OBSERVER_TIER_RANK = 10`, doktryna „członkostwo bije plan"
- `src/lib/clubs/minisiteAccess.ts` — `CLUB_MINISITE_TIER_RANK = 50`
- `src/lib/clubs/capabilityMatrix.ts` — macierz zdolności ról klubowych (dokumentacja zachowania `club_capabilities()`)
- `src/lib/clubs/applyValidation.ts` — 22 pola zgłoszenia do klubu; `src/lib/clubs/gateView.ts`, `accessSentence.ts` — prezentacja bramki i ustawień dostępu
- `src/lib/clubs/membershipSignals.ts` — nieprzeczytane i sygnał „coś się wydarzyło"; `networkApi.ts`, `memberRoster.ts` — sieć ludzi i skład klubu
- `supabase/migrations/20260808090000_discussion_clubs_a1_structure.sql` — klub, grupa, członkostwo, `club_capabilities()` jako jedno źródło prawdy o dostępie
- `supabase/migrations/20260808092000…a2_invitations.sql`, `…20260808270000…a27_segment_invitations.sql`, `…20260811150000…a35_applications_fixes.sql` — zaproszenia i zgłoszenia
- `supabase/migrations/20260808093000…a3_threads.sql`, `…094000…a4_interaction.sql` — wątki, reakcje semantyczne, stanowiska
- `supabase/migrations/20260808300000…a28_workspace.sql`, `…310000…a28_thread_workspace.sql`, `…20260809000000…a29_products_and_topic_sections.sql` — dokumenty, harmonogram, dorobek (7 rodzajów produktu)
- `supabase/migrations/20260810120000…a32_networking.sql`, `…20260810180000…a33_network_screens.sql`, `…20260810210000…a34_roster_faces.sql` — ogłoszenia, kompetencje, „poproś o zdanie", „poznaj członka", skład
- `supabase/migrations/20260808250000…a23_gdpr_export.sql` — ślad klubowy w eksporcie danych osobowych
- `src/components/admin/membership/**` — panel warstw: edytor progów, panel capabilities, nadania

**Funkcje i tabele bazy przywoływane w katalogu**
`has_content_access`, `get_event_access`, `rsvp_event`, `claim_included_event_ticket`,
`my_ticket_allowance`, `my_expert_request_quota`, `my_inmail_quota`, `send_expert_inmail`,
`list_qa_questions`, `club_list`, `club_events_list`, `club_event_rsvp`,
`get_or_create_direct_conversation`, `can_gift_articles`, `create_gift_link`,
`my_academic_domain_verification`, `early_access_window()`, `membership_year_window`,
`my_effective_tier_features`, `current_membership_tier`; tabele `membership_tiers`, `access_plans`,
`membership_grants`, `member_organizations`, `organization_seats`, `plan_ticket_claims`,
`metering_settings`, `verification_domains`, `member_resources`, `eu_policy_follows`.

---

_Stan dokumentu: 2026-09-09. Podstawa: katalog v6.2 (22.08.2026) oraz stan migracji i kodu na branchu
`claude/focused-goodall-rhngcr`. Dokument jest zestawieniem — źródłem prawdy o cenie pozostaje
`access_plans`, o uprawnieniu `membership_tiers.features` i ranga, o zobowiązaniu procesowym
kalendarz z §11._
