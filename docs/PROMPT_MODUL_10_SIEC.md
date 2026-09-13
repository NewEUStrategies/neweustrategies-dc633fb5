# ZLECENIE: MODUŁ 10 - Sieć / networking

> **HEAD pomiaru: `7a780b1d0`.** Każda liczba w tym dokumencie została zmierzona na tym commicie.
> Jeżeli pracujesz na nowszym `main`, **przemierz przed startem** - i jeśli któraś liczba się rozjechała,
> napisz o tym w opisie PR-a zamiast dopasowywać się do nieaktualnego zlecenia. Ta uwaga stoi tu,
> bo w wydaniu 10 trzy z siedmiu pozycji erraty wykonawcy wzięły się z czytania zlecenia na innym HEAD,
> niż powstało (rozdz. 8.5 audytu, pozycja 16).
>
> **Stan na dzień oddania zlecenia:** między `7a780b1d0` a commitem, który wnosi ten plik, nie zmienił
> się ani jeden plik w `src/`, `supabase/` ani `drizzle/`. Liczby niżej obowiązują więc także na
> dzisiejszym `main`. Sprawdzisz to jednym poleceniem:
> `git diff --name-only 7a780b1d0..HEAD -- src/ supabase/ drizzle/` ma nie wypisać nic.

Źródło: `docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`, rozdz. 15.15 (defekty) i 15.16
(rodzaj testu per moduł). Wszystkie osiem defektów wymienionych niżej przeszło **niezależną próbę
obalenia** przez osobnego agenta i zostało potwierdzone. Trzy miejsca, które rozszerzają zgłoszenie
poza jego pierwotny zakres, są w tekście oznaczone słowem **SZERZEJ** wraz z dowodem.

---

## 0. Stan wyjściowy - zmierzony, nie przepisany

| Metryka                       | Wartość na `7a780b1d0`                        |
| ----------------------------- | --------------------------------------------- |
| Pliki produkcyjne             | 32 (5 206 wierszy)                            |
| Pliki testowe                 | 23 (350 przypadków `it`/`test`, 0 `it.fails`) |
| Trasy                         | 2 (`/network`, `/network/mutual/$userId`)     |
| Linie                         | **83,65 %** (701/838)                         |
| Funkcje                       | **81,85 %** (248/303)                         |
| Gałęzie                       | **67,98 %** (654/962)                         |
| Pliki z pokryciem zerowym     | 3 (155 wierszy instrukcji)                    |
| Testy pgTAP dotykające modułu | 6 plików                                      |

### 0.1. Ten moduł to dwie populacje, nie jedna

Średnia 83,65 % nie opisuje tu niczego, bo pod nią stoją dwa rozłączne zbiory plików o zupełnie
różnym stanie dowodu:

| Populacja                      | Linie                 | Funkcje           | Gałęzie            |
| ------------------------------ | --------------------- | ----------------- | ------------------ |
| **28 plików objętych progiem** | **99,71 %** (682/684) | **99,59 %**       | 87,55 %            |
| **4 pliki bez żadnego progu**  | **12,34 %** (19/154)  | **8,47 %** (5/59) | **3,14 %** (7/223) |

Te cztery pliki to:

```
src/routes/network.tsx                 0 %   120 wierszy instrukcji
src/routes/network.mutual.$userId.tsx  0 %    24
src/hooks/useFollowedFeed.ts           0 %    11
src/hooks/useFollows.ts             82,6 %   (pokrycie uboczne, bez własnego testu)
```

Trzy pierwsze mają zero. Czwarty ma 82,6 % i **nie ma ani jednego własnego testu** - liczba bierze się
z `FollowButton.test.tsx`, `LoginPopup.test.tsx`, `profileListRoutes.test.tsx` i `readingListRoute.test.tsx`,
które wołają go przy okazji swojego tematu. **To jest pokrycie bez kontraktu**: nikt nie zapisał,
co ten hook ma robić, więc zmiana jego zachowania nie ma jak zapalić czerwieni u siebie - zapali ją
gdzie indziej, w cudzym teście, z cudzym komunikatem.

Te cztery pliki trzymają **223 z 962 gałęzi modułu (23 %)**, z czego pokrytych jest siedem.
Cała dziura gałęziowa modułu siedzi tutaj.

### 0.2. Zbieżność nie jest przypadkowa

Progów pasujących do plików modułu 10 są dokładnie dwa:

```
src/lib/network/**        8 plików   statements 85 / functions 95 / lines 95 / branches 65
src/components/network/** 20 plików  statements 97 / functions 98 / lines 98 / branches 92
```

**Zbiór „bez progu" i zbiór „bez dowodu" to ten sam zbiór, co do pliku.** To nie jest korelacja
przypadkowa: próg per ścieżka jest w tym repozytorium jedynym mechanizmem, który zauważa, że czegoś
nie ma. Dwie trasy i dwa hooki obserwowania wypadły spod obu globów, więc przez cały czas życia modułu
nikt nie dostał o nich sygnału.

Oba istniejące progi mają zresztą zapas do podniesienia, zmierzony:
`src/lib/network/**` ma gałęzie 73,25 % przy progu 65, `src/components/network/**` ma 93,93 % przy 92.

---

## 1. Pozycje BLOKUJĄCE - dwa defekty o wadze wysokiej

### A1. Tryb „prywatny" w „Kto oglądał Twój profil" nie działa, a jego skutek jest odwrotny do obiecanego

**Gdzie:** `supabase/migrations/20260718215718_df61e0ac-a9af-4ff0-bbd0-2b693090f9ec.sql`, funkcje
`record_profile_view` (linie 210-232), `my_profile_viewers` (234-253) i `profile_view_stats` (255-262).

**Co jest.** Zabezpieczenie przed powtórzeniem sprawdza jedno, a wstawka zapisuje co innego:

```sql
IF EXISTS (SELECT 1 FROM public.profile_view_events
            WHERE profile_id = p_profile AND viewer_id = auth.uid()
              AND viewed_at > now() - INTERVAL '1 hour') THEN RETURN; END IF;
INSERT INTO public.profile_view_events (..., viewer_id, viewer_mode, ...)
VALUES (..., CASE WHEN v_mode = 'private' THEN NULL ELSE auth.uid() END, v_mode, ...);
```

Dla trybu `private` kolumna `viewer_id` dostaje `NULL`, więc warunek `viewer_id = auth.uid()` nigdy
nie trafi w istniejący wiersz. Z tego wynikają trzy rzeczy naraz:

1. **Debounce godzinny nie obowiązuje prywatnych.** Każde wejście na profil to nowy wiersz.
2. `my_profile_viewers` filtruje wyłącznie `e.profile_id = auth.uid()`. Wiersz prywatnego widza
   **jest zwracany** - tylko z wymaskowanymi polami, czyli wygląda jak anonim.
3. `profile_view_stats` liczy `COUNT(*)` bez filtra po `viewer_mode`, więc **każda z tych wizyt
   podbija licznik 7/30/90 dni**.

**Dlaczego to jest blokujące.** Prywatność jest tu obietnicą złożoną wprost, w dwóch miejscach kodu:

- `src/components/network/ProfileViewsCard.tsx:5-6`: „anonimowi widzowie są maskowani w bazie,
  **prywatni w ogóle nie trafiają na listę**";
- `src/lib/network/useProfileViews.ts:2-3`: „zapisuje obejrzenie **z debouncingiem po stronie bazy**
  (jedno zdarzenie / godzinę / para viewer-profile)".

Oba zdania są nieprawdziwe. Gorzej: użytkownik, który świadomie wybrał `private`, **zostawia na cudzym
profilu więcej śladu niż użytkownik publiczny**, bo jako jedyny nie podlega debounce'owi. Dziesięć wejść
publicznego widza to jeden wiersz i jeden punkt w liczniku; dziesięć wejść prywatnego to dziesięć wierszy
i dziesięć punktów. Ustawienie prywatności działa dokładnie na odwrót niż głosi jego etykieta.

**Co zrobić.** Rozstrzygnij najpierw, co `private` ma znaczyć, bo z tego wynika kształt poprawki:

- **(a) prywatny nie zostawia śladu** - `record_profile_view` w trybie `private` wychodzi przez `RETURN`
  przed `INSERT`. Najprostsze, spójne z tekstem w `ProfileViewsCard`, ale traci sygnał dla przyszłych
  agregatów.
- **(b) prywatny zostawia ślad niewidoczny** - wiersz powstaje z `viewer_id` zapisanym zawsze, a odsiew
  przenosi się do odczytu: `my_profile_viewers` i `profile_view_stats` dostają `WHERE viewer_mode <> 'private'`.
  Zachowuje dane, wymaga dyscypliny przy każdym nowym czytelniku tej tabeli.

**Niezależnie od wyboru: dedup musi przestać zależeć od trybu.** Oprzyj go na parze
`(profile_id, viewer_id)` zapisywanej zawsze, albo na osobnej kolumnie identyfikującej widza.
Warunek, który dziś nie trafia, to nie jest „brak debounce'u dla jednego trybu" - to jest
warunek nieprawdziwy z założenia.

Wybór uzasadnij w opisie PR-a. Nie zostawiaj stanu, w którym wiersz nie trafia na listę,
ale nadal liczy się do statystyk.

**Kryterium odbioru.** Nowy plik pgTAP `supabase/tests/profile_view_privacy_test.sql`:
prywatny widz odwiedza cudzy profil trzy razy pod rząd i po tych trzech wywołaniach
**ani `my_profile_viewers` nie zwraca jego wiersza, ani `profile_view_stats` nie drgnął**;
osobno: widz publiczny odwiedza dwa razy w ciągu godziny i zostawia **jeden** wiersz.
Dziś żaden test pgTAP nie dotyka `profile_view_events` ani razu - sprawdziłem grepem po
`supabase/tests/`, trafienia w `network_event_notifications_test.sql` dotyczą wyłącznie
preferencji powiadomień (`enabled_profile_view`), nie zapisu odsłon.

---

### A2. `request_introduction` pomija trzy bramki, które ma jego własny wzorzec

**Gdzie:** `supabase/migrations/20260718215718_df61e0ac-a9af-4ff0-bbd0-2b693090f9ec.sql:265-287`.

**Co jest.** Cała walidacja prośby o wprowadzenie to:

```
_are_connected(auth.uid(), p_bridge)     -- most jest moim kontaktem
_are_connected(p_bridge, p_target)       -- most zna cel
NOT _are_connected(auth.uid(), p_target) -- jeszcze nie znam celu
limit 5 oczekujących / 24 h
```

Brakuje trzech bramek, które ma `connection_request` w `20260717170000_connections_v2.sql:95-140`:

| Bramka                              | `connection_request` | `request_introduction` |
| ----------------------------------- | -------------------- | ---------------------- |
| `is_blocked_pair`                   | linia 102            | **brak**               |
| `profiles.discoverable` celu        | linia 136            | **brak**               |
| `connections_allowed_from(cel, ja)` | linia 137            | **brak**               |

**Dlaczego to jest blokujące.** Te trzy bramki to cała treść prywatności tego modułu. Osoba, która
mnie zablokowała, albo która wyłączyła przyjmowanie zaproszeń, albo która zdjęła `discoverable`,
**nadal jest osiągalna drogą wprowadzenia** - i to nie teoretycznie: przy statusie `forwarded`
wyzwalacz `tg_introduction_notify` wysyła jej powiadomienie
(`20260812101000_pgtap_cluster_c_fix.sql:125`). Blokada nie blokuje, wyłączenie nie wyłącza.
Nagłówek `src/lib/network/useIntroductions.ts:7` deklaruje przy tym wprost: „target musi zezwalać
na komunikację (allowConnections)".

**Czego tu NIE ma, choć wygląda podobnie.** Izolacja najemcy **jest zachowana** i nie dokładaj do niej
sprawdzenia. Wynika przechodnio: most jest moim zaakceptowanym kontaktem, cel jest zaakceptowanym
kontaktem mostu, a oba wejścia do `user_connections` wymuszają równość najemcy
(`connection_request` w `20260717170000_connections_v2.sql:109-111`, `auto_connect_experts`
w `20260723133949_...sql:24` przez `pb.tenant_id = pa.tenant_id`), przy czym `authenticated` nie ma
na tej tabeli grantu zapisu. Piszę to jawnie, żebyś nie zmarnował rundy na dowodzenie dziury,
której nie ma - i żebyś nie dołożył warunku, który niczego nie zmienia, a zaciemnia funkcję.

**Co zrobić.** Skopiuj bramki z `connection_request` **razem z ich dyscypliną prywatności**: tam
niedostępność adresata i jego ustawienie zwracają **ten sam** wyjątek (`'connections: peer not available'`,
linie 136-139), bo różne komunikaty zdradzają ustawienie prywatności osobie, która nie ma prawa go znać.
Wprowadzenia muszą to zachowanie powtórzyć, nie wymyślać własne.

**Kryterium odbioru.** Rozszerz `supabase/tests/introductions_flow_test.sql` o trzy przypadki
`throws_ok`: blokada pary, `discoverable = false` u celu, `connections_allowed_from` odmawiające -
każdy z **identycznym** komunikatem. Zwróć uwagę, że ten plik ma dziś `plan(6)` i **ani razu nie woła
`request_introduction`** (grep po całym `supabase/tests/` daje zero trafień). Testuje wyłącznie
`respond_introduction` i `my_introduction_requests`, czyli drugą połowę przepływu. Pierwsza połowa -
ta, która zapisuje wiersze i ma dziury - nie ma dowodu wykonania w ogóle.

---

## 2. Pozycje zwykłe - cztery defekty o wadze średniej i dwa niskie

### A3. Deduplikacja prośby o wprowadzenie istnieje tylko w komentarzu i w kliencie (średni)

**Gdzie:** `src/lib/network/useIntroductions.ts:8`, tabela `introduction_requests`
w `20260718215718_...sql:76-91`, funkcja `request_introduction` tamże.

**Co jest.** Komentarz kontraktowy obiecuje „jeden aktywny request na trójkę (**deduplikacja w bazie**)".
W bazie nie ma niczego takiego: tabela ma `PRIMARY KEY`, trzy `CHECK` i dwa zwykłe indeksy
(`idx_intro_bridge`, `idx_intro_requester`) - **ani `UNIQUE`, ani indeksu częściowego**. Sama funkcja
nie robi `SELECT` sprawdzającego istniejący wiersz. Jedyną ochroną jest `usedBridges` liczone w kliencie
z propsa `existing` (`RequestIntroductionDialog.tsx:54-63`), karmionego zapytaniem o `staleTime: 15_000`
(`RequestIntroductionButton.tsx:33`). Dwie karty otwarte obok siebie, albo jedno kliknięcie w oknie
nieodświeżonych 15 sekund, i most dostaje tę samą prośbę drugi raz.

**Co zrobić.** Wzorzec stoi w tym samym repozytorium: `user_connections_pair_uidx`
(`20260723133949_...sql:2-3`) to unikalny indeks na uporządkowanej parze, a wołający obsługuje
`unique_violation` w bloku `EXCEPTION` (linia 34). Powtórz to:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS introduction_requests_active_uidx
  ON public.introduction_requests (requester_id, bridge_id, target_id)
  WHERE status = 'pending';
```

i w `request_introduction` przechwyć `unique_violation`, **zwracając `id` istniejącego wiersza**,
nie rzucając wyjątkiem - powtórne kliknięcie ma być bezszkodliwe, a nie głośne. Po tej zmianie
`usedBridges` w kliencie zostaje jako wygoda interfejsu, ale przestaje być jedyną ochroną.

**Kryterium odbioru:** przypadek w `introductions_flow_test.sql`, w którym `request_introduction`
wołane dwa razy z tymi samymi trzema identyfikatorami zostawia **jeden** wiersz i zwraca **to samo** `id`.

---

### A4. „N wspólnych kontaktów" liczy co innego niż lista, do której prowadzi (średni)

**Gdzie:** `src/components/network/MutualConnectionsHint.tsx:19-27`; CTE `mutual`
w `supabase/migrations/20260812100500_pgtap_cluster_b_fix.sql:97-105`; `mutual_connections`
w `20260724110537_3fa530d6-c01a-4b82-ad15-f7fc723b987c.sql:46-68`.

**Co jest.** Podpowiedź pokazuje `mutualCount` z `connection_statuses` i linkuje do
`/network/mutual/$userId`, którą zasila `mutual_connections`. To dwa różne zbiory:

- CTE `mutual` to czysty `JOIN user_connections x mine` z `GROUP BY`. **Nie dotyka `profiles` w ogóle**,
  więc nie zna ani `discoverable`, ani najemcy.
- `mutual_connections` kończy się `WHERE ... AND p.tenant_id = me.tenant_id AND p.discoverable = true`.

Liczba jest więc systematycznie większa lub równa długości listy. Kliknięcie w „7 wspólnych kontaktów"
prowadzi na stronę pokazującą czterech i nie tłumaczącą różnicy. Ten sam `mutualCount` bramkuje ponadto
przycisk prośby o wprowadzenie (`RequestIntroductionButton.tsx:55`), więc CTA potrafi się pojawić przy
zerowej liście mostów do wybrania.

**Co zrobić.** Rozstrzygnij, co ta liczba znaczy, i wymuś jedną definicję we wszystkich trzech
miejscach (`connection_statuses`, `connection_suggestions`, `mutual_connections`). Rekomendacja:
**liczba ma opisywać to, co użytkownik zobaczy po kliknięciu** - czyli CTE `mutual` dostaje `JOIN profiles`
z tymi samymi dwoma warunkami. Jeżeli pełna liczba jest potrzebna do rankingu sugestii, zwracaj
**obie** (`mutual_count` i `mutual_visible_count`) i w podpowiedzi pokazuj tę drugą.

**Kryterium odbioru:** przypadek pgTAP, w którym wspólny kontakt ma `discoverable = false`,
a `connection_statuses` i `mutual_connections` zgadzają się co do liczby; plus test
`MutualConnectionsHint`, że renderuje tę wartość, którą wyświetli trasa docelowa.

---

### A5. Skrzynka zaproszeń jest ucięta na 50 wierszach, a licznik obok mówi prawdę (średni)

**Gdzie:** `src/lib/network/useConnections.ts:135-150`; RPC `my_connection_requests`
w `20260717162432_436f3a05-2743-4686-976d-fda5a4db740a.sql:432-457`; `RequestsTab`
w `src/routes/network.tsx:484-497`; odznaki zakładek tamże, linie 830 i 836.

**Co jest.** Hook woła RPC z `p_limit: 50` i **nie przekazuje `p_offset`**; RPC klamruje limit
do 50 (`LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50)`), więc pięćdziesiąt to twardy sufit.
Wiersz niesie `total_count`, ale hook go nie czyta (`return data ?? []`). `RequestsTab` renderuje
`requestsQ.data ?? []` bez „pokaż więcej" i bez śladu, że coś obcięto. Odznaka zakładki bierze
tymczasem `pending_in` / `pending_out` z `my_network_counts`, który liczy `COUNT(*)` po całej tabeli.
Użytkownik z 60 zaproszeniami widzi **odznakę „60" nad listą pokazującą 50** i nie ma jak dojść
do pozostałych dziesięciu.

**Co zrobić.** Przepnij `useConnectionRequests` na `useInfiniteQuery` z `p_offset` i `total_count`
(RPC zwraca oba), a w `RequestsTab` dołóż przycisk dociągania kolejnej strony - dokładnie tak,
jak działa już zakładka kontaktów obok (`useMyConnections`, `src/lib/network/useConnections.ts:110`).
Wzorzec jest w tym samym pliku; to jest wyrównanie do niego, nie nowy mechanizm.

**SZERZEJ, niż zgłoszono.** Ta sama klasa błędu siedzi na drugiej trasie modułu:
`src/routes/network.mutual.$userId.tsx:77-81` woła `mutual_connections` z **zapisanymi na sztywno**
`p_limit: 100, p_offset: 0`, a w linii 94 pokazuje `total = rows[0]?.total_count ?? 0`. Przy 150
wspólnych kontaktach strona **napisze 150 i pokaże 100**. RPC obsługuje `p_offset` i klamruje limit
do 100 (`20260724110537_...sql:67-68`), więc brakuje wyłącznie strony klienta. Napraw oba miejsca
w jednym PR - to jeden defekt w dwóch instancjach, nie dwa.

**Kryterium odbioru:** test hooka na stronicowanie (drugie wywołanie z `p_offset` równym długości
pierwszej strony) oraz test trasy, że przy `total_count` większym od długości listy renderuje się
kontrolka dociągania.

---

### A6. Kotwica deep-linku z powiadomień nie istnieje w DOM (średni)

**Gdzie:** producent w `supabase/migrations/20260812101000_pgtap_cluster_c_fix.sql:92, 113, 125, 141`;
odbiorca w `src/components/network/IntroductionsCard.tsx:84`; trasa `src/routes/profile.index.tsx`.

**Co jest.** Wyzwalacz buduje adres `'/profile?tab=activity&intro=<rola>#i-' || NEW.id || '-<status>'`.
Wiersz karty to `<div className="rounded-md border border-border bg-background/60 p-3">` - **w całym
pliku nie ma ani jednego `id=`** (grep daje zero). W `src/routes/profile.index.tsx` obsługiwane są
wyłącznie `?tab` i `?intro`; nikt nie czyta `location.hash` i nikt nie przewija. Powiadomienie
doprowadza na właściwą zakładkę i tam zostawia użytkownika na górze listy.

Najostrzejsze jest to, że **migracja sama deklaruje, że kotwica działa**. Jej nagłówek, punkt 2
„MARTWE LINKI" (linie 30-38), pisze: „fragment `#i-<id>-<status>` wskazuje wiersz". Ta migracja była
naprawą martwych linków - poprawiła połowę kontraktu (parametry `?tab` i `?intro`) i zostawiła drugą
połowę nienapisaną, w przekonaniu, że istnieje.

**SZERZEJ, niż zgłoszono.** Ta sama migracja produkuje bliźniaczą kotwicę dla rekomendacji,
`'#r-' || NEW.id || '-pending'` i `'-published'` (linie 201, 237, 252, 363, 380 w rodzinie tych
producentów). **Grep za `id={\`r-`w całym`src/` też daje zero.** Obie kotwice są martwe, z tego samego
powodu; zgłoszenie wymieniło tylko jedną. Napraw obie.

**Co zrobić.** Nadaj wierszom `id` w postaci, której oczekuje baza (`i-<id>-<status>`, `r-<id>-<status>`),
i dołóż przewinięcie. Narzędzie już jest: `src/lib/smoothAnchorScroll.ts` eksportuje
`smoothScrollToAnchor(id, options)` wraz z `getAnchorScrollOffset` i ma własny test
(`smoothAnchorScroll.test.ts`). Wzorzec przewijania do wskazanego wiersza masz też w tym module -
`highlightRef` w `src/routes/network.tsx:129-131`.

Jeśli po przeczytaniu uznasz, że fragment jest w tym miejscu zbędny, **drugą dopuszczalną drogą jest
usunięcie go z producenta** w nowej migracji. Czego nie wolno zostawić: adresu, który obiecuje kotwicę
nieistniejącą w DOM.

**Kryterium odbioru:** test `IntroductionsCard`, że wiersz ma `id` dokładnie w formacie z migracji,
oraz test trasy profilu, że przy trafieniu w istniejący fragment wołane jest przewinięcie.

---

### A7. Domyślna rola `"all"` zawsze zwraca pustą listę, po cichu (niski)

**Gdzie:** `src/lib/network/useIntroductions.ts:34` i `:49`; RPC `my_introduction_requests`
w `20260724120000_fix_introductions_flow.sql:64-71`.

**Co jest.** Typ `IntroductionRole` dopuszcza `"all"`, a hook ma je jako **wartość domyślną**
i przekazuje 1:1 do `p_role`. W bazie rola rozstrzyga się przez
`CASE p_role WHEN 'bridge' ... WHEN 'requester' ... WHEN 'target' ... ELSE FALSE END`,
więc dla `'all'` predykat `WHERE` jest fałszywy: **zero wierszy, zero błędów**.

Dziś defekt jest uśpiony, bo wszystkie wywołania produkcyjne podają rolę jawnie. To jest pułapka
na następnego czytelnika, nie awaria: `useMyIntroductions()` bez argumentu wygląda jak „wszystkie
moje wprowadzenia" i zwraca pustą listę bez jednego sygnału, że coś poszło nie tak.

**Co zrobić - wybierz jedną drogę:**

- **(a)** usuń `"all"` z typu `IntroductionRole` i z sygnatury hooka; rola staje się wymagana.
  Kompilator wskaże wszystkie miejsca, które trzeba domknąć. **To jest droga rekomendowana** -
  wartość, która nigdy nie ma sensu, nie powinna dać się wpisać.
- **(b)** dołóż `WHEN 'all' THEN (i.bridge_id = auth.uid() OR i.requester_id = auth.uid()
OR (i.target_id = auth.uid() AND i.status = 'forwarded'))` w nowej migracji i nazwij tę rolę uczciwie.

Czego nie rób: nie zostawiaj typu, który dopuszcza wartość odrzucaną przez bazę bez komunikatu.

---

### A8. Wyszukiwarka mostów strzela RPC na każde naciśnięcie klawisza (niski)

**Gdzie:** `src/components/network/RequestIntroductionDialog.tsx:52` i `:122`.

**Co jest.** `useMyConnections(search, 30)` przy `onChange={(e) => setSearch(e.target.value)}`,
bez żadnego opóźnienia. Klucz zapytania niesie przyciętą frazę (`useConnections.ts:110`), więc każdy
znak to nowy klucz i nowe wywołanie `my_connections`, które po stronie bazy robi
`discovery_search LIKE '%...%'` z sortowaniem po `similarity`
(`20260717162432_...sql:421-427`). Wpisanie ośmioliterowego nazwiska to osiem zapytań trigramowych.

Wzorzec poprawny stoi w tym samym module: `ConnectionsTab` w `src/routes/network.tsx:294-301`
ma `setTimeout` 250 ms ze sprzątaniem w `return`. Przenieś go tutaj - bez wymyślania własnego okna
czasowego i **bez wprowadzania nowej zależności**; ten `useEffect` wystarczy.

**Kryterium odbioru:** test dialogu z zegarem atrapą, że po wpisaniu trzech znaków w mniej niż 250 ms
padło **jedno** wywołanie RPC, a nie trzy.

---

## 3. Pozycje pokryciowe - dług, który nie jest defektem

Te sześć pozycji nie opisuje zepsutego zachowania. Opisują zachowanie, którego nikt nie zapisał.

**B1. Trasa `/network` - 120 wierszy instrukcji, 0 %.** Cztery zakładki, wyszukiwanie z debounce 250 ms,
paginacja klienta nad `useInfiniteQuery` (`PAGE_SIZE = 24`), deep-link `?c=` z `validateSearch`
(linia 69) i przewijanie przez `highlightRef` (129-131), zimny start z sugestiami przy pustej sieci.
Największy pojedynczy plik bez dowodu w module.

**B2. Trasa `/network/mutual/$userId` - 24 wiersze, 0 %.** Brak walidacji parametru trasy (`userId`
idzie prosto do dwóch zapytań), brak stronicowania (patrz A5), `as unknown as MutualRow[]` w linii 82.

**B3. `useFollowedFeed` - 0 %, `useFollows` - 82,6 % bez własnego testu.** Oba zasilają scoring sugestii,
czyli wpływają na to, kogo moduł proponuje. Przy `useFollows` zadanie brzmi „zapisz kontrakt, który
już działa", nie „podnieś liczbę" - liczba jest wysoka, umowy nie ma.

**B4. `record_profile_view` nie ma testu pgTAP.** Patrz A1; wymieniam osobno, bo nowy plik testowy
jest tu produktem, nie efektem ubocznym.

**B5. `request_introduction` nie jest wołane w żadnym teście pgTAP.** Patrz A2 i A3.

**B6. Martwe elementy kontraktu, które pokrycie nagradza za istnienie.** Cztery pozycje, każda
zweryfikowana grepem:

| Element                                                                  | Stan                                                                                                  |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `ReportUserButton` (`ReportUserDialog.tsx:125`)                          | wyeksportowany, **zero konsumentów produkcyjnych**, 4 przypadki testowe w `ReportUserDialog.test.tsx` |
| `targetSlug` w `ConnectionPathTrailProps` (`ConnectionPathTrail.tsx:34`) | zadeklarowany, **nigdzie nie czytany** w ciele komponentu; przekazywany z `network.tsx:207`           |
| `degree: 3` w wierszach zaproszeń (`network.tsx:569` i `:583`)           | nadpisuje `...NO_CONNECTION` **wbrew komentarzowi trzy wiersze wyżej**                                |
| augmentacja `bridge_avatar` (`useIntroductions.ts:26-31`)                | nieaktualna - `types.ts:25261` ma już `bridge_avatar: string`                                         |

Dwa z nich zasługują na komentarz, bo pokazują, jak dług tej klasy się utrzymuje.

`ReportUserButton` jest **martwy i przetestowany naraz**. Cztery testy dają mu pokrycie, pokrycie
wygląda jak zdrowie, więc nic nie sygnalizuje, że nikt go nie woła. Metryka nagradza tu trzymanie
kodu, który nie ma użytkownika. Usuń komponent razem z jego testami - `ReportUserDialog` zostaje.

`degree: 3` stoi bezpośrednio pod komentarzem, któremu przeczy:

```tsx
state={{
  // Zaproszenie w toku nie jest stopniem - graf relacji
  // opisuje fakty, nie intencje (stąd `degree` z NO_CONNECTION).
  ...NO_CONNECTION,
  status: "pending_in",
  connectionId: r.connection_id,
  canInvite: false,
  degree: 3,          // <- nadpisuje degree: 0 z NO_CONNECTION
}}
```

Komentarz opisuje intencję, kod robi coś innego, oba w jednym literale obiektowym. Zdejmij `degree: 3`
w obu miejscach; `...NO_CONNECTION` już ustawia wartość, o którą chodzi komentarzowi.

Augmentacja `bridge_avatar` jest **gorsza niż martwa**: rozszerza wygenerowany typ o pole opcjonalne
(`bridge_avatar?: string`), podczas gdy wygenerowany typ ma je już jako wymagane `string`. Efekt
jest odwrotny do zamierzonego - osłabia typ zamiast go uzupełniać. Że baza je zwraca, potwierdza
dodatkowo asercja w `introductions_flow_test.sql:67-73`.

**Przy okazji, bo ratchet i tak to liczy:** dwa pliki modułu mają zamrożony dług `as unknown as` -
`src/lib/network/useProfileViews.ts` (1) i `src/routes/network.mutual.$userId.tsx` (1),
`scripts/lib/unknownCastBaseline.ts:111` i `:149`. Oba i tak otwierasz. Jeżeli cast da się zdjąć
bez naciągania, zdejmij go i zaktualizuj baseline w dół - lista ma tylko maleć.

---

## 4. Czego dowód nie obejmuje - do rozstrzygnięcia, nie do wykonania

Zapisuję, żeby nie zniknęło. **Nie jest to część tego zlecenia** i nie ma trafić do tego PR-a:

- **Tytuły tras nie podlegają i18n, w całej platformie.** `network.tsx:83` daje
  `"Moja sieć | New European Strategies"`, a `network.mutual.$userId.tsx:43` -
  `"Wspólne kontakty - New EU Strategies"`; użytkownik z EN dostaje polski tytuł karty przeglądarki.
  Nie jest to defekt modułu 10: **38 ze 160 tytułów tras w `src/routes/` zawiera polski literał**.
  Warto zauważyć, dlaczego żadna z trzech bramek i18n tego nie widzi -
  `check:i18n-parity` porównuje słowniki ze sobą (a tu nie ma klucza), bramka `networkI18nKeys`
  patrzy na wywołania `t()` (a tu ich nie ma), a `check:i18n-hardcoded` z założenia szuka
  **rozgałęzienia po języku** (`isPl ? ... : ...`, `l(pl, en)`), więc pojedynczy literał bez gałęzi
  jest dla niej niewidzialny (`src/lib/ci/hardcodedLanguage.ts:1-35`). To jest zadanie przekrojowe
  na osobny PR, nie doklejka do naprawy sieci.
- Ranking `connection_suggestions` (wspólne kontakty, dossier, wydarzenia, zbieżność firmy,
  specjalizacji, lokalizacji, intencji, kompletność profilu) nie ma testu, który przypinałby kolejność
  przy zadanym zestawie sygnałów.
- Zachowanie modułu przy koncie bez najemcy (`_caller_tenant()` zwracające `NULL`) nie jest przypięte
  na żadnej z powierzchni sieci.

---

## 5. Zasady, których nie wolno złamać

1. **Nie zmieniasz zachowania produkcyjnego po to, żeby test przeszedł.** Jeśli znajdziesz defekt
   spoza tej listy - zapisujesz go jako `it.fails("DEFEKT: ...")` z opisem mechanizmu, a nie naprawiasz
   po cichu przy okazji. Naprawa defektu i dopisanie testu do zielonego kodu to dwie różne czynności.
2. **Progi wolno wyłącznie podnosić.** Nigdy nie obniżasz żadnej wartości w `vitest.config.ts`
   i nie wykluczasz pliku z pomiaru. Po skończonej pracy **dopisz progi per plik dla wszystkich czterech
   plików bez progu** (`src/routes/network.tsx`, `src/routes/network.mutual.$userId.tsx`,
   `src/hooks/useFollows.ts`, `src/hooks/useFollowedFeed.ts`). Bez tego kroku praca nie jest skończona:
   to właśnie brak progu pozwolił tym plikom zejść do zera i nikogo nie obudzić.
3. **Nie zmieniasz `package.json` i nie commitujesz `package-lock.json`.**
4. **Żaden test nie wychodzi do sieci i nie zawiera prawdziwego sekretu.** Supabase i Realtime
   są atrapami.
5. **RODO w testach:** żadnych prawdziwych danych osobowych w fixture, żadnych realnych adresów e-mail
   poza domenami `example.com` / `example.org`. W tym module jest to reguła pierwszej wagi - dotykasz
   grafu relacji między ludźmi, historii oglądania cudzych profili i zgłoszeń do moderacji.
   Identyfikatory bierz z istniejącego `NETWORK_IDS`, nie wymyślaj własnych.
6. **Nie regenerujesz snapshotu autoryzacji**, żeby zgasić czerwień.
7. **Nie usuwasz cudzych wpisów `it.fails`** bez naprawy produkcji w tym samym commicie.
8. **Migracje dopisujesz do `supabase/migrations/`, nie do `drizzle/migrations/`.** Bramki SQL czytają
   katalog wskazany stałą `MIGRATIONS_DIR` w `scripts/lib/sqlMigrations.ts` i pasa drizzle nie widzą
   wcale (znalezisko Z1 audytu, rozdz. 15.7). W tym zleceniu piszesz co najmniej trzy migracje -
   ta reguła dotyczy każdej.
9. **Nie zmieniasz istniejącej migracji.** Stan obowiązujący bazy jest wynikiem odtworzenia 958 plików
   po kolei; poprawka wchodzi jako nowy plik z `CREATE OR REPLACE`, nigdy jako edycja starego.

---

## 6. Standard kodu

- **i18n (PL i EN)** dla każdego napisu, który zobaczy użytkownik. Bramka `check:i18n-hardcoded`
  tego pilnuje, `check:i18n-parity` pilnuje równości zestawów kluczy, a `networkI18nKeys.gate.test.ts`
  dodatkowo sprawdza, że żaden klucz sieci nie istnieje wyłącznie w kodzie i że **żadne `t()` nie opiera
  się na `defaultValue`**. Nagłówek tej bramki opisuje incydent, który ją powołał - przeczytaj go przed
  dopisaniem pierwszego klucza.
- **Atomic design:** nowe komponenty trafiają do właściwej warstwy (`atoms` / `molecules` / `organisms`).
  Moduł ma już wszystkie trzy (`atoms/DegreeBadge`, `molecules/ConnectionPathTrail`,
  `organisms/NetworkDistance`) i próg `src/components/network/**` na poziomie 97/98/98/92 - jeśli
  dokładasz komponent, dokładasz jego test w tej samej zmianie.
- **`tenant_id`** w każdym nowym zapytaniu i w każdej nowej polityce RLS. Jedyny wyjątek w tym zleceniu
  jest opisany w A2 i jest wyjątkiem **dlatego, że warunek już obowiązuje przechodnio** - nie dlatego,
  że go nie potrzeba.
- **Warstwa danych zostaje RPC-only.** Nie dopisujesz zapytań `.from("user_connections")` po stronie
  klienta; `authenticated` nie ma na tej tabeli grantu `SELECT` i ma go nie dostać. Nowe odczyty idą
  przez `SECURITY DEFINER`.
- **Zero `any`** - ani `: any`, ani `as any`. W całym repozytorium jest dziś **zero `as any`**
  i **jedno `: any`** (w cudzym pliku); nie psuj tego wyniku. Rzutowania `as unknown as` podlegają
  ratchetowi `check:unknown-casts` i mogą tylko znikać.
- **Dywiz `-`, nigdy długa kreska (U+2014).** W wydaniu 10 jeden wykonawca zostawił 191 takich znaków
  w czterech plikach testowych. Znaku nie wpisuję tu dosłownie, bo wtedy to zlecenie samo łamałoby
  regułę, którą stawia: przeszukanie tego pliku za znakiem U+2014 musi zwracać zero trafień,
  tak samo jak przeszukanie twojego diffu.
- Komentarz piszesz wtedy, gdy tłumaczy **dlaczego**, nie **co**. Wzorzec masz w nagłówku
  `src/lib/ci/hardcodedLanguage.ts` i w nagłówku migracji `20260812101000_pgtap_cluster_c_fix.sql`:
  oba opisują incydent, który powołał regułę do życia. Przy okazji: **komentarz, który przestał być
  prawdziwy, jest defektem** - trzy pozycje tego zlecenia (A1, A3, B6) to dokładnie rozjazd między
  komentarzem a kodem. Kiedy naprawiasz zachowanie, popraw też zdanie, które je opisywało.

---

## 7. Kryterium odbioru całości

| Wymóg                                        | Dziś    | Po          |
| -------------------------------------------- | ------- | ----------- |
| Linie modułu 10                              | 83,65 % | **>= 95 %** |
| Funkcje modułu 10                            | 81,85 % | **>= 93 %** |
| Gałęzie modułu 10                            | 67,98 % | **>= 85 %** |
| Pliki z pokryciem zerowym                    | 3       | **0**       |
| Pliki bez własnego progu                     | 4       | **0**       |
| Testy pgTAP wołające `request_introduction`  | 0       | **>= 4**    |
| Testy pgTAP dotykające `profile_view_events` | 0       | **>= 2**    |

Cel liniowy nie jest ambitny przez zaokrąglenie: 28 plików objętych progiem stoi dziś na 99,71 %,
więc **cała odległość do 95 % leży w czterech plikach**, które trzymają 154 wiersze instrukcji.
Doprowadzenie ich do 90 % daje modułowi 97,97 % linii i 97,69 % funkcji - liczby policzone, nie zgadnięte.
Jeśli wyjdzie mniej, powiedz w opisie PR-a dlaczego, zamiast obniżać próg.

Ponadto:

- `bun run check:i18n-parity`, `check:i18n-hardcoded`, `check:unknown-casts`, `check:feature-taxonomy`
  i bramki SQL - **zielone**.
- Każdy defekt z rozdziałów 1-2 albo **naprawiony i przypięty testem**, albo zostawiony z jawnym
  uzasadnieniem w opisie PR-a. Trzecia możliwość nie istnieje.
- **Opis PR-a ma być równy diffowi.** Jeśli czegoś nie zrobiłeś, opis mówi to wprost. Zlecenie
  wymienia osiem defektów, dwie pozycje rozszerzające (A5 o trasę wspólnych kontaktów, A6 o kotwicę
  rekomendacji) i sześć pozycji pokryciowych - w opisie ma się znaleźć stan każdej z nich.
