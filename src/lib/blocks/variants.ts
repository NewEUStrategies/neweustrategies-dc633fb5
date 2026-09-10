// Rejestr wariantów bloków - używany przez toolbar Gutenberg-style
// nad aktywnym blokiem (SortableBlockItem). Pozwala szybko przełączyć
// wariant (np. "card" ↔ "split") bez otwierania panelu ustawień.

export interface BlockVariantOption {
  key: string;
  label: string;
}

// Klucz mapy = Block.type. Wartość = lista wariantów zapisywanych do
// block.data.variant. Blok bez wpisu = brak toolbara wariantów.
export const BLOCK_VARIANTS: Record<string, BlockVariantOption[]> = {
  "author-bio": [
    { key: "card", label: "Karta" },
    { key: "split", label: "Split" },
    { key: "inline", label: "Inline" },
    { key: "profile", label: "Karta profilu" },
  ],

  // Cytat: warianty spójne z rendererem `renderQuote` i edytorem `QuoteBlock`.
  quote: [
    { key: "default", label: "Border" },
    { key: "plain", label: "Plain" },
    { key: "card", label: "Karta" },
    { key: "minimal", label: "Minimal" },
  ],
  // Szybkie przełączanie rodzaju wykresu. Toolbar zapisuje data.variant;
  // parseChartConfig czyta variant z pierwszeństwem nad kind (o ile variant
  // JEST znanym rodzajem), a edytor wykresu utrzymuje oba klucze w zgodzie.
  //
  // LISTA MUSI OBEJMOWAĆ KAŻDY RODZAJ Z `CHART_KINDS`, i nie jest to kwestia
  // wygody. Toolbar zapisuje `variant`, a `variant` ma pierwszeństwo - więc
  // rodzaj, którego na tej liście nie ma, jest z toolbara NIEOSIĄGALNY, a przy
  // okazji nie da się do niego wrócić po jednym kliknięciu w inny wariant.
  // Tak było z mostkiem: siedział w typie i w edytorze bloku, ale nie tutaj,
  // więc toolbar pokazywał sześć wariantów i żaden nie był aktywny.
  // Zgodności pilnuje bramka `src/lib/charts/__tests__/chartKinds.test.ts`.
  chart: [
    { key: "bar", label: "Kolumny" },
    { key: "bar-horizontal", label: "Słupki" },
    { key: "line", label: "Linia" },
    { key: "area", label: "Pole" },
    { key: "pie", label: "Kołowy" },
    { key: "donut", label: "Pierścień" },
    { key: "waterfall", label: "Wodospad" },
    { key: "histogram", label: "Histogram" },
    { key: "boxplot", label: "Boxplot" },
    { key: "beeswarm", label: "Rój (beeswarm)" },
    { key: "scatter", label: "Punktowy" },
  ],
};

export function getBlockVariants(type: string): BlockVariantOption[] | null {
  return BLOCK_VARIANTS[type] ?? null;
}

/** Tokeny kolorystyki bloku (block.data.colorPalette) - te same, których
 *  używa publiczny renderer, żeby podgląd 1:1 zgadzał się ze stroną. */
export const BLOCK_PALETTE_KEYS = [
  "neutral",
  "brand",
  "primary",
  "accent",
  "success",
  "warning",
  "danger",
] as const;

export type BlockPaletteKey = (typeof BLOCK_PALETTE_KEYS)[number];

export const BLOCK_PALETTE_VAR: Record<string, string> = {
  neutral: "var(--foreground)",
  brand: "var(--brand, var(--primary))",
  primary: "var(--primary)",
  accent: "var(--accent-foreground, var(--primary))",
  success: "var(--success, #16a34a)",
  warning: "var(--warning, #d97706)",
  danger: "var(--destructive)",
};

/** Typy bloków, których kolorystyka jest edytowana z toolbara widgetu. */
const PALETTE_TYPES = new Set(["quote"]);

export function hasBlockPalette(type: string): boolean {
  return PALETTE_TYPES.has(type);
}
