# ZLECENIE: MODUŁ 19 - Ustawienia / integracje / users / multi-tenant / RODO

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
(rodzaj testu per moduł). Osiem defektów zgłoszonych, **siedem potwierdzonych** po niezależnej próbie
obalenia przez osobnego agenta, **jeden obalony** - obalenie opisuję w rozdz. 4, bo wiedza o tym,
czego NIE naprawiać, jest tu równie ważna.

---

## 0. Stan wyjściowy - zmierzony, nie przepisany

### 0.1. Dwie liczby, dwa różne pomiary - przeczytaj to przed startem

Karta modułu podaje **84,4 % linii i 80,3 % funkcji**. Pomiar całego modułu daje **89,38 % i 87,36 %**.
Obie liczby są prawdziwe i mierzą co innego:

| Widok                                    | Plików | Wiersze | Linie       | Funkcje                 |
| ---------------------------------------- | ------ | ------- | ----------- | ----------------------- |
| **Funkcjonalności** (to, co na karcie)   | 110    | 3 346   | **84,43 %** | **80,27 %** (773/963)   |
| **Cały moduł** (klasyfikator taksonomii) | 147    | 5 217   | **89,38 %** | **87,36 %** (1486/1701) |

Widok funkcjonalności obejmuje pliki przypisane do ośmiu nazwanych funkcjonalności. Pozostałe 37 plików
modułu nie ma przypisania do żadnej z nich i do tej średniej nie wchodzi - stąd różnica pięciu punktów.
**Nie jest to rozbieżność do naprawienia, tylko dwie perspektywy tego samego kodu.** Piszę to
wprost, bo wykonawca, który uruchomi pomiar i zobaczy 89,38 %, mógłby uznać kartę za nieaktualną
i zacząć od niewłaściwej diagnozy.

W liczbach z karty zgadza się wszystko co do sztuki: **521 wierszy bez testu, 15 plików na zerze,
48 martwych funkcji nazwanych**. W widoku całego modułu plików na zerze jest **16** (374 wiersze
instrukcji) - szesnasty leży poza nazwanymi funkcjonalnościami.

### 0.2. Pozostałe wielkości

| Metryka                  | Wartość na `7a780b1d0` |
| ------------------------ | ---------------------- |
| Pliki produkcyjne        | 147 (28 484 wiersze)   |
| Pliki testowe            | 61 (1 412 przypadków)  |
| Trasy                    | 28                     |
| Gałęzie (cały moduł)     | 84,41 % (4375/5183)    |
| Pliki bez własnego progu | **93 ze 147**          |

### 0.3. Gdzie dokładnie stoi dług

Szesnaście plików na zerze, największe sześć:

```
133 wiersze  src/lib/admin/membersDirectory.functions.ts
 39          src/lib/admin/emailOutbox.functions.ts        <- tu siedzi defekt krytyczny A1
 34          src/lib/admin/dashboard/dashboard.functions.ts
 28          src/lib/admin/badges.ts
 26          src/lib/admin/library.ts
 24          src/lib/admin/scheduler.functions.ts
```

Największe luki niezerowe:

```
 56 niepokrytych   16,4 %  src/lib/admin/accountAdmin.functions.ts
 19                17,4 %  src/lib/admin/impersonation.ts
 14                30,0 %  src/lib/adminToasts.ts
  9                18,2 %  src/lib/admin/useSiteSettingsRevisions.ts
```

Zwróć uwagę na kształt: **cztery najsłabsze pliki modułu to warstwa `lib/admin`** - operacje na kontach,
katalog członków, impersonacja, rewizje ustawień. To jest dokładnie ta funkcjonalność, która na karcie
ma najgorszy wynik (77,2 % linii, 33 martwe funkcje nazwane) i największy wolumen (45 plików, 1 740
wierszy). Dług nie jest rozsiany po module - ma adres.

### 0.4. Czego dziś nie pilnuje żaden próg

Progów dotykających modułu jest 36, ale **93 ze 147 plików nie wpada pod żaden z nich**. Wśród plików
z defektami tego zlecenia:

| Plik                                          | Próg                                     |
| --------------------------------------------- | ---------------------------------------- |
| `src/lib/admin/emailOutbox.functions.ts`      | **BRAK** (i pokrycie 0 %)                |
| `src/lib/consents.functions.ts`               | **BRAK**                                 |
| `src/lib/admin/accountAdmin.functions.ts`     | **BRAK** (i pokrycie 16,4 %)             |
| `src/lib/admin/membersDirectory.functions.ts` | **BRAK** (i pokrycie 0 %)                |
| `src/lib/admin/invitations.functions.ts`      | `src/lib/admin/invitations.functions.ts` |
| `src/routes/admin.integrations.tsx`           | `src/routes/admin.integrations.tsx`      |
| `src/routes/admin.organizations.$id.tsx`      | `src/routes/admin.organizations*.tsx`    |
| `src/lib/admin/community.ts`                  | `src/lib/admin/community.ts`             |

**Plik z defektem krytycznym nie ma ani progu, ani jednej linii pokrycia.** To nie przypadek: próg per
ścieżka jest w tym repozytorium jedynym mechanizmem, który zauważa nieobecność testu. Gdzie progu nie
ma, tam nic nie zapaliło się przez cały czas życia pliku.

---

## 1. Pozycja BLOKUJĄCA - jeden defekt krytyczny

### A1. Skrzynka wysyłek e-mail pokazuje adresy odbiorców wszystkich najemców

**Gdzie:** `src/lib/admin/emailOutbox.functions.ts:134-140`; tabela w
`supabase/migrations/20260728154925_email_infra.sql:27-36`, polityki tamże 44-62.

**Co jest.** Handler czyta klientem serwisowym, filtrując wyłącznie po czasie:

```ts
const { data: raw, error } = await supabaseAdmin
  .from("email_send_log")
  .select("id, message_id, template_name, recipient_email, status, error_message, created_at")
  .gte("created_at", window.from)
  .lte("created_at", window.to)
  ...
```

Trzy fakty, każdy sprawdzony osobno:

1. **W całym pliku nie ma ani jednego wystąpienia `tenant_id`** (`grep -c` zwraca zero).
2. **Tabela `email_send_log` nie ma kolumny `tenant_id`.** Jej kolumny to `id`, `message_id`,
   `template_name`, `recipient_email`, `status`, `error_message`, `metadata`, `created_at`.
   Żadna późniejsza migracja jej nie dodaje.
3. **RLS nie ma czego odsiać** - wszystkie trzy polityki dopuszczają wyłącznie
   `auth.role() = 'service_role'`, a odczyt i tak idzie kluczem serwisowym, czyli RLS omija.

Jedyną bramką jest `requireAdminEditor` (`src/integrations/supabase/require-staff.ts:28-90`), która
sprawdza rolę w tenancie **wywołującego**, nie w tenancie czytanych wierszy.

**Dlaczego to jest blokujące.** `recipient_email` to dane osobowe. Admin jednego najemcy widzi adresy
e-mail odbiorców wszystkich pozostałych najemców, wraz z nazwą szablonu, statusem doręczenia i treścią
błędu - czyli kto, kiedy i co dostał. To nie jest hipoteza: ścieżka rejestracji `staff`
(`supabase/migrations/20260703120200_signup_default_reader.sql:62-81`) **zakłada nowy najemca i nadaje
w nim rolę `admin`**, więc drugi najemca z własnym adminem jest zamierzonym stanem produktu,
nie scenariuszem laboratoryjnym.

Moduł, który w nazwie ma „multi-tenant" i „RODO", ma tu wyciek międzynajemcowy danych osobowych
na powierzchni panelu. Z całego zestawu dwóch modułów to jest pozycja numer jeden.

**Co zrobić - w tej kolejności, bo druga zmiana zależy od pierwszej:**

1. **Migracja dodająca `tenant_id` do `email_send_log`** (`supabase/migrations/`, nowy plik).
   Kolumna `UUID`, indeks `(tenant_id, created_at DESC)` pod dzisiejsze zapytanie. Rozstrzygnij
   w opisie PR-a, co zrobić z wierszami historycznymi: backfill z `metadata` jeśli da się z niej
   wyprowadzić najemcę, w przeciwnym razie `NULL` i jawna reguła, że wiersze bez najemcy widzi
   wyłącznie `super_admin`. **Nie kasuj historii wysyłek, żeby uprościć sobie migrację.**
2. **Wszystkie miejsca zapisujące do tej tabeli muszą zacząć podawać `tenant_id`** - wyszukaj je
   przed migracją, nie po.
3. **Handler dostaje `.eq("tenant_id", ...)`** z profilu wywołującego, ze zwolnieniem dla
   `super_admin` dokładnie takim, jaki jest już w `accountAdmin.functions.ts:38-46`
   (z tamtejszym komentarzem: rola platformowa nie podlega granicy najemcy). **Powtórz istniejący
   wzorzec, nie wymyślaj drugiego.**

**Kryterium odbioru.** Test funkcji serwerowej: admin najemcy A nie widzi w wyniku żadnego wiersza
najemcy B, a `super_admin` widzi oba. Plus test pgTAP na obecność kolumny i indeksu. Plik ma dziś
**0 % pokrycia**, więc test piszesz od zera - i dopisujesz mu próg (patrz zasada 2).

---

## 2. Pozycje zwykłe - trzy defekty wysokie i trzy średnie

### A2. Wyszukiwanie konta widzi tylko pierwszych 200 użytkowników (wysoki)

**Gdzie:** `src/lib/admin/invitations.functions.ts:293-296`.

**Co jest.** `findAuthUserIdByEmail` woła `supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 })` -
jedna strona, **bez pętli po stronach, bez sprawdzenia `nextPage`/`total`**, a `data` jest nawet
destrukturyzowane bez `error`. Wynik steruje gałęzią `if (!authUserId) { ... createUser(...) }`
(linie 300-329). Przy 201. użytkowniku istniejące konto staje się niewidoczne, `createUser` rzuca
konfliktem, wyjątek leci do catcha `performSend`, a zaproszenie dostaje `status: "failed"`.

Komentarz w liniach 287-291 opisuje dokładnie ten scenariusz jako **powód istnienia tej funkcji**.
Funkcja została napisana po to, żeby nie tworzyć duplikatu konta, i przestaje działać dokładnie
wtedy, kiedy zaczyna być potrzebna. To jedyne użycie `listUsers` w `src/` - nie ma gdzie podejrzeć
wariantu stronicowanego.

**Co zrobić.** Stronicuj do skutku albo szukaj po adresie zamiast listować. Jeżeli wersja SDK
w repozytorium nie daje filtru po e-mailu, zrób pętlę po stronach z twardym sufitem i **jawnym
zachowaniem po jego przekroczeniu** - błąd mówiący, że nie dało się rozstrzygnąć, a nie ciche
założenie, że konta nie ma. Cicha odpowiedź „nie ma" jest tu gorsza od błędu, bo prowadzi do
`createUser`.

**Kryterium odbioru:** test, w którym atrapa `listUsers` zwraca dwie strony, a szukane konto leży
na drugiej - funkcja ma je znaleźć i **nie** wejść w gałąź tworzenia.

---

### A3. Kafle KPI integracji pokazują próbkę jako sumę (wysoki)

**Gdzie:** `src/routes/admin.integrations.tsx:188-197`, kafle w liniach 298-302 i 349-352.

**Co jest.** `.from("integration_deliveries").select("status").limit(1000)` - **bez `.order(...)`** -
a potem zliczanie w pętli i wynik wprost do czterech `<StatCard value={...} />`. Nie ma ani flagi
obcięcia, ani tekstu o próbce; jedyne trafienie na „truncat" w pliku to klasa CSS przy adresie
endpointu (linia 392). Brak sortowania oznacza dodatkowo, że **nie wiadomo, które tysiąc wierszy
zostało policzone** - kolejność bez `ORDER BY` nie jest gwarantowana.

Operator patrzy na cztery liczby i podejmuje na ich podstawie decyzję o zdrowiu integracji.
Przy ponad tysiącu doręczeń liczby są nieprawdziwe i nic tego nie sygnalizuje.

**Wzorzec poprawny jest w tym samym module.** `emailOutbox.functions.ts:60-62` i `:173` liczą tak samo
z sufitem, ale **zwracają pole `truncated`** i interfejs to pokazuje. Ten sam zespół rozwiązał ten sam
problem uczciwie jedno piętro dalej.

**Co zrobić.** Policz po stronie bazy - `select("status", { count: "exact", head: true })` per status
albo jedno RPC z `GROUP BY status`. Jeśli z jakiegoś powodu zostaje próbkowanie, dołóż `.order(...)`
i pole `truncated`, a kafel ma **pokazać**, że to próbka. Liczba bez tej informacji jest gorsza
niż jej brak.

---

### A4. Draft organizacji nigdy się nie uzgadnia - cichy lost update (wysoki)

**Gdzie:** `src/routes/admin.organizations.$id.tsx:108-111` i `:168-183`;
`src/lib/admin/membership-admin.ts:114-120`.

**Co jest.** `useEffect(() => { if (orgQ.data && !draft) setDraft(orgQ.data); }, [orgQ.data, draft])` -
po pierwszym ustawieniu warunek `!draft` jest już zawsze fałszywy, więc **żaden refetch nigdy nie dociera
do formularza**. `onSuccess` zapisu (136-140) tylko unieważnia zapytania i nie resetuje draftu.
Zapis wysyła cały obiekt, a `updateOrganization` to `update(patch).eq("id", id)` - **bez `if_version`,
bez `.eq("updated_at", ...)`, bez RPC z kontrolą wersji**, i bez triggera odrzucającego zapis
po znaczniku czasu.

Dwie osoby otwierają tę samą organizację. Pierwsza zapisuje. Druga, która ma w formularzu stan
sprzed tego zapisu, klika zapisz i **po cichu nadpisuje wszystkie pola** - także te, których nie
dotknęła. Nikt nie dostaje żadnego sygnału.

**Co zrobić.** Dwie zmiany, obie potrzebne:

1. **Uzgadnianie draftu:** zdejmij warunek `!draft` i zamiast tego reaguj na zmianę tożsamości
   lub znacznika wersji danych z serwera; po udanym zapisie ustaw draft z odpowiedzi.
2. **Kontrola wersji przy zapisie:** `updateOrganization` dostaje warunek na `updated_at` (albo kolumnę
   `version`), a brak trafienia w wiersz zwraca konflikt, który interfejs pokazuje jako „dane zmieniły
   się w międzyczasie" z możliwością przeładowania. **Wzorzec `if_version` jest w tym repozytorium
   używany** - nie wprowadzasz nowego pojęcia.

**Kryterium odbioru:** test, w którym zapis ze starym znacznikiem nie zmienia wiersza i zwraca konflikt.

---

### A5. Batchowy zapis zgód RODO nie jest atomowy (średni)

**Gdzie:** `src/lib/consents.functions.ts:90-107`; wołający `src/lib/consent/registryBridge.ts:229-235`
i `:262-270`.

**Co jest.** Pętla `for` po `data.entries`, każdy wpis to osobne `supabase.rpc("set_user_consent", ...)`,
a `if (error) throw` przerywa po pierwszym niepowodzeniu - **wcześniejsze wywołania są już zatwierdzone**,
bo każde to osobna transakcja. Komentarz w liniach 62-67 sam to przyznaje: atomowy jest pojedynczy
upsert plus zdarzenie, nie cała decyzja użytkownika.

Wołający `pushEntriesToRegistry` siedzi w `try { ... } catch { }` **z pustym ciałem**, więc błąd nie
dociera nigdzie. A ścieżka naprawcza nie naprawia: `backfillRegistryOnLogin` (313-343) uzupełnia
wyłącznie klucze **nieobecne** w rejestrze, a kategoria z nieudanego zapisu jest obecna ze **starą**
wartością - więc nigdy nie zostanie poprawiona. Backfill odpala się w dodatku raz na użytkownika
(flaga w `localStorage`).

Wynik: użytkownik klika „odrzuć wszystko", zapis przerywa się w połowie, i **część jego zgód zostaje
włączona**, trwale, bez żadnego komunikatu. To jest dokładnie ta klasa zdarzenia, którą RODO nazywa
naruszeniem zapisu zgody.

**Co zrobić.** Jedno RPC przyjmujące całą decyzję i zapisujące ją w jednej transakcji - podpis w rodzaju
`set_user_consents(p_entries jsonb)`, wewnątrz pętla po elementach, wszystko albo nic. Pojedyncze
`set_user_consent` zostaje dla ścieżek, które naprawdę zapisują jedną kategorię.
**Pusty `catch` w `registryBridge.ts` ma przestać być pusty** - błąd zapisu zgody to zdarzenie, które
ktoś musi zobaczyć.

**Kryterium odbioru:** test, w którym drugi z trzech wpisów zawodzi, a po operacji **żaden** z trzech
nie jest zmieniony w bazie; plus test, że wołający nie połyka błędu.

---

### A6. `slugify` gubi polskie `ł` (średni)

**Gdzie:** `src/lib/admin/invitations.functions.ts:40-48`.

**Co jest.** `.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-")`.
U+0142 (`ł`) **nie ma rozkładu kanonicznego**, więc NFD go nie rusza, litera wpada w klasę negatywną
i zamienia się w kreskę. Skutek jest przypięty testem `it.fails`
w `src/lib/admin/__tests__/invitationsFunctions.test.ts:2160-2192`, z wyliczonymi przykładami:
„Michał Kowalski" daje `micha-kowalski`, „Łukasz Dąbrowski" daje `ukasz-dabrowski`.

Ta funkcja zasila `profiles.slug` w `performSend` (linia 339) i w `provisionTeamMembers`, czyli
**publiczny adres profilu autora**. W polskojęzycznym serwisie to nie jest przypadek brzegowy.

**Co zrobić.** Mapa znaków **przed** NFD, obejmująca co najmniej `ł/Ł`, i przemyśl, czy nie dotyczy
to też innych liter bez rozkładu kanonicznego (`đ`, `ø`, `ß`). Po naprawie **zdejmij `it.fails`
i zostaw test jako zwykły** - to jest właśnie ten commit, w którym wolno to zrobić.

Rozstrzygnij też w opisie PR-a, co z profilami, które już mają kaleki slug: przekierowanie ze starego
na nowy, czy zostawienie istniejących bez zmian. Adres publiczny raz opublikowany ma swoje linki.

---

### A7. Wyszukiwarka rozmów nie escapuje wzorca ILIKE (średni)

**Gdzie:** `src/lib/admin/community.ts:113-115`.

**Co jest.** `query.ilike("last_message_preview", \`%${params.search.trim()}%\`)`- fraza z panelu
wstawiana wprost do wzorca. **Ten sam katalog eksportuje`escapeLike`**
(`src/lib/admin/listFilters.ts:7`) i używają go pozostałe wyszukiwarki panelu; ta jedna nie.
Defekt jest przypięty testem `it.fails`w`src/lib/admin/**tests**/community.test.ts:490-509`.

Skutek nie jest tu wstrzyknięciem SQL - PostgREST parametryzuje wartość - tylko **cichym
zniekształceniem wyniku**: `%` i `_` we frazie zmieniają znaczenie wzorca, a nawias lub przecinek
potrafi rozsypać parser filtra PostgREST.

**Co zrobić.** Przepuść frazę przez `escapeLike`, tak jak robi to reszta panelu, i zdejmij `it.fails`.
To jest zmiana jednowierszowa - wymieniam ją, bo rozjazd z własną konwencją katalogu jest wart
domknięcia przy okazji, kiedy i tak jesteś w tym pliku.

---

## 3. Pozycje pokryciowe - dług, który nie jest defektem

**B1. `membersDirectory.functions.ts` - 133 wiersze, 0 %.** Największy plik bez dowodu w module.
Katalog członków to dane osobowe i zakres najemcy; przeczytaj go z A1 w pamięci.

**B2. `accountAdmin.functions.ts` - 16,4 %, 56 niepokrytych wierszy.** Operacje administracyjne
na cudzych kontach. Zwolnienie `super_admin` z granicy najemcy (linie 38-46) jest tu jawną decyzją
projektową i **nie ma dziś testu, który by tę decyzję przypinał**. Test na świadome zwolnienie jest
wart tyle samo, co test na bramkę.

**B3. `impersonation.ts` - 17,4 %, 19 niepokrytych.** Patrz rozdz. 4: mechanizm jest poprawny,
ale nieprzypięty.

**B4. Cztery kolejne pliki na zerze w `lib/admin`:** `dashboard.functions.ts` (34), `badges.ts` (28),
`library.ts` (26), `scheduler.functions.ts` (24).

**B5. Powierzchnia macierzy uprawnień bez dowodu.** `src/routes/admin.permissions.tsx` (12 wierszy, 0 %)
plus cztery komponenty tej powierzchni na zerze: `PermissionMatrixToolbar` (8),
`PermissionActorGrid` (3), `PermissionSourceNotice` (2), `MatrixKpiTile` (1). Sama warstwa reguł
(`lib/authz`) ma progi i pokrycie; brakuje dowodu na to, co użytkownik **widzi i klika**.

**B6. Trzy komponenty ustawień i cookie bannera na zerze:** `ConsentAuditSummary` (21),
`CookieBannerBrandingSection` (13), `DetectedElementsPanel` (12), plus
`GoogleSourceBadgeDeviceSection` (13). Dwa pierwsze dotykają ścieżki zgód - patrz A5.

---

## 4. Czego NIE naprawiać - zgłoszenie obalone

**`startImpersonation` nie sprawdza najemcy konta docelowego - i tak ma być.**

Zgłoszenie było poważne: handler po `is_super_admin()` idzie od razu do
`supabaseAdmin.auth.admin.getUserById(...)`, bez porównania najemców
(`src/lib/admin/impersonation.functions.ts:33-50`). **Fakt jest prawdziwy, wniosek był błędny.**

Co pokazała weryfikacja:

- Sąsiedni plik nie jest kontrprzykładem, tylko potwierdzeniem: `accountAdmin.functions.ts:38-46`
  **jawnie zwalnia** `super_admin` z granicy najemcy, z komentarzem „Super administrator platformy
  zarządza wszystkimi organizacjami, więc granica najemcy go nie ogranicza". Oba pliki traktują
  `super_admin` identycznie - jako rolę platformową. `assertSameTenant` istnieje tam dlatego,
  że `requireAdmin` wpuszcza też zwykłego `admin`, którego impersonacja w ogóle nie dopuszcza.
- Ścieżka eskalacji nie istnieje i została zamknięta świadomie.
  `supabase/migrations/20260703090100_profiles_column_grants_and_role_audit.sql:232` odbiera
  `INSERT/UPDATE/DELETE` na `user_roles` od ról `anon` i `authenticated`, a `change_user_role`
  (linia 209) rzuca `super_admin_required`, jeśli rolę `super_admin` próbuje nadać lub odebrać ktoś,
  kto nią nie jest. Komentarz tej migracji (linia 230) opisuje wprost stan sprzed niej: „the old
  «Admins manage tenant roles» FOR ALL policy let any tenant admin INSERT e.g. a super_admin row
  for themselves". **Dokładnie ta eskalacja, o którą chodziło zgłoszeniu, istniała i została
  zamknięta** - zgłoszenie opisało nieaktualny stan bazy. Nowy najemca ze ścieżki `staff` dostaje
  `admin`, nie `super_admin`.

**Nie dokładaj tam sprawdzenia najemcy.** Zepsułoby to zamierzoną funkcję roli platformowej,
a wygląda na naprawę. Jeżeli uznasz, że coś tu jednak jest nie tak, napisz to w opisie PR-a
z dowodem - ale nie zmieniaj kodu w ramach tego zlecenia.

Warto natomiast zauważyć, co to zgłoszenie ujawniło przy okazji: **`impersonation.ts` ma 17,4 %
pokrycia** (pozycja B3). Mechanizm jest poprawny i nieprzypięty - a to znaczy, że następna osoba,
która przeczyta ten kod, powtórzy tę samą pomyłkę, bo nie ma testu, który mówi „tak, to jest celowe".
**Test dokumentujący świadomą decyzję jest tu produktem, nie dodatkiem.**

### Do rozstrzygnięcia, nie do wykonania

- Ratchet „martwych funkcji nazwanych" nie istnieje. Moduł ma ich 48 w widoku funkcjonalności,
  z czego **33 w samym `lib/admin`**. Bez zapadki liczba może rosnąć niezauważona.
- `email_send_log` nie jest jedyną tabelą infrastruktury e-mail bez najemcy - przy A1 warto sprawdzić
  sąsiadki z tej samej migracji, ale **nie rozszerzaj o nie tego PR-a** bez osobnej decyzji.

---

## 5. Zasady, których nie wolno złamać

1. **Nie zmieniasz zachowania produkcyjnego po to, żeby test przeszedł.** Defekt spoza tej listy
   zapisujesz jako `it.fails("DEFEKT: ...")` z opisem mechanizmu, a nie naprawiasz po cichu.
   Wyjątek dotyczy A6 i A7: tam `it.fails` **już istnieje** i zdejmujesz go w tym samym commicie,
   w którym naprawiasz produkcję.
2. **Progi wolno wyłącznie podnosić.** Nigdy nie obniżasz wartości w `vitest.config.ts` i nie
   wykluczasz pliku z pomiaru. Po skończonej pracy **dopisz progi per plik dla każdego pliku,
   który ruszyłeś** - cztery pliki z defektami tego zlecenia nie mają dziś żadnego progu,
   a dwa z nich stoją na zerze.
3. **Nie zmieniasz `package.json` i nie commitujesz `package-lock.json`.**
4. **Żaden test nie wychodzi do sieci i nie zawiera prawdziwego sekretu.** Supabase, dostawca poczty
   i integracje zewnętrzne są atrapami.
5. **RODO w testach - w tym module reguła pierwszej wagi.** Dotykasz rejestru zgód, adresów e-mail
   odbiorców, katalogu członków i impersonacji. Żadnych prawdziwych danych osobowych w fixture,
   żadnych realnych adresów poza domenami `example.com` / `example.org`, żadnych prawdziwych nazwisk.
   Fraza testowa do A6 („Michał", „Łukasz") ma być danymi testu, nie cudzym nazwiskiem.
6. **Nie regenerujesz snapshotu autoryzacji**, żeby zgasić czerwień. W module o macierzy uprawnień
   ta reguła znaczy dokładnie to, co mówi.
7. **Nie usuwasz cudzych wpisów `it.fails`** bez naprawy produkcji w tym samym commicie.
8. **Migracje dopisujesz do `supabase/migrations/`, nie do `drizzle/migrations/`.** Bramki SQL czytają
   katalog ze stałej `MIGRATIONS_DIR` w `scripts/lib/sqlMigrations.ts` i pasa drizzle nie widzą wcale
   (znalezisko Z1 audytu, rozdz. 15.7).
9. **Nie zmieniasz istniejącej migracji.** Stan obowiązujący bazy jest wynikiem odtworzenia 958 plików
   po kolei; poprawka wchodzi jako nowy plik, nigdy jako edycja starego.
10. **Nie kasujesz danych, żeby uprościć migrację.** Dotyczy A1 wprost: historia wysyłek zostaje.

---

## 6. Standard kodu

- **i18n (PL i EN)** dla każdego napisu widocznego dla użytkownika; `check:i18n-hardcoded`
  i `check:i18n-parity` tego pilnują.
- **Atomic design:** nowe komponenty do właściwej warstwy (`atoms` / `molecules` / `organisms`).
  Powierzchnia macierzy uprawnień ma już wszystkie trzy - jeśli dokładasz komponent, dokładasz
  jego test w tej samej zmianie.
- **`tenant_id` w każdym zapytaniu i w każdej nowej polityce RLS.** To jest moduł, w którym ta reguła
  jest przedmiotem pracy, nie tłem: A1 istnieje dokładnie dlatego, że raz jej nie dotrzymano.
  Jedyne dopuszczalne odstępstwo to jawne zwolnienie `super_admina` - z komentarzem mówiącym,
  dlaczego, wzorowanym na `accountAdmin.functions.ts:38-46`.
- **Zero `any`** - ani `: any`, ani `as any`. W całym repozytorium jest dziś **zero `as any`**
  i **jedno `: any`**; nie psuj tego wyniku. Rzutowania `as unknown as` podlegają ratchetowi
  `check:unknown-casts` i mogą tylko znikać.
- **Dywiz `-`, nigdy długa kreska (U+2014).** Przeszukanie tego pliku za znakiem U+2014 musi zwracać
  zero trafień, tak samo jak przeszukanie twojego diffu.
- Komentarz piszesz wtedy, gdy tłumaczy **dlaczego**, nie **co**. I reguła, którą to zlecenie
  egzekwuje szczególnie: **komentarz, który przestał być prawdziwy, jest defektem.** W tym module
  dwie pozycje (A2 i A5) to rozjazd między komentarzem a kodem - w A5 komentarz uczciwie przyznaje
  problem, w A2 opisuje powód istnienia funkcji, która go nie realizuje. Kiedy naprawiasz zachowanie,
  popraw zdanie, które je opisywało.

---

## 7. Kryterium odbioru całości

| Wymóg                                           | Dziś      | Po          |
| ----------------------------------------------- | --------- | ----------- |
| Linie modułu (cały moduł)                       | 89,38 %   | **>= 93 %** |
| Funkcje modułu (cały moduł)                     | 87,36 %   | **>= 91 %** |
| Linie w widoku funkcjonalności                  | 84,43 %   | **>= 90 %** |
| Pliki z pokryciem zerowym                       | 16        | **<= 6**    |
| Pliki z defektami bez własnego progu            | 4         | **0**       |
| `email_send_log` z kolumną i indeksem najemcy   | brak      | **jest**    |
| Wpisy `it.fails` zdjęte wraz z naprawą (A6, A7) | 2 otwarte | **0**       |

Cel dla plików na zerze jest celowo nierówny: sześć wolno zostawić, bo nie wszystkie mieszczą się
w jednym PR-ze. **Ale `emailOutbox.functions.ts` do tej szóstki nie należy** - plik z defektem
krytycznym wychodzi z zera bezwarunkowo.

Ponadto:

- `bun run check:i18n-parity`, `check:i18n-hardcoded`, `check:unknown-casts`, `check:feature-taxonomy`
  i bramki SQL - **zielone**.
- Każdy defekt z rozdziałów 1-2 albo **naprawiony i przypięty testem**, albo zostawiony z jawnym
  uzasadnieniem w opisie PR-a. Trzecia możliwość nie istnieje.
- **Zgłoszenie obalone z rozdz. 4 zostaje nietknięte** - a jeśli je ruszysz, uzasadniasz to osobno.
- **Opis PR-a ma być równy diffowi.** Zlecenie wymienia siedem defektów do naprawy, jedno obalone
  do zostawienia i sześć pozycji pokryciowych; w opisie ma się znaleźć stan każdej z nich.
