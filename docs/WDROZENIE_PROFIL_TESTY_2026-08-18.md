# Profil: 587 testów, cztery bramki pokrycia i trzy defekty naprawione po drodze (2026-08-18)

Ten sam ruch, co PR #250 zrobił dla czatu (`docs/WDROZENIE_CZAT_TESTY_REFAKTOR_2026-08-18.md`),
zastosowany do modułu **profilu** - obszaru, który audyt `AUDYT_PROFILE_CZAT_SIEC_2026-08-18.md`
(sekcja 0.4) wskazał jako obecnie najsłabiej pokryty. Ten dokument audytu nie jest jeszcze
w repozytorium w chwili pisania tego wdrożenia - liczby bazowe poniżej pochodzą z **własnego
przebiegu**, zmierzonego na HEAD `e83570c` (ten sam commit, który zadanie podało jako punkt
odniesienia), a nie przepisane z zadania bez sprawdzenia.

---

## 1. Stan wyjściowy: pomiar bez zapory

| Powierzchnia             | Instrukcje | Gałęzie | Funkcje |  Linie | Plików na 0% |
| ------------------------ | ---------: | ------: | ------: | -----: | -----------: |
| `src/lib/profile`        |     22,02% |  19,23% |     31% | 22,22% |       9 z 16 |
| `src/components/profile` |     27,84% |  28,04% |  26,74% | 29,01% |       6 z 17 |

Zmierzone liczby zgadzają się co do dwóch miejsc po przecinku z tymi podanymi w zadaniu -
pomiar bazowy z zadania był aktualny.

Dwa pliki dominowały nad resztą delty: **`AuthorProfileEditor.tsx`** (219 instrukcji, edytor
profilu autora dla `/profile/author` i `/admin/users/$id`, największy pojedynczy plik profilu
bez ani jednej asercji) i **`AccountIdentityPanel.tsx`** (141 instrukcji). Razem z
`CompanyPickerDialog.tsx` (120), `SocialIdentityPanel.tsx` (115) i `useProfileEditor.ts` (85)
stanowiły większość zerowej powierzchni.

### 1.1 Dlaczego pokrycie stało w miejscu

Ten sam koszt wejścia, co przy czacie, tylko w innym przebraniu:

1. **Warstwa danych profilu rozmawia z bazą przez ŁAŃCUCH PostgREST**
   (`.from().select().eq().maybeSingle()`), a do tego dochodzi **Storage** (podpisany URL
   uploadu + adres publiczny) i **`XMLHttpRequest`** ręcznie wołane dla postępu wysyłki
   avatara/okładki/CV. Trzy różne światy do zaatrapowania w KAŻDYM teście z osobna.
2. **Dwa RPC-e SECURITY DEFINER na tę samą encję.** `AuthorProfileEditor` czyta przez
   `get_own_author_profile()` w trybie `self` i `admin_get_author_profile()` w trybie `admin` -
   zamiana tych dwóch RPC-ów nie daje błędu typów, tylko cichy wyciek PII między tenantami.
3. **Radix Dialog/Select w happy-dom.** Select nie otwiera listy bez realnego wskaźnika -
   trzeba było podstawić natywny `<select>` o tym samym kontrakcie (`radixSelectStub`
   w fixture'ach). Dialog okazał się działać wprost (zweryfikowane sondą przed napisaniem
   testów), więc `CompanyPickerDialog` jest testowany przez PRAWDZIWY komponent Radix, bez
   atrapy.

---

## 2. Fixture'y: jeden wspólny łańcuch PostgREST dla całego repo

`src/test/chat/fixtures.ts` (PR #250) miał już atrapę łańcucha PostgREST - w niej nie było
NIC czatowego, tylko generyczna maszyneria `supabase.from(...)`. Zamiast kopiować ją do
drugiego pliku (dwie atrapy rozjeżdżające się przy następnej zmianie kontraktu) albo
importować z `test/chat` do testów profilu (zależność, która nic nie znaczy), atrapa
wyprowadziła się do **`src/test/supabaseChain.ts`** - `test/chat/fixtures.ts` re-eksportuje
ją dalej, żaden plik testowy czatu nie zmienia importu. Zweryfikowane bezpośrednio: pełny
przebieg `src/lib/chat src/components/chat` daje **582 zielone testy w 31 plikach**
zarówno PRZED, jak i PO wydzieleniu atrapy - wyprowadzenie modułu nie ruszyło ani jednego
testu. (Nagłówek `docs/WDROZENIE_CZAT_TESTY_REFAKTOR_2026-08-18.md` mówi o „607 testach
w 33 plikach" - rozjazd z rzeczywistym stanem HEAD `e83570c` istniał już PRZED tym
wdrożeniem i nie ma związku z niniejszą zmianą; nietknięty, bo poza zakresem tego zadania.)

Nowy moduł **`src/test/profile/fixtures.ts`** dokłada, czego łańcuch nie miał:

- **atrapę Storage** (`storageStub`) z trzema trybami awarii podpisu (`failSign`,
  `failSignWith` - odrzucenie NIE-Error-em, `signWithoutData` - sukces bez ładunku),
- **atrapę `XMLHttpRequest`** (`xhrStub`) odgrywającą PEŁNY cykl - `onprogress`
  (w tym zdarzenie bez znanego rozmiaru, `lengthComputable: false`), `onload`, `onerror`,
- **`radixSelectStub`** - natywny `<select>` w miejsce Radixowego (patrz §1.1),
- fabryki wierszy 1:1 z kolumnami tabel (`profileEditorRow`, `profileIntentRow`,
  `exposureRow`), kwestionariusz Big Five parametryzowany rozmiarem osi, oraz `okCount` -
  odpowiedź zapytania LICZĄCEGO (`count: exact, head: true`), bo `useProfileIntent` liczy
  umiejętności/doświadczenie/wykształcenie bez ściągania wierszy.

Jeden defekt fixture'owy złapany PRZED napisaniem właściwych testów: `reactI18nextStub`
zwracał **nowy obiekt `i18n` na każde wywołanie** `useTranslation()`. `AuthorProfileEditor`
wpina `i18n` do tablicy zależności swojego efektu ładującego (dokumentowany wprost w
komentarzu kodu: „i18n.t stabilna instancja, żeby przełączenie języka nie przeładowywało
formularza w trakcie edycji") - z niestabilnym `i18n` efekt odpalał w kółko przy każdym
renderze i formularz nigdy nie stabilizował stanu `exists`. Naprawione raz w fixture'ach:
`i18n` jest teraz jednym stabilnym obiektem z getterem na `language`, dokładnie jak realna
instancja i18next.

---

## 3. Trzy defekty znalezione PRZY PISANIU testów, naprawione osobnymi commitami

Zgodnie z zasadą zadania - test, który ujawnia defekt, dostaje zgłoszenie i (jeśli mały)
poprawkę w osobnym commicie, z opisem, bez osłabiania asercji.

### 3.1 Propozycja publicznego adresu profilu zjadała literę „ł"

`SocialIdentityPanel.slugify()` transliterował diakrytyki przez samo `normalize("NFKD")`.
NFKD rozkłada ą/ć/ę/ń/ó/ś/ź/ż na „podstawa + znak diakrytyczny" - ale **nie** „ł" (U+0142),
bo to nie złożenie, tylko osobna litera z przekreśleniem. Litera przechodziła przez NFKD
bez zmian i wpadała pod `[^a-z0-9]+` → dywiz → usunięta z brzegu regułą `^-+|-+$`.

Skutek dla propozycji adresu `/author/<slug>` (ten, który użytkownik kopiuje do wizytówki
i rozsyła):

```
„Łukasz Zieliński" -> ukasz-zielinski   (litera zjedzona z POCZĄTKU)
„Michał Nowak"     -> micha-nowak
„Paweł Kowalski"   -> pawe-kowalski
```

W produkcie polskojęzycznym dotykało to jednych z najczęstszych imion. Poprawka: mapa liter,
których unicode nie rozkłada (ł, đ, ð, ø, æ, œ, ß, þ, ħ, ŀ, ı - zakres ogólnoeuropejski, bo
katalog osób też jest), stosowana PRZED `normalize`. Ta sama luka siedzi we WSZYSTKICH
pozostałych implementacjach `slugify` w repo (`taxonomySlug.ts`, `content.functions.ts`,
`invitations.functions.ts`) - to osobne powierzchnie i osobne zadanie, świadomie
nietknięte tutaj. Trzy testy `REGRESJA:` przypinają początek/środek/koniec wyrazu.

Commit: `profil: propozycja sluga zjadała „ł" z imienia i nazwiska`.

### 3.2 Osiem pól formularza tworzenia firmy bez powiązania z etykietą

`CompanyPickerDialog`'s `FieldRow` renderował `<Label>` jako **rodzeństwo** pola, nie jego
rodzica - bez `htmlFor` powiązanie etykieta/pole nie istniało. Skutek dla ośmiu pól
formularza tworzenia firmy (nazwa, kraj, branża, miasto, kod pocztowy, adres, strona,
telefon): czytnik ekranu ogłaszał osiem nienazwanych pól tekstowych (WCAG 1.3.1 / 4.1.2),
kliknięcie etykiety nie fokusowało pola. Prop `required` na `FieldRow` był deklarowany
w typach, ale nigdy nie renderowany - gwiazdka przy polu obowiązkowym nie pojawiała się.

Poprawka: `useId()` na dialog (może być zamontowany więcej niż raz - edytor profilu i panel
tożsamości), `htmlFor`/`id` na każdej parze, gwiazdka `required` renderowana i oznaczona
`aria-hidden`.

Commit: `profil: pola formularza tworzenia firmy bez powiązania z etykietą`.

### 3.3 Utworzenie nowej firmy ignorowało błąd DRUGIEGO kroku

Utworzenie firmy w `CompanyPickerDialog` to dwie operacje: `create_company_self_service`
(zapis do CRM), potem `link_current_company` (powiązanie z profilem). Pierwsza sprawdzała
błąd (`if (error) throw error`) - druga, `await supabase.rpc("link_current_company", ...)`,
**nie sprawdzała go wcale**. Wynik drugiego wywołania był odrzucany bez odczytania.

Skutek: gdy powiązanie się nie udawało, firma i tak lądowała w CRM, użytkownik widział
toast „utworzono firmę" i dialog się zamykał - profil zostawał BEZ powiązania, bez żadnego
sygnału, że coś poszło nie tak. `linkCompany` (łączenie z ISTNIEJĄCĄ firmą) sprawdzał błąd
TEGO SAMEGO RPC poprawnie kilka linii wyżej w tym samym pliku - to samo wywołanie, dwa
miejsca, jedno bez kontroli.

Poprawka: odczytanie i zgłoszenie błędu z drugiego kroku, identycznie jak w `linkCompany`.
Test `REGRESJA: błąd DRUGIEGO KROKU...` przypina scenariusz.

Commit: `profil: utworzenie firmy ignorowało błąd powiązania z profilem`.

---

## 4. Wynik: przed → po (własny pomiar)

| Powierzchnia / plik                       | Instrukcje |     Po | Gałęzie |     Po |
| ----------------------------------------- | ---------: | -----: | ------: | -----: |
| `src/lib/profile` (całość)                |     22,02% | 85,22% |  19,23% | 79,49% |
| `src/components/profile` (całość)         |     27,84% | 89,54% |  28,04% | 86,03% |
| `AuthorProfileEditor.tsx`                 |         0% | 84,01% |      0% | 79,85% |
| `CompanyPickerDialog.tsx`                 |         0% | 85,36% |      0% | 89,88% |
| `identity/AccountIdentityPanel.tsx`       |         0% | 92,90% |      0% | 86,88% |
| `identity/SocialIdentityPanel.tsx`        |         0% | 95,72% |      0% | 93,50% |
| `sections/ProfileIntentSection.tsx`       |         0% | 91,22% |      0% | 97,22% |
| `privacy/VisibilityAndContactSection.tsx` |         0% | 95,55% |      0% |   100% |
| `lib/profile/useProfileEditor.ts`         |         0% | 98,82% |      0% | 97,95% |
| `lib/profile/useProfileIntent.ts`         |         0% | 97,50% |      0% | 96,42% |
| `lib/profile/badges.ts`                   |         0% | 95,65% |      0% | 93,75% |
| `lib/profile/usePublicExposure.ts`        |         0% |   100% |      0% |    75% |
| `lib/profile/useHeaderProfile.ts`         |         0% |   100% |      0% |   100% |
| `lib/profile/personality.ts`              |         0% |   100% |      0% |   100% |
| `lib/profile/routes.ts`                   |         0% |   100% |      0% |   100% |
| `lib/profile/guestPreviewStore.ts`        |         0% |   100% |      0% |   100% |
| `lib/profile/completeness.ts`             |     30,43% |   100% |      0% |   100% |
| `sections/ProfileExtraSections.tsx`       |     35,46% | 84,72% |  29,75% | 79,51% |

Test Files **27 passed**, **587 testów** zielonych (`npx vitest run src/lib/profile
src/components/profile`), progi włączone. Rozbicie policzone bezpośrednio z JSON-owego
raportu przebiegu, nie z pamięci: **12 zupełnie nowych plików testowych** (361 przypadków:
`AccountIdentityPanel`, `AuthorProfileEditor`, `CompanyPickerDialog`, `ProfileIntentSection`,
`SocialIdentityPanel`, `VisibilityAndContactSection` po stronie komponentów;
`completeness`, `guestPreviewStore`, `personality`, `profileDataHooks`, `profileRoutes.gate`,
`useProfileEditor` po stronie `lib`) + **28 nowych przypadków dopisanych do istniejącego**
`ProfileExtraSections.test.tsx` (12 → 40, domykające `EducationSection`, `AwardsSection`,
`CvSection`). Reszta - **198 testów w 14 plikach** (`DataRightsSection`,
`MediaMentionsSection`, `ProfileNav`, `ProfileMediaPreview`, `VerifiedProfileBadge`,
`inlineEditors`, `profileAtoms` i siedem istniejących bramek/testów jednostkowych) -
istniała przed tym wdrożeniem i nietknięta.

Zero plików na 0% w `src/components/profile`. W `src/lib/profile` zostaje jeden -
`export.functions.ts` - patrz §5.

---

## 5. Co pominięte i dlaczego

**`src/lib/profile/export.functions.ts`** (48 instrukcji, 0%) - server function składająca
paczkę eksportu RODO z ~33 zapytań. Ma już **bramkę statyczną**
(`src/lib/profile/__tests__/exportOwnerScope.gate.test.ts`), która czyta kod i wymaga, żeby
każde zapytanie samo dowodziło zawężenia do właściciela (kolumna z listy `OWNER_COLUMNS`
albo jawny wpis w `RLS_SCOPED` z odpowiadającym testem pgTAP). Runtime'owe pokrycie
wymagałoby dwóch użytkowników z danymi w kilkudziesięciu tabelach i uruchomienia
`@tanstack/react-start`'owej server function w środowisku testowym (inny mechanizm
wykonania niż zwykły komponent/hook) - koszt wejścia nieproporcjonalny do ryzyka, które
bramka statyczna już adresuje. Zostawione jawnie jako wyjątek w progu
`src/lib/profile/**` (komentarz w `vitest.config.ts` odsyła tutaj).

**Częściowo pominięte w `AuthorProfileEditor.tsx` (84,01%) i `ProfileExtraSections.tsx`
(84,72%)**: OG-refresh happy-path z pełnym renderem trzech linków debugera jest pokryty,
ale kilka rzadkich gałęzi obronnych (np. `MiniField`/`MiniArea` bez wypełnionej wartości
przy pustym renderze, kilka wariantów formatowania dat w `formatRange`) zostało - próg
tego pliku jest floorowany ~4pp pod zmierzonym poziomem właśnie po to, żeby nie udawać,
że jest to 100%.

**Otwarte ustalenia audytu N1-N3** (blokada w `send_expert_request`, kompletność eksportu
RODO, degree vs blokada) - świadomie nietknięte. To osobne zadania i osobne PR-y, zgodnie
z zakresem tego wdrożenia.

---

## 6. Bramki pokrycia (`vitest.config.ts`)

Wzorem bloku czatu - progi floorowane ~4pp pod zmierzonym poziomem (marża na dryf CI),
wolno je wyłącznie podnosić:

```
src/lib/profile/**                    statements 81 / functions 81 / lines 81 / branches 75
src/components/profile/**             statements 85 / functions 74 / lines 87 / branches 82
```

Cztery czyste moduły przypięte na **100% na wszystkich czterech metrykach** - tak jak
czyste moduły czatu i płatności w tym samym pliku:

```
src/lib/profile/personality.ts
src/lib/profile/completeness.ts
src/lib/profile/routes.ts
src/lib/profile/guestPreviewStore.ts
```

`src/lib/profile/exportManifest.ts` miał już taki próg (100/100/100/95) - nietknięty.
Żaden istniejący próg w pliku nie został obniżony: jedyna zmiana istniejącej wartości to
podniesienie `src/components/profile/**` z 25/25/25/25 do wartości powyżej. Zweryfikowane
uruchomieniem `npx vitest run src/lib/profile src/components/profile --coverage` (exit 0,
zero linii `ERROR: Coverage for ... does not meet threshold`) oraz spot-checkiem
`src/lib/chat`, `src/components/chat`, `src/lib/network`, `src/components/network` z tym
samym poleceniem, żeby potwierdzić, że edycja wspólnego pliku konfiguracyjnego nie zepsuła
progów sąsiednich powierzchni.

---

## 7. Wzorce wzięte z repo, nie wymyślone

- `src/test/chat/fixtures.ts` / `src/test/network/fixtures.ts` - fixture'y w duchu atomic
  design; `src/test/profile/fixtures.ts` idzie tą samą ścieżką.
- `src/test/renderWithQueryClient.tsx` - rozszerzony o zwracanie `queryClient` w wyniku
  (potrzebne do `spyOn(queryClient, "invalidateQueries")` bez budowania własnego providera;
  zmiana czysto addytywna, żaden dotychczasowy konsument nie destrukturyzuje pełnego
  kształtu wyniku).
- `src/components/network/__tests__/ConnectButton.matrix.test.tsx` - wzór testu
  macierzowego; ta sama zasada zastosowana do maszyny stanów sluga w
  `SocialIdentityPanel.test.tsx` (pusty / za krótki / niepoprawny / zarezerwowany / zajęty /
  wolny).
- `src/components/profile/__tests__/DataRightsSection.test.tsx` - działający wzór dla
  sekcji profilu, nietknięty, służył jako punkt odniesienia stylu asercji.
- `src/lib/chat/__tests__/chatDataHooks.test.tsx` - wzór testu hooków warstwy danych
  Supabase; `profileDataHooks.test.tsx` i `useProfileEditor.test.tsx` idą tym samym
  wzorem (atrapa `supabase.from`/`supabase.rpc` przez `vi.hoisted` + dynamiczny import
  fixture'ów wewnątrz fabryki `vi.mock`).

---

## 8. Jak zweryfikować

```bash
sed -E -i 's#https://europe-west[0-9]+-npm\.pkg\.dev/lovable-core-prod/sandbox-npm-cache/#https://registry.npmjs.org/#g' bun.lock
bun install
git checkout -- bun.lock   # CI-only, nie commitować

npx vitest run src/lib/profile src/components/profile --coverage
# 27 plików testowych, 587 testów, progi włączone, exit 0

npx prettier --check src/lib/profile src/components/profile src/test/profile \
  src/test/supabaseChain.ts src/test/renderWithQueryClient.tsx src/test/chat/fixtures.ts \
  vitest.config.ts docs/WDROZENIE_PROFIL_TESTY_2026-08-18.md

bun run check:gate-coverage
bun run check:types-freshness
bun run check:stale-never-casts
```

`check:authz-snapshot` jest czerwona już przed tym wdrożeniem (dryf flagi `pro_briefings`,
moduł wydarzeń) - niezwiązana z tym zadaniem, nietknięta.
