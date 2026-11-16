// Arkusz wykresów jako zasób React 19 (`<link precedence>` w renderze), NIE import CSS z boku.
//
// Reguły silnika, paleta `--chart-*` obu motywów, druk wykresu i reguły "digital features"
// nie jadą już w arkuszu głównym (blokującym każdą stronę), tylko w `chart-sheet.css`. Ten
// komponent renderuje każdy moduł, który maluje tą powierzchnią - klasą wykresu albo tokenem
// `--chart-*` (w `style`, atrybucie SVG, klasie Tailwinda `[var(--chart-...)]`, odczycie
// `getComputedStyle`). Pilnuje tego src/lib/ci/__tests__/chartSheetMounts.test.ts.
//
// Mechanika jak w `components/maps/WorldMap.tsx`: serwer hoistuje link do `<head>` (powłoka)
// albo wstrzymuje odsłonięcie granicy strumienia do `onload`, klient wstrzymuje commit, aż
// arkusz się wczyta - wykres nigdy nie maluje się bez stylów. React deduplikuje zasób po
// `href`, więc wiele wykresów na stronie to jedno żądanie. `precedence="default"` to grupa
// arkusza głównego (TanStack nadaje ją linkom z `head()`), więc arkusz wykresów staje za nim,
// a przed grupami arkuszy widgetów (`builder`, `nes-widgets`) - tak jak reguły wykresów stały
// dotąd w arkuszu głównym przed nimi. `?url` zostawia plik w potoku CSS Vite (lightningcss,
// rozwinięte `@import`, cel przeglądarek z `cssTarget`).
import chartSheetUrl from "./chart-sheet.css?url";

export function ChartStylesheet() {
  return <link rel="stylesheet" href={chartSheetUrl} precedence="default" />;
}
