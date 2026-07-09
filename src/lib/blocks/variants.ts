// Rejestr wariantów bloków — używany przez toolbar Gutenberg-style
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
    { key: "minimal", label: "Minimalna" },
  ],
};

export function getBlockVariants(type: string): BlockVariantOption[] | null {
  return BLOCK_VARIANTS[type] ?? null;
}
