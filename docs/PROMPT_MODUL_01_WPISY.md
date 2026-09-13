# ZLECENIE: MODUŁ 1 - Wpisy: doświadczenie czytelnika

> **HEAD pomiaru: `7a780b1d0`.** Każda liczba w tym dokumencie została zmierzona na tym commicie.
> Jeżeli pracujesz na nowszym `main`, **przemierz przed startem** - i jeśli któraś liczba się rozjechała,
> napisz o tym w opisie PR-a zamiast dopasowywać się do nieaktualnego zlecenia. Ta uwaga stoi tu,
> bo w wydaniu 10 trzy z siedmiu pozycji erraty wykonawcy wzięły się z czytania zlecenia na innym HEAD,
> niż powstało (rozdz. 8.5 audytu, pozycja 16).
>
> **Stan na dzień oddania zlecenia:** między `7a780b1d0` a commitem, który wnosi ten plik, nie zmienił
> się ani jeden plik w `src/`, `supabase/` ani `drizzle/` - siedem commitów po drodze dotknęło wyłącznie
> `README.md`, dokumentu audytu, `reports/i18n-parity.json` i skryptu weryfikującego. Liczby niżej
> obowiązują więc także na dzisiejszym `main`. Sprawdzisz to jednym poleceniem:
> `git diff --name-only 7a780b1d0..HEAD -- src/ supabase/ drizzle/` ma nie wypisać nic.

Źródło: `docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`, rozdz. 15.15 (defekty) i 15.16
(rodzaj testu per moduł). Wszystkie osiem defektów wymienionych niżej przeszło **niezależną próbę
obalenia** przez osobnego agenta i zostało potwierdzone.

---

## 0. Stan wyjściowy - zmierzony, nie przepisany

| Metryka                         | Wartość na `7a780b1d0`                                     |
| ------------------------------- | ---------------------------------------------------------- |
| Pliki produkcyjne               | 106 (13 896 wierszy)                                       |
| Pliki testowe                   | 42                                                         |
| Trasy                           | 10                                                         |
| **Linie**                       | **84,78%** (2 194 / 2 588)                                 |
| **Funkcje**                     | **82,28%** (571 / 694)                                     |
| Gałęzie                         | 75,18%                                                     |
| Linii bez ani jednego wykonania | **394**                                                    |
| Plików na zerze                 | **13** (270 wierszy)                                       |
| Rodzajów testów w module        | **4** z 11 (jednostkowy, komponentowy, hooka, dostępności) |

**Moduł 1 jest trzecią najsłabszą powierzchnią w całym repozytorium** - słabsze są tylko design system
(81,48%) i sieć kontaktów (83,65%). Jednocześnie jest to **najbardziej publiczna część platformy**:
to jest strona, na którą trafia czytelnik z wyszukiwarki i z mediów społecznościowych.

### 0.1. Gdzie dokładnie stoi dług

Trzynaście plików na zerze (270 wierszy):

| Plik                                         | Wiersze |
| -------------------------------------------- | ------: |
| `src/components/author/AuthorCvSections.tsx` |      53 |
| `src/routes/api/stt.ts`                      |      45 |
| `src/components/author/CvPrintSheet.tsx`     |      41 |
| `src/hooks/usePasswordUnlock.ts`             |      38 |
| `src/routes/api/public/related-click.ts`     |      29 |
| `src/routes/preview.$token.tsx`              |      25 |
| `src/lib/relatedInsights.functions.ts`       |      14 |
| `src/routes/post.$slug.tsx`                  |      14 |
| `src/hooks/useUnlockedContent.ts`            |       5 |
| `src/routes/admin.related-posts.tsx`         |       3 |
| `src/routes/admin.key-takeaways.tsx`         |       1 |
| `src/routes/admin.post-layouts.tsx`          |       1 |
| `src/routes/admin.toc.tsx`                   |       1 |

Największe dziury poza zerami: `RelatedPosts.tsx` (39 wierszy bez testu), `api/tts.ts` (34),
`PostSidebarRenderer.tsx` (12), `lib/audio/ttsRenditions.ts` (10).

**Te dwie listy pokrywają się z listą defektów niemal dokładnie** i to jest najważniejsza obserwacja
tego zlecenia: dług pokrycia i dług produktowy siedzą w tych samych plikach. Nie są to dwie osobne
kampanie.

### 0.2. Czego dziś NIE pilnuje żaden próg

Sprawdzone w `vitest.config.ts`: **żaden z sześciu plików, w których siedzą defekty, nie ma własnego
progu**. `RelatedPosts.tsx`, `PostSidebarRenderer.tsx` i `AutoLoadNextPost.tsx` wpadają wyłącznie pod
glob `src/components/post/**` (linie 84), a `routes/api/tts.ts`, `routes/api/public/related-click.ts`
i `hooks/useRecordPostView.ts` **nie wpadają pod nic**. Dowolna regresja na tych trzech ostatnich
przejdzie CI bez mrugnięcia.

---

## 1. Pozycje BLOKUJĄCE - trzy defekty o wadze wysokiej

### A1. Silnik rekomendacji v2 jest martwy na produkcji

**Gdzie:** `src/components/post/RelatedPosts.tsx:43-50`, `src/lib/queries/relatedPosts.ts:189-216`,
`src/lib/relatedPosts.ts:164-186`.

**Co jest:** `RelatedPosts` przekazuje do warstwy zapytania **cztery pola**:
`{ postId, limit, strategy, recencyBoostDays }`. Warstwa zapytania woła legacy `scoreRelated`, a wrapper
domyka brakujące pola zerami: `weight_popularity ?? 0`, `weight_dwell ?? 0`, `weight_personalization ?? 0`,
`use_idf ?? false`. `rankRelated` dostaje domyślne `minScore = 0`. Funkcje `scoreRelatedDetailed`,
`buildIdf` i `normalizeMap` **nie mają w `src/` ani jednego wywołania produkcyjnego** - grep poza plikiem
definicji zwraca wyłącznie pliki testowe.

**Dlaczego to jest blokujące:** panel `/admin/related-posts` pozwala ustawić siedem wag 0-10, IDF
i `min_score`, zapisuje je i pokazuje zakładkę „Analiza". **Redakcja stroi pokrętła, które nic nie robią.**
To nie jest błąd wydajności ani kosmetyki - to jest narzędzie redakcyjne, które kłamie o swoim działaniu.

**Co zrobić - wybierz JEDNĄ z dwóch dróg i uzasadnij wybór w opisie PR-a:**

- **(a) domknąć kontrakt:** przekazać z `RelatedPosts.tsx` pełną konfigurację do warstwy zapytania,
  wywołać `scoreRelatedDetailed` z sygnałami popularności, dwell i profilu, a `min_score` podać do
  `rankRelated`. Jeśli utrzymanie tych sygnałów po stronie klienta jest za drogie, przenieść scoring
  do RPC obok `get_recommended_posts_v2`.
- **(b) usunąć niedziałającą konfigurację:** wyciąć z panelu pokrętła, których render nie czyta, i zostawić
  wyłącznie te, które faktycznie wpływają na wynik.

**Czego NIE robić:** nie zostawiaj stanu pośredniego, w którym część wag działa, a część nie - to jest
dokładnie ta sytuacja, którą naprawiasz.

**Kryterium odbioru:** test warstwy zapytania, który dla dwóch różnych konfiguracji wag daje **różną
kolejność** wyników; oraz test, że `min_score` faktycznie odcina kandydata poniżej progu. Przy drodze (b):
test panelu, że zapisywane pola to dokładnie te, które czyta render.

---

### A2. `/api/tts` przyjmuje od klienta dowolny głos i model

**Gdzie:** `src/routes/api/tts.ts:14-20` i `:36-40`.

**Co jest:** walidacja `voiceId` to `/^[A-Za-z0-9]{8,40}$/` - **sprawdzenie kształtu, nie przynależności**.
Dowolny identyfikator głosu ElevenLabs przechodzi. Obok stoi lokalna `ALLOWED_MODELS` z czterema pozycjami
(`eleven_multilingual_v2`, `eleven_monolingual_v1`, `eleven_turbo_v2`, `eleven_turbo_v2_5`), z czego
**dwóch nie ma w kanonicznej `TTS_MODELS`** (`src/lib/audio/ttsCanonical.ts`, dwa modele; `TTS_VOICES`,
sześć głosów). Trasa nie importuje `isAllowedTtsVoiceId` ani `isAllowedTtsModelId`, choć obie funkcje
istnieją i są wyeksportowane. Trasa nie ma też żadnego cache - **każde wywołanie to nowa płatna synteza**.

**Precedens masz w repozytorium:** `isAllowedTtsVoiceId` jest już konsumowane produkcyjnie przez schemat
Zod w `src/lib/content.functions.ts:288` (`refine`, komunikat `"Voice outside the allowlist"`), a
`isAllowedTtsModelId` przez `resolveTtsSettings` w `ttsCanonical.ts:197`. Nie wprowadzasz więc nowego
mechanizmu, tylko podłączasz trasę do tego, któremu reszta platformy już ufa.

**Dlaczego to jest blokujące:** nagłówek `ttsCanonical.ts` opisuje przyczynę źródłową audytu z 2026-08-03:
wybór głosu i modelu po stronie klienta mnożył płatne syntezy. Naprawiono to w `/api/public/post-tts`
i **zostawiono nietkniętą drugą ścieżkę syntezy**. To jest ten sam defekt, ten sam koszt, inny plik.

**Co zrobić:** zastąpić `ALLOWED_MODELS` i regex wywołaniami `isAllowedTtsModelId` i `isAllowedTtsVoiceId`
z modułu kanonicznego. Następnie rozstrzygnąć, czy widget buildera w ogóle potrzebuje wyboru głosu -
jeśli nie, zablokować oba pola po stronie serwera i dopisać cache treści analogiczny do `post-tts`
(prywatny bucket, ETag, 304, koalescencja).

**Kryterium odbioru:** test handlera na wzór istniejącego `-post-tts.test.ts`, przechodzący **ten sam
handler co HTTP**, z sekcjami: brak tokenu, brak roli staff (RPC `is_staff`), głos spoza allowlisty,
model spoza allowlisty, dwuoknowe dławienie fail-closed, mapowanie błędu dostawcy, nagłówki odpowiedzi.
Dziś testowana jest **wyłącznie** funkcja `normalizeTtsInput`.

---

### A3. Rate-limit beacona rekomendacji skanuje tabelę bez pasującego indeksu

**Gdzie:** `src/routes/api/public/related-click.ts:48-55`.

**Co jest:** zapytanie `.eq("viewer_hash", viewer).gte("clicked_at", since)` z `count: "exact"`.
Indeksy na `public.related_post_clicks` (migracja `20260716212125`) to:

```
related_post_clicks_tenant_time_idx  (tenant_id, clicked_at DESC)
related_post_clicks_pair_idx         (tenant_id, source_post_id, target_post_id)
related_post_clicks_target_idx       (tenant_id, target_post_id)
```

**`viewer_hash` nie jest pierwszą kolumną żadnego z nich.** Zapytanie jest więc `count(*)` po całej,
stale rosnącej tabeli klików - wykonywanym **przy każdym kliknięciu w rekomendację**, czyli na gorącej
ścieżce czytelniczej.

**Co zrobić - w tej kolejności, bo druga zmiana rozstrzyga kształt pierwszej:**

1. **Najpierw zawęź zapytanie licznika do najemcy** źródłowego wpisu. Dziś licznik sumuje ruch
   wszystkich najemców, więc aktywny najemca wyczerpuje limit cudzym czytelnikom - to jest defekt
   sam w sobie, niezależny od wydajności, i łamie regułę `tenant_id` w każdym zapytaniu.
2. **Potem dołóż indeks pod finalny predykat**, nie pod dzisiejszy. Po kroku 1 predykat brzmi
   `tenant_id = ? AND viewer_hash = ? AND clicked_at >= ?`, więc właściwy jest:

   ```sql
   CREATE INDEX IF NOT EXISTS related_post_clicks_tenant_viewer_window_idx
     ON public.related_post_clicks (tenant_id, viewer_hash, clicked_at DESC);
   ```

   Indeks prowadzony samym `viewer_hash` też by zadziałał, ale zostawiłby `tenant_id` poza kluczem
   i rozjechałby się z konwencją pozostałych trzech indeksów tej tabeli, które wszystkie prowadzą
   `tenant_id`. **Nie dokładaj obu** - jeden indeks pod jeden predykat.

**Uwaga na pas migracji:** migrację dopisujesz do `supabase/migrations/`, **nie** do `drizzle/migrations/`.
Bramki SQL czytają katalog wskazany stałą `MIGRATIONS_DIR` w `scripts/lib/sqlMigrations.ts` i pasa drizzle
nie widzą wcale (znalezisko Z1 audytu, rozdz. 15.7).

**Kryterium odbioru:** `check:sql-tenant-scope` i pozostałe bramki SQL zielone; test trasy pokrywający
walidację ciała, odrzucenie samoodwołania, rate-limit i blokadę międzynajemcową (dziś plik ma **0%**).

---

## 2. Pozycje zwykłe - cztery defekty o wadze średniej i jeden niski

### A4. Historia czytania zapisywana poza bramką zgody analitycznej

**Gdzie:** `src/hooks/useRecordPostView.ts:55-70`.

`user_read_history` to profil zachowania konkretnej osoby: co i kiedy przeczytała. Zasila rekomendacje,
sygnał dwell i metryki analityczne (`src/lib/analytics/semantic/streams.ts:228`). Po wycofaniu zgody
analitycznej hook przestaje liczyć odsłonę i **czyści `viewer_hash`**, ale `upsert` do `user_read_history`
leci dalej, bo stoi poza tą samą gałęzią.

**Co zrobić:** przenieść `upsert` pod tę samą bramkę co odsłonę, **albo** świadomie wydzielić dla niego
osobną kategorię zgody i dopisać tabelę do `/cookies`. W obu wariantach dołożyć do istniejącego testu
regresji RODO asercję na mocku upsertu, żeby decyzja została utrwalona, a nie tylko podjęta.

### A5. Widget „Karta autora" renderuje zaślepkę

**Gdzie:** `src/components/post/PostSidebarRenderer.tsx:140-146`.

`case "author-card"` zwraca ramkę z napisem „Karta autora wkrótce." / „Author card coming soon.".
Redaktor wybiera z palety widget opisany jako „Bio i linki autora", zapisuje layout, publikuje -
i czytelnik dostaje pustą ramkę. **Właściwy komponent już istnieje**: `AuthorBusinessCard.tsx`, a dane
autora są w propsie, który renderer i tak dostaje.

**Co zrobić:** podpiąć `AuthorBusinessCard` pod `case "author-card"`. Jeśli brakuje jakiegoś pola,
dociągnąć je w loaderze trasy, nie w komponencie.

### A6. Doładowywanie kolejnych wpisów trwale podmienia adres i tytuł

**Gdzie:** `src/components/post/AutoLoadNextPost.tsx:100-115`.

Po przewinięciu do doładowanego wpisu i **powrocie w górę** czytelnik ma na ekranie pierwotny artykuł,
a w pasku adresu i w tytule karty - inny. Udostępnienie linku, zakładka albo odświeżenie prowadzą wtedy
do nie tego materiału, który jest na ekranie.

**Co zrobić:** obserwować nagłówki **wszystkich** elementów łańcucha razem z pierwotnym artykułem
i przywracać adres oraz tytuł przy wyjściu doładowanego wpisu z kadru.

### A7. Paywall ignoruje błędy obu swoich zapytań

**Gdzie:** `src/components/Paywall.tsx:110-125`.

Zalogowany czytelnik trafia na treść płatną, zapytanie o plany pada (RLS, sieć, chwilowy błąd bazy) -
i dostaje komunikat „treść płatna" **bez ani jednego przycisku zakupu**. To jest lejek sprzedażowy
w najwęższym miejscu.

**Co zrobić:** czytać pole `error` obu zapytań i pokazywać stan błędu z ponowieniem zamiast cicho pustej
listy planów.

**Kryterium odbioru:** Paywall nie ma dziś **żadnego** testu komponentowego. Dopisz go: gałęzie trybów
(członkostwo / płatność / hasło), blokada po pięciu próbach hasła, zachowanie przy nieudanym odczycie
planów.

### A8. Martwa zmienna w pętli strumieniowania audio (niski)

**Gdzie:** `src/lib/audio/global-player.tsx:345-355`.

Kod sugeruje jednorazowe przejście w etap `streaming`, którego nie ma - `setTts({ stage: "streaming" })`
odpala się przy każdym odebranym fragmencie. Usuń martwy warunek albo dowieź semantykę, którą obiecuje.

---

## 3. Pozycje pokryciowe - dług, który nie jest defektem

Kolejność od najtańszego do najdroższego. **Nie dopisuj testu do pliku, którego defekt naprawiasz
w punktach A1-A8 - tam test jest częścią kryterium odbioru i liczy się raz.**

- **B1.** `src/hooks/usePasswordUnlock.ts` (38 wierszy, **0%**) - hook odblokowania po haśle z blokadą
  po pięciu próbach. Czysta logika, test hooka jest tani, a reguła jest dostępowa.
- **B2.** `src/hooks/useUnlockedContent.ts` (5 wierszy, **0%**) i `src/lib/relatedInsights.functions.ts`
  (14 wierszy, **0%**) - dwa małe pliki, razem 19 wierszy.
- **B3.** `src/routes/preview.$token.tsx` (25 wierszy, **0%**) - podgląd szkicu pod embargiem.
  Test trasy: `noindex`, baner wygaśnięcia, ta sama pre-transformacja przypisów co na produkcji,
  brak reklam i komentarzy. **To jest powierzchnia, przez którą materiał nieopublikowany wychodzi
  na zewnątrz do prasy i partnerów** - zero procent jest tu najdroższym zerem modułu.
- **B4.** `src/routes/post.$slug.tsx` (14 wierszy, **0%**) - przekierowanie 301 na adres kanoniczny.
- **B5.** `src/components/author/AuthorCvSections.tsx` (53) i `CvPrintSheet.tsx` (41) - razem 94 wiersze
  na zerze. Eksport CV do PDF przez druk przeglądarki; test komponentowy na strukturę i a11y.
- **B6.** `src/routes/api/stt.ts` (45 wierszy, **0%**) - druga trasa bez żadnego testu handlera.
  Pokryty jest tylko jej konsument po stronie wyszukiwarki głosowej.

**Cztery trasy panelu** (`admin.related-posts`, `admin.key-takeaways`, `admin.post-layouts`, `admin.toc`)
mają po 1-3 wiersze na zerze - to są same definicje trasy. Nie warto ich ruszać osobno; wejdą przy okazji.

---

## 4. Czego dowód nie obejmuje - do rozstrzygnięcia, nie do wykonania

Zapisuję to, żeby nie zniknęło, ale **nie jest to część tego zlecenia**:

- Produkcyjna ścieżka doboru powiązanych wpisów nie ma testu, a testy scorera v2 dotyczą funkcji,
  których żaden kod produkcyjny nie wywołuje - **utrwalają zachowanie martwego wariantu**.
  Po naprawie A1 te testy trzeba przemyśleć od nowa.
- Brak testu kontraktowego pgTAP dla meteringu i rejestru nagrań TTS, choć ten wzorzec jest
  w repozytorium stosowany dla limitów punktów kluczowych.
- Auto-podlinkowanie słowniczka, portalowa wstawka rekomendacji po N-tym akapicie i renderer widgetów
  sidebara nie mają testów na poziomie organizmu.

---

## 5. Zasady, których nie wolno złamać

1. **Nie zmieniasz zachowania produkcyjnego po to, żeby test przeszedł.** Jeśli znajdziesz defekt spoza
   tej listy - zapisujesz go jako `it.fails("DEFEKT: ...")` z opisem mechanizmu, a nie naprawiasz
   po cichu przy okazji. Naprawa defektu i dopisanie testu do zielonego kodu to dwie różne czynności.
2. **Progi wolno wyłącznie podnosić.** Nigdy nie obniżasz żadnej wartości w `vitest.config.ts`
   i nie wykluczasz pliku z pomiaru. Po skończonej pracy **dopisz progi per plik dla każdego pliku,
   który ruszyłeś** - dziś sześć plików z defektami nie ma żadnego własnego progu, a trzy z nich
   nie wpadają nawet pod glob.
3. **Nie zmieniasz `package.json` i nie commitujesz `package-lock.json`.**
4. **Żaden test nie wychodzi do sieci i nie zawiera prawdziwego sekretu.** Dostawca TTS, Supabase
   i płatności są atrapami.
5. **RODO w testach:** żadnych prawdziwych danych osobowych w fixture, żadnych realnych adresów e-mail
   poza domenami `example.com` / `example.org`. W tym module jest to szczególnie istotne - dotykasz
   `user_read_history`, historii czytania konkretnej osoby.
6. **Nie regenerujesz snapshotu autoryzacji**, żeby zgasić czerwień.
7. **Nie usuwasz cudzych wpisów `it.fails`** bez naprawy produkcji w tym samym commicie.

## 6. Standard kodu

- **i18n PL i EN** dla każdego napisu widocznego dla użytkownika - żadnych twardych literałów.
  Bramka `check:i18n-hardcoded` to sprawdza; bramka `check:i18n-parity` pilnuje, żeby oba języki miały
  ten sam zestaw kluczy. Zwróć uwagę, że jedyny napis, który usuwasz w A5, jest dziś jedynym miejscem
  z poprawnym dwujęzycznym zapisem - nie zgub go przy podmianie.
- **Atomic design:** nowe komponenty trafiają do właściwej warstwy (`atoms` / `molecules` / `organisms`).
  Atomy modułu 1 mają próg 100/100/100/90 - jeśli dokładasz atom, dokładasz też jego test.
- **`tenant_id`** w każdym zapytaniu do bazy i w każdej nowej polityce RLS. Dotyczy to zwłaszcza A3,
  gdzie licznik dziś sumuje ruch wszystkich najemców.
- **Zero `any`** - ani `: any`, ani `as any`. W całym repozytorium jest dziś **zero `as any`**
  i **jedno `: any`** (w cudzym pliku); nie psuj tego wyniku. Do rzutowań używaj wzorca przyjętego
  w repozytorium i pilnowanego bramką `check:unknown-casts`.
- **Dywiz `-`, nigdy długa kreska (U+2014).** W wydaniu 10 jeden wykonawca zostawił 191 takich znaków
  w czterech plikach testowych. Znaku nie wpisuję tu dosłownie, bo wtedy to zlecenie samo łamałoby
  regułę, którą stawia: `grep -c $'\u2014'` na tym pliku musi zwracać zero, tak samo jak na twoim diffie.
- Komentarz piszesz wtedy, gdy tłumaczy **dlaczego**, nie **co**. Wzorzec masz w nagłówku
  `ttsCanonical.ts`: opisuje incydent, który powołał moduł do życia.

## 7. Kryterium odbioru całości

- Osiem defektów A1-A8 zamkniętych albo jawnie odłożonych z uzasadnieniem w opisie PR-a.
  **Pozycja odłożona bez adnotacji jest traktowana jak niewykonana** - w wydaniu 10 pominięto tak
  pozycję nazwaną blokującą i wyszło to dopiero w audycie.
- Moduł 1 na **≥ 92% linii i ≥ 90% funkcji** (dziś 84,78% / 82,28%). To jest cel realny: 394 niepokryte
  wiersze, z czego 270 to trzynaście plików na zerze.
- **Zer w module: 0** albo lista zer z uzasadnieniem, dlaczego dany plik zostaje.
- Progi per plik dopisane dla każdego ruszonego pliku; żaden próg nie obniżony.
- `bun run check:gate-coverage` i komplet bramek `check:*` zielone.
- **Opis PR-a równy diffowi:** lista zmienionych plików produkcyjnych z powodem każdej zmiany.
  Jeśli zmieniasz plik spoza modułu 1 - nazwij go i uzasadnij. W wydaniu 10 jeden PR zmienił
  34 pliki produkcyjne, o których jego opis nie wspominał ani słowem.

---

_Zlecenie powstało na HEAD `7a780b1d0`. Defekty: rozdz. 15.15 dokumentu audytu, wszystkie osiem
potwierdzone niezależną próbą obalenia. Stan pokrycia: rozdz. 15.9. Rodzaj testu per moduł: rozdz. 15.16._
