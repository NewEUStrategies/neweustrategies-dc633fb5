# Plan: Light/Dark mode per widget w CMS Builderze

## Cel
Każdy widget (i sekcja, i kolumna) ma mieć osobne wartości stylów dla trybu jasnego i ciemnego. Domyślnie korzysta z Global Colors (semantic tokens `--gc-*`, które już teraz automatycznie przełączają się z klasą `.dark`). Użytkownik może nadpisać dowolne pole osobno dla light i dark, oraz zresetować je z powrotem do globalnego.

## Model danych

Wprowadzamy nowy wrapper analogiczny do istniejącego `ResponsiveValue<T>`:

```ts
// src/lib/builder/types.ts
export type Mode = "light" | "dark";
export interface ThemedValue<T> { light?: T; dark?: T }
export type Themed<T> = T | ThemedValue<T>;
```

`CommonStyle` rozszerzamy tak, by **wszystkie pola wizualne** (kolory, tła, typografia, spacing, border) mogły być `Themed<...>`:

```ts
interface CommonStyle {
  bgColor?: Themed<string>;
  textColor?: Themed<string>;
  borderColor?: Themed<string>;
  borderWidth?: Themed<string>;
  borderStyle?: Themed<...>;
  borderRadius?: Themed<string>;
  boxShadow?: Themed<string>;
  bgImage?: Themed<string>;            // nowe
  bgGradient?: Themed<string>;         // nowe
  padding?: Themed<ResponsiveValue<string>>;
  margin?: Themed<ResponsiveValue<string>>;
  typography?: Themed<WidgetTypography>;
  hover?: Themed<HoverStyle>;
  ...
}
```

Brak migracji DB — `data` jest `jsonb`, stare dokumenty (płaskie wartości) pozostają zgodne dzięki narzutowi `Themed<T> = T | { light?, dark? }`.

## Logika pick (frame.ts)

```ts
const pickMode = <T>(v: Themed<T> | undefined, mode: Mode): T | undefined => {
  if (v == null) return undefined;
  if (typeof v === "object" && ("light" in v || "dark" in v)) {
    return (v as ThemedValue<T>)[mode] ?? (v as ThemedValue<T>).light;
  }
  return v as T;
};
```

`styleToCSS(style, device, mode)` najpierw `pickMode`, potem dotychczasowy `pick` dla device. Dla pól pozostawionych pusto fallback do `var(--gc-*)` (tj. style w ogóle nie jest emitowany → element dziedziczy z global colors).

## UI

### 1. Globalny przełącznik trybu w Toolbar
W `Builder.tsx` dodajemy `mode: Mode` (obok `device`). W `Toolbar` segmented control Light/Dark obok desktop/tablet/mobile. Canvas dostaje klasę `dark` warunkowo, więc semantic tokens (`--gc-*`, `--background`, itp.) automatycznie się przełączają. `mode` propagowany do property panes i widget renderer.

### 2. Zakładki Light/Dark w panelu Styl
W `WidgetProperties.tsx` i `SectionProperties.tsx` u góry zakładki **Styl** dodajemy mały segmented (Light/Dark). Wybór synchronizuje się z globalnym przełącznikiem (zmiana w jednym miejscu zmienia drugi). Pod spodem zostają istniejące kontrolki — czytają/zapisują wartość przez `pickMode(value, mode)` i `setMode(value, mode, newVal)`.

### 3. Nowy atom: `ThemedInput` / `useThemedField`
Hook `useThemedField(value, mode, onChange)` zwracający `[current, setCurrent, { isOverridden, reset }]`. Wszystkie istniejące kontrolki (`ColorField`, `SpacingControl`, `TypographyControl`, `HoverControl`, `BorderControl`) opakowujemy nim w jednym miejscu zamiast przerabiać każdą.

### 4. Reset per pole
Obok każdego pola w panelu Styl mała kropka-badge gdy wartość jest nadpisana w aktualnym trybie + ikona ↺ (reset) ustawiająca `value[mode] = undefined` (jeśli oba puste — usuwa cały klucz). Tooltip: „Wróć do Global Colors”.

### 5. Placeholder z Global Colors
W `ColorField` gdy pole jest puste pokazujemy podgląd aktualnego tokenu (`--gc-body-bg`) jako placeholder swatcha + napis „z Global Colors”. Sekcja palet w pickerze już listuje `GLOBAL_COLOR_GROUPS` — dodajemy kliknięcie „Użyj tokenu” które zapisuje `var(--gc-key)` zamiast surowego hex (dzięki temu zmiana global colors automatycznie się propaguje).

## Renderer

`SectionView` / `WidgetView` / `ColumnView` przyjmują `mode` (z kontekstu builder podglądu) i przekazują do `styleToCSS`. Na froncie publicznym `mode` wynika z `document.documentElement.classList.contains('dark')` — używamy `useEffect` z `MutationObserver` lub istniejącego hooka, jeśli jest. **Lepiej:** emitujemy dwa bloki CSS (light + dark) per widget z unikalnym `data-wid="..."` i selektorem `.dark [data-wid="..."] { ... }` — zero JS, działa SSR.

## Pliki do zmiany / utworzenia

**Zmiana:**
- `src/lib/builder/types.ts` — `ThemedValue`, `Themed<T>`, rozszerzenie `CommonStyle`
- `src/components/admin/builder/ui/organisms/widget-view/frame.ts` — `pickMode`, `styleToCSS(mode)`, emisja CSS per mode
- `src/components/admin/builder/Builder.tsx` — `mode` state + propagacja
- `src/components/admin/builder/ui/organisms/Toolbar.tsx` — przełącznik Light/Dark
- `src/components/admin/builder/WidgetProperties.tsx` — zakładki Light/Dark + badge override
- `src/components/admin/builder/ui/organisms/section-properties/StylePane.tsx` — to samo dla sekcji
- `src/components/admin/builder/ColumnProperties.tsx` — to samo dla kolumn
- `src/components/admin/builder/ui/molecules/ColorField.tsx` — placeholder z tokenem + przycisk „Użyj tokenu”

**Nowe:**
- `src/lib/builder/themed.ts` — helpery `pickMode`, `setMode`, `isOverridden`, `resetMode`
- `src/components/admin/builder/ui/atoms/ThemedField.tsx` — wrapper UI (badge + reset)
- `src/components/admin/builder/ui/atoms/ModeSwitch.tsx` — segmented Light/Dark

## Wstecz-kompatybilność
- Stare dokumenty (płaskie wartości) działają bez zmian — `pickMode` zwraca je jak są dla obu trybów.
- Pierwsza edycja w trybie dark automatycznie migruje pole do `{ light: oldValue, dark: newValue }`.
- Brak migracji SQL.

## Poza zakresem (świadomie)
- Eksport CSS na publicznej stronie pozostaje statyczny (klasa `.dark` na `<html>`); nie ruszamy mechanizmu przełączania trybu po stronie odwiedzającego.
- Nie ruszamy edytora Global Colors — ten już obsługuje light/dark.
- Animacje przejść między trybami zostawiamy na CSS `transition` w istniejących tokenach.
