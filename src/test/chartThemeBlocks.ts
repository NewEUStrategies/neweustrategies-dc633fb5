// Pomocnik testów: bloki tokenów motywu jasnego, ciemnego i druku TAK, JAK WIDZI JE STRONA
// Z WYKRESEM.
//
// Paleta `--chart-*` stoi w arkuszu wykresów (`src/components/charts/chart-tokens.css`,
// ładowanym przez `<ChartStylesheet />`), a tokeny powierzchni, wobec których jest mierzona
// (`--card`, `--foreground`, `--muted-foreground`...), w arkuszu głównym (`src/styles.css`).
// Bramki palety, ról, geometrii i map czytają oba rodzaje, więc blok motywu to sklejenie
// zakresu z arkusza głównego i zakresu z arkusza wykresów. Nazwy się nie powtarzają
// (arkusz główny nie deklaruje `--chart-*` - src/lib/ci/__tests__/chartSheetMounts.test.ts),
// więc pierwsze trafienie wyrażenia regularnego jest jedynym.
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

/** Wycinek od znacznika `from` do znacznika `to` za nim (`null` = do końca pliku). */
function between(css: string, path: string, from: string, to: string | null): string {
  const start = css.indexOf(from);
  if (start < 0) throw new Error(`${path}: brak znacznika ${from}`);
  if (to === null) return css.slice(start);
  const end = css.indexOf(to, start);
  if (end < 0) throw new Error(`${path}: brak znacznika ${to}`);
  return css.slice(start, end);
}

const STYLES_PATH = "src/styles.css";
const TOKENS_PATH = "src/components/charts/chart-tokens.css";
const CHARTS_PATH = "src/components/charts/charts.css";

const STYLES = read(STYLES_PATH);
const TOKENS = read(TOKENS_PATH);
const CHARTS = read(CHARTS_PATH);

/** `:root, .light` arkusza głównego + `:root, .light` tokenów wykresów. */
export const LIGHT_TOKENS =
  between(STYLES, STYLES_PATH, ":root,", ".dark {") +
  "\n" +
  between(TOKENS, TOKENS_PATH, ":root,", ".dark {");

/** `.dark` arkusza głównego (do `@layer base`) + `.dark` tokenów wykresów (do końca pliku). */
export const DARK_TOKENS =
  between(STYLES, STYLES_PATH, ".dark {", "@layer base") +
  "\n" +
  between(TOKENS, TOKENS_PATH, ".dark {", null);

/** Blok `@media print` silnika wykresów (jasne tokeny w zasięgu `.dark`). */
export const PRINT_TOKENS = between(CHARTS, CHARTS_PATH, "@media print {", null);
