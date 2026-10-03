# Moduł 4 (strony, wygląd, motyw, media, import): domknięcie rekomendacji wydania 11 (2026-10-03)

Zlecenie: „optymalizuj, naprawiaj, wdrażaj testy" dla rozliczenia rekomendacji
wydania 11 modułu 4 - pięć rekomendacji niewykonanych i trzy nowe. Stan
wyjściowy: `531a2c5`.

| #   | Rekomendacja                                                       | Stan przed  | Stan po                                       |
| --- | ------------------------------------------------------------------ | ----------- | --------------------------------------------- |
| R1  | Naprawić albo usunąć migrację typografii                           | niewykonana | **naprawiona** (§1)                           |
| R2  | Realna zgoda w formularzu kontaktowym szablonu strony              | niewykonana | **wykonana** (§2)                             |
| R3  | Upload ikon przez wspólną ścieżkę mediów                           | niewykonana | **wykonana** (§3)                             |
| R4  | Paginacja biblioteki mediów, indeks, ograniczenie skanu użyć       | niewykonana | **wykonana** (§4)                             |
| R5  | Parametryzacja domeny mediów, domknięcie zapisu wariantów ikony    | niewykonana | **wykonana w kodzie**; migracja danych - §5.2 |
| N1  | Komunikat o odrzuconych plikach w pickerze                         | nowa        | **wykonana** (§6)                             |
| N2  | Usunąć martwy `DynamicIconFull`, uzgodnić komentarze rejestru ikon | nowa        | **wykonana** (§7)                             |
| N3  | Migracja markowania utrwala jedną domenę dla wszystkich najemców   | nowa        | **zabezpieczona w kodzie**; dane - §5.2       |

Sekcja „Defekty" raportu (4 nowe defekty: 3 średnie, 1 niski) nie była częścią
zlecenia, więc nie jest tu rozliczana co do numerów. Defekty znalezione przy
pracy i naprawione wymienia §8.

Środowisko: host `cdn.sheetjs.com` jest zablokowany polityką sieci, więc `xlsx`
zainstalowano lokalnie z rejestru npm (0.18.5) z przywróceniem
`package.json`/`bun.lock`. Żaden zmieniony plik nie importuje `xlsx`.

---

## 1. Migracja typografii (`lib/theme/typographyApply.functions.ts`)

Defekt był poważniejszy, niż opisało wydanie 11. Odczyt szedł klientem
użytkownika z komentarzem „RLS + tenant scoping działa przez klienta
użytkownika", ale:

- kolumny `content_pl/en`, `blocks_data`, `builder_data` są odebrane roli
  `authenticated` od `20260702200000_gate_content_body_columns.sql`, więc
  `SELECT` kończył się `permission denied` - skan nie działał w produkcji
  w ogóle, a test jednostkowy (atrapa bez uprawnień kolumnowych) był zielony;
- opublikowane wpisy są dla RLS czytelne publicznie we wszystkich najemcach,
  więc nawet przy prawie do kolumn filtr najemcy nie istniał.

Naprawa (doktryna `posts-migrate` i `getMediaUsage`):

- bramka `requireAdmin` (rola admina w najemcy z profilu + krok MFA) zamiast
  `has_role("admin")` przez RPC, które pomijało MFA i `super_admin`;
- odczyt service_role z jawnym `.eq("tenant_id", tenantId)`, najemca
  z profilu; brak najemcy = wyjątek przed pierwszym zapytaniem o wpisy;
- skan partiami po 100 w stabilnym porządku po `id` (zamiast całego
  archiwum w pamięci workera);
- zapis klientem wołającego, zawężony po `id` i `tenant_id`, z
  `select("id")`: cichy filtr RLS (0 wierszy) jest błędem, nie
  „zaktualizowano".

Testy: `lib/theme/__tests__/typographyApplyFunctions.test.ts` przepisany - 23
przypadki, w tym partie, fail-closed bez najemcy, zapis wyłącznie klientem
wołającego, 0 wierszy = błąd.

## 2. Zgoda w formularzu kontaktowym (`components/pages/ContactForm.tsx`)

Formularz wysyłał na sztywno `consent: true` bez pola, więc
`contact_messages.consent` poświadczało zgodę, której nikt nie wyraził (art. 7
ust. 1 RODO - administrator musi umieć wykazać zgodę). Teraz: pole zgody
(niezaznaczone domyślnie), brak zgody = brak wywołania serwera, komunikat
i `aria-invalid`, do rejestru `consents` trafia dokładnie widziana treść
w języku formularza (`{ key: "rodo", text, given, lang }` - jak w widżecie
buildera), po wysyłce zgoda wraca do stanu niezaznaczonego. Testy: 6 nowych
przypadków (10 w pliku).

## 3. Upload ikon przez wspólną ścieżkę mediów (`lib/iconLibrary.ts`, `routes/admin.icons.tsx`)

`uploadIconAsset` wołał `storage.upload` bezpośrednio: bez walidacji (pola
`accept="image/*"` zapraszały SVG, który bucket odrzuca nieczytelnym błędem
w połowie importu) i bez wiersza `media` (pliku nie było w bibliotece, audycie
ani ścieżce usuwania). Teraz:

- `uploadIconAsset(ctx, kind, file)` idzie przez `uploadAndRegisterMedia`
  (walidacja przed wysłaniem, rejestracja, sprzątnięcie storage przy
  odrzuconej rejestracji); `uploadAndRegisterMedia` dostało opcję
  `cacheControl`, więc ikony zachowują roczny cache;
- `ICON_ACCEPT_ATTR` = jawna lista rastrów (bez `image/*`, bez SVG) w obu
  polach; upuszczone pliki spoza listy dają komunikat (`onRejectedFiles`);
- **domknięcie zapisu wariantów**: import hurtowy waliduje CAŁĄ grupę przed
  wysłaniem, a porażka jednego wariantu albo zapisu `icon_library` kasuje
  warianty, które zdążyły wejść (`discardIconAssets` -> `bulkDeleteMedia`);
  slot wariantu kasuje plik, gdy wiersz ikony go nie przyjął (`save` zwraca
  wynik zamiast połykać błąd);
- slot wariantu wgrywa do katalogu rodzaju z wiersza (dotąd zawsze
  `icons/custom`, także dla flag i logotypów).

Testy: `lib/__tests__/iconLibrary.test.ts` (65) i
`routes/__tests__/adminIconsRoute.test.tsx` (51) - m.in. SVG odrzucany przed
wysłaniem, rejestracja w `media`, sprzątanie wariantów w trzech ścieżkach
porażki, rodzaj z wiersza, komunikat przy upuszczeniu.

## 4. Paginacja biblioteki mediów, indeksy, skan użyć

### 4.1 Migracja `20261003090000_media_library_pagination_usage_scan.sql`

- `media_tenant_created_idx (tenant_id, created_at DESC, id DESC)` - picker
  („wszystkie foldery");
- `media_tenant_folder_created_idx (tenant_id, folder_path, created_at DESC,
id DESC)` - menedżer per folder; przejmuje prefiks
  `media_tenant_folder_idx`, który jest zdejmowany;
- `media_folder_paths(_tenant_id)` - różne foldery z położenia plików
  (SECURITY INVOKER, RLS `media` obowiązuje); folder może istnieć wyłącznie
  jako `media.folder_path`, więc drzewo czytało dotąd całą tabelę;
- `media_usage_scan(_tenant_id, _needles, _limit)` - dopasowanie podciągów
  w bazie, zwraca wyłącznie trafienia (limit 1-500); EXECUTE tylko
  service_role.

Weryfikacja lokalna (PostgreSQL 16, minimalny schemat): migracja wykonana
dwukrotnie (idempotentna); na 60 000 wierszy oba kształty zapytań idą
`Index Only Scan` po nowych indeksach bez sortowania; funkcje zwracają
poprawne trafienia, pomijają kosz, obcego najemcę i puste igły; granty
zgodne z założeniem. Test pgTAP:
`supabase/tests/media_library_pagination_usage_scan_test.sql` (17 asercji;
lokalnie nie ma rozszerzenia pgTAP, więc uruchomi go CI `supabase test db`).

### 4.2 Kod

- `components/admin/media/lib/mediaPage.ts` - kursor keyset
  `(created_at, id)`, strona z wierszem nadmiarowym, escapowanie `ILIKE`,
  `placeholderData` ograniczone do tego samego najemcy;
- `useMediaData(tenantId, { folder, search })` - zapytanie per folder,
  stronami po 60, fraza w bazie (po debounce 250 ms), foldery z RPC;
  `MediaManager` dostał „Wczytaj więcej"; `useMediaMutations` pamięta folder
  pochodzenia plików, żeby cofnięcie wycięcia/wklejenia między folderami
  działało przy liście ograniczonej do bieżącego folderu;
- `MediaPickerDialog` - paginacja keyset zamiast `limit(500)` (plik 501. był
  nieosiągalny), filtr folderu, frazy i typu audio w bazie, foldery z RPC;
- `getMediaUsage` - skan przez `media_usage_scan` zamiast pobierania pełnych
  treści wszystkich wpisów i stron; duplikaty zawężone do najemcy
  i limitowane; odpowiedź niesie `truncated`, a lista użyć mówi o przycięciu.

Testy: `mediaPage.test.ts` (9), `useMediaData.test.tsx` (23),
`MediaManager.test.tsx` (62), `MediaPickerDialog.test.tsx` (45),
`media.functions.test.ts` (81).

## 5. Domena mediów

### 5.1 Kod (`lib/media/publicUrl.ts`, `lib/cropSizes.ts`)

- `VITE_PUBLIC_MEDIA_ORIGIN` - origin kanoniczny nowych adresów (domyślnie
  domena NES, więc wdrożenie bez zmiennej zachowuje się jak dotąd);
  walidowany: tylko `https` (wyjątek: localhost), bez ścieżki i danych
  logowania - literówka nie wstempluje w bazę obcego hosta;
- `VITE_PUBLIC_MEDIA_ORIGINS` - dodatkowe originy (np. domeny najemców), pod
  którymi `/media/...` jest rozpoznawane jako nasze;
- domena domyślna jest rozpoznawana zawsze: wiersze zapisane przed zmianą
  konfiguracji zachowują warianty rozmiarowe, a `brandedMediaUrl` przepisuje
  je na origin kanoniczny przy kolejnym zapisie;
- `isSupabaseStorageUrl` i `mediaStoragePath` korzystają z jednej funkcji
  `isBrandedMediaOrigin` - dwa miejsca nie odpowiadają różnie na to samo
  pytanie.

Testy: `publicUrl.test.ts` (z 4 do 23 przypadków), w tym ładowanie modułu
z różnymi zmiennymi środowiskowymi.

### 5.2 Czego świadomie NIE zrobiono: migracja danych

Przemarkowanie zapisanych już adresów per najemca (odwrotność
`brand_media_url_text` z filtrem `tenant_id` w `posts`, `pages`, `media`,
`icon_library`, `site_settings`, rewizjach) nie weszło do tej zmiany. Masowy
`UPDATE` treści na kilkunastu tabelach wymaga decyzji, które domeny dostają
najemcy, i próby na kopii bazy - tego nie da się odpowiedzialnie wykonać
bez dostępu do danych. Zmiana w kodzie jest warunkiem wstępnym: po ustawieniu
domen najemców w `VITE_PUBLIC_MEDIA_ORIGINS` istniejące adresy działają,
a migracja może być wykonana później bez okna, w którym obrazy przestają się
skalować.

## 6. Odrzucone pliki w pickerze (`MediaPickerDialog.tsx`)

Obszar wgrywania pustej biblioteki dostał `onRejectedFiles` z komunikatem
(nazwy plików). Przy okazji: komunikat rozróżnia za duży plik od złego
formatu, tryb „wszystko" nie mówi „to nie jest obraz", a sukces liczy pliki
wgrane (dotąd „Wgrano 3 plików" przy dwóch odrzuconych, a przy samych
odrzuconych - zielony komunikat).

## 7. Martwy `DynamicIconFull` i komentarze rejestru ikon

`allIconNames` i `pascalToKebabIconName` przeniesione do
`lib/icons/iconNames.ts` (katalog nazw z `iconNames.generated.json`, bez
danych SVG); `DynamicIconFull.tsx` usunięty. Komentarze uzgodnione z kodem:
4 porcje (`hash % 4`), koszt nieznanej nazwy = jedna porcja (23-25 KB gzip,
zmierzone na plikach JSON) zamiast całego rejestru; poprawione odwołania
do usuniętego pliku w generatorze, bramce `check:menu-icons`, CI, pickerze
ikon, bibliotece widżetów newslettera, centrum powiadomień i konfiguracji
pokrycia; nazwa przypadku w `MenuIcon.test.tsx`.

## 8. Defekty znalezione przy pracy

| miejsce                                    | defekt                                                                                                                                                                     | naprawa                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `MediaPickerDialog.tsx`                    | Po wgraniu `setPickedUrl` dostawał adres markowy absolutny, a wiersze listy adres renderowany `/media/...`; panel metadanych świeżo wgranego pliku nigdy się nie otwierał. | `mediaRenderUrl` przed porównaniem, szkic nazwy z wgranego pliku. |
| `MediaPickerDialog.tsx`                    | Licznik sukcesu liczył pliki wybrane, nie wgrane; same odrzucone dawały zielony komunikat.                                                                                 | Licznik wgranych; brak sukcesu = brak zielonego komunikatu.       |
| `MediaPickerDialog.tsx`                    | Tryb audio nie filtrował typów w bazie - strona wyników zapełniała się obrazami.                                                                                           | `like("mime_type", "audio/%")`.                                   |
| `routes/admin.icons.tsx`                   | Slot wariantu wgrywał flagi i logotypy do `icons/custom`; błąd zapisu wiersza był połykany, więc plik zostawał sierotą.                                                    | Rodzaj z wiersza; `save` zwraca wynik, porażka kasuje plik.       |
| `lib/media.functions.ts` (`getMediaUsage`) | Odczyt duplikatów bez filtra najemcy i bez limitu.                                                                                                                         | `.eq("tenant_id")`, `limit(50)`.                                  |

## 9. Weryfikacja

- Vitest: `src/lib/media`, `src/lib/__tests__/cropSizes.test.ts`,
  `src/routes` - 249 plików, 8 574 testy zielone (83 `it.fails` bez zmian);
  `src/components/admin/media` - 27 plików zielone; pliki z §1-§3 zielone.
- Bramki: `check:rpc-contract`, `check:sql-tenant-scope`,
  `check:sql-owner-tenant-scope`, `check:sql-policy-tenant-regression`,
  `check:sql-migration-replay`, `check:types-freshness`, `check:i18n-parity`,
  `check:i18n-hardcoded`, `check:i18n-default-value`,
  `check:i18n-overlay-imports` (baseline `MediaUsageList.tsx` 9 -> 0),
  `check:unknown-casts`, `check:stale-never-casts`, `check:db-row-casts`,
  `check:tenant-isolation`, `check:sql-app-role`, `check:sql-anon-insert`,
  `check:dangerous-html`, `check:module-singletons` - zielone.
- ESLint i Prettier na zmienionych plikach - czyste.
- Pokrycie przepisanych modułów: `typographyApply.functions.ts` i
  `mediaPage.ts` 100%, `iconLibrary.ts` 99/95/100/99, `useMediaData.ts`
  100/90/100/100 (instrukcje/gałęzie/funkcje/linie).
