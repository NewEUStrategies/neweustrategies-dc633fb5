## Cel

Jeden picker kolorów na całą platformę = `AdminColorPicker` (popover z podglądem, HEX/RGB/HSL, react-colorful) — taki sam jak w `/admin/category-colors` po ostatniej zmianie. Znika systemowy popup przeglądarki.

## Zakres — 17 miejsc do podmiany

Builder widget properties (5 plików):
- `AccountLinkEditor.tsx` — 3× swatche kolorów
- `MegaMenuEditor.tsx` — 1×
- `SliderEditor.tsx` — 3×
- `SectionLabelEditor.tsx` — 3×
- `SchemaFieldControl.tsx` — generyczny renderer pola koloru (1×)

Panele Theme / Global / Newsletter (4 pliki):
- `GlobalColorsEditor.tsx` — 2×
- `ThemeOptionsPane.tsx` — 2×
- `ThemeBackgroundsPane.tsx` — 1×
- `newsletter/builder/PropertiesPanel.tsx` — 1×

Trasy admin (1 plik):
- `admin.web-stories.tsx` — 1×

Atomy buildera już delegują do `AdminColorPicker` (`ColorInput`, `ColorField`) — zostają.

## Zasady podmiany

1. `<input type="color" value={x} onChange=... />` + towarzyszący text `Input` z HEX → jeden `<AdminColorPicker value={x} onChange={v => setX(v ?? "")} />`.
2. Jeśli obok był dedykowany przycisk „reset do domyślnego" — mapujemy na wbudowane `allowReset` pickera; jeśli logika resetu jest inna (np. do rekomendowanego koloru z presetu), zostawiamy osobny przycisk i wyłączamy `allowReset={false}`.
3. Kolor obowiązkowy (nie może być `undefined`) — użycie `onChange={v => setX(v ?? fallback)}`, `allowTransparent={false}`, `allowReset={false}`.
4. Kolor opcjonalny (dziedziczony/token) — `allowTransparent={true}`, `allowReset={true}`, opcjonalnie `inheritedValue` żeby pokazywać dziedziczoną wartość jako placeholder.
5. Zero zmian w logice biznesowej / stanie / walidacji — tylko warstwa UI.
6. Reguły w `styles.css` z `input:not([type="color"])` zostają — nie kolidują (nie ma już natywnych kolorów, ale selektor jest nadal poprawny i bezpieczny).

## Weryfikacja

- `rg "type=\"color\"" src/components src/routes` po zmianach → 0 trafień poza `styles.css`, `ThemeOptionsStyle.tsx`, `globalColors.ts` (selektory CSS, nie inputy).
- Build ok, brak nowych błędów TS.
- Ręczny przegląd screenshotów: builder widget properties, Global Colors, Theme Options, Newsletter, web-stories.

## Szacunkowy rozmiar

~10 plików, głównie mechaniczna podmiana JSX. Bez migracji DB, bez zmian typów. Wysokie ryzyko regresji tylko przy „resetach do preseta" — te robimy ręcznie z zachowaniem istniejącego zachowania.
