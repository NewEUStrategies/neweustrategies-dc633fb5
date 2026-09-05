# Izolacja najemcy na danych kandydatów (moduł 21): jeden dowód, którego nie było w żadnej warstwie - i osiem liczb zlecenia, które okazały się nieaktualne (2026-09-05)

Zlecenie prosiło o usunięcie „mechanicznej przyczyny bezruchu" modułu 21:
dziewięć identycznych pomiarów, 55,12% linii, 47,13% funkcji, zero progów
per-ścieżka, zero wpisów w rejestrze defektów. Pierwszą czynnością tej pracy
było odtworzenie tych liczb, tak jak nakazują jego własne ZASADY. **Żadna
z nich nie odtworzyła się.** Moduł został domknięty dwa dni wcześniej.

Zostało natomiast jedno zadanie z tego zlecenia naprawdę otwarte - i akurat to,
które zlecenie samo nazwało najcięższym znaleziskiem. Ten dokument opisuje, co
zrobiono, oraz - osobno i szczegółowo - które liczby zlecenia były nieaktualne,
bo ta druga lista jest dla audytu cenniejsza niż pierwsza.

---

## 1. Stan zastany: pomiar przed pracą

| co | zlecenie twierdzi | repozytorium na HEAD `e15d2d3` | źródło |
| --- | --- | --- | --- |
| linie modułu | 55,12% (468/849) | **100%** (883/883) | commit `052aea9`, 2026-09-03 |
| funkcje modułu | 47,13% (164/348) | **100%** (359/359) | jw. |
| wywołania `it(` | 165 | **643** (23 pliki testowe) | `grep -a`, zakres jak niżej |
| wywołania `expect(` | 374 | **2 007** | jw. |
| klucze progowe w `vitest.config.ts` | 554 | **638** | parser kluczy |
| klucze obejmujące moduł 21 | 1 (fałszywy przyjaciel) | **10** | jw. |
| wpisy `it.fails` | 0 | **6** w module + **2** w `jobsTickRun` | `grep -a` |
| `it.fails` na platformie | 327 / 186 plików | **348 / 199** | jw. |
| testy trasy `admin.hiring.tsx` | brak pliku | **89 testów, 303 asercje** | `adminHiringRoute.test.tsx` |
| testy trasy `admin.careers.tsx` | brak pliku | **111 testów, 324 asercje** | `adminCareersRoute.test.tsx` |
| `check:ci-gates` | czerwona | **zielona** (46 plików, 892 testy) | przebieg |

Prace, które to zmieniły, opisuje
`docs/WDROZENIE_POKRYCIE_MODUL_21_REKRUTACJA_2026-09-03.md`. Zlecenie tego
dokumentu nie widziało.

**Rozdział 12.8, na którym zlecenie się opiera, nie istnieje.** Audyt
`AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md` kończy się na rozdziale
11 (aktualizacja modułu 16 z 2026-09-02). Rozbiór modułu 21 z tego zlecenia
nie pochodzi z tego pliku.

---

## 2. Co było naprawdę otwarte

Polityki trzech tabel z danymi osobowymi kandydata czytają:

```sql
USING (public.is_admin_or_editor() AND tenant_id = public.current_tenant_id())
```

`is_admin_or_editor()` bada **wyłącznie rolę** - dokładnie tak, jak `is_staff()`
w regresji, którą opisuje nagłówek migracji
`20260814194500_career_cv_policies_tenant_scope_reassert.sql`. Nośność
koniunkcji najemcy miała więc dowód:

- **człon ROLI** - sekcja 15 uprzęży (`author` przechodzi `is_staff()`, ale nie
  `is_admin_or_editor()`, i nie widzi niczego);
- **człon NAJEMCY, ale tylko na `storage.objects`** - sekcje 10 i 11;
- **człon NAJEMCY na samych tabelach** - **nie miał żadnego**.

Luka była strukturalna, nie przypadkowa: sekcje 4-9 uprzęży dotykają
`career_applications`, `career_application_events` i `career_cv_gc_queue`
z roli harnessu, **która RLS nie podlega**. Skasowanie koniunkcji najemcy
z tych trzech polityk przechodziło cały harness na zielono.

Zlecenie postawiło tę diagnozę trafnie („test JS dowodzi tylko tego, co robi
klient; nie dowodzi, że baza odrzuci klienta, który zrobi inaczej"), choć
uzasadniło ją nieściśle - patrz §5.

---

## 3. Co zrobiono: dwa niezależne dowody, oba z kontrolą negatywną

### 3.1 Uprząż runtime - sekcja 16

`scripts/careers-harness/runtime_test.sql`, **14 nowych asercji**. Obie strony
(A nie widzi B **i** B nie widzi A), każda asercja izolacji w parze z asercją
niepustki, plus kotwica `is_admin_or_editor()` - bez niej „widzi zero"
przechodziłoby z powodu roli, a nie z powodu najemcy.

**Kontrola negatywna - trzy osobne mutacje, każda uruchomiona:**

| mutacja polityki | wynik | która asercja zapala |
| --- | --- | --- |
| `career_applications` bez członu najemcy | `EXIT=1` | „admin A NIE widzi zgłoszenia najemcy B" |
| `career_application_events` bez członu najemcy | `EXIT=1` | „admin A NIE widzi dziennika etapów najemcy B" |
| `career_cv_gc_queue` bez członu najemcy | `EXIT=1` | „admin A NIE widzi kolejki CV najemcy B" |

Przy każdej z trzech mutacji **sekcje 10 i 15 przechodzą** - co jest dowodem,
że luka była realna, a nie że dokładano asercję do rzeczy już pilnowanej.

Asercji w pliku: 50 → 72. Przebieg po zmianie: `careers-harness: OK
(12 migracji, 6 atrap-celów polityk, 0 pominiętych migracji)`.

### 3.2 pgTAP na pełnym schemacie

`supabase/tests/career_applications_tenant_isolation_test.sql`, **18 asercji**
(`plan(18)`). Uprząż stoi na atrapach sześciu celów polityk; pgTAP biegnie na
**pełnym** zestawie migracji w zadaniu CI `pgtap`, więc dowodzi więcej.
Cztery asercje strukturalne (koniunkcja najemcy w każdej z trzech polityk plus
`relrowsecurity` na trzech tabelach), reszta behawioralna, w obie strony.

**Kontrola negatywna:** skasowanie członu najemcy z `career_applications`
zapala **4 z 18** asercji (strukturalną, oba kierunki i sumę). Po przywróceniu
polityki plik wraca na zielono.

Suita pgTAP lokalnie: **95 → 96 plików OK**, te same **6** plików czerwonych co
przed zmianą (`chat_contacts_search_and_privacy`, `chat_privacy_isolation`,
`community_cron_schedule`, `job_scheduler_heartbeat`, `profile_intent_semantic`,
`tenant_isolation_billing_storage`). Żadnej czerwieni nie dołożono.

### 3.3 Sprostowanie zielonego testu, który utrwalał tę lukę

`adminCareersRoute.test.tsx` zawierał asercję:

```ts
expect(pgtapMentioning("career_applications")).toEqual([]);
```

opisaną jako **„i to jest ŚWIADOME, nie luka"**, z uzasadnieniem, że „pgTAP nie
jest dostępny w obrazie".

Przesłanka jest prawdziwa **o obrazie uprzęży** - `scripts/careers-harness/run.sh`
stawia goły Postgres i dlatego jej asercje są gołym SQL-em. Wniosek dotyczył
jednak `supabase/tests/`, czyli katalogu biegnącego w **innym** zadaniu CI,
które rozszerzenie instaluje wprost (`create extension if not exists pgtap`,
`ci.yml:983`). Repozytorium ma **101 plików pgTAP**, w tym dedykowane testy
izolacji najemcy dla czatu i klubów. Obraz nigdy nie był przeszkodą.

Asercja jest teraz **pozytywna** - dokładnie tak, jak zrobiono w tym samym
pliku przy ZNALEZISKU 6, z tym samym uzasadnieniem: *dowód ma pilnować
obecności dowodu, a nie utrwalać jego brak*. Plik: 110 zielonych + 1 `it.fails`.

To jest znalezisko klasy, której zlecenie szukało: **zielony test, który
zamykał drogę do dowodu, opierając się na fałszywej przesłance.**

---

## 4. Bramka taksonomii była niewpięta

`scripts/check-feature-taxonomy.ts` istniał i **nie był wołany znikąd** - ani
z `package.json`, ani z `.github/workflows/ci.yml`. Pilnuje trzech
niezmienników mapy modułów: brak sieroty, brak martwej reguły, brak pustej
funkcjonalności.

To ta sama klasa, którą audyt 2026-08-11 (rozdz. 8.1) opisał przy `pg-harness`:
skrypt istniał, uruchamiał go wyłącznie człowiek, jeśli pamiętał - i dlatego
złamany `CHECK` trafił na produkcję. Cytat z tego samego repozytorium:
*„Uprząż, której nikt nie odpala, jest dokumentacją, nie bramką."*

Wpięta jako `check:feature-taxonomy` (`package.json`) i jako krok CI w bloku
najtańszych sygnałów. Zielona przy wpięciu: **3 304 pliki produkcyjne, 2 901
w modułach, 27 funkcjonalności**.

To jest realna odpowiedź na tezę zlecenia o „braku sprzężenia zwrotnego" -
tyle że sprzężenie, którego brakowało, dotyczyło **mapy**, nie progów pokrycia.

---

## 5. Które liczby zlecenia okazały się nieaktualne

Lista, o którą zlecenie prosiło osobno.

1. **55,12% / 47,13%** - moduł stoi na 100%/100% od `052aea9` (2026-09-03).
   „Dziewięć identycznych pomiarów" opisuje okno zamknięte przed tą pracą.
2. **554 klucze progowe, ani jeden na module 21** - jest 638 kluczy, z czego
   **10** obejmuje moduł 21, o wartościach 96-100.
3. **Jedyny klucz łapiący się na `/career|job/i` to `JobRunnerCard.tsx`** -
   prawda, ale wniosek fałszywy: `admin.hiring.tsx` **ma** własny klucz
   (`vitest.config.ts:689`). Regexp zlecenia nie zawiera członu `hiring`, więc
   **jego własna recepta pomiarowa nie może zobaczyć tego pliku.**
4. **Zero `it.fails` w module** - jest **6** w 23 plikach modułu (5 w
   `adminHiringRoute`, 1 w `adminCareersRoute`) plus **2** w `jobsTickRun.test.ts`,
   czyli w warstwie, którą §0.6 zlecenia samo zalicza do obwodu modułu. Platforma
   ma 348/199, nie 327/186; ta ostatnia para była prawdziwa 2026-09-03.
5. **Trasy `admin.hiring.tsx` i `admin.careers.tsx` bez ani jednego testu** -
   mają 89 i 111 testów oraz 303 i 324 asercje.
6. **`zatrudniamy.tsx` rozliczany do modułu 20 przez lukę w mapie** - mapa jest
   **kodem wykonywalnym** (`scripts/taxonomy/moduleMap.mjs`), a nie tylko
   dokumentem, i już zawiera regułę `^src\/routes\/zatrudniamy` (linia 442),
   wraz z komentarzem stawiającym dokładnie diagnozę z §0.6 zlecenia.
   **Nieaktualny jest DOKUMENT audytu** (rozdz. 9.1, linia 3330), który wciąż
   drukuje pięć wzorców. Kierunek rozjazdu jest odwrotny, niż zakłada zlecenie.
7. **Rozdział 12.8 audytu** - nie istnieje; dokument kończy się na rozdziale 11.
8. **`check:ci-gates` czerwona na wejściu** - zielona (46 plików, 892 testy).
9. **„Suita czerwona w ośmiu plikach (272 testy)"** - nie odtworzone; patrz §7
   (moje środowisko nie jest równoważne CI, więc tę pozycję zgłaszam jako
   niesprawdzoną, nie jako obaloną).
10. **Testy A3 „biegną w `check:pg-harness`"** - `check:pg-harness` dobiera
    migracje po treści `public.(club_|admin_club_)`, czyli jest uprzężą modułu
    16 i **żadnej migracji `career_*` nie zaaplikuje**. Powierzchnia rekrutacji
    ma własną bramkę `check:careers-harness`, a pgTAP biegnie w zadaniu `pgtap`.
    Kryterium odbioru było w tym punkcie niewykonalne jak napisane.

**Czego NIE zaliczam do pomyłek zlecenia, choć wygląda na pomyłkę.** Liczby
`0/170` (hiring) i `0/126` (careers) mają **poprawne mianowniki** - to dokładnie
liczniki INSTRUKCJI v8 tych plików, a nie linii (linii jest 148 i 109).
Niezależny przebieg `vitest run --coverage` po jednym pliku daje dziś
`admin.hiring.tsx`: instrukcje 170/170, gałęzie 90/90, funkcje 100%. Zlecenie
pomyliło się w liczniku, nie w mianowniku, i nazwało instrukcje liniami - to
nieścisłość nazewnicza, nie zła liczba.

Zlecenie miało rację w rzeczy najważniejszej - że dowód na izolację danych
kandydatów nie istnieje - i pomyliło się niemal we wszystkich liczbach, którymi
to uzasadniało.

---

## 6. Czego świadomie nie zrobiono

- **Nie ruszono zachowania produkcyjnego.** Osiem wpisów `it.fails` opisuje
  otwarte defekty (m.in. odmowa odczytu renderowana jak pusta skrzynka w obu
  panelach, pasek zakładek bez `role="tablist"`, tick przekraczający minutę
  podejmujący sprzeczne decyzje). Ich naprawa to zmiana produkcji, a ZASADY
  zlecenia jej zabraniają poza defektami bezpieczeństwa z A3. Żaden z tych
  ośmiu nim nie jest.
- **Nie dopisano progów per-plik.** Globy `src/lib/careers/**`
  i `src/components/careers/**` są agregatami katalogu (`thresholds.perFile`
  nie jest ustawione). Realny luz jest jednak wąski, bo podłogi linii i funkcji
  stoją na 100 - przy takiej podłodze każda niepokryta linia w katalogu wywraca
  agregat. Luz zostaje na `statements: 99` i na gałęziach (98/96). Domknięcie
  tego wzorem modułu 22 (`vitest.config.ts:5651+`) wymaga **pomiaru per plik**,
  a mojemu pomiarowi nie ufam na tyle, by na nim stawiać podłogi - patrz §7.
  To jest najmocniejsza pozycja pozostawiona otwarta.
- **Nie naprawiono komentarza w `jobsTick.server.ts:287`**, który obiecuje, że
  długości sekretów nie są zdradzane wcześniej, podczas gdy `&&` w linii 292
  zwiera obwód na różnicy długości. Sam kod jest poprawny - `timingSafeEqual`
  rzuca przy różnych długościach, więc strażnik jest konieczny - nieścisła jest
  obietnica w komentarzu.
- **Nie naprawiano sześciu czerwonych plików pgTAP** ani dwóch czerwonych
  plików suity JS; żaden nie należy do modułu 21.

---

## 6a. Trzy znaleziska zostawione otwarte, z dowodem

Weryfikacja adwersaryjna narracji bezpieczeństwa z A3 potwierdziła ją **w każdym
nośnym szczególe** (trzy zawężone polityki, trzy odtworzone w kształcie sprzed
hardeningu, ratunek wyłącznie przez kolejność sortowania nazw plików). Przy
okazji wyszły trzy rzeczy, których ta praca nie zamyka.

**1. `career_cv_gc_queue.tenant_id` jest jedyną z sześciu kolumn `tenant_id`
bez `NOT NULL`** (`20260814110000:267`; pozostałe pięć jest NOT NULL wprost albo
przez klucz główny). Skutek jest nieoczywisty i niedobry: wiersz z `NULL`
przechodzi przez politykę `tenant_id = current_tenant_id()` jako **niewidoczny
dla całego personelu**, więc zakolejkowana ścieżka CV, której nikt nie widzi,
nie zostanie też przez nikogo obsłużona. Dołożenie `NOT NULL` to zmiana
schematu, czyli zmiana produkcji - poza zakresem ZASAD tego zlecenia.

**2. Test przypina predykat, który późniejsza migracja wymieniła.**
`adminCareersRoute.test.tsx:773-787` czyta migrację `20260814110000` i asertuje
`is_staff() AND tenant_id = current_tenant_id()`. Efektywny predykat tych
polityk to od `20260824074231` **`is_admin_or_editor()`**, nie `is_staff()`.
Test jest zielony, bo o tym pliku mówi prawdę - ale o stanie faktycznym bazy
już nie. To ta sama klasa co §3.3: asercja o pliku udająca asercję o systemie.

Ryzyko jest już strukturalnie domknięte przez tę pracę, choć innym sposobem:
asercje strukturalne w nowym pliku pgTAP czytają **`pg_policies`**, czyli stan
efektywny po wszystkich migracjach, a nie treść wybranego pliku. Żadna kolejna
migracja nie może ich ominąć.

**3. `check:sql-policy-tenant-regression` nie blokuje kategorii „wyleczonej".**
Przebieg raportuje 620 polityk w stanie końcowym, 562 związane z najemcą i **11
wyleczonych regresji jako NIEBLOKUJĄCE** - w tym trójkę `career-cv` z narracji
A3. Klasa jest więc widziana, ale nie zatrzymuje CI. Gdyby intencją było, żeby
wygenerowany plik nigdy więcej nie wyemitował polityki sprzed hardeningu,
bramka potrzebuje reguły blokującej dla regresji, których plik osłabiający jest
młodszy od samej bramki.

---

## 7. Ograniczenie tego pomiaru - i dlaczego jest istotne

Prywatny rejestr npm (`europe-west4-npm.pkg.dev`) jest w tym środowisku
odcięty polityką sieci, a `bun install --frozen-lockfile` kończy się serią 403.
Drzewo zależności, na którym mierzyłem, pochodzi z **rejestru publicznego**
i **nie jest drzewem z `bun.lock`**: zainstalowany
`@tanstack/react-router` to **1.170.32**, a `bun.lock` przypina **1.170.18**.

Skutek jest widoczny: `src/__tests__/router.test.tsx` przewraca dwa testy na
`useRouter must be used inside a <RouterProvider>`, czyli na zachowaniu
biblioteki, nie na kodzie repozytorium.

Dlatego **wszystkie liczby pokrycia w tym dokumencie traktuję jako
orientacyjne, nie jako równoważne CI** - i dlatego nie stawiam na nich progów.
Liczby, które są twarde, pochodzą z warstw **niezależnych od npm**: uprząż
`careers-harness` i pgTAP to czysty `bash` + `psql` (CI mówi o tym wprost przy
zadaniu `pg-harness`: „to także jedyna bramka bazodanowa, która nie zależy od
prywatnego rejestru npm"). Obie kontrole negatywne z §3 biegły właśnie tam.

Ostrzeżenie o tej klasie stoi zresztą w samym audycie: **rozdz. 8.5, pozycja 1**
opisuje przebieg wydania 8, który dał 32,24% zamiast 76%, bo `npm install` pisał
do `node_modules` jeszcze po starcie pomiaru - 966 z 2 005 plików padło na
zbieraniu. Sygnatura była wtedy ta sama, co u mnie na pierwszym podejściu:
**setki padniętych PLIKÓW przy garstce czerwonych TESTÓW**. Pierwszy przebieg
w tej sesji wyglądał dokładnie tak (253 pliki „(0 test)") i został odrzucony,
a nie opublikowany.

I jeszcze jedno, czego zlecenie nie mogło wiedzieć, a co stoi w audycie:
**rozdz. 8.5 zawiera 12 pozycji sprostowań, a pozycja 9 obala wprost wcześniejszą
wersję tego samego zlecenia** („Zlecenie twierdziło, że go nie ma - «0/16 linii,
0/1 funkcji»") dla trasy `/api/public/jobs-tick`. Zlecenie, które dostałem,
podaje w tym miejscu `0/17` i powtarza tezę, którą audyt zamknął.

`bun.lock` nie został zmieniony ani zacommitowany. `package.json` zmieniono
wyłącznie o jeden skrypt, na co zlecenie zezwala wprost.

---

## 8. O kolejności A1-A6 - zlecenie prosiło o zdanie

Prosiło: *„Jeśli uznasz, że kolejność A1-A6 jest zła - że np. pgTAP powinien być
pierwszy, bo ryzyko bije arytmetykę - napisz to i uzasadnij."*

**Powinien był być pierwszy, i to nie z powodu ryzyka, tylko z powodu samej
metryki porządkującej.**

Kolejność zlecenia policzono z **niepokrytych linii na test**. Ta metryka mierzy
koszt pracy, nie jej wartość - i ma jedną własność, która przesądza sprawę:
**A3 nie wnosi ani jednej linii pokrycia JavaScriptu.** pgTAP i uprząż SQL nie
pojawiają się w `coverage-final.json` w ogóle. W rankingu „linii na test" A3 nie
zajmuje ostatniego miejsca - **nie da się go w nim umieścić**, bo jego wartość
w liczniku wynosi zero.

I dokładnie to się stało. Moduł przeszedł z 55% na 100% linii i funkcji, dostał
10 progów i 477 nowych dowodów - a jedyna asercja pytająca, czy baza odrzuci
redaktora obcego najemcy sięgającego po CV kandydata, nie powstała, bo w tej
metryce nie była nic warta. Kampania domykająca moduł napisała nawet **test
utrwalający jej brak** (§3.3).

Metryka, która uporządkowała to zlecenie, jest tą samą metryką, która przez
dziewięć pomiarów ukrywała jego najcięższe znalezisko. Kolejność powinna
zaczynać się od pytania „co się stanie, jeśli to jest zepsute", a arytmetyka
linii na test powinna rozstrzygać dopiero remisy.
