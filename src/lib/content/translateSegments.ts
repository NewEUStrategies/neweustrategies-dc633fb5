// Segmentacja wpisu do tłumaczenia AI PL->EN (B4) - czysta, testowalna
// jednostkowo. Zbiera WSZYSTKIE teksty wpisu (metadane + treść bloków) w
// płaską listę segmentów i umie odłożyć przetłumaczoną listę z powrotem
// w te same miejsca (apply), z zachowaniem struktury dokumentu 1:1.
//
// Bloki: tłumaczymy wyłącznie pola tekstowe znanych typów (whitelist niżej) -
// URL-e, konfiguracje i dane wykresów przechodzą bez zmian. Nieznane typy
// bloków są kopiowane bez ingerencji (struktura wspólna PL/EN).
import type { Block } from "@/lib/blocks/types";

export interface TranslateInput {
  title_pl: string;
  excerpt_pl: string | null;
  takeaways_pl: string[];
  seo_title_pl: string | null;
  seo_description_pl: string | null;
  /** Treść trybów richtext/markdown (HTML/MD). */
  content_pl: string | null;
  /** Bloki dokumentu PL (edytor blokowy). */
  blocks_pl: Block[] | null;
}

export interface TranslateOutput {
  title_en: string;
  excerpt_en: string | null;
  takeaways_en: string[];
  seo_title_en: string | null;
  seo_description_en: string | null;
  content_en: string | null;
  blocks_en: Block[] | null;
}

/** Twardy limit łącznej długości segmentów (ochrona kosztów i limitów API). */
export const MAX_TOTAL_CHARS = 120_000;

type Slot = (translated: string) => void;

interface Collector {
  texts: string[];
  slots: Slot[];
  push(text: string, slot: Slot): void;
}

function collector(): Collector {
  const texts: string[] = [];
  const slots: Slot[] = [];
  return {
    texts,
    slots,
    push(text, slot) {
      texts.push(text);
      slots.push(slot);
    },
  };
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Rejestruje pola tekstowe bloku w kolektorze. Mutuje KOPIĘ bloku (deep copy
 * robi buildSegments), więc oryginalny dokument PL zostaje nietknięty.
 */
function collectBlockTexts(block: Block, col: Collector): void {
  const data = block.data as Record<string, unknown>;
  const bind = (key: string) => {
    const value = data[key];
    if (isNonEmpty(value)) col.push(value, (tr) => (data[key] = tr));
  };
  switch (block.type) {
    case "paragraph":
    case "html":
      bind("html");
      break;
    case "heading":
      bind("text");
      break;
    case "quote":
    case "pullquote":
      bind("text");
      bind("cite");
      break;
    case "callout":
    case "verse":
    case "preformatted":
      bind("text");
      break;
    case "image":
    case "cover":
      bind("caption");
      bind("alt");
      break;
    case "list": {
      const items = data.items;
      if (Array.isArray(items)) {
        items.forEach((item, i) => {
          if (isNonEmpty(item)) col.push(item, (tr) => (items[i] = tr));
        });
      }
      break;
    }
    case "faq": {
      const items = data.items;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item && typeof item === "object") {
            const qa = item as Record<string, unknown>;
            if (isNonEmpty(qa.q)) col.push(qa.q, (tr) => (qa.q = tr));
            if (isNonEmpty(qa.a)) col.push(qa.a, (tr) => (qa.a = tr));
          }
        }
      }
      break;
    }
    case "button":
      bind("label");
      break;
    default:
      // Pozostałe typy: bez tłumaczenia (kopiowane 1:1).
      break;
  }
  // Zagnieżdżone kolumny (blok columns trzyma left/right z blokami).
  for (const side of ["left", "right"]) {
    const nested = data[side];
    if (Array.isArray(nested)) {
      for (const child of nested) {
        if (child && typeof child === "object" && "type" in child && "data" in child) {
          collectBlockTexts(child as Block, col);
        }
      }
    }
  }
}

export interface SegmentedTranslation {
  /** Segmenty do przetłumaczenia, w stałej kolejności. */
  texts: string[];
  /** Składa TranslateOutput z przetłumaczonych segmentów (ta sama kolejność). */
  apply(translated: readonly string[]): TranslateOutput;
}

export function buildSegments(input: TranslateInput): SegmentedTranslation {
  const col = collector();

  const out: TranslateOutput = {
    title_en: "",
    excerpt_en: null,
    takeaways_en: [],
    seo_title_en: null,
    seo_description_en: null,
    content_en: null,
    // Deep copy dokumentu PL - sloty bloków mutują tę kopię.
    blocks_en: input.blocks_pl ? (JSON.parse(JSON.stringify(input.blocks_pl)) as Block[]) : null,
  };

  if (isNonEmpty(input.title_pl)) col.push(input.title_pl, (tr) => (out.title_en = tr));
  if (isNonEmpty(input.excerpt_pl)) col.push(input.excerpt_pl, (tr) => (out.excerpt_en = tr));
  input.takeaways_pl.forEach((takeaway, i) => {
    if (isNonEmpty(takeaway)) {
      out.takeaways_en.push("");
      const slotIndex = out.takeaways_en.length - 1;
      col.push(takeaway, (tr) => (out.takeaways_en[slotIndex] = tr));
    }
  });
  if (isNonEmpty(input.seo_title_pl)) {
    col.push(input.seo_title_pl, (tr) => (out.seo_title_en = tr));
  }
  if (isNonEmpty(input.seo_description_pl)) {
    col.push(input.seo_description_pl, (tr) => (out.seo_description_en = tr));
  }
  if (isNonEmpty(input.content_pl)) col.push(input.content_pl, (tr) => (out.content_en = tr));
  for (const block of out.blocks_en ?? []) collectBlockTexts(block, col);

  const total = col.texts.reduce((acc, t) => acc + t.length, 0);
  if (total > MAX_TOTAL_CHARS) {
    throw new Error(
      `Treść przekracza limit tłumaczenia (${total} > ${MAX_TOTAL_CHARS} znaków) / content exceeds translation limit`,
    );
  }

  return {
    texts: col.texts,
    apply(translated) {
      if (translated.length !== col.texts.length) {
        throw new Error("Translation segment count mismatch");
      }
      translated.forEach((text, i) => col.slots[i](text));
      return out;
    },
  };
}
