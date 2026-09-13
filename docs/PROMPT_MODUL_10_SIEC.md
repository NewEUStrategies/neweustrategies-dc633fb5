# ZLECENIE: MODUŁ 10 - Sieć / networking

> **HEAD pomiaru: `967cec9`.** Każda liczba statyczna w tym dokumencie została zmierzona na tym commicie.
> Jeżeli pracujesz na nowszym `main`, **przemierz przed startem** - i jeśli któraś liczba się rozjechała,
> napisz o tym w opisie PR-a zamiast dopasowywać się do nieaktualnego zlecenia. Ta uwaga stoi tu,
> bo w wydaniu 10 trzy z siedmiu pozycji erraty wykonawcy wzięły się z czytania zlecenia na innym HEAD,
> niż powstało (rozdz. 8.5 audytu, pozycja 16).
>
> **Sprawdzisz aktualność tego zlecenia jednym poleceniem:**
> `git diff --name-only 967cec9..HEAD -- src/routes/network.tsx src/components/network/ src/lib/network/ src/hooks/useFollows.ts supabase/migrations/20260718215718_df61e0ac-a9af-4ff0-bbd0-2b693090f9ec.sql`
> ma nie wypisać nic.

---

## OSTRZEŻENIE O ZAKRESIE DOWODU - przeczytaj przed rozdziałem 0

**Procenty pokrycia w tym zleceniu NIE zostały zmierzone. Zostały przepisane z wydania 10 audytu
i są opatrzone HEAD-em, na którym powstały.** Sesja, w której powstało to zlecenie, **nie mogła
zainstalować zależności**: `bun.lock` przypina 384 rozstrzygnięcia do lustra `europe-west1-npm.pkg.dev`
i `europe-west4-npm.pkg.dev` (`lovable-core-prod`), a polityka egresu organizacji odrzuca ten host
odpowiedzią **403 na CONNECT**. Bez `node_modules` nie ma `vitest run --coverage`.

**Pierwszą czynnością tego zlecenia jest pomiar**, nie kodowanie: `bun install && bun run test:coverage`,
potem `node scripts/taxonomy/report.mjs --module 10`. Dopiero ta liczba jest podstawą kryterium
odbioru z rozdz. 7.

**Liczby statyczne rozdz. 0 i 0.2 oraz wszystkie trzy defekty rozdz. 1-3 są zweryfikowane
czytaniem kodu na `967cec9`** i nie zależą od instalacji zależności. Każdy defekt przeszedł
**niezależną próbę obalenia przez osobnego agenta**, a wszystkie trzy sprawdziłem dodatkowo
ręcznie przy redakcji.

**Żaden defekt nie został obalony, ale próba obalenia zmieniła treść każdego z trzech:**
w A1 poprawiła klasę defektu i wskazała **drugą, mocniejszą fałszywą obietnicę**, której
nie było w zgłoszeniu; w A2 wykazała, że proponowana naprawa nie jest jednolinijkowa i wymaga
zmiany projektowej; w A3 usunęła twierdzenie bez pokrycia i skorygowała mnożnik kosztu
z trzydziestu sześciu na dwanaście. Te sprostowania stoją w treści pozycji, opisane wprost.

---

## 0. Stan wyjściowy

### 0.1. Zmierzone na `967cec9` - obowiązuje

| Metryka                                   | Wartość                   |
| ----------------------------------------- | ------------------------- |
| Pliki produkcyjne                         | **32** (5 206 wierszy)    |
| Pliki testowe                             | 23                        |
| Trasy                                     | 2                         |
| Pliki bez importu w korpusie testowym     | **4** (474 wiersze, 9,1%) |
| Wiersze powierzchni bez progu per-ścieżka | **1 232** (23,7%)         |

### 0.2. Przepisane z wydania 10 audytu (HEAD `5fd13461c`) - do przemierzenia

| Metryka            | Wartość wg audytu |
| ------------------ | ----------------- |
| Instrukcje         | 79,85%            |
| Gałęzie            | 68,71%            |
| Funkcje            | 81,85%            |
| **Linie**          | **83,65%**        |
| Plików na zerze    | 3                 |
| Niepokrytych linii | 137               |

**Moduł 10 jest drugą najsłabszą powierzchnią repozytorium** - słabszy jest tylko design system
(81,48%), który dostaje własne zlecenie w tej samej serii. Audyt odnotowuje też, że moduł ten
**nie ruszył się o setną punktu** między wydaniem 9 a 10: nikt go nie dotknął.

**Powierzchnia nie ruszyła się także od HEAD-a pomiaru zlecenia modułu 1.** Między `7a780b1`
(origin/main) a `967cec9` w plikach modułu 10 zmieniło się **zero plików**.

### 0.3. Czego dziś NIE pilnuje żaden próg - i dlaczego to jest asymetria, nie brak

Moduł 10 **ma** progi per-ścieżka, i to mocne:

| Ścieżka                     | instrukcje | funkcje | linie | gałęzie |
| --------------------------- | ---------: | ------: | ----: | ------: |
| `src/lib/network/**`        |         85 |      95 |    95 |      65 |
| `src/components/network/**` |         97 |      98 |    98 |      92 |

**Ale obie trasy modułu nie wpadają pod żaden z 694 progów w `vitest.config.ts`:**

| Plik bez progu                          | Wiersze |
| --------------------------------------- | ------: |
| `src/routes/network.tsx`                |     865 |
| `src/routes/network.mutual.$userId.tsx` |     246 |
| `src/hooks/useFollows.ts`               |      76 |
| `src/hooks/useFollowedFeed.ts`          |      45 |

To jest **najważniejsza obserwacja tego zlecenia**. Warstwa danych i warstwa komponentów są
zabezpieczone zapadką na poziomie 95-98% linii, a **23,7% wierszy modułu, w tym najgrubszy plik
całej powierzchni (865 wierszy), nie ma żadnej bramki**. Moduł raportuje 83,65% linii nie dlatego,
że zabezpieczone warstwy się osunęły, tylko dlatego, że jedna czwarta powierzchni stoi poza pomiarem
bramkowym. **Dowolna regresja w `network.tsx` przejdzie CI bez mrugnięcia.**

Sprawdzenie: `grep -n "routes/network" vitest.config.ts` nie zwraca nic.

---

## 1. Pozycja BLOKUJĄCA

### A1. Tryb „Prywatnie" nie daje użytkownikowi niczego, czego nie daje „Anonimowo", a dwa miejsca w produkcie twierdzą, że daje

**Gdzie:** `src/lib/i18n-network.ts:212-213` (PL) i `:480-481` (EN),
`src/components/network/ProfileViewsCard.tsx:5-6` (komentarz nagłówkowy), `:43` (`ViewerRow`),
`:88` i `:155-160`,
`supabase/migrations/20260718215718_df61e0ac-a9af-4ff0-bbd0-2b693090f9ec.sql:227-231`, `:243-247`.

**Co jest zaimplementowane, żeby nie szukać tego drugi raz.** Tryb prywatności **jest** czytany
i **jest** egzekwowany po stronie serwera. `record_profile_view` nie tworzy `viewer_snapshot`
dla trybu innego niż `public`, a `my_profile_viewers` maskuje tożsamość warunkiem
`CASE WHEN e.viewer_mode = 'public'`. **Pierwsze zdanie podpowiedzi w interfejsie
(„Anonimowo ukrywa Twoje imię") jest w pełni zrealizowane.** To nie jest martwa konfiguracja
i nie należy jej tak opisywać.

**Co jest defektem.** Niezaimplementowane jest **drugie** zdanie tej samej podpowiedzi, wypowiedziane
wprost w obu wersjach językowych:

> PL: „Prywatnie" dodatkowo **wyłącza Twój dostęp** do listy „Kto oglądał Twój profil".
> EN: „Private" additionally **disables your access** to the „Who viewed your profile" list.

Żadna warstwa tego nie wykonuje. `my_profile_viewers` filtruje wyłącznie
`WHERE e.profile_id = auth.uid()`, `profile_view_stats` tak samo, i **ani jedna z nich nie czyta
`profile_view_mode` wołającego**. W komponencie `mode` steruje wyłącznie tym, który tekst pustego
stanu się pokaże; gdy lista nie jest pusta, renderuje się w całości niezależnie od trybu.

**Druga fałszywa obietnica, mocniejsza od pierwszej, w komentarzu nagłówkowym pliku
(`ProfileViewsCard.tsx:5-6`):**

> „anonimowi widzowie są maskowani w bazie, **prywatni w ogóle nie trafiają na listę**."

To jest nieprawda. `record_profile_view` wstawia zdarzenie **również** dla trybu `private`, tylko
z `viewer_id = NULL`. Prywatny widz trafia na listę oglądanego jako „Użytkownik anonimowy".

**Wniosek, który jest sednem tej pozycji:** `private` różni się od `anonymous` w warstwie danych
dokładnie jednym szczegółem (`viewer_id = NULL` zamiast `auth.uid()`), a ten szczegół jest
**niewidoczny w całym produkcie**. `my_profile_viewers` maskuje oba tryby identycznie,
`ViewerRow:43` renderuje oba jako „Użytkownik anonimowy" warunkiem `viewer_mode !== "public"`,
producent powiadomień traktuje je razem. **Trzecia opcja w przełączniku jest funkcjonalnym
duplikatem drugiej**, opatrzonym obietnicą, której nikt nie dotrzymuje.

**Polecenie dowodu:**

```bash
sed -n '1,8p;40,48p;155,160p' src/components/network/ProfileViewsCard.tsx
sed -n '227,231p;239,251p;254,262p' supabase/migrations/20260718215718_df61e0ac-a9af-4ff0-bbd0-2b693090f9ec.sql
grep -n "privacyHint" src/lib/i18n-network.ts
```

**Dlaczego to jest blokujące:** przedmiotem obietnicy jest prywatność, obietnica jest złożona
explicite w interfejsie w dwóch językach, a użytkownik, który ją przeczyta i wybierze „Prywatnie",
sądzi, że zawarł kontrakt wzajemności znany z LinkedIn. Nie zawarł żadnego: widzi pełną listę
swoich widzów i pełne liczniki, dokładnie tak jak w trybie publicznym. Drugi powód jest
utrzymaniowy: komentarz nagłówkowy pliku wprowadza w błąd następną osobę, która ten kod otworzy.

**Uwaga o wadze i o klasie defektu:** agent rozpoznania ocenił tę pozycję jako średnią i nazwał ją
martwą konfiguracją. Podnoszę wagę do blokującej, ale **odrzucam tę klasę** za niezależną próbą
obalenia: to nie jest martwy parametr, tylko rozjazd między tekstem a implementacją plus opcja,
która dubluje sąsiednią. Klasa ma znaczenie, bo prowadzi do innej naprawy.

**Co zrobić - wybierz JEDNĄ z trzech dróg i uzasadnij wybór w opisie PR-a:**

- **(a) wykonać obietnicę:** `my_profile_viewers` i `profile_view_stats` mają czytać
  `profile_view_mode` wołającego i zwracać pustą listę oraz zera dla trybu `private`. Wtedy
  `private` przestaje być duplikatem `anonymous`, a oba teksty stają się prawdziwe.
- **(b) wycofać obietnicę:** usunąć z `i18n-network.ts` drugie zdanie podpowiedzi (PL i EN)
  **oraz** poprawić komentarz nagłówkowy `ProfileViewsCard.tsx:5-6`. Zostaje wtedy pytanie,
  po co istnieje trzecia opcja, skoro nie różni się od drugiej.
- **(c) usunąć tryb `private`:** skoro nie daje niczego ponad `anonymous`, zredukować przełącznik
  do dwóch opcji i zmigrować istniejące wartości. Ta droga wymaga migracji danych i decyzji
  produktowej, więc podejmij ją tylko za zgodą właściciela produktu.

**Czego NIE robić:** nie ukrywaj listy po stronie klienta przy działającym RPC. Ukrycie
w interfejsie przy endpointcie, który nadal zwraca dane, to nie prywatność, tylko jej pozór.

**Kryterium odbioru:** przy drodze (a) test pgTAP: widz w trybie `private` woła
`my_profile_viewers` i dostaje zero wierszy, `profile_view_stats` zwraca trzy zera, a ten sam
użytkownik w trybie `public` dostaje swoje wiersze. Przy drodze (b) test słownika, że żaden
z dwóch języków nie obiecuje odcięcia dostępu, oraz sprawdzenie, że komentarz nagłówkowy zgadza
się z migracją.

---

## 2. Pozycje zwykłe

### A2. Debounce zapisu odwiedzin nie działa dla trybu „Prywatnie", bo warunek porównuje z NULL

**Gdzie:** `supabase/migrations/20260718215718_df61e0ac-a9af-4ff0-bbd0-2b693090f9ec.sql:222-231`.

**To jest bezpośredni skutek uboczny mechanizmu opisanego w A1** i dlatego stoi tuż za nim.

**Co jest:** `record_profile_view` odsiewa powtórki w ciągu godziny warunkiem
`viewer_id = auth.uid()`, a bezpośrednio potem wstawia wiersz, w którym dla trybu prywatnego
`viewer_id` jest **NULL**:

```sql
IF EXISTS (
  SELECT 1 FROM public.profile_view_events
   WHERE profile_id = p_profile AND viewer_id = auth.uid()
     AND viewed_at > now() - INTERVAL '1 hour'
) THEN RETURN; END IF;
INSERT INTO public.profile_view_events
  (tenant_id, profile_id, viewer_id, viewer_mode, viewer_snapshot)
VALUES (v_tenant, p_profile,
        CASE WHEN v_mode = 'private' THEN NULL ELSE auth.uid() END,
        v_mode, v_snapshot);
```

`NULL = auth.uid()` nie jest prawdą **nigdy**, więc dla widza w trybie prywatnym `EXISTS` nie trafia
i funkcja wstawia nowy wiersz przy **każdym** wywołaniu. Klient woła to RPC w `useEffect` przy
montowaniu trasy autora (`src/routes/author.$slug.tsx:375-380`), a tabela nie ma ograniczenia
unikalności.

**Co dokładnie z tego wynika, a co nie.** Niezależna próba obalenia zawęziła skutek i prostuję
to tutaj, bo inaczej zlecenie kazałoby gonić problem, którego nie ma:

- **Nie ma wycieku tożsamości.** Widz w trybie prywatnym pozostaje niezidentyfikowany;
  `my_profile_viewers` maskuje go tak samo jak anonimowego. **Wycieka wolumen, nie tożsamość.**
- **Nie ma zalewu powiadomień.** Dla trybów `private` i `anonymous` odsyłacz powiadomienia jest
  stałą, więc dedup zwija wszystkie takie wejścia w jeden sygnał na okno; dodatkowo zadanie
  zbiorcze (`supabase/migrations/20260807140000_network_event_notifications.sql:405-412`) przepuszcza
  najwyżej jeden zagregowany sygnał na profil na dwadzieścia godzin.
- **Jest natomiast zawyżenie liczby.** Zadanie zbiorcze liczy `count(*)`, więc zawyżony wolumen
  **wycieka do treści powiadomienia**, a liczniki 7/30/90 dni w karcie pokazują wejścia zamiast widzów.
- **Przyrost wierszy nie jest nieograniczony** - ogranicza go faktyczna nawigacja użytkownika
  (jeden wiersz na zamontowanie trasy), a nie pętla.

**Dlaczego to jest defekt:** skutek jest odwrotny do intencji ustawienia prywatności. Tryb, który
miał zmniejszyć ślad użytkownika, zwiększa liczbę zapisanych o nim wierszy i zawyża statystykę,
którą widzi ktoś inny.

**Co zrobić - i dlaczego to NIE jest poprawka jednolinijkowa.** Zerowanie `viewer_id` dla trybu
prywatnego jest **celowym mechanizmem prywatności**, więc samo naprawienie porównania
(np. `IS NOT DISTINCT FROM`) nie zadziała: odsiałoby wtedy **wszystkich** prywatnych widzów tego
profilu naraz, bo wszyscy mają `viewer_id IS NULL`. Realna naprawa wymaga **odrębnego klucza
deduplikacji**, którego `my_profile_viewers` nie eksponuje: osobnej kolumny z nieodwracalnym
skrótem pary widz-profil albo tabeli satelickiej trzymającej znacznik czasu ostatniego wejścia.
To jest zmiana projektowa. Opisz w PR-ze, którą z tych dwóch dróg wybrałeś.

**Czego NIE robić:** nie dokładaj indeksu unikalnego na `(profile_id, viewer_id)` - dla wartości
NULL nie zadziała tak, jak się wydaje, a przy okazji zablokuje legalne powtórne wejścia po godzinie.
Nie zapisuj też identyfikatora widza w kolumnie, którą `my_profile_viewers` może zwrócić.

**Kryterium odbioru:** test pgTAP, w którym ten sam widz w trybie `private` woła
`record_profile_view` dwa razy pod rząd i tabela ma **jeden** wiersz; oraz drugi test, w którym
**dwaj różni** widzowie w trybie `private` wchodzą na ten sam profil i tabela ma **dwa** wiersze.
Drugi test jest tu ważniejszy od pierwszego, bo to on wyklucza naprawę pozorną.

### A3. Zakładka sugestii w `/network` odpala ciężkie RPC osobno dla każdej karty zamiast jednym wywołaniem

**Gdzie:** `src/routes/network.tsx:698-705` (renderowanie kart), `:376` i `:859` (montowanie zakładki),
`src/components/network/MessageOrConnectButton.tsx:41-46`,
`src/components/network/ConnectButton.tsx:73-78`, `src/lib/network/useConnections.ts:63-66`.

**Co jest:** `SuggestionsTab` renderuje do dwunastu kart, a każda dostaje
`MessageOrConnectButton` i `ConnectButton` **bez** propsa `connectionState`/`state`:

```tsx
<MessageOrConnectButton userId={s.user_id} displayName={s.display_name}
  displayAvatar={s.avatar_url} compact iconOnly />
<ConnectButton userId={s.user_id} displayName={s.display_name} compact iconOnly />
```

Oba komponenty wpadają wtedy w tryb `selfFetch` i wołają `useConnectionStatuses([userId])`
samodzielnie. **Cała trasa `network.tsx` ani razu nie importuje `useConnectionStatuses`.**

**Co dokładnie jest złamane, bo pierwsza redakcja nazwała to nieprecyzyjnie.** Niezależna próba
obalenia wykazała cztery nieścisłości i prostuję je, bo trzy z nich osłabiają zarzut, a jedna
go doprecyzowuje:

1. **To nie jest złamanie kontraktu hooka.** Tryb `selfFetch` jest **udokumentowanym** trybem obu
   komponentów (`ConnectButton.tsx:49-53`, `MessageOrConnectButton.tsx:25-28`) i ma legalnych
   konsumentów jednoosobowych: `organisms/NetworkDistance.tsx:35`, `MutualConnectionsHint.tsx:18`,
   `RequestIntroductionButton.tsx:30`, `RecommendationsSection.tsx:96`, `AuthorCvSections.tsx:267`.
   Złamana jest **konwencja projektu dla powierzchni listowych**, nie sygnatura ani kontrakt typu.
2. **Koszt to 12 wywołań, nie 24 ani 36.** Na jednej karcie są trzy potencjalne wywołania
   (`MessageOrConnectButton`, zagnieżdżony w nim `ConnectButton` oraz siostrzany `ConnectButton`),
   ale wszystkie składają **ten sam klucz** `["network","statuses",uid,"<id>"]`, więc React Query
   je dedupikuje. Mnożnik wynosi dwanaście, nie trzydzieści sześć.
3. **Zakładka sugestii nie jest najczęściej otwieraną zakładką sieci** - pierwsza redakcja
   tak twierdziła i było to twierdzenie bez pokrycia. Domyślną zakładką jest „Kontakty"
   (`const active: NetworkTab = tab ?? "connections"`). `SuggestionsTab` montuje się w wierszu 859
   (wybrana zakładka „Sugestie") oraz w wierszu 376 (zimny start zakładki „Kontakty", gdy lista
   jest pusta) - czyli także dla **nowego użytkownika bez kontaktów**, co jest scenariuszem
   pierwszego kontaktu z produktem.
4. **Wzorców poprawnych jest trzy, nie dwa, i jeden z nich stoi w tym samym pliku.**
   `people.tsx:390` i `DossierFollowers.tsx:23` batchują przez `useConnectionStatuses`, a zakładka
   „Kontakty" w `network.tsx:405-433` buduje stan relacji lokalnie i **nie odpala ani jednego**
   wywołania `connection_statuses`. Wzorzec do naśladowania masz więc kilkaset wierszy wyżej.

**Polecenie dowodu:**

```bash
grep -n "useConnectionStatuses" src/routes/network.tsx    # ma nie zwrócić nic
sed -n '698,705p' src/routes/network.tsx
grep -n "useConnectionStatuses" src/routes/people.tsx src/components/network/DossierFollowers.tsx
```

**Dlaczego to jest defekt:** `connection_statuses` nie jest tanim odczytem. Dla każdego wywołania
buduje zestaw wyrażeń pomocniczych nad całą tabelą `user_connections`, żeby policzyć stopień
znajomości i most. Wywołanie jej dwanaście razy zamiast raz mnoży przez dwanaście pracę bazy
i liczbę round-tripów, i robi to między innymi na ścieżce zimnego startu nowego użytkownika.

**Co zrobić:** w `SuggestionsTab` zawołać `useConnectionStatuses` raz, z listą identyfikatorów
wszystkich renderowanych kart, i przekazać wynik do kart propsem `connectionState`/`state`.
Tryb `selfFetch` w obu komponentach **zostaje** - jest potrzebny i udokumentowany dla kart
stojących pojedynczo.

**Czego NIE robić:** nie usuwaj trybu `selfFetch` ani nie czyń propsa `connectionState`
obowiązkowym. Ma pięciu legalnych konsumentów wymienionych wyżej.

**Kryterium odbioru:** test trasy, który renderuje zakładkę sugestii z dwunastoma profilami
i sprawdza, że atrapa `useConnectionStatuses` została zawołana **raz**, z listą dwunastu
identyfikatorów, a nie dwanaście razy z listami jednoelementowymi.

---

## 3. Pozycje pokryciowe - dług, który nie jest defektem

**B1. Obie trasy modułu muszą dostać próg per-ścieżka.** To jest najważniejsza pozycja tego
rozdziału i wynika wprost z rozdz. 0.3: 1 232 wiersze, czyli 23,7% powierzchni, nie mają dziś
żadnej bramki, podczas gdy reszta modułu stoi pod progiem 95-98% linii. Próg wyznacz metodą tego
repozytorium: **zmierz, a potem postaw zaporę tuż pod zmierzonym poziomem**.

**B2. Cztery pliki bez importu w korpusie testowym** (474 wiersze):

| Plik                                                      | Wiersze |
| --------------------------------------------------------- | ------: |
| `src/routes/network.mutual.$userId.tsx`                   |     246 |
| `src/components/network/atoms/PathNode.tsx`               |     106 |
| `src/components/network/molecules/ConnectionDistance.tsx` |      75 |
| `src/components/network/useDegreeLabels.ts`               |      47 |

Trzy ostatnie to warstwa prezentacji stopnia znajomości, czyli dokładnie to, co A3 wywołuje
dwanaście razy zamiast raz. Test tej warstwy jest tani i zamyka jednocześnie dług pokryciowy
i ryzyko regresji przy naprawie A3.

---

## 4. Czego dowód nie obejmuje - do rozstrzygnięcia, nie do wykonania

1. **Procenty pokrycia modułu na `967cec9`.** Nie zmierzone (patrz ostrzeżenie na górze).
2. **Które 3 pliki stoją na zerze.** Audyt podaje liczbę, nie nazwy.
3. **Nieścisły typ `ProfileViewer`.** `src/lib/network/useProfileViews.ts` deklaruje
   `viewer_id: string` jako pole nieopcjonalne, podczas gdy RPC zwraca `NULL` dla **każdego** trybu
   innego niż `public`. To jest drobiazg niezależny od A1 i A2, wychwycony przy próbie ich obalenia.
   Popraw przy okazji, jeżeli i tak ruszasz ten plik; nie otwieraj dla niego osobnego PR-a.
4. **Zawężenie do najemcy w `my_profile_viewers` i `profile_view_stats`.** Obie funkcje filtrują
   wyłącznie po `profile_id = auth.uid()`, mimo że `profile_view_events` ma kolumnę `tenant_id`
   i jest nią zasilana przy zapisie. **Nie twierdzę, że to defekt** - nie ustaliłem, czy profil
   może być oglądany spoza swojego najemcy. Zapisuję jako pytanie do rozstrzygnięcia, bo
   repozytorium ma bramkę `check:sql-tenant-scope` i warto wiedzieć, czemu te dwie funkcje jej
   nie potrzebują.

---

## 5. Zasady, których nie wolno złamać

1. **Nie obniżaj żadnego progu w `vitest.config.ts`.** Progi są zapadką: wolno je wyłącznie podnosić.
2. **Nie pomijaj, nie wyłączaj i nie kwarantannuj testu**, żeby uzyskać zieleń.
3. **Nie dopisuj `as any` ani `: any`.**
4. **Nie zamrażaj zegara przez `vi.setSystemTime` w bloku `describe`** bez odmrożenia.
5. **Nie licz na to, że test renderujący bez asercji coś mierzy.**
6. **Zmiana w SQL idzie nową migracją**, nie edycją migracji już zastosowanej. Migracja
   `20260718215718` jest w repozytorium od lipca i mogła zostać odtworzona na środowiskach.
7. **Nie używaj znaku U+2014 (długiej kreski) w plikach tego repozytorium.** Sprawdzisz siebie
   poleceniem `LC_ALL=C.UTF-8 grep -nP "\x{2014}" <plik>` - ma nie wypisać nic.

---

## 6. Standard kodu

- Test warstwy danych sieci sprawdza **kontrakt RPC**, nie kształt odpowiedzi atrapy.
- Test prywatności sprawdza, że dane **nie wychodzą z bazy**, a nie że interfejs ich nie pokazuje.
- Nazwy testów po polsku, w trybie orzekającym, opisujące zachowanie.
- `prettier --check .` i `eslint .` mają przechodzić przed wysłaniem PR-a.

---

## 7. Kryterium odbioru całości

1. **A1, A2 i A3 zamknięte**, każdy z uzasadnieniem wybranej drogi w opisie PR-a.
2. **Obie trasy modułu mają próg per-ścieżka** (B1), wyznaczony po Twojej pracy, nie przed nią.
3. **Pokrycie linii modułu nie niższe niż 92%** i **funkcji nie niższe niż 90%**, zmierzone
   poleceniem z rozdz. 0. Jeżeli pomiar wyjściowy na `967cec9` okaże się istotnie inny niż 83,65%
   z audytu, **podaj obie liczby w opisie PR-a** i przyjmij za punkt odniesienia własny pomiar.
4. **`bun run verify:blocking` przechodzi.**
