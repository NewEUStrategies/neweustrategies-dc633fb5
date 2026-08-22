# Ustawienia, integracje, użytkownicy, multi-tenant i RODO (MODUŁ 19): z 28% na 95%+ na trzynastu powierzchniach, 36 defektów i dwie bramki (2026-08-22)

Praca dotyczy powierzchni, na której administrator zmienia **reguły działania
serwisu dla wszystkich** - a nie własne dane. Defekt w edytorze wpisu psuje
jeden wpis; defekt tutaj przestawia zgody, role, integracje albo izolację
najemcy i widać go po tygodniu, w cudzych danych.

Zakres: `src/routes/admin.settings.*` (15 tras), `admin.users.*`,
`admin.organizations.*`, `admin.integrations`, `admin.names`, `admin.greetings`,
`admin.popups`, `admin.audience`, `admin.personalized`, `src/lib/admin/**`,
`src/lib/authz/**`, `src/lib/consent*`, `src/lib/legal/**`,
`src/lib/contact.functions.ts`, `src/lib/integrations/**`.

---

## 1. Stan wyjściowy: liczby z pomiaru

Pomiar własny na `6426bd0` (2026-08-21), metodą audytu (v8, `all: true`), na
130 plikach produkcyjnych modułu:

| Miara                       |             21.08 |
| --------------------------- | ----------------: |
| Linie                       |        **28,04%** |
| Instrukcje                  |            28,10% |
| Gałęzie                     |        **23,20%** |
| Funkcje                     | 23,32% (336/1439) |
| Plików z pokryciem 0%       |                56 |
| Stosunek plików test./prod. |              0,23 |
| Linii niepokrytych          |             3 109 |

Dwie liczby wyznaczyły kolejność pracy. **Gałęzie (23,2%) były niżej niż linie
(28,0%)**, a w panelach ustawień spadały do 24,5% - czyli 93% gałęzi było
trudniejszym celem niż 95% linii. Powód jest strukturalny: panel ustawień czyta
wartości przez `??`, `||`, `?:` i `?.`, a najczęstszym realnym błędem tego
repozytorium jest wartość **fałszywa ale prawidłowa** (`0` dni karencji, `""`
tytułu, `false` flagi), którą `||` podmienia na domyślną. Takiej pomyłki nie
widzi żaden test „czy się wyrenderowało".

### 1.1 Dlaczego dopisywanie testów renderujących tego nie dowozi

Repozytorium miało już na to odpowiedź - i to odpowiedź PRZECZĄCĄ tej pracy.
`src/routes/__tests__/adminRouteAuthority.gate.test.ts` argumentuje wprost, że
render-testowanie tras panelu **dla pokrycia** jest farmą: ryzykiem w trasie
panelu jest DOSTĘP, a dostęp egzekwują trzy miejsca, z których render nie widzi
ani jednego:

1. wspólny layout `routes/admin.tsx` - odrzuca każdego bez `isStaff`,
2. sama trasa - `isSuperAdmin` dla obszarów wrażliwych,
3. **baza** - RLS i RPC, ostateczny autorytet.

Ten plik został przeczytany przed pierwszą linią kodu i jego argument jest
przyjęty, nie obejrzany. Rozwiązanie jest takie samo jak w module klubów:
pokryć trasy **i rozszerzyć bramkę**, z jawnym podziałem odpowiedzialności,
który wpisany jest też do komentarza progów w `vitest.config.ts`:

> próg per-ścieżka = stan i sklejenie. Bramka autorytetu = dostęp.

---

## 2. Refaktor: jedna ekstrakcja, znak w znak

`src/routes/admin.names.tsx` miało 1349 linii i 0% pokrycia, a reguły importu
CSV dawały się sprawdzić WYŁĄCZNIE przez klikanie po zamontowanej trasie: żeby
dowieść, że plik z BOM-em albo z przecinkiem w cudzysłowie mapuje się na
właściwe kolumny, trzeba było zbudować `File`, podać go ukrytemu inputowi
i czytać wynik z tabeli podglądu.

Wycięte do `src/lib/admin/namesCsv.ts` (764 linie): parser CSV, serializacja,
katalog krajów z aliasami, normalizacja kraju, klasyfikacja duplikatu
(`add`/`merge`/`skip`), budowa ładunku wstawki i łatki scalenia. **Ciała
funkcji są znak w znak takie, jak przed wyprowadzeniem** - razem z ich wadami
(separator `;`, BOM, zwijanie duplikatów). Wady są zgłoszone `it.fails`, nie
naprawione: naprawa zmienia wynik importu, a refaktor nie może.

Trasa została z 896 liniami samego sklejenia (stan Reacta, zapytania,
komunikaty, nasłuch realtime) i ma dziś 100% linii.

To jedyna zmiana produkcyjna w całej pracy. Reszta modułu została nietknięta.

---

## 3. Trzydzieści sześć defektów: zgłoszone jako `it.fails`, produkcji nie ruszono

37 wpisów `it.fails`, 36 różnych defektów (droplista roli jest zgłoszona
z dwóch punktów widzenia: bramki statycznej i zamontowanej trasy). Każdy ma
**kontrolę dodatnią** - zwykły `it` przypinający stan faktyczny - żeby nikt nie
„naprawił" tego przypadkiem w drugą stronę.

### 3.1 Klasa dominująca: awaria odczytu udaje pustkę albo stan domyślny (12 wystąpień, 10 zgłoszonych)

To najczęstszy defekt tego obszaru i jednocześnie najgroźniejszy, bo w panelu
ustawień **pustka jest zaproszeniem do zapisu**:

| miejsce | skutek |
| --- | --- |
| `admin.greetings.tsx:73-95` | awaria odczytu wygląda jak słownik domyślny; pierwszy „Zapisz" wysyła dokładnie `DEFAULT_GREETINGS` i nadpisuje słownik najemcy |
| `admin.personalized.tsx:29-43` | to samo, z `allowGuests: false` w komplecie - personalizacja gościom zostaje wyłączona |
| `admin.organizations.$id.tsx:1085` | odmowa RLS na miejscach wygląda jak organizacja BEZ KONT („dodaj pierwsze konto", licznik `0/5`); administrator zaprasza ludzi od nowa |
| `admin.organizations.$id.tsx:154,157` | gałąź „organizacji nie ma" jest KODEM MARTWYM - karta cudzej organizacji stoi na „wczytywanie" na zawsze |
| `admin.users.index.tsx` | awaria `admin_list_users` renderuje się jako lista pusta (czytane jest tylko `data`) |
| `admin.integrations` (odczyt endpointów) | „brak endpointów" zamiast błędu |
| `admin.integrations` (odczyt kolejki) | czwórka zer zamiast błędu |
| `lib/builder/popups.ts:220-238` + `admin.popups.tsx:226-228` | odmowa RLS wygląda jak „brak popupów"; kampanie lecą czytelnikom, a ekran do ich wyłączenia milczy |
| `admin.audience.tsx:102,286` | odmowa RPC serii i retencji renderuje „brak danych" - fałszywe twierdzenie w raporcie, uwiarygodnione poprawnym lejkiem obok |
| `admin.users.index.tsx` | jeden komunikat na „brak użytkowników" i „brak trafień filtra" |

W rodzinie organizacji ta klasa występuje **cztery** razy; zgłoszone są dwa
wystąpienia (oba na karcie), bo dwóch odczytów listy zadanie nie obejmowało -
nagłówek pliku testowego mówi to wprost, żeby naprawa objęła wszystkie cztery.

### 3.2 Izolacja najemcy i zakres operacji (2)

| miejsce | skutek |
| --- | --- |
| `admin.organizations.$id.tsx:1008-1025` + `lib/organizations/teamSeats.server.ts` | „domknij zaległe" i „wyślij przypomnienia" w karcie organizacji A działają na `organization_seats` klientem serwisowym BEZ zawężenia do organizacji ani najemcy: gaszą dostęp i wysyłają maile także w organizacjach B i C, **u innych najemców** - a komunikat sugeruje zasięg jednej organizacji |
| `lib/authz/permissionMatrix.ts:394,404` | kafel KPI „Bramki bez `current_tenant_id()`" liczy WIERSZE, nie BRAMKI: na żywym snapshocie bez odniesienia do tenanta jest 25 bramek, a audytor widzi 23 - `pro_briefings` (3 bramki) i `chat_direct_gated` (2) zwijają się do jednej pozycji każda |

### 3.3 Rola i dostęp (3)

| miejsce | skutek |
| --- | --- |
| `admin.users.index.tsx:799-822` | droplista zmiany roli renderuje się KAŻDEMU członkowi personelu (sprawdzane jest tylko `u.id === user?.id`); ten sam defekt bramka wyłapała wcześniej na karcie `$id` |
| `admin.greetings.tsx` | trasa zawężona w nawigacji do `isAdmin` (`lib/admin/adminNav.ts:207-209`) nie sprawdza roli w ogóle: redaktor dostaje w pełni czynny formularz zmiany treści serwisu |
| `admin.settings.seo.tsx:21`, `site-identity.tsx:22`, `social-preview.tsx:32` | `head()` z tytułem, ale bez `robots: noindex`, choć reszta rodziny go ma - a `head()` renderuje się serwerowo, PRZED klientowym przekierowaniem z `/admin` |

### 3.4 Cicha utrata danych i cisza po odmowie (9)

| miejsce | skutek |
| --- | --- |
| `admin.organizations.$id.tsx:107` | łatka zapisu niesie CAŁY draft: klient dopłaca do 8 miejsc, a zapis poprawki miasta wpisuje z powrotem 5, omijając `org_set_seats_limit`; przycisk zapisu aktywuje się sam |
| `admin.personalized.tsx:36-40,185` | częściowy `sections` w bazie WYWALA panel (płaskie scalanie), choć czytelnik publiczny to przeżywa (`deepMerge`) - konfiguracji nie da się naprawić z interfejsu |
| `admin.names.tsx:352-372` | odmowa bazy w trakcie importu liczy się jako „pominięto" i kończy komunikatem SUKCESU („dodano 0, pominięto 120") |
| `admin.names.tsx:390-395` | udane usunięcie nie zdejmuje wiersza ze stanu ani nie potwierdza niczego; wiersz znika tylko zdarzeniem realtime, więc przy plakietce „Offline" nie znika nigdy |
| `admin.names.tsx:305` | eksport po filtrze BEZ wyników oddaje CAŁY słownik (`filtered.length ? filtered : rows` skleja „nie filtrowano" z „nic nie znaleziono") |
| `admin.integrations` (przełącznik) | nieudane przełączenie MILCZY - mutacja nie ma `onError` |
| `admin.greetings.tsx:111-116`, `admin.personalized.tsx:47-56` | zapis nie unieważnia cache czytelnika ustawień (`staleTime` 5 min): administrator zapisuje i przez pięć minut widzi stare wartości |
| `impersonation.functions.ts:63` | `??` na komunikacie błędu przepuszcza `message: ""` - toast po nieudanym podszyciu jest PUSTY; ten sam wzorzec siedzi w `crm.functions.ts:631`, `invitations.functions.ts:257`, `wp-media.server.ts:214` |
| `contact.functions.ts:441-446` | `confirmation_sent_at` stawia się, gdy wyszło POWIADOMIENIE DLA REDAKCJI, więc panel pokazuje „Potwierdzenie wysłane" przy zgłoszeniu, do którego nadawca nic nie dostał |

### 3.5 Reguły tekstu, sluga i wyszukiwania (7)

| miejsce | skutek |
| --- | --- |
| `invitations.functions.ts:36-44` | `slugify` zamienia `ł`/`Ł` na myślnik: „Michał Kowalski" → `micha-kowalski`, „Łukasz Dąbrowski" → `ukasz-dabrowski`; slug jest publicznym adresem autora, a funkcja biegnie na OBU ścieżkach tworzenia konta |
| `admin.organizations.new.tsx` vs `invitations.functions.ts` | dwie różne reguły sluga w jednym panelu: ten sam napis daje dwa różne adresy publiczne |
| `namesCsv.ts` (separator) | plik z `;` jest odrzucany w całości, mimo że eksport tego samego panelu cytuje `;` |
| `namesCsv.ts` (dedupe) | duplikat `key` W JEDNYM PLIKU nie jest scalany, tylko liczony dwa razy |
| `namesCsv.ts` (flaga złożenia) | sama flaga złożenia rozjeżdża podgląd z zapisem |
| `lib/admin/community.ts` | fraza z panelu nie przechodzi przez `escapeLike`: `%` z wejścia działa jak wildcard |
| `lib/admin/pageTopics.ts:154,172,173,191,261-268` | filtr serwera i plakietka wiersza liczą temat dwiema drogami; na zachodzących wzorcach zakładka zwraca stronę, której plakietka wskazuje inny temat, a licznik nie zgadza się z liczbą wierszy |

### 3.6 Komunikaty i i18n (4)

| miejsce | skutek |
| --- | --- |
| `admin.users.*` (`changeRole`) | surowy komunikat Postgresa na ekranie zamiast klucza tłumaczenia |
| `admin.names.tsx` (`load`, `addOne`, `updateRow`, `deleteRow`) | to samo: tekst PostgreSQL-a z nazwą polityki i tabeli w panelu, który cały jest dwujęzyczny |
| `admin.greetings.tsx:151-177` + `lib/greetings/greetings.ts:203,259-261` | podgląd pokazuje „Anna" tam, gdzie panel obiecuje wołacz „Anno"; administrator „naprawia" to wpisując wołacz na sztywno we wzorzec i od tej pory KAŻDY czytelnik jest witany imieniem Anna |
| `admin.greetings.tsx:47-62` vs `281,293-295` | pora dnia z samych białych znaków blokuje zapis, ale żadna sekcja nie jest oznaczona - jedyne wyjście to „Przywróć domyślne", czyli utrata całego słownika |

### 3.7 Kontrakt wyniku (1)

`contact.functions.ts:536-539` - **rozstrzygnięcie sprawy „cichej degradacji
poczty"**, o którą pytał zakres etapu. Trójkąt „wiadomość zapisana + wysyłki
brak + wynik niesie sygnał" TRZYMA SIĘ i jest dowiedziony pięcioma testami:
przy braku klucza API `fetch` nie jest tknięty ani raz, `emails.autoReply` jest
`false`, a `confirmation_sent_at` nie jest stawiany. Defekt jest o poziom
głębiej: sygnał nie niesie POWODU. `emails.autoReply === false` znaczy naraz
„poczta nieskonfigurowana" (awaria systemowa), „autoodpowiedź wyłączona przez
najemcę" (stan poprawny), „odmowa bramki dla jednego adresu", „bramka
nieosiągalna" i „brak skonfigurowanego adresata". Ścieżka newslettera pole
`error` oddaje (`:511`) - asymetria dwa akapity niżej w tym samym pliku.

---

## 4. Wynik: przed → po

### 4.1 Powierzchnie (pomiar v8, plik po pliku, 2026-08-22)

| powierzchnia | linie przed | linie po | gałęzie przed | gałęzie po |
| --- | ---: | ---: | ---: | ---: |
| `routes/admin.users*` | 0% | **99,78%** | 0% | **95,09%** |
| `components/admin/users/**` | 0% | **98,09%** | 0% | **96,77%** |
| `lib/admin/invitations.functions.ts` | 0% | **100%** | 0% | **97,61%** |
| `lib/consent*` + `lib/legal/**` | 45,87% | **99,69%** | 44% | **95,31%** |
| `routes/admin.settings*` (15 tras) | 0% | **97,25%** | 24,5% | **95,08%** |
| `lib/admin/useSettings.ts` | 0% | **100%** | 0% | **100%** |
| `routes/admin.integrations.tsx` | 0% | **99,15%** | 0% | **95,04%** |
| `lib/integrations/dispatch.functions.ts` | 0% | **100%** | 0% | **100%** |
| `routes/admin.names.tsx` | 0% | **100%** | 0% | **98,83%** |
| `lib/admin/namesCsv.ts` | (nowy) | **100%** | — | **99,35%** |
| `routes/admin.organizations*` (3 trasy) | 39,80% | **99,67%** | 30,30% | **98,65%** |
| — w tym `admin.organizations.$id.tsx` | 2,13% | **99,46%** | 0% | **98,53%** |
| `routes/admin.audience/personalized/popups/greetings` | 0% | **99,24%** | 0% | **96,90%** |
| `lib/admin/community.ts` | ~7% | **100%** | ~7% | **99,63%** |
| `lib/admin/membership-admin.ts` | 0% | **100%** | 0% | **100%** |
| `lib/admin/pageTopics.ts` | 100% | **100%** | 79,16% | **100%** |
| `lib/admin/impersonation.functions.ts` | 0% | **100%** | 0% | **100%** |
| `lib/admin/consentAudit.{functions,server}.ts` | 0% | **100%** | 0% | **100%** |
| `lib/admin/network.ts` | 0% | **100%** | 0% | **100%** |
| `lib/joinUsSync.functions.ts` | 0% | **100%** | 0% | **100%** |
| `lib/contact.functions.ts` | ~4% | **100%** | ~4% | **98,96%** |
| `lib/authz/**` | 86,80% | **100%** | 77,14% | **100%** |
| — w tym `permissionMatrix.ts` | 95,86% | **100%** | 82,30% | **100%** |

### 4.2 Testy

| plik testowy | przypadki |
| --- | ---: |
| `routes/__tests__/adminUsersRoutes.test.tsx` | 151 |
| `routes/__tests__/adminSettingsRoutes.test.tsx` | 225 |
| `routes/__tests__/adminOrganizationsRoutes.test.tsx` | 210 |
| `routes/__tests__/adminIntegrationsRoute.test.tsx` | ~120 |
| `routes/__tests__/adminNamesRoute.test.tsx` | 120 |
| `routes/__tests__/adminAudienceRoutes.test.tsx` | 133 |
| `routes/__tests__/adminRouteAuthority.gate.test.ts` | 58 (było 21) |
| `lib/admin/__tests__/invitationsFunctions.test.ts` | 204 |
| `lib/__tests__/contactFunctions.test.ts` | 141 |
| `lib/admin/__tests__/pageTopics.test.ts` | 321 |
| `lib/authz/__tests__/*` | 184 |
| pozostałe pliki modułu | ~700 |

---

## 5. Dowód, że to nie „render bez asercji"

Trzy mechanizmy, które w tej pracy zrobiły najwięcej i których nie da się
zaliczyć bez asercji:

1. **Bramka pola martwego** (`adminSettingsRoutes.test.tsx`). Dla każdego z 15
   paneli test przechodzi po WSZYSTKICH kontrolkach formularza, zmienia każdą
   z osobna i porównuje ładunek zapisu przed i po. Pole, którego zmiana nie
   zmienia ładunku, ląduje na liście `dead` i oblewa test z nazwą kontrolki.
   To ona dowiozła 95% gałęzi na piętnastu trasach naraz - i to ona wyłapie
   pole dopisane w przyszłości bez podpięcia do zapisu.
2. **Rozszerzona bramka autorytetu**. Dotychczasowy czytnik dopasowywał
   `isSuperAdmin ? [{ … to: "/admin/<slug>"` - czyli PIERWSZY adres w bloku
   i wyłącznie dla `isSuperAdmin`. Wpis zawężony do `isAdmin` był dla bramki
   niewidzialny, a to właśnie tam siedzi defekt `admin.greetings`. Nowy
   `navGatedSlugs(role)` czyta oba warianty i wszystkie adresy w bloku.
   Doszła też lista `PRIVILEGED_TABLES` (`user_roles`, `tenants`,
   `role_audit_log`, `user_consents`) sprawdzana na 28 trasach oraz reguła
   „panel czytający `site_settings` musi używać `useSettings`".
3. **Asercje strukturalne, nie tekstowe**. Kontrolka nadania roli jest
   rozpoznawana po ZBIORZE wartości `<option>`, nie po napisie etykiety;
   klucze ustawień są importowane z produkcji (`SEO_SETTINGS_KEY`,
   `COOKIE_BANNER_SETTINGS_KEY`), bo literówka w napisie dałaby test, który
   „przechodzi" obok panelu; prefiks inwalidacji cache jest sprawdzany jako
   PREFIKS klucza, a nie jako konkretna tablica.

---

## 6. Nie osiągnięto 95% linii / 93% gałęzi w:

**Żadna powierzchnia w zakresie nie jest poniżej celu.** Poniżej celu są
pojedyncze gałęzie i one są wypisane z numerami linii - w komentarzach plików
testowych i tutaj.

### 6.1 `routes/admin.names.tsx` - 98,83% gałęzi (4 z 342)

- `:240` `if (clamped === p) return p` - nieosiągalne: żądanie strony, na której
  już jesteśmy, przychodzi wyłącznie z przycisków, a te są wtedy `disabled`.
- `:345` `if (!preview) return` - przycisk „Zatwierdź import" istnieje w drzewie
  tylko wtedy, gdy `preview` jest niepuste (okno renderowane warunkowo).
- `:550` angielskie ramię napisu „... i N więcej" - wymaga ponad 200 wierszy CSV
  w interfejsie angielskim; polskie ramię jest pokryte, różnica to jeden napis.
- `:826` `t("admin.users.delete") || "Delete"` - i18next zawsze oddaje niepusty
  napis, więc ramię zapasowe jest osiągalne tylko przy tłumaczeniu ustawionym
  na pusty string.

### 6.2 `routes/admin.organizations.$id.tsx` - 98,53% gałęzi (3 z 205)

- `:118` `if (!draft) return` w `mutationFn` - przycisk zapisu istnieje tylko po
  ustawieniu draftu.
- `:157-163` gałąź „organizacji nie ma" - **kod martwy**, zgłoszony `it.fails`
  (§3.1). Pokrycie wymagałoby naprawy produkcji.
- `:166` `d ? mut({ ...d }) : d` - `patch` woła się wyłącznie z formularza,
  który istnieje tylko przy niepustym draftcie.

`admin.organizations.new.tsx:254` - `hint` nie jest przekazywany przez żadnego
wołającego w tej trasie (martwy prop, stan sprzed tej pracy).

### 6.3 `routes/admin.greetings.tsx` - 97,70% linii, 95,40% gałęzi

`:103-108` (`toast.error` + `return` w `save()` przy zablokowanym zapisie) oraz
gałęzie `:51`, `:102`, `:104`: przycisk ma `disabled={busy || !canSave}`, więc
kliknięcie nie dochodzi - to defensywna duplikacja stanu wyłączonego.
`dict[l][b] ?? []` jest nieosiągalne, bo odczyt zawsze startuje
z `cloneDefaults()`.

### 6.4 `routes/admin.popups.tsx` - 95,23% gałęzi

`:109` i `:196` - strażniki zdublowane z `disabled` / z warunkiem renderu okna.
`:165` fałszywe ramię `if (!cancelled)` - wymaga, by `Promise.all` liczników
rozwiązało się PO odmontowaniu efektu; wspólna atrapa łańcucha
(`src/test/supabaseChain.ts`) nie daje takiego przeplotu bez sztucznej bramki
i wyścigu, a dokładanie ich do wspólnego pliku testowego byłoby kosztem dla
całego repozytorium.

### 6.5 `lib/contact.functions.ts` - 98,96% gałęzi (2 z 193)

`:101` `?? c` w `esc()` - regex `/[&<>"']/g` dopasowuje dokładnie te pięć
znaków, które słownik ma jako klucze. `:296` `?? null` po
`fwd.split(",")[0]?.trim()` - `split` zwraca listę o długości ≥ 1, więc `[0]`
nigdy nie jest `undefined`.

### 6.6 `lib/integrations/dispatch.functions.ts` - 85,71% FUNKCJI

Jedna funkcja jest osiągalna wyłącznie przez uruchomienie middleware, czego
harness funkcji serwerowych z założenia nie robi (`src/test/serverFnHarness.ts`).
Bramka roli jest tam dowodzona jako DEKLARACJA middleware - i tak ma zostać.

### 6.7 Zakres świadomie nietknięty

- **Baza.** Ani jeden test w vitest nie odtwarza RLS, RPC ani triggerów. To
  pgTAP (`role_management_test.sql`, `rls_tenant_isolation_test.sql`,
  `tenant_isolation_three_tenants_test.sql`,
  `security_definer_tenant_scope_test.sql`,
  `consent_evidence_hardening_test.sql` i 15 dalszych) oraz bramki
  `check:authz-snapshot`, `check:permissions-parity`, `check:sql-*`,
  `check:rpc-contract`.
- **`check:db-contract` nie został uruchomiony** - wymaga poświadczeń Supabase,
  których w tym środowisku nie ma. Wszystkie pozostałe bramki (osiem
  statycznych SQL, cztery i18n, `check:unknown-casts`,
  `check:stale-never-casts`, `check:authz-snapshot`,
  `check:permissions-parity`, `check:gate-coverage`) przechodzą.
- **Flagi funkcji (96,9%) i multi-tenant w kodzie (90,4%)** - zostawione,
  zgodnie z zakresem; ruszone zostały wyłącznie brakujące gałęzie w authz
  (77,14% → 100%).
- **Dwa odczyty listy organizacji** z klasy „pusto kontra błąd" - nagłówek
  pliku testowego mówi o tym wprost, żeby naprawa objęła wszystkie cztery
  wystąpienia jednocześnie.

---

## 7. Zapadka: progi per-ścieżka w `vitest.config.ts`

28 nowych wpisów. Każdy niesie ZMIERZONĄ wartość z datą 2026-08-22
w komentarzu i stoi 1-2 p.p. pod pomiarem (zapas na dryf w CI). Żaden
istniejący próg nie został obniżony. Blok otwiera komentarz z podziałem
odpowiedzialności („próg = stan i sklejenie, bramka = dostęp"), żeby następny
czytelnik nie próbował dowodzić dostępu progiem pokrycia.

Dwa progi są niższe od reszty świadomie i mają to opisane na miejscu:
`dispatch.functions.ts` (funkcje 85%, patrz §6.6) i `consentAudit.server.ts`
(bez progu gałęzi i funkcji - plik ma dla v8 dwie instrukcje wykonywalne, dwa
schematy Zod, więc te metryki nic tam nie znaczą).

---

## 8. Wzorce wzięte z repozytorium, nie wymyślone

- `renderRoute()` (`src/test/routeHarness.tsx`) - montaż PRAWDZIWEJ trasy
  plikowej, z odtworzonym krokiem generatora, więc `Route.useParams()`,
  `validateSearch`, `loader` i `head()` istnieją.
- `supabaseFromStub()` (`src/test/supabaseChain.ts`) - thenable łańcuch
  PostgREST z rejestracją ogniw; asercje mówią też, czego w łańcuchu BYĆ NIE
  MOŻE (zawężenia najemcą po stronie klienta).
- `realtimeStub()` (`src/test/supabase/realtime.ts`) - kanały z obserwowalnym
  refcountem; zgubiony `removeChannel` nie psuje nic od razu, dopiero po
  kilku przejściach między trasami.
- `serverFnStubModule()` (`src/test/serverFnHarness.ts`) - bramka roli jako
  DEKLARACJA middleware, nigdy jako zachowanie handlera.
- `realT()` (`src/test/i18nReal.ts`) - prawdziwy tłumacz zamiast atrapy
  oddającej klucz. Dzięki temu usunięcie klucza ze słownika oblewa test,
  a asercja nie wymaga `as unknown as TFunction`.
- `it.fails` jako sposób zgłoszenia defektu bez ruszania produkcji, zawsze
  z kontrolą dodatnią.
- Strażniki runtime zamiast rzutowań (wzorzec z `routeHarness.tsx`). W nowym
  kodzie jest **zero** `any`, `as unknown as` i `@ts-expect-error`; przy
  okazji zdjęte zostały cztery rzutowania, które przemknęły we wcześniejszych
  etapach tej samej pracy - dwa z nich zastąpił biwariantny interfejs metodowy
  (składnia metodowa pozwala przypisać funkcję o węższym parametrze bez
  rzutowania), a dwa strażnik odrzucający wartość o złym typie.

---

## 9. Jak zweryfikować

```bash
# środowisko (rejestr prywatny wymaga OBU kroków; bez drugiego ~250 plików nie startuje)
npm install --no-audit --no-fund --legacy-peer-deps
npm install --no-save --legacy-peer-deps @testing-library/dom jsdom

# 1. cała suita z pokryciem i progami per-ścieżka
npx vitest run --coverage

# 2-6. powierzchnie z §4.1 (przykłady)
npx vitest run src/routes/__tests__/adminSettingsRoutes.test.tsx --coverage \
  --coverage.include='src/routes/admin.settings*'
npx vitest run src/routes/__tests__/adminOrganizationsRoutes.test.tsx --coverage \
  --coverage.include='src/routes/admin.organizations*'
npx vitest run src/routes/__tests__/adminNamesRoute.test.tsx --coverage \
  --coverage.include='src/routes/admin.names.tsx'
npx vitest run src/lib/authz/__tests__ --coverage --coverage.include='src/lib/authz/**'

# 7. bramka autorytetu (58 przypadków, 2 zgłoszenia defektów)
npx vitest run src/routes/__tests__/adminRouteAuthority.gate.test.ts

# 8. bramki repozytorium - wszystkie zielone bez regeneracji czegokolwiek
npm run check:authz-snapshot
npm run check:permissions-parity
npm run check:gate-coverage
npm run check:unknown-casts
npm run check:i18n-hardcoded && npm run check:i18n-default-value
npm run check:i18n-overlay-imports && npm run check:i18n-parity
npm run check:sql-tenant-scope && npm run check:sql-app-role
npm run check:rpc-contract

# 9. typy i lint
npx tsc --noEmit
npx eslint src
```
