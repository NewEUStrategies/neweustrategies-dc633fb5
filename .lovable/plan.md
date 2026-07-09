## Cel

W panelu **Ustawienia motywu** (`ThemeOptionsPane`) etykieta "Style treści" ma zostać zamieniona na **"Rozmiary czcionek" / "Font sizes"**, a wewnątrz pojawi się nowa, spójna z resztą admina, sekcja globalnych rozmiarów typografii.

Ponieważ obecna zakładka "Style treści" (`ThemeDesignPane`) już zawiera bardzo dużo ustawień niezwiązanych z rozmiarami czcionek (nagłówki bloków, "read more", meta, mode switch, karuzele, socials itp.), rozdzielam ją od nowej sekcji, żeby niczego nie stracić i utrzymać jasną nawigację.

## Zmiany UI/nawigacja

- W `SECTIONS` w `src/components/admin/ThemeOptionsPane.tsx`:
  - Zmieniam ID i label istniejącego wpisu `design` -> `font_sizes` (`themeOptions.sections.fontSizes`) i tam ląduje nowa sekcja rozmiarów czcionek (to jest element, który user zaznaczył).
  - Dotychczasowy pełny `ThemeDesignPane` (nagłówki bloków, karuzele itp.) trafia pod nowe ID `design_advanced` z etykietą "Style treści (zaawansowane)" / "Advanced content styling", tuż obok - żeby zachować dostęp do wszystkich obecnych ustawień bez zmian.
- Dodaję tłumaczenia PL/EN: `themeOptions.sections.fontSizes` = "Rozmiary czcionek" / "Font sizes", oraz odpowiednie stringi do nowej sekcji.

## Nowa sekcja "Rozmiary czcionek"

Nowy komponent `ThemeFontSizesPane` z formularzem po lewej + live preview po prawej (spójne z ToC/Key Takeaways). Kontrolki:

Typografia bazowa:
- Body (px + line-height)
- Small / caption
- Lead (wprowadzenie)
- Blockquote
- Code / inline code

Nagłówki (dwie kolumny: **desktop** + **mobile**, wspólna waga i line-height):
- H1, H2, H3, H4, H5, H6 - font-size (px), line-height, letter-spacing, font-weight, textTransform

Wszystko jako liczby (px) z użyciem istniejącego atomu `NumberInput` / `StepperInput` z buildera. Sekcja "Reset do domyślnych" i przyciski Save (spójne z pozostałymi zakładkami motywu).

## Model danych

- Nowe site_setting: `font_sizes` (JSONB), schema Zod z bezpiecznymi defaultami:

```text
{
  body:   { size: 16, lineHeight: 1.6 },
  small:  { size: 13, lineHeight: 1.5 },
  lead:   { size: 18, lineHeight: 1.6 },
  blockquote: { size: 18, lineHeight: 1.55 },
  code:   { size: 14 },
  headings: {
    h1: { desktop: 40, mobile: 30, lineHeight: 1.15, letterSpacing: 0, weight: 800, transform: 'none' },
    h2: { desktop: 32, mobile: 26, ... },
    h3: { desktop: 26, mobile: 22, ... },
    h4: { desktop: 22, mobile: 19, ... },
    h5: { desktop: 18, mobile: 17, ... },
    h6: { desktop: 16, mobile: 15, ... }
  }
}
```

- Hook `useFontSizes` + `useSaveFontSizes` w `src/lib/theme/fontSizes.ts` (analogicznie do `themeDesign`).
- Nowy plik `src/components/ThemeFontSizesStyle.tsx` (mount w root layoucie, obok istniejącego `ThemeDesignStyle`) wypuszcza globalne zmienne CSS:

```text
:root {
  --fs-body, --lh-body, --fs-small, --fs-lead, --fs-blockquote, --fs-code,
  --fs-h1, --fs-h2, --fs-h3, --fs-h4, --fs-h5, --fs-h6,
  --lh-h1..h6, --ls-h1..h6, --fw-h1..h6, --tt-h1..h6
}
@media (max-width: 768px) { :root { --fs-h1..h6: mobile values } }
```

## Propagacja tokenów

- W `src/styles.css` mapuję `h1..h6`, `body`, `.lead`, `blockquote`, `code`, `.cms-post-content h1..h6` do nowych zmiennych (`font-size: var(--fs-h1)` itd.) z fallbackiem do obecnych wartości, żeby nie zepsuć istniejącego wyglądu. Zachowuję priorytet nadpisań per-wpis (`--td-*`), które już istnieją.
- Renderer bloków treści (`BlocksRenderer`) już czyta klasy `.cms-*` - nowe zmienne zaczną obowiązywać automatycznie.

## i18n

- Nowe klucze w `src/lib/locale/pl.ts` i `en.ts`:
  - `themeOptions.sections.fontSizes`
  - `themeOptions.sections.contentStylingAdvanced`
  - `themeOptions.fontSizes.*` (etykiety pól, opisy, sekcje)

## Bezpieczeństwo / typy

- Zero `any`, pełna walidacja Zod, sanity clampy (H1 12-96 px, body 12-24 px itd.), krok 1 px.
- Zapis idzie przez istniejący RLS'owy zapis `site_settings` (bez zmian w bazie/migracjach).

## Testy

- `src/lib/theme/__tests__/fontSizes.test.ts`: walidacja defaultów, clampów i generowanego CSS.
- Test renderu `ThemeFontSizesPane`: podstawowe kontrolki + reset przywraca defaulty.

## Weryfikacja

Po wdrożeniu: build, typecheck, oraz szybki podgląd zakładki "Rozmiary czcionek" w admin motywu (live preview typografii + wpływ na stronę wpisu).
