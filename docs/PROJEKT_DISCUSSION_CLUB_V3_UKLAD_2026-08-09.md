# Discussion Club V3 — przeformatowanie układu pod standard think-tankowy

Data: 2026-08-09 · Status: **Etapy 0–2 wdrożone**, etapy 3–4 czekają na decyzję
Kontekst: wytyczne „Pełnoprawny think-tankowy Discussion Club" + audyt obecnego układu huba klubu.
Poprzednicy: `PROJEKT_MODUL_DISCUSSION_CLUB_2026-08-07.md` (V1), `PROJEKT_MODUL_DISCUSSION_CLUB_V2_ADMIN_2026-08-07.md` (V2).

---

## 0. Teza

Moduł ma **prawie wszystkie klocki**, których wymagają wytyczne: reżim Chatham House, rodzaje wątków
z zamierzonym wynikiem, bibliotekę dokumentów, kalendarz, harmonogram etapów, kadencyjność ról,
reakcje semantyczne, kotwiczenie w aktach prawnych. Problem nie leży w brakach funkcjonalnych.

Problem leży w **hierarchii ekranu**. Obecny układ odpowiada na pytanie „co się tu dzieje" (ruch),
a wytyczne wymagają, żeby klub odpowiadał na pytanie „co z tego wynikło" (dorobek). Do tego jedna
lista w lewej szynie skleja **cztery różne osie klasyfikacji**, przez co użytkownik klikając pozycję
nie wie, czy właśnie wybrał temat, format pracy, powierzchnię czy poziom poufności.

Przeformatowanie to więc w 80% **przestawienie tego, co już istnieje**, i w 20% dołożenie warstwy
produktowej (dorobek, cykl kwartalny, klasy członkostwa).

---

## 1. Diagnoza

### 1.1 „Grupy" to nie jedna oś, tylko cztery sklejone

Klub referencyjny („Bezpieczeństwo Europy Środkowo-Wschodniej", migracja `20260808220000`) ma dziś
pięć pozycji w liście oznaczonej „Grupy". Żadna z nich nie jest tematem:

| Pozycja w liście | Jaką oś NAPRAWDĘ wyraża                 | Czy moduł ma już lepszą reprezentację tej osi                  |
| ---------------- | --------------------------------------- | -------------------------------------------------------------- |
| Debata otwarta   | brak osi — to jest „wszystko pozostałe" | tak: pozycja „Wszystkie działy"                                |
| Akty prawne      | **kotwica** w treści platformy          | tak: `club_threads.anchor_type/anchor_id` + filtr `p_anchored` |
| Stanowiska klubu | **zamierzony wynik** wątku              | tak: `club_threads.kind = 'position'`                          |
| Biblioteka       | **powierzchnia** (materiały)            | tak: sekcja „Dokumenty" + tabela `club_documents`              |
| Kuluary          | **reżim zaufania**                      | tak: `attribution_mode = 'chatham'` + `visibility = 'private'` |

**Cztery z pięciu „grup" duplikują osie, które moduł już ma** — i wyrażają je gorzej, bo jako
jednorazowy wybór z listy zamiast jako właściwość wątku. Wątek „stanowiskowy" w dziale
„Debata otwarta" jest dziś niemożliwy do znalezienia, chociaż `kind = 'position'` istnieje w bazie.

To nie jest błąd redakcji. To jest konsekwencja tego, że dział był **jedynym widocznym wymiarem
porządkującym**, więc redakcja użyła go do wyrażenia wszystkiego, co miała do wyrażenia.

### 1.2 Oś tematyczna istnieje w danych i jest niewidoczna

`club_threads.topic` (migracja `20260808092623`) jest ustawiany w kreatorze wątku i domyślnie
dziedziczy `clubs.policy_area`. Nie jest pokazywany na wierszu wątku ani nie da się po nim filtrować
wewnątrz klubu.

Decyzja z A26 („`policy_area` jest kolumną KLUBU, więc wewnątrz listy jednego klubu jest stała")
była poprawna dla klubu monotematycznego. Wytyczne §2 opisują klub **wielodomenowy** — osiem domen
od geopolityki po kulturę. Przy tym profilu założenie „jeden klub = jeden temat" przestaje
obowiązywać i filtr tematyczny przestaje być droplistą, która niczego nie odsiewa.

### 1.3 Prawa kolumna mierzy ruch, nie dorobek

„Puls klubu" pokazuje: odpowiedzi, aktywnych, bez odpowiedzi. Na zrzucie ekranu: **3 / 1 / 5**.
Te liczby są prawdziwe i katastrofalne w wymowie — klub czyta się jak martwe forum.

Wytyczne §13 mówią wprost, że sukcesu nie mierzy się liczbą wypowiedzi, tylko: liczbą ukończonych
analiz, liczbą rekomendacji, cytowaniami, powracalnością uczestników, liczbą projektów powstałych
dzięki klubowi. Klub, który w kwartale wyprodukował policy brief i dwa scenariusze, ma w tej chwili
dokładnie ten sam „puls" co klub, który nie zrobił nic.

### 1.4 Nazewnictwo mówiło co innego niż kod

Warstwa kodu nazywała ten byt „działem" od początku (`ClubGroupTree` — „drzewo działów klubu",
`club.groupPanel.clear` — „Wyczyść wybór działu", wykres w Dynamice — „Rozkład na działy"), a etykiety
w UI mówiły „Grupy". Rozjazd był w samym module, nie tylko między modułem a wytycznymi.

---

## 2. Model docelowy: cztery rozdzielone osie

**Zasada nadrzędna: jedna oś = jedna kontrolka = jedno miejsce na ekranie.**

| Oś                   | Pytanie użytkownika          | Nośnik w danych (już istnieje)                | Miejsce w układzie           |
| -------------------- | ---------------------------- | --------------------------------------------- | ---------------------------- |
| **DZIAŁ TEMATYCZNY** | „o czym?"                    | `club_groups` + hierarchia z konwencji slugów | lewa szyna, drzewo           |
| **TRYB PRACY**       | „z jakim wynikiem?"          | `club_threads.kind` (6 wartości)              | chipy nad strumieniem        |
| **ETAP CYKLU**       | „gdzie jesteśmy w procesie?" | `club_milestones` (+ nowe pole kwartału)      | belka nad strumieniem        |
| **REŻIM**            | „na jakich zasadach?"        | `attribution_mode` + `visibility` działu      | znacznik przy dziale i wątku |

Dwa dodatkowe wymiary zostają tam, gdzie są, bo są **filtrami**, a nie osiami nawigacji:
kotwica (`anchored`) i status (`open`/`resolved`/`dormant`).

### 2.1 Co zrobić z pięcioma obecnymi działami

Rekomendacja: **przenieść je na właściwe osie i zbudować działy tematyczne od nowa.**

| Dziś             | Docelowo                                                                   |
| ---------------- | -------------------------------------------------------------------------- |
| Debata otwarta   | znika — to jest widok domyślny („Wszystkie działy")                        |
| Akty prawne      | filtr „zakotwiczone" (istnieje w RPC, brak kontrolki w UI)                 |
| Stanowiska klubu | chip trybu pracy „Stanowisko" (`kind = 'position'`)                        |
| Biblioteka       | sekcja „Dokumenty" — już jest w szynie, dublet znika                       |
| **Kuluary**      | **zostaje działem** — bo naprawdę jest osobną przestrzenią o innym reżimie |

Nowe działy tematyczne dla klubu bezpieczeństwa (wytyczne §2, poziom „domena"):

```
Architektura bezpieczeństwa          bezpieczenstwo-architektura
  └── Wschodnia flanka i NATO        bezpieczenstwo-architektura-flanka
  └── Odstraszanie i eskalacja       bezpieczenstwo-architektura-odstraszanie
Zdolności i przemysł obronny         bezpieczenstwo-przemysl
Technologia i cyber                  bezpieczenstwo-tech
Odporność państwa i instytucji       panstwo-odpornosc
Gospodarka i suwerenność ekonomiczna gospodarka
Kuluary  (reżim Chatham House)       kuluary
```

Hierarchia jedzie z konwencji slugów (`buildClubGroupTree` w `src/lib/clubs/groupTree.ts`) — poddziały
działają bez migracji, wystarczy dyscyplina w nazywaniu.

**Alternatywa**, jeśli redakcja nie chce ruszać istniejących treści: zostawić pięć obecnych działów
jako „tryby pracy" i dołożyć oś tematyczną na `club_threads.topic` obok. Kosztuje mniej pracy
redakcyjnej, ale zostawia w produkcie dwie listy, które użytkownik i tak będzie mylił. Nie polecam.

---

## 3. Nowy układ huba klubu

### 3.1 Dziś

```
┌ LEWA (13.5rem) ────┬ ŚRODEK ───────────────────────┬ PRAWA (20rem) ──────┐
│ Strumień           │ [kompozytor]                  │ PULS KLUBU          │
│ Dokumenty          │ [szukaj] [sortowanie]         │  odpowiedzi 3       │
│ Kalendarz          │ [Wszystko|Wątki|Dok.|Terminy] │  aktywni 1          │
│ Harmonogram        │                               │  bez odpowiedzi 5   │
│ Dynamika           │ • wątek                       │ CO PRZED NAMI       │
│ Skład              │ • wątek                       │ BIEŻĄCY ETAP        │
│ ── GRUPY ──        │ • wątek                       │ ŚWIEŻE MATERIAŁY    │
│  Wszystkie grupy   │                               │ KTO TU ROZMAWIA     │
│  Debata otwarta 4  │                               │                     │
│  Akty prawne 0     │                               │                     │
│  Stanowiska klubu 1│                               │                     │
│  Biblioteka 1      │                               │                     │
│  Kuluary 1         │                               │                     │
│ ── OBSZAR TEM. ──  │                               │                     │
│  Bezpieczeństwo    │                               │                     │
│ Zasady klubu       │                               │                     │
└────────────────────┴───────────────────────────────┴─────────────────────┘
```

Trzy problemy widoczne z samego rysunku: „Biblioteka" dubluje „Dokumenty" dwa wiersze wyżej,
„Obszar tematyczny" to jeden nieklikalny chip pod listą, która sama miała być tematyczna,
a prawa kolumna otwiera się liczbą 3.

### 3.2 Propozycja

```
┌ LEWA (14rem) ──────┬ ŚRODEK ───────────────────────────┬ PRAWA (20rem) ──────┐
│ Strumień           │ ╔ CYKL: Q3/2026 ════════════════╗ │ DOROBEK KWARTAŁU    │
│ Dorobek        ←NOWE│ ║ Przyszłość NATO i architektury║ │  2 policy briefs    │
│ Dokumenty          │ ║ „Czy Polska powinna...?"      ║ │  1 scenario paper   │
│ Kalendarz          │ ║ ●───●───●───○───○  4/7 etapu  ║ │  3 rekomendacje     │
│ Harmonogram        │ ╚═══════════════════════════════╝ │  [zobacz dorobek]   │
│ Dynamika           │                                   │                     │
│ Skład              │ [kompozytor]                      │ NAJBLIŻSZA SESJA    │
│                    │ [szukaj]            [sortowanie]  │  12.09 · roundtable │
│ ── DZIAŁY TEMAT. ──│                                   │  briefing: 5.09     │
│  Wszystkie działy  │ Tryb: ⊙Wszystko ○Dyskusja ○Pytanie│  moderuje: ...      │
│  ▾ Architektura  6 │       ○Stanowisko ○Materiał ○Sondaż│  [agenda]           │
│    Wschodnia fl. 3 │                                   │                     │
│    Odstraszanie  2 │ Filtry: [zakotwiczone] [bez odp.] │ BIEŻĄCY ETAP        │
│  Zdolności       4 │                                   │ ŚWIEŻE MATERIAŁY    │
│  Technologia     2 │ • wątek  [Stanowisko] [⚓ akt]     │ KTO TU ROZMAWIA     │
│  Odporność pań.  1 │ • wątek  [Pytanie] [rozstrzygnięty]│ PULS (zwinięty)     │
│  🔒 Kuluary      1 │ • wątek  [Dyskusja]               │                     │
│ ── REŻIM ──        │                                   │                     │
│  Wypowiedzi podpis.│                                   │                     │
│  Kuluary: Chatham  │                                   │                     │
│ Zasady klubu       │                                   │                     │
└────────────────────┴───────────────────────────────────┴─────────────────────┘
```

Sześć zmian i powód każdej:

1. **Belka cyklu nad strumieniem.** Wytyczne §14 wymagają kwartalnego rytmu tematycznego. Belka
   niesie pytanie przewodnie kwartału — a wytyczne §5 pokazują na przykładzie, że różnica między
   „Porozmawiajmy o bezpieczeństwie Europy" a „Czy Polska powinna inwestować w strategiczną
   autonomię przemysłową, nawet kosztem krótkoterminowej efektywności?" jest różnicą między salonem
   a think tankiem. Pytanie przewodnie musi stać na ekranie, nie w opisie wydarzenia.
2. **„Dorobek" jako druga pozycja w szynie**, zaraz po Strumieniu. To jest ta jedna zmiana, która
   odróżnia klub dyskusyjny od think tanku na poziomie pierwszego spojrzenia.
3. **„Biblioteka" znika z listy działów** — została „Dokumentami" w szynie sekcji.
4. **Tryb pracy jako chipy nad strumieniem**, nie jako dział. Sześć wartości `club_threads.kind`
   już istnieje w bazie i jest renderowanych na wierszu wątku; brakuje wyłącznie filtra.
5. **Reżim jako znacznik, nie jako pozycja listy.** Kłódka przy „Kuluarach" i zdanie w szynie
   („Wypowiedzi podpisane; Kuluary: reguła Chatham House") robią to, co wytyczne §6 nazywają
   „jasnym określeniem, co jest poufne" — bez wchodzenia w ustawienia.
6. **Prawa kolumna otwiera się dorobkiem, nie pulsem.** Puls schodzi na dół i zostaje zwinięty.

### 3.3 Telefon

Kolejność bez zmian względem dzisiejszej doktryny (treść pierwsza, kontekst pod spodem), z jednym
dodatkiem: belka cyklu zostaje NAD strumieniem także na telefonie, bo jest jednozdaniowa i niesie
pytanie przewodnie. Poziomy pasek działów, który już istnieje (`ClubGroupBar`), dostaje drugi rząd
na chipy trybu pracy.

---

## 4. Nowa powierzchnia: DOROBEK

Wytyczne §7 i §8 wymagają, żeby każde spotkanie kończyło się produktem, a klub działał „jak system
produktów, nie jak pojedynczy format wydarzeniowy". Dziś te produkty są dokumentami w bibliotece —
czyli leżą obok materiałów źródłowych, notatek i prezentacji, bez rozróżnienia.

Mapowanie wytycznych na obecny słownik `CLUB_DOCUMENT_KINDS`:

| Produkt z wytycznych §7                     | Dziś                                                       | Propozycja                                      |
| ------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| Briefing PRZED spotkaniem (5–10 stron)      | `brief`                                                    | `brief` — bez zmian                             |
| Discussion Note                             | —                                                          | `discussion_note`                               |
| Policy Brief                                | `brief` (**kolizja**)                                      | `policy_brief`                                  |
| Scenario Paper                              | —                                                          | `scenario`                                      |
| Strategic Memo                              | —                                                          | `memo`                                          |
| Research Agenda                             | —                                                          | `research_agenda`                               |
| Public Insight                              | —                                                          | `public_insight`                                |
| Internal Decision Memo                      | —                                                          | `decision_memo` (+ `visibility = 'moderators'`) |
| Minutes / synteza                           | `minutes`                                                  | bez zmian                                       |
| Analiza, dane, stanowisko, akt, prezentacja | `analysis`, `dataset`, `position`, `legal`, `presentation` | bez zmian                                       |

**Kolizja `brief` jest istotna.** Ta sama wartość oznacza dziś materiał, który powstaje PRZED
spotkaniem, i produkt, który powstaje PO. To są dwa końce procesu i mieszanie ich w jednym filtrze
sprawia, że nie da się odpowiedzieć na pytanie „co ten klub wyprodukował".

Ekran „Dorobek" = biblioteka zawężona do produktów, pogrupowana po kwartale cyklu, z licznikiem
na górze i statusem („w recenzji" / „opublikowany" / „wewnętrzny"). Reużywa `ClubDocumentLibrary`,
nie wymaga nowego zapytania.

---

## 5. Cykl kwartalny

Wytyczne §14: kwartał = jeden strategiczny problem, siedem kroków (briefing otwierający → sesja
ekspercka → dyskusja członków → grupa robocza → dokument końcowy → prezentacja wniosków → ewaluacja).

Do zbudowania z tego, co jest: `club_milestones` ma już `planned/active/done/blocked/cancelled`,
daty i powiązanie z wątkiem. Brakuje **nagłówka cyklu**: nazwy kwartału i pytania przewodniego.

Minimalna zmiana: tabela `club_cycles (id, club_id, label_pl/en, question_pl/en, starts_on, ends_on,
status)` + `club_milestones.cycle_id`. Bez tego siedem etapów jest listą zadań, a nie cyklem —
i nie da się powiedzieć, do czego zmierza kwartał.

---

## 6. Standard spotkania

Wytyczne §5 opisują spotkanie jako **zaprojektowany format**, nie kalendarzowy wpis:
7 bloków czasowych, jedno pytanie przewodnie, briefing, moderator, osoba sporządzająca syntezę,
zdefiniowany rezultat, follow-up.

`club_events` ma dziś rodzaj (`meeting`/`briefing`/`workshop`/…), datę, miejsce, link, RSVP i pojemność.
Do dołożenia, żeby kalendarz przestał być listą dat:

- `question_pl/en` — pytanie przewodnie sesji,
- `agenda` (jsonb) — bloki z czasami, wypełniane z szablonu 120-minutowego,
- `moderator_id`, `rapporteur_id` — moderator i autor syntezy (wytyczne §5 wymagają obu),
- `briefing_document_id` — materiał do przeczytania przed,
- `outcome_document_id` — produkt po; jego brak po zamkniętym spotkaniu to sygnał, nie luka w danych.

Ostatnie dwa pola robią z kalendarza **pętlę**: briefing → sesja → produkt. Bez nich klub ma
wydarzenia i dokumenty, ale nie ma procesu.

---

## 7. Członkostwo

Dziś `club_members.role` = `lead` / `moderator` / `member` / `observer`. To jest oś **uprawnień**.

Wytyczne §3 opisują Founding Members / Full Members / Fellows / Young Leaders / Institutional
Partners. To jest oś **statusu i trybu uczestnictwa** — i nie wolno jej zlepić z uprawnieniami:
Fellow bywa najważniejszą osobą w sali bez żadnych praw moderacyjnych, a moderator operacyjny
nie musi być członkiem założycielem.

Propozycja: `club_members.membership_class` jako osobna kolumna, odznaka w „Składzie" i w profilu,
filtr na liście członków. Bez zmian w macierzy uprawnień — `club_capabilities()` zostaje nietknięte.

Kadencyjność z wytycznych §4 **jest już zaimplementowana**: `club_members.role_expires_at` istnieje
od migracji `20260807152937`, a panel pokazuje ją jako „Kadencja do". Brakuje wyłącznie widoku
„kadencje wygasające w ciągu 60 dni" dla prowadzących.

---

## 8. Baza wiedzy i poufność

Wytyczne §12 wymagają tagowania materiałów po: regionie, temacie, horyzoncie czasowym, poziomie
poufności, typie źródła, autorze, jakości dowodów i powiązanych projektach.

Dziś `club_documents` niesie: rodzaj, język, `source_label`, dział, wątek, widoczność (`club` /
`moderators`), wersję. Do dołożenia: `region`, `horizon` (0–2 / 2–5 / 5–15 lat), `evidence_grade`,
`confidentiality`.

**Poufność zasługuje na osobne zdanie.** Dziś ma dwie wartości, a wytyczne §6 wymagają jawnego
rozstrzygnięcia czterech rzeczy naraz: co jest poufne, co można publikować, czy wypowiedzi są
cytowalne, kto ma dostęp do notatek. Propozycja: cztery poziomy — `public` / `members` / `chatham`
(treść cytowalna, tożsamość nie) / `restricted` — widoczne jako znacznik na każdym materiale
i na każdym wątku. Reguła Chatham House jest dziś przełącznikiem klubu i działu; brakuje jej
na poziomie pojedynczego materiału.

---

## 9. Metryki jakości

Dzisiejsza „Dynamika": nowe wątki, odpowiedzi, aktywni, mediana pierwszej odpowiedzi, bez odpowiedzi,
dokumenty, nadchodzące wpisy, otwarte etapy, rozkład na działy i rodzaje.

To są metryki **ruchu**. Wytyczne §13 dokładają metryki **jakości**:

| Wskaźnik z wytycznych                            | Da się policzyć dziś?                               |
| ------------------------------------------------ | --------------------------------------------------- |
| Odsetek uczestników wracających na kolejne sesje | tak — `club_event_rsvp` po osobach, brak widoku     |
| Frekwencja członków                              | tak — RSVP `going` vs. obecni, brak pola „obecny"   |
| Liczba ukończonych analiz                        | po rozdzieleniu produktów (§4)                      |
| Liczba rekomendacji                              | wymaga nowego bytu lub konwencji na `decision_memo` |
| Liczba współprac między członkami                | częściowo — współautorstwo dokumentów               |
| Cytowania publikacji                             | nie — wymaga danych z zewnątrz                      |
| Ocena jakości moderacji                          | nie — wymaga ankiety po sesji                       |

Do tego **test trzech pytań** z wytycznych §13, zadawany po każdym spotkaniu (czy uczestnicy
dowiedzieli się czegoś nowego / czy zmieniła się ich ocena problemu / czy powstała konkretna idea).
To jest mikroankieta na trzy kliknięcia — mechanizm sondaży (`club_polls`) już istnieje i wystarczy
podpiąć go pod zamknięcie wydarzenia.

---

## 10. Mapa: wytyczne → stan modułu

| §   | Wymóg                                                            | Stan                                                             | Luka                                                        |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | Tożsamość i pozycjonowanie                                       | opis, hasło, zasady, okładka                                     | pozycjonowanie („czym to NIE jest") nie ma miejsca w UI     |
| 2   | Zakres tematyczny, 3 poziomy (diagnoza/interpretacja/implikacje) | katalog obszarów + `topic` na wątku                              | oś tematyczna niewidoczna w klubie; brak trzech poziomów    |
| 3   | Pięć kategorii członkostwa                                       | role uprawnień                                                   | brak klasy członkostwa                                      |
| 4   | Zarządzanie, rada, kadencje                                      | role + `role_expires_at`                                         | brak rady programowej i widoku kadencji                     |
| 5   | Standard spotkania (7 bloków)                                    | `club_events` z rodzajami                                        | brak agendy, pytania, moderatora, syntezy                   |
| 6   | Zasady debaty i poufność                                         | zasady klubu + Chatham House + zgłoszenia                        | poufność dwuwartościowa, nie czterowartościowa              |
| 7   | Warstwa badawcza (briefing → produkt)                            | dokumenty z rodzajami                                            | kolizja `brief`, brak siedmiu typów produktów               |
| 8   | Produkty klubu                                                   | biblioteka                                                       | brak wydzielonego „Dorobku"                                 |
| 9   | Elitarność i dostęp                                              | widoczność ×4, polityka wstępu ×3, progi planu                   | pełne pokrycie                                              |
| 10  | Niezależność i etyka                                             | —                                                                | brak deklaracji konfliktu interesów i polityki finansowania |
| 11  | Finansowanie                                                     | progi planu, płatności                                           | brak oznaczania materiałów sponsorowanych                   |
| 12  | Warstwa cyfrowa                                                  | portal, biblioteka, kalendarz, sondaże, wyszukiwarka semantyczna | brak tagowania bazy wiedzy                                  |
| 13  | Mierzenie jakości                                                | metryki ruchu                                                    | brak metryk dorobku i testu trzech pytań                    |
| 14  | Cykl roczny/kwartalny                                            | harmonogram etapów                                               | brak nagłówka cyklu i pytania przewodniego                  |
| 15  | Wersja minimalna i docelowa                                      | —                                                                | decyzja produktowa, nie techniczna                          |

Pełne pokrycie: **§9**. Blisko: §1, §4, §12. Największe luki: **§7, §8, §13, §14** — i wszystkie
cztery dotyczą tego samego: **klub nie pokazuje, co wyprodukował.**

---

## 11. Etapy

| Etap   | Zakres                                                                                                                  | Migracja                                   | Stan         |
| ------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------ |
| **E0** | nazewnictwo: „Grupy" → „Działy tematyczne" (PL), „Groups" → „Topic sections" (EN), w hubie, panelu i katalogu elementów | nie                                        | **wdrożone** |
| **E1** | rozdzielenie osi: chipy trybu pracy, filtry kotwicy i nieprzeczytanych, znacznik reżimu, panel reżimu w szynie          | nie                                        | **wdrożone** |
| **E2** | „Dorobek": rozdzielenie `brief`, siedem rodzajów produktu, zakres biblioteki, panel dorobku w prawej kolumnie           | tak (A29)                                  | **wdrożone** |
| **E3** | cykl kwartalny + standard spotkania (agenda, pytanie przewodnie, moderator, synteza, briefing → produkt)                | tak (`club_cycles`, kolumny `club_events`) | do decyzji   |
| **E4** | klasy członkostwa, metryki jakości, test trzech pytań, tagowanie bazy wiedzy, czterostopniowa poufność                  | tak                                        | do decyzji   |

### Co dokładnie weszło (E0–E2)

**Warstwa danych — migracja `20260809000000_discussion_clubs_a29_*`:**

- `club_documents.kind` rozszerzony o siedem rodzajów produktu (`discussion_note`,
  `policy_brief`, `scenario`, `memo`, `research_agenda`, `public_insight`, `decision_memo`);
  `brief` znaczy od teraz wyłącznie briefing przedsesyjny;
- `club_documents_list` przyjmuje `p_kinds text[]` — zawężenie po ZBIORZE rodzajów. Bez tego
  „Dorobek" musiałby odsiewać rodzaje po stronie klienta, a `total_count` liczy się w oknie
  PRZED limitem: licznik i paginacja mówiłyby o innym zbiorze niż lista pod nimi;
- pięć działów klubu referencyjnego przebudowanych na cztery tematyczne
  (Architektura bezpieczeństwa → poddział Wschodnia flanka i NATO, Zdolności i przemysł obronny,
  Technologia i cyber) plus Kuluary jako reżim. Wątki przeniesione **po slugu, nie hurtem**:
  „Debata otwarta" trzymała i wątek o zdolnościach przemysłowych, i sondaż porządkowy klubu,
  więc przeniesienie całego działu w jedno miejsce powtórzyłoby błąd, który ta migracja naprawia.

Dwie rzeczy, które ta migracja robi **ostrożnie**. Po pierwsze, cała przebudowa działów stoi za
bramką porównującą slug ORAZ obie nazwy z tym, co zasiał A20 — jeśli redakcja tknęła którykolwiek
dział, blok kończy się `NOTICE` i nie zmienia niczego. Po drugie, opróżnione działy idą na
`archived`, a nie do kosza: znikają z szyny członka, ale zarządzający widzi je dalej i może cofnąć
decyzję. Licznik wątków jest przeliczany jawnie, bo trigger reaguje na `UPDATE OF status`,
a nie na `group_id` — dokładnie z tego powodu robi to też `admin_club_thread_move`.

**Warstwa interfejsu:**

- `ClubStreamFilters` — chipy rodzaju wątku (6 wartości `club_threads.kind`) plus filtry
  „tylko zakotwiczone" i „tylko nieprzeczytane". Wszystko idzie do RPC (`p_kind`, `p_anchored`,
  `p_unread_only` istnieją od A26), nie do przeglądarki;
- włączenie zawężenia wątkowego w trybie „Wszystko" przestawia strumień na „Wątki" — widocznie,
  bo rusza się segmentowany przełącznik obok. Inaczej filtr rodzaju wyglądałby na zepsuty,
  skoro dokumenty i terminy go nie dotyczą;
- `ClubRegimeMark` — znacznik przy dziale, który NADPISUJE regułę klubu (Chatham House albo
  zawężoną widoczność). Dział dziedziczący nie dostaje nic: znacznik przy każdej pozycji
  nie znaczy nic;
- panel „Reżim" w szynie: zdanie o atrybucji klubu plus lista działów z własnym reżimem;
- biblioteka dostała przełącznik zakresu **Wszystko / Dorobek / Materiały**, a chipy rodzaju
  idą za zakresem — rodzaj spoza zakresu zwróciłby pustkę;
- panel „Dorobek klubu" otwiera prawą kolumnę, „Puls" schodzi na koniec. Panel **nie znika przy
  zerze**: klub bez ani jednego produktu ma to zobaczyć, bo to jest informacja o klubie,
  a nie brak danych do ukrycia.

---

## 12. Decyzje, których nie podejmę bez Was

1. ~~Czy przebudowujemy pięć obecnych działów na tematyczne?~~ **Rozstrzygnięte: tak.** Działy
   tematyczne są bytem klubowym (`club_groups`) i zostały przebudowane migracją A29. Otwarte
   zostaje jedno: **czy nazwy czterech nowych działów są tymi, których chce redakcja** — dobrałem
   je z domen wytycznych §2 pod profil klubu bezpieczeństwa, ale to jest decyzja redakcyjna
   i zmiana nazwy nie wymaga migracji.
2. **Czy „Dorobek" jest widoczny publicznie** dla klubów `public`? Wytyczne §8 rozróżniają produkty
   zamknięte i publiczne — to jest decyzja o tym, czy klub jest też lejkiem pozyskania.
3. **Czy cykl jest kwartalny, czy dowiązany do procesu legislacyjnego?** Klub referencyjny deklaruje
   rytm procesu legislacyjnego, a wytyczne proponują kwartały. Kalendarz UE nie chodzi w kwartałach.
4. **Kto jest „Radą programową" w modelu uprawnień?** Nowa rola, czy `lead` z klasą członkostwa
   „Founding"? Od tego zależy, czy §4 wymaga migracji.
5. **Poziom poufności na materiale — czy dziedziczy z działu, czy jest ustawiany zawsze jawnie?**
   Dziedziczenie jest wygodniejsze; jawność jest bezpieczniejsza i zgodna z duchem §6.
