# Wdrożenie: karta profilu autora - odwzorowanie wzorca, ustawienia w obu builderach, baza wewnętrzna ekspertów (2026-08-04)

Mandat: wariant „karta profilu" widgetu autora ma być wdrożony w naszym CMS - w builderze
Elementor-like **i** w block editorze (Gutenberg) - jako **odwzorowanie** wklejonego wzorca,
z **edycją w ustawieniach** i z **identyfikacją bazy wewnętrznej ekspertów** (dziś ponad 40
profili, wszyscy z New European Strategies). Platformowe **6 px rounding** obowiązuje, a
Twitter to **X**.

Fundament (komponent `ProfileCard`, widget `author-profile-card`, wariant `profile` bloku
`author-bio`, hydratacja danych eksperta) istniał; ta rewizja domyka trzy braki: wygląd nie
był odwzorowaniem tylko parafrazą, prezentacja nie miała ANI JEDNEGO ustawienia, a wybór
osoby szedł przez zwykły `<select>` po katalogu publicznym.

## 1. Odwzorowanie: co jest z wzorca, co świadomie nie

`src/components/ui/profile-card.tsx` renderuje układ wzorca:

- kwadratowy portret **470 px** (poprzednio kolumna 320 px),
- karta **nachodząca na zdjęcie od prawej** o 80 px (poprzednio 40 px),
- `shadow-2xl`, padding `p-8`, nazwisko `text-2xl font-bold`, opis `text-base leading-relaxed`,
- **wypełnione** przyciski social 48 px z ikoną w kontrze (poprzednio 32 px obrys),
- mobile: zdjęcie nad **wyśrodkowaną** treścią,
- animacja wejścia (desktop z prawej, mobile z dołu).

Świadome odstępstwa - każde wymuszone przez system albo stack, nie przez wygodę:

| Wzorzec                        | U nas                               | Dlaczego                                                            |
| ------------------------------ | ----------------------------------- | ------------------------------------------------------------------- |
| `rounded-3xl` (24 px)          | `rounded-[6px]`                     | platformowe zaokrąglenie - jedno w całym systemie                   |
| `rounded-full` na social       | `rounded-[6px]`                     | jw. (kółka są jedynym miejscem, gdzie wzorzec łamał własną siatkę)  |
| `framer-motion`                | klasy CSS `.pc-rise-x/.pc-rise-y`   | biblioteki nie ma w projekcie; jedno wejście CSS robi bez kosztu JS |
| `next/image`, `next/link`      | `<img>`, `AppLink`                  | stack to TanStack Start, `next` nie jest zależnością                |
| `Twitter` z lucide             | logotyp **X** (`XIcon`)             | Twitter to X - także w etykietach panelu                            |
| `bg-gray-900 dark:bg-gray-100` | `bg-foreground` / `text-background` | tokeny semantyczne = dark mode bez drugiej ścieżki                  |

Animacja siedzi w `src/styles.css` (`@keyframes pc-rise-x|y`) i gaśnie pod
`prefers-reduced-motion: reduce` - tak jak reszta ruchu na platformie.

## 2. Ustawienia: jeden czytnik dla obu edytorów

`src/lib/builder/profileCardStyle.ts` to jedyne miejsce, które tłumaczy treść dokumentu na
propsy karty. Czyta **osiem** kluczy: `imageSize`, `overlap`, `cardMaxWidth`, `shadow`,
`socialStyle`, `socialSize`, `mobileAlign`, `animate`.

Trzy zasady, które ten moduł utrzymuje:

- **puste pole liczbowe ≠ zero** - pusty input oznacza „użyj domyślnej", nie „0 px",
- **wartość spoza zakresu wraca do granicy** (ten sam clamp co `min`/`max` w panelu), więc
  ręczna edycja JSON-a albo stary dokument nie rozjeżdżają układu,
- **odczyt bezwarunkowy** - wszystkie klucze czytane naraz, bo bramka wierności ustawień
  liczy odczyty przez Proxy; skrócony odczyt (`??`) ukryłby resztę pól jako „martwe".

Gdzie to widać:

- builder Elementor-like: `WIDGET_SCHEMAS["author-profile-card"]` (grupa „Prezentacja”) →
  `AuthorProfileCardWidget` → `ProfileCard`; nowe wpisy dostają wymiary wzorca z
  `WIDGETS.defaults`,
- block editor: `ProfileVariantSettings` (panel bloku, widoczny tylko dla wariantu
  „Karta profilu") → `renderAuthorBio` → `AuthorBioView` → `ProfileCard`.

**Te same nazwy kluczy po obu stronach** - dokument przeniesiony między edytorami wygląda
identycznie, a dołożenie ustawienia po jednej stronie nie może po cichu ominąć drugiej.
Podgląd w obu panelach renderuje ten sam komponent co strona publiczna.

Bramki CI: `settingsFidelity.gate` (219 przypadków) potwierdza, że każde nowe pole panelu
jest realnie czytane przez renderer; `labelsEn` wymusiło komplet tłumaczeń EN dla nowych
etykiet, podpowiedzi i opcji.

## 3. Baza wewnętrzna ekspertów zamiast listy identyfikatorów

`src/lib/experts/internalBase.ts` scala po `user_id` trzy sygnały:

1. odznaka `expert` (`profile_badges`) → `isExpert`,
2. profil autorski (`author_profiles`) → stanowisko, organizacja, `isPublic`,
3. role redakcyjne (`admin_list_users`) → osoby jeszcze bez profilu autorskiego.

Publiczny katalog (`expertsDirectoryQueryOptions`) do wyboru osoby **nie wystarczał**:
pokazuje wyłącznie profile z odznaką ORAZ `is_public`, więc redakcja nie mogła wskazać
kogoś, czyj profil czeka na publikację - i nie widziała, że taka osoba w bazie jest.
`admin_list_users` jest dostępne tylko dla admina tenanta; dla staffu bez tej roli lista
schodzi na widok publiczny i **mówi to wprost** (`restricted`), zamiast udawać, że baza
jest mniejsza.

`src/components/admin/experts/ExpertPicker.tsx` zastępuje `<select>` w OBU edytorach
(`ExpertLinkPanel` w builderze, wybór autora w bloku `author-bio`):

- wyszukiwarka po nazwisku, stanowisku, organizacji i slugu,
- wiersz ze zdjęciem, stanowiskiem i odznakami („ekspert", „profil niepubliczny"),
- stopka z realną wielkością bazy: „Baza wewnętrzna: N osób · M z odznaką «ekspert»"
  (polska odmiana liczebnika), plus komunikat o ograniczeniu uprawnień.

Wybór osoby nadal **hydratuje** treść widgetu (`@/lib/experts/hydration`), więc renderer
nie robi zapytań sieciowych, a redakcja może nadpisać dowolne pole ręcznie.

## 4. Testy

`src/components/admin/builder/__tests__/authorProfileCardParity.test.tsx` zamyka dwie klasy
defektu naraz:

- **odwzorowanie rozjeżdżające się z wzorcem** - test pilnuje jednocześnie układu wzorca
  (rozmiar zdjęcia, nakładka, cień, wypełnione social, animacja) i platformowego 6 px
  (`rounded-3xl`/`rounded-full` w DOM = porażka), więc „poprawka" w dowolną stronę pali się,
- **dwa edytory, dwa wyglądy** - ten sam zestaw ustawień jedzie przez widget i przez blok,
  a test porównuje realny DOM obu ścieżek (klasy karty, `margin-left`, szerokości).

Dodatkowo: clamp wartości spoza zakresu, precedencja `animate`, komplet pól prezentacji w
panelu (lista kluczy brana z `PROFILE_CARD_STYLE_KEYS`, nie przepisana ręcznie) i filtr
bazy wewnętrznej.
