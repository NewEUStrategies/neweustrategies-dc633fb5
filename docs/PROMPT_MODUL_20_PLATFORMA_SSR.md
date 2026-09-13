# ZLECENIE: MODUŁ 20 - Platforma / backend / infrastruktura / SSR

> **HEAD pomiaru: `7a780b1d0`.** Każda liczba w tym dokumencie została zmierzona na tym commicie.
> Jeżeli pracujesz na nowszym `main`, **przemierz przed startem** - i jeśli któraś liczba się rozjechała,
> napisz o tym w opisie PR-a zamiast dopasowywać się do nieaktualnego zlecenia. Ta uwaga stoi tu,
> bo w wydaniu 10 trzy z siedmiu pozycji erraty wykonawcy wzięły się z czytania zlecenia na innym HEAD,
> niż powstało (rozdz. 8.5 audytu, pozycja 16).
>
> **Stan na dzień oddania zlecenia:** między `7a780b1d0` a commitem, który wnosi ten plik, nie zmienił
> się ani jeden plik w `src/`, `supabase/` ani `drizzle/`. Sprawdzisz to poleceniem
> `git diff --name-only 7a780b1d0..HEAD -- src/ supabase/ drizzle/` - ma nie wypisać nic.

Źródło: `docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`, rozdz. 15.15 (defekty) i 15.16
(rodzaj testu per moduł). Wszystkie osiem defektów przeszło **niezależną próbę obalenia** przez
osobnego agenta i zostało potwierdzonych.

---

## 0. Stan wyjściowy - zmierzony, nie przepisany

### 0.1. To jest najlepiej pokryty moduł platformy. Zlecenie dotyczy tego, czego ta liczba nie obejmuje

| Widok                                    | Plików | Wiersze | Linie       | Funkcje                 |
| ---------------------------------------- | ------ | ------- | ----------- | ----------------------- |
| **Funkcjonalności** (to, co na karcie)   | 193    | 9 286   | **95,82 %** | **91,65 %** (1866/2036) |
| **Cały moduł** (klasyfikator taksonomii) | 243    | 11 061  | **98,20 %** | **96,88 %** (2362/2438) |

Obie liczby są prawdziwe i mierzą co innego; szczegóły jak w module 19. Z karty zgadza się wszystko
co do sztuki: **388 wierszy bez testu, 4 pliki na zerze, 19 martwych funkcji nazwanych**.

| Metryka                     | Wartość na `7a780b1d0`     |
| --------------------------- | -------------------------- |
| Pliki produkcyjne           | 243 (73 764 wiersze)       |
| Pliki testowe               | 422 (9 463 przypadki)      |
| Trasy                       | 32                         |
| Gałęzie (cały moduł)        | 95,14 % (8696/9140)        |
| Pliki na zerze (cały moduł) | 9 (42 wiersze, same trasy) |
| Pliki bez własnego progu    | 168 z 243                  |

Dziewięć zer to czterdzieści dwa wiersze rozsypane po cienkich trasach (`welcome.tsx` 12,
`admin.index.tsx` 7, `admin.i18n.tsx` 6, reszta po trzy). Dziesięć z jedenastu funkcjonalności modułu
stoi między 96,9 % a 100 %. **Ten moduł nie ma długu pokryciowego wartego osobnego zlecenia** -
i właśnie dlatego to zlecenie jest o czymś innym.

### 0.2. Jedenasta funkcjonalność: dok roboczy, którego pomiar modułu nie widzi

Jedna pozycja karty odstaje od pozostałych o trzydzieści punktów:

```
Dok roboczy (WorkspaceDock): 32 pliki | 4 376 wierszy | linie 65,26 % | funkcje 58,72 % | galezie 60,41 %
                             263 niepokryte wiersze | 11 martwych funkcji nazwanych
```

**Uwaga, która rozstrzyga o całym zleceniu: pomiar modułu 20 tego nie pokazuje.** Pliki
`src/components/dock/**` klasyfikator taksonomii przypisuje do przekroju `admin-shell`, nie do modułu 20
(sprawdź sam: `classifyPath("src/components/dock/organisms/TodoPanel.tsx")` zwraca
`{ module: null, crossCutting: "admin-shell" }`). Do modułu 20 wpadają z doku tylko pliki
`src/lib/dock/**`. Widok funkcjonalności zbiera je wszystkie razem, widok modułu - nie.

Wykonawca, który uruchomi pomiar modułu 20, zobaczy **98,20 %** i uzna, że nie ma tu nic do roboty.
Piszę to na początku, żeby tak się nie stało.

### 0.3. Dok jest udowodniony od zewnątrz i nieudowodniony w środku

Dok ma **16 plików testowych** - powłokę, stan, geometrię, ruch, i18n, obecność, dane. A rozkład
pokrycia wygląda tak:

| Warstwa                            | Pokrycie                          |
| ---------------------------------- | --------------------------------- |
| `WorkspaceDock.tsx` (powłoka)      | 94,2 %                            |
| `lib/dock/useDockReservedSpace.ts` | 89,7 %                            |
| `lib/dock/dockState.ts`            | 88,2 %                            |
| `organisms/ChatSideDrawer.tsx`     | **2,3 %** (84 niepokryte wiersze) |
| `organisms/NotesPanel.tsx`         | **2,1 %** (47)                    |
| `organisms/SavedPanel.tsx`         | **5,9 %** (32)                    |
| `organisms/TodoPanel.tsx`          | **0 %** (31)                      |
| `organisms/CalendarPanel.tsx`      | **0 %** (23)                      |
| `molecules/MinimizedChats.tsx`     | **8,7 %** (21)                    |

**Rama jest udowodniona, zawartość nie.** Sześć paneli - czyli dokładnie to, co użytkownik otwiera
i w czym pracuje - trzyma 238 z 263 niepokrytych wierszy doku. Testy sprawdzają, że dok się otwiera,
zamyka, rezerwuje miejsce i nie łamie SSR; nie sprawdzają, czy notatka się zapisuje, czy zadanie
da się odhaczyć i czy kalendarz pokazuje właściwy tydzień.

**Progów: zero na trzydzieści dwa pliki.** Żaden plik doku nie wpada pod żaden glob w `vitest.config.ts`.
To odpowiada na pytanie, jak powierzchnia z szesnastoma plikami testowymi mogła zejść do 65 %:
nie było czego zapalić.

### 0.4. Progi dla plików z defektami

| Plik                                | Próg                                |
| ----------------------------------- | ----------------------------------- |
| `src/lib/http/resolveReturnUrl.ts`  | **BRAK**                            |
| `src/lib/ci/publicRouteLoaders.ts`  | **BRAK**                            |
| `src/lib/http/parseCacheControl.ts` | **BRAK**                            |
| `src/lib/http/documentCache.ts`     | **BRAK**                            |
| `src/lib/queries/archives.ts`       | `src/lib/queries/archives.ts`       |
| `src/lib/queries/blocks.ts`         | `src/lib/queries/blocks.ts`         |
| `src/lib/queries/megaMenu.ts`       | `src/lib/queries/megaMenu.ts`       |
| `src/routes/people.tsx`             | `src/routes/people.tsx`             |
| `src/lib/server/jobsTick.server.ts` | `src/lib/server/jobsTick.server.ts` |

Warstwa zapytań ma progi per plik, warstwa HTTP - żadnego. Defekt o najwyższej wadze leży
w tej drugiej.

---

## 1. Pozycje BLOKUJĄCE - dwa defekty o wadze wysokiej

### A1. Adres powrotu z płatności budowany z niezaufanego nagłówka hosta

**Gdzie:** `src/lib/http/resolveReturnUrl.ts:14-24`; odbiorcy w
`src/lib/billing/checkout.functions.ts:447`, `stripeCheckout.functions.ts:156` i `:210`,
`donations.functions.ts:192`, dalej `adhocCheckout.server.ts:204` i `:307`.

**Co jest.**

```ts
const originHeader = headers?.get("origin");
const forwardedProto = headers?.get("x-forwarded-proto");
const forwardedHost = headers?.get("x-forwarded-host") ?? headers?.get("host");
const origin =
  originHeader ??
  (forwardedHost ? `${forwardedProto ?? "https"}://${forwardedHost}` : null) ??
  process.env.PUBLIC_SITE_URL ??
  "https://neweuropeanstrategies.com";
```

Żadna z tych wartości nie przechodzi przez zaufany rozstrzygacz hosta. Tymczasem sąsiedni plik
w tym samym katalogu - `src/lib/http/requestHost.ts:20-31` - nazywa surowy `X-Forwarded-Host`
**„untrusted input by definition"** i wprost mówi, że jedynymi legalnymi konsumentami są zaufany
rozstrzygacz i testy, a wszystko z zakresem najemcy idzie przez `trustedPublicHost()` /
`currentTenantHost()`.

**Dlaczego to jest blokujące.** Docstring tej funkcji obiecuje dokładnie tę ochronę, której nie daje:

> „Jeśli klient przekaże absolutny URL, odrzucamy jego host - dzięki temu atakujący nie może
> przekierować użytkownika na zewnętrzną domenę po prawdziwej płatności."

Host jest istotnie odcinany **od argumentu**, a zaraz potem wczytywany **z nagłówka**, który klient
kontroluje równie łatwo. Wynik wędruje jako `return_url` do operatora płatności. To jest przekierowanie
po zakończonej, prawdziwej transakcji - moment, w którym użytkownik jest najbardziej skłonny zaufać
temu, co zobaczy.

Testy utrwalają dziś złe zachowanie: `src/lib/http/__tests__/resolveReturnUrl.test.ts` ma cztery
przypadki, wszystkie o obcinaniu hosta ze ścieżki, a jeden z nich - **„falls back to forwarded
host/proto"** - przypina zaufanie do `X-Forwarded-Host` jako poprawne. To jest ten rzadki przypadek,
w którym naprawa produkcji wymaga przepisania istniejącego testu; zrób to i **napisz w opisie PR-a,
że tak zrobiłeś**, wraz z powodem.

**Co zrobić.** Origin ma pochodzić z zaufanego źródła: `trustedPublicHost(request)` albo
`currentTenantHost()` (`src/lib/http/requestHost.ts:38` i `:61`), z `PUBLIC_SITE_URL` jako jawnym
zapasowym. Nagłówek `Origin` też podlega tej regule - jest tak samo klienta.

Jeżeli któryś tryb pracy (dev, preview bez skonfigurowanej domeny) naprawdę wymaga odczytu z nagłówka,
**odseparuj go jawnie warunkiem środowiskowym** i opisz w komentarzu, dlaczego w tym trybie to
dopuszczalne. Cicha ścieżka zaufania dla wygody na preview to jest właśnie to, co jest tu dzisiaj.

**Kryterium odbioru:** test, w którym żądanie ze sfałszowanym `X-Forwarded-Host` **nie** produkuje
adresu powrotu na obcej domenie; plus przepisany test „falls back", który po zmianie ma sprawdzać
zachowanie przy hoście zaufanym, a nie przy dowolnym. Plik nie ma dziś progu - dopisz mu go.

---

### A2. Archiwum taksonomii pobiera wszystkie identyfikatory wpisów i wkłada je do `.in()`

**Gdzie:** `src/lib/queries/archives.ts:249-275`; trasa `src/routes/category.$slug.tsx:47-56`.

**Co jest.**

```ts
const pivotQuery = kind === "category"
  ? supabase.from("post_categories").select("post_id").eq("category_id", taxRow.id)
  : supabase.from("post_tags").select("post_id").eq("tag_id", taxRow.id);
// ...
const postIds = (pivot ?? []).map((r) => (r as { post_id: string }).post_id);
// ...
.from("posts").select(POST_COLS, { count: "exact" }).in("id", postIds) ... .range(from, to)
```

Zapytanie pivotowe **nie ma `.limit()`, nie ma `.range()`, nie ma `.order()`**. Cały zbiór
identyfikatorów kategorii trafia następnie do `.in(...)` - i dopiero tam nakładane jest stronicowanie.
Stronicowanie zabezpiecza więc drugie zapytanie, a nie pierwsze.

**Dlaczego to jest blokujące.** Skutek rośnie liniowo z sukcesem serwisu i uderza w trasę publiczną,
renderowaną po stronie serwera z loadera. Identyfikator to 36 znaków plus separator, więc łańcuch
`in.(...)` rośnie o mniej więcej 38 bajtów na wpis. **Około dwustu wpisów w kategorii i linia żądania
przekracza typowy limit serwera HTTP** (rząd 8 KB w domyślnej konfiguracji nginx; dokładna wartość
zależy od wdrożenia). Wtedy archiwum kategorii nie zwalnia - **przestaje działać**, a razem z nim
trasa SSR, którą widzą wyszukiwarki.

Weryfikacja sprawdziła też obejścia, których nie ma: w repozytorium nie istnieje ani widok, ani RPC
liczące to po stronie bazy, ani bramka pilnująca nieograniczonego fan-outu.

**Co zrobić.** Przenieś złączenie do bazy, zamiast przewozić identyfikatory przez adres URL.
Rekomendacja: widok albo RPC `SECURITY DEFINER` zwracające stronę wpisów danej taksonomii wraz
z `total_count`, z sortowaniem i `LIMIT/OFFSET` po stronie serwera. Wariant lżejszy, jeśli chcesz
zostać przy PostgREST: zagnieżdżony select na `posts` z filtrem po tabeli pivot, zamiast dwóch
zapytań i `.in()`.

**Czego nie rób:** nie dokładaj `.limit(1000)` do zapytania pivotowego. To zamieni awarię na ciche
gubienie wpisów - a to jest gorsze, bo nikt tego nie zauważy. Ten sam błąd w wersji „cichej" opisuje
zresztą A3 w module 19.

**Kryterium odbioru:** test, w którym kategoria ma więcej wpisów, niż mieści strona, a zapytanie
do bazy **nie** niesie listy identyfikatorów; plus test, że `total_count` zgadza się z liczbą
wszystkich opublikowanych wpisów taksonomii, nie tylko pobranej strony.

---

## 2. Pozycje zwykłe - trzy średnie i trzy niskie

### A3. Ten sam nieograniczony fan-out w zapytaniach bloków (średni)

**Gdzie:** `src/lib/queries/blocks.ts:66-81` (`postIdsForCategorySlug`), użycie w `:99-111`;
gałąź „related" w `:353-359` i `:369-375`.

**Co jest.** Dokładnie kształt z A2, w trzech miejscach: `select("post_id").eq("category_id", cat.id)`
bez `.limit()` i bez `.order()`, a limit (`safeCount` 1-50, przy related 1-12) nakładany dopiero
na tabelę `posts`. Między jednym a drugim nie ma żadnego ogranicznika.

**Co zrobić.** Napraw razem z A2 i **tym samym mechanizmem**. Jeżeli A2 dostanie RPC albo widok,
bloki mają go użyć, a nie dostać własny wariant. Trzy kopie tego samego błędu to argument za jednym
rozwiązaniem, nie za trzema łatkami.

---

### A4. Mega menu próbkuje pivot bez sortowania (średni)

**Gdzie:** `src/lib/queries/megaMenu.ts:47-52`, drugie zapytanie w `:56-63`, konfiguracja
zapytania w `:31-37`.

**Co jest.** `.from("post_categories").select("post_id").eq("category_id", cat.id).limit(limit * 4)` -
limit **jest**, ale nie ma `ORDER BY`. Dopiero drugie zapytanie sortuje po `published_at`.
Sortowanie po pobraniu próbki, która sama została wybrana bez porządku, nie daje najnowszych wpisów -
daje najnowsze **z przypadkowej czwórki razy limit**.

Kolejność bez `ORDER BY` nie jest w Postgresie gwarantowana, ale w praktyce bywa stabilna - i to jest
najgorszy wariant, bo defekt nie objawia się losowo, tylko **konsekwentnie pomija te same wpisy**.
Zapytanie ma przy tym `staleTime` 10 minut, `gcTime` 30 minut, wyłączone odświeżanie przy powrocie
do okna i przy ponownym połączeniu - więc próbka zastyga na całe okno pracy.

**Co zrobić.** Dołóż `.order("...", { ascending: false })` do zapytania pivotowego, po kolumnie,
która odpowiada porządkowi docelowemu. Jeżeli pivot nie ma takiej kolumny, to jest argument za tym,
żeby mega menu też przeszło na mechanizm z A2 - wtedy problem znika razem z dwoma zapytaniami.

---

### A5. Dług „SSR oddaje szkielet" jest mierzony, ale nie ma zapadki (średni)

**Gdzie:** `src/lib/ci/publicRouteLoaders.ts:1-31`; `package.json:77`; `scripts/verify-static.ts:68-79`.

**Co jest.** Moduł mierzy rzecz o dużej wadze i sam nazywa swój wynik:

> „ZMIERZONE 2026-09-01: 82 publiczne strony SSR -> 21 z samymi zimnymi kluczami, z czego 16 wchodzi
> do cache dokumentów"

Czyli: dwadzieścia jeden publicznych tras oddaje szkielet ładowania zamiast treści, a szesnaście
z nich ten szkielet **utrwala w cache dokumentów na do 24 godzin**. Nagłówek modułu mówi wprost:
„narzędzie pomiarowe, nie bramka".

I faktycznie nią nie jest. Runner jest wystawiony jako `report:route-loaders`, a `verify-static.ts`
buduje zestaw blokujący **wyłącznie ze skryptów o nazwie zaczynającej się od `check:`**. W żadnym
przepływie GitHub Actions nie ma wywołania `report:route-loaders`. Weryfikacja sprawdziła też dwa
możliwe obejścia i oba odpadły: `check:ssr-budgets` importuje z tego modułu tylko pomocnicze
`balancedArgs`/`topLevelOption` i nie zamraża liczby zimnych tras, a test jednostkowy modułu
asercjuje na syntetycznych atrapach, nie na prawdziwym drzewie tras.

**Dlaczego to jest pozycja średnia, a nie niska.** Liczba 21/16 nie ma dziś żadnego hamulca. Może
rosnąć przy każdym PR-ze i nikt się nie dowie. Pomiar bez zapadki to pomiar, który zestarzeje się
w ciszy - a ten konkretny opisuje, ile publicznych stron widzi wyszukiwarka jako pusty szkielet.

**Co zrobić.** Wystaw runner jako `check:route-loaders` z **zamrożoną linią bazową** (21 zimnych tras,
16 wchodzących do cache), zapadką w dół i listą per trasa - dokładnie tak, jak działają
`check:unknown-casts` i `check:i18n-hardcoded`. Wzorzec i uzasadnienie ratchetu per plik są opisane
w nagłówku `src/lib/ci/hardcodedLanguage.ts:22-27`: licznik globalny da się skompensować, lista
per pozycja wymusza kierunek w każdej z osobna.

**Nie naprawiaj przy okazji żadnej z 21 tras.** Zadaniem jest zapadka; ścinanie długu to osobna praca
i osobny PR.

---

### A6. Tytuły dokumentu zapisane po polsku na trasach w pełni zi18n-owanych (niski)

**Gdzie:** `src/routes/people.tsx:99-116`; ten sam kształt w `cart.tsx:12-29`,
`contributors.tsx:41-44`, `reading-list.tsx:37-40`.

**Co jest.** `head()` zwraca `title`, `description`, `og:title` i `og:description` po polsku,
a komponent tuż niżej woła `useTranslation()` (linia 125). Użytkownik z EN dostaje angielski
interfejs i polską kartę przeglądarki oraz polski podgląd linku przy udostępnieniu.

**Kontrprzykład jest w tym samym katalogu:** `src/routes/welcome.tsx:17-30` rozgałęzia po
`activeLang(url)` i robi to poprawnie. Wzorzec istnieje; te cztery trasy go nie użyły.

**Dlaczego żadna bramka tego nie łapie - i dlaczego to nie jest luka do zgłoszenia.**
`src/lib/ci/monolingualUserText.ts:33-36` **nazywa tę klasę wprost** jako świadomie pozostawioną poza
zasięgiem: „właściwości obiektów (`{ title: "Zapisz" }`)". Meta w `head()` ma dokładnie ten kształt.
Bramka nie przeoczyła tego - zdecydowała, że nie patrzy.

**Co zrobić.** Napraw te cztery trasy wzorem `welcome.tsx`. Rozszerzanie bramki o właściwości obiektów
**nie jest częścią tego zlecenia** - to decyzja, która dotyka całego repozytorium i wymaga własnego
pomiaru linii bazowej.

**Zakres:** ogranicz się do tych czterech tras plus tych, które znajdziesz w module 20. Polskich
literałów w `title:` jest w `src/routes/` łącznie **38 na 160**; reszta leży w innych modułach
i **nie wchodzi do tego PR-a**.

---

### A7. Komentarz przy porównaniu sekretu crona twierdzi coś, czego kod nie robi (niski)

**Gdzie:** `src/lib/server/jobsTick.server.ts:292-298`.

**Co jest.** Komentarz: „Stały czas porównania sekretów (długości też nie zdradzamy wcześniej)".
Kod pod nim: `return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);` - operator `&&`
kończy porównanie na różnicy długości, **nie wywołując `timingSafeEqual`**. Długość jest więc
zdradzana wcześniej, wbrew zdaniu w nawiasie.

**Kod jest tu poprawny, a komentarz nie.** Test `jobsTickSecrets.test.ts:145-156` opisuje tę gałąź
jako świadomą i konieczną: bez niej `timingSafeEqual` rzuciłby `RangeError`, a publiczna trasa
oddałaby 500. Dokumentacja w teście jest prawdziwa, komentarz przy kodzie - odwrotny.

**Co zrobić.** Popraw komentarz, nie kod. Ma mówić, co naprawdę zachodzi: stały czas dla sekretów
tej samej długości, wcześniejsze wyjście przy różnej długości, i **dlaczego** to wyjście tam jest
(`RangeError`, 500 na publicznej trasie). Jeśli uznasz, że wyciek długości jest realnym problemem,
napisz to w opisie PR-a jako osobną obserwację - ale nie zmieniaj zachowania w ramach tego zlecenia,
bo zmiana dotyka odpowiedzi publicznej trasy.

---

### A8. Parser `Cache-Control` ignoruje `no-cache` (niski)

**Gdzie:** `src/lib/http/parseCacheControl.ts:3-10` i `:34-52`;
`src/lib/http/documentCache.ts:196-209`.

**Co jest.** `ParsedCacheControl` ma pola `public`, `private`, `noStore`, `sMaxAge`,
`staleWhileRevalidate`, a `switch` obsługuje dokładnie te pięć nazw. **`no-cache` i `must-revalidate`
wpadają w `default` i giną.** `documentStorePolicy` podejmuje decyzję o zapisie dokumentu do cache
wyłącznie na tych polach.

**Dlaczego mimo to niski.** Weryfikacja sprawdziła część wyłączającą dzisiejsze ryzyko: jedyne
wystąpienie `no-cache` w `src/` to `src/routes/api/public/nl-open.ts:28-29`, gdzie nagłówek zawiera
również `no-store`, a odpowiedź i tak nie jest dokumentem `text/html`. **Dziś żadna ścieżka tego
nie wyzwala.** To jest mina, nie pożar - parser cicho gubi dyrektywę, która w HTTP rozstrzyga
o zapisie do cache, i zadziała w dniu, w którym ktoś napisze `Cache-Control: public, s-maxage=600,
no-cache` w dobrej wierze.

**Co zrobić.** Dołóż `no-cache` (i rozważ `must-revalidate`) do typu i do `switch`, a
`documentStorePolicy` ma je respektować. Plik nie ma dziś progu - dopisz go razem z testem.

---

## 3. Pozycja pokryciowa - dok roboczy

To jest największa pozycja tego zlecenia liczona w wierszach i jedyna, która nie jest defektem.
**263 niepokryte wiersze, 123 niepokryte funkcje, zero progów na 32 pliki.**

**B1. Sześć paneli bez dowodu.** `ChatSideDrawer` (2,3 %), `NotesPanel` (2,1 %), `SavedPanel` (5,9 %),
`TodoPanel` (0 %), `CalendarPanel` (0 %), `MinimizedChats` (8,7 %). Każdy z nich to powierzchnia,
na której użytkownik wykonuje pracę: pisze notatkę, odhacza zadanie, czyta czat, wraca do zapisanego
wpisu. Testów tych czynności nie ma.

**B2. Progi dla wszystkich 32 plików doku.** Dziś żaden nie wpada pod żaden glob. Bez tego kroku
wynik pracy nad B1 rozpłynie się przy następnym PR-ze dokładnie tak, jak rozpłynął się dotychczas.
Ustaw progi **na poziomie osiągniętym**, nie życzeniowym - zapadka ma trzymać to, co zrobiłeś,
a nie blokować cudzy PR.

**B3. Cztery pliki doku na zerze bezwarunkowo wychodzą z zera:** `TodoPanel.tsx` (31 wierszy),
`CalendarPanel.tsx` (23), `DockPanelShell.tsx` (5), `atoms/DockEmptyState.tsx` (1).

**Jak to testować - podpowiedź z istniejącego dorobku.** Dok ma już szesnaście plików testowych
i wśród nich gotowe wzorce: `dockState.test.ts` (stan), `reservedSpace.test.ts` (geometria),
`WorkspaceDock.ssr.test.tsx` (zachowanie przy renderze serwerowym), `dockI18nKeys.gate.test.ts`
(bramka kluczy), `noteContextSubscription.test.tsx` (subskrypcja). Brakuje warstwy, która otwiera
panel i coś w nim robi. **Nie zaczynasz od zera - zaczynasz od brakującego piętra.**

---

## 4. Czego dowód nie obejmuje - do rozstrzygnięcia, nie do wykonania

Zapisuję, żeby nie zniknęło. **Nie jest to część tego zlecenia:**

- **Rozbieżność klasyfikacji doku.** `src/components/dock/**` należy w taksonomii do przekroju
  `admin-shell`, a w widoku funkcjonalności do modułu 20. Dopóki tak jest, żaden pomiar per moduł
  nie pokaże tej powierzchni w całości. Czy to poprawić w `scripts/taxonomy/moduleMap.mjs`,
  czy zostawić jako świadome rozdzielenie - to decyzja właściciela taksonomii, nie wykonawcy
  tego PR-a.
- **Bramka `check:i18n-hardcoded` nie widzi właściwości obiektów** (patrz A6). Rozszerzenie jej
  zasięgu wymaga zmierzenia linii bazowej dla całego repozytorium.
- **Nie ma bramki na nieograniczony fan-out** w zapytaniach. A2, A3 i A4 to trzy instancje jednego
  wzorca; po ich naprawie warto rozważyć zapadkę, która nie wpuści czwartej. Osobny PR.
- **21 tras SSR oddających szkielet** (patrz A5). To zlecenie dokłada zapadkę, nie ścina długu.

---

## 5. Zasady, których nie wolno złamać

1. **Nie zmieniasz zachowania produkcyjnego po to, żeby test przeszedł.** Defekt spoza tej listy
   zapisujesz jako `it.fails("DEFEKT: ...")` z opisem mechanizmu.
   **Wyjątek, jeden i opisany:** test „falls back to forwarded host/proto" w A1 utrwala złe
   zachowanie i ma zostać przepisany razem z naprawą - z wyjaśnieniem w opisie PR-a.
2. **Progi wolno wyłącznie podnosić.** Nigdy nie obniżasz wartości w `vitest.config.ts` i nie
   wykluczasz pliku z pomiaru. Po skończonej pracy **dopisz progi dla wszystkich 32 plików doku
   i dla czterech plików warstwy HTTP**, które dziś progu nie mają.
3. **Nie zmieniasz `package.json`** - dotyczy to także A5: nie dopisujesz tam skryptu
   `check:route-loaders`. Zamiast tego przygotuj runner i **opisz w PR-ze dokładną linijkę,
   którą właściciel repozytorium ma dodać**, wraz z powodem. Zapadka bez wpisu w `package.json`
   nie blokuje, ale jest gotowa do włączenia jednym wierszem.
4. **Żaden test nie wychodzi do sieci i nie zawiera prawdziwego sekretu.** Supabase, operator
   płatności i dostawca poczty są atrapami. W A1 i A7 dotykasz ścieżek, na których sekret jest
   przedmiotem testu - tym bardziej ma być wymyślony.
5. **RODO w testach:** żadnych prawdziwych danych osobowych w fixture, żadnych realnych adresów
   e-mail poza domenami `example.com` / `example.org`. Dotyczy zwłaszcza paneli doku (notatki, czat,
   zapisane) - treść testowa ma być wymyślona.
6. **Nie regenerujesz snapshotu autoryzacji**, żeby zgasić czerwień.
7. **Nie usuwasz cudzych wpisów `it.fails`** bez naprawy produkcji w tym samym commicie.
8. **Nie zamieniasz awarii na ciche gubienie danych.** Dotyczy A2 wprost: `.limit(1000)` na zapytaniu
   pivotowym jest zakazane. Jeżeli czegoś nie da się dowieźć w całości, kod ma to powiedzieć,
   a nie udawać, że dowiózł.
9. **Nie ścinasz długu przy okazji zapadki** (A5) i nie rozszerzasz zakresu i18n poza moduł (A6).

---

## 6. Standard kodu

- **i18n (PL i EN)** dla każdego napisu widocznego dla użytkownika - w tym dla tytułów i opisów
  w `head()`, co jest treścią A6. Wzorzec: `src/routes/welcome.tsx:17-30`.
- **Atomic design:** dok ma już pełne trzy warstwy (`atoms/DockEmptyState`, `molecules/MinimizedChats`,
  `organisms/TodoPanel`). Nowe komponenty trafiają do właściwej, razem z testem.
- **`tenant_id`** w każdym nowym zapytaniu i w każdej nowej polityce RLS. Przy A2, jeśli powstanie
  RPC albo widok, warunek najemcy jest jego częścią od pierwszej wersji, nie dopiskiem.
- **Zero `any`** - ani `: any`, ani `as any`. W całym repozytorium jest dziś **zero `as any`**
  i **jedno `: any`**; nie psuj tego wyniku. Rzutowania `as unknown as` podlegają ratchetowi
  `check:unknown-casts` i mogą tylko znikać. Zwróć uwagę na `archives.ts:258`
  (`(r as { post_id: string }).post_id`) - przy naprawie A2 ten cast najpewniej zniknie sam.
- **Dywiz `-`, nigdy długa kreska (U+2014).** Przeszukanie tego pliku za znakiem U+2014 musi zwracać
  zero trafień, tak samo jak przeszukanie twojego diffu.
- Komentarz piszesz wtedy, gdy tłumaczy **dlaczego**, nie **co**. **Komentarz, który przestał być
  prawdziwy, jest defektem** - to zlecenie zawiera dwa takie przypadki i warto zobaczyć różnicę
  między nimi: w A7 kod jest poprawny i komentarz trzeba poprawić, w A1 komentarz opisuje ochronę,
  której nie ma, więc poprawić trzeba **kod**. Zanim poprawisz zdanie, rozstrzygnij, która strona
  rozjazdu ma rację.

---

## 7. Kryterium odbioru całości

| Wymóg                                    | Dziś      | Po             |
| ---------------------------------------- | --------- | -------------- |
| Linie doku roboczego (32 pliki)          | 65,26 %   | **>= 85 %**    |
| Funkcje doku roboczego                   | 58,72 %   | **>= 82 %**    |
| Pliki doku na zerze                      | 4         | **0**          |
| Pliki doku bez progu                     | 32 z 32   | **0**          |
| Pliki warstwy HTTP z defektami bez progu | 4         | **0**          |
| Linie modułu (cały moduł)                | 98,20 %   | **>= 98,20 %** |
| Zapytania pivotowe bez ogranicznika      | 3 miejsca | **0**          |

Wiersz przedostatni nie jest pomyłką: **moduł ma nie spaść.** Przy 98,20 % zadaniem nie jest podniesienie
liczby, tylko jej nieuszkodzenie przy okazji naprawy ośmiu defektów. Praca pokryciowa tego zlecenia
mierzy się osobno - na doku, którego pomiar modułu nie obejmuje.

Ponadto:

- `bun run check:i18n-parity`, `check:i18n-hardcoded`, `check:unknown-casts`, `check:feature-taxonomy`
  i bramki SQL - **zielone**.
- Runner zapadki tras SSR **gotowy do włączenia jednym wierszem** w `package.json`, z zamrożoną
  linią bazową 21/16 i listą per trasa. Wiersz do dodania podajesz w opisie PR-a.
- Każdy defekt z rozdziałów 1-2 albo **naprawiony i przypięty testem**, albo zostawiony z jawnym
  uzasadnieniem. Trzecia możliwość nie istnieje.
- **Opis PR-a ma być równy diffowi.** Zlecenie wymienia osiem defektów, trzy pozycje pokryciowe doku
  i cztery sprawy wyłączone z zakresu; w opisie ma się znaleźć stan każdej z nich.
