## Cel
Odwzorować stronę PL/EN `/wydarzenia` (na podstawie `neweuropeanstrategies.com/wydarzenia/`) na naszym CMS Builderze, dodać brakujące widgety i uzupełnić bibliotekę mediów o obrazy sekcji.

## Zakres referencji
Referencyjna strona składa się z 4 sekcji:
1. **Spotkania Chatham House** - animowany nagłówek + counters (3 / 23 / 9) + slider "NADCHODZĄCE" + slider "POPRZEDNIE"
2. **Spotkania Bonjour Diplomacy** - animowany nagłówek + counters (5 / 30 / 12) + slider "NADCHODZĄCE" + slider "POPRZEDNIE"
3. **Konferencja Geopolityczna Gra Mocarstw** - animowany nagłówek + counters (4 / 48 / 72 / 900) + slider poprzednich edycji
4. **Konferencja Bezpieczeństwa Międzynarodowego** (jeśli wystąpi w reszcie HTML) - analogicznie

## Brakujące widgety w naszym Builderze
- **`counter`** - animowany licznik (from-value → to-value w `data-duration` ms) z etykietą, prefiksem, sufiksem, i18n dla etykiety.
  - Schemat: `type: "counter"`, category `basic`, ikona `Hash`
  - Pola: `value`(number), `label_pl`, `label_en`, `prefix`, `suffix`, `durationMs`, `align`, `accentColor`
  - Render: IntersectionObserver, animacja liczby przy wejściu w viewport, `prefers-reduced-motion` = statyczna wartość.
  - Test wizualnej regresji dark/light + a11y.
- Istniejący widget **`slider`** (source `custom`, items = obrazy z biblioteki) pokryje karuzele nadchodzących/poprzednich spotkań - autoplay + strzałki + fade.
- Istniejący **`animated-heading`** (mode: `highlight`, shape: `underline`/`double_underline`) pokryje elementorowe animowane nagłówki.

## Media
Sprawdzenie biblioteki: obecny jest tylko `Geopolitics-and-military-affairs.webp`. Brakuje:
- `Dyplomacja.webp`, `9.webp`, `7.webp`, `Przykladowe-BD.webp`, `Geopolityczna-Gra-Mocarstw.webp` i pochodne.

**Plan mediów:** pobrać brakujące obrazy z `i0.wp.com/neweuropeanstrategies.com/wp-content/uploads/2024/03/*` przez `lovable-assets` → wgrać do `public.media` z odpowiednim `tenant_id` i `folder_path='/wydarzenia'`. Bez tego slidery pokażą placeholdery.

## Zmiany w kodzie
1. `src/lib/builder/registry.tsx` - wpis `counter` w kategorii `basic` z defaultami.
2. `src/lib/builder/schemas.ts` - `counter: [...]` z polami edytora.
3. `src/components/admin/builder/ui/organisms/widget-view/SimpleWidgets.tsx` - `case "counter"` z komponentem animowanym.
4. `src/components/admin/builder/ui/organisms/widget-view/__tests__/*` - test snapshot + a11y.
5. Migracja danych (SQL update `pages.builder_data` dla `id=e96accd7-…` PL i `80bdad7d-…` EN) - kompletny JSON 4 sekcji z counterami i sliderami, i18n równolegle w polach `*_pl` / `*_en`.
6. Wpisy w `public.media` dla obrazów sekcji (po uploadzie).

## Kolejność implementacji
1. Widget `counter` (kod + schemat + widok + test).
2. Upload obrazów do biblioteki mediów.
3. Podmiana `builder_data` na `/wydarzenia` (PL + EN).
4. Weryfikacja Playwright: `/wydarzenia` i `/en/wydarzenia` renderują 4 sekcje, counters animują się przy scrollu, slidery działają w publikacji i w Builderze (tabs/klik whitelist).

## Uwaga (potrzebna decyzja)
Obrazy z domeny WordPressa mają licencję nieznaną poza projektem klienta. Zakładam, że mogę je przenieść 1:1 do naszej biblioteki mediów (są to Twoje zasoby ze starej strony). Jeśli wolisz świeże zdjęcia lub grafiki generowane - powiedz, wtedy zamiast fetchu wygeneruję asset packa spójny z naszym layoutem.
