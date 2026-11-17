// Nazwa ikony w katalogu (`iconNames.generated.json`, porcje `icons-N`) dla
// klucza PascalCase `DynamicIcon`: `AlarmClockCheck` -> `alarm-clock-check`,
// `Grid2x2` -> `grid-2x-2` (porcja danych sama dociąga wariant `grid-2x2`).
//
// Wspólna dla porcji danych (`lazyNamedIcon` - pod tą nazwą szuka węzła
// i tworzy komponent `createLucideIcon(nazwa)`, który dostaje klasę
// `lucide-<nazwa>`) i dla `DynamicIcon` (rozpoznaje po tej klasie, że SVG
// z DOM-u serwera to ikona TEJ nazwy, a nie znak zapytania innego wywołania).
// Osobny moduł: `DynamicIcon` jest w chunku startowym, porcja danych - nie.
export function catalogIconName(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-zA-Z])([0-9])/g, "$1-$2")
    .toLowerCase();
}
