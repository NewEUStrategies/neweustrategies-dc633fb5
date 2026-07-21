// Bilingual sample copy for the live post-preview stage.
//
// The preview intentionally renders realistic PL / EN editorial copy (not the
// admin UI language) so an editor can eyeball how a real card looks in each
// public language. Kept as a pure function for easy testing and so the preview
// organism stays presentational.
import type { ThemeDesignLang } from "@/lib/theme/themeDesign";
import type { PreviewSection } from "./tabs";

export interface PreviewCopy {
  eyebrow: string;
  category: string;
  title: string;
  excerpt: string;
  author: string;
  published: string;
  read: string;
  readMore: string;
  listHeader: string;
  toolbar: string;
  modeSwitcher: string;
  modeItems: readonly [string, string, string];
  social: string;
  overlayCategory: string;
  items: readonly [string, string, string];
}

const EN: PreviewCopy = {
  eyebrow: "Latest analyses",
  category: "Diplomacy",
  title: "How trade routes reshape modern statecraft",
  excerpt:
    "A concise take on how logistics corridors are redefining sovereignty, alliances and long-range planning.",
  author: "Anna Kowalska",
  published: "09/07/2026",
  read: "6 min read",
  readMore: "Read more",
  listHeader: "Ranked stories",
  toolbar: "Toolbar",
  modeSwitcher: "Reader mode",
  modeItems: ["Light", "Sepia", "Dark"],
  social: "Follow us",
  overlayCategory: "Analysis",
  items: [
    "Container flows above 2019 peak",
    "New arctic corridor opens",
    "AI in customs risk scoring",
  ],
};

const PL: PreviewCopy = {
  eyebrow: "Najnowsze analizy",
  category: "Dyplomacja",
  title: "Jak szlaki handlowe redefiniują nowoczesną politykę państw",
  excerpt:
    "Zwięzła analiza tego, jak korytarze logistyczne zmieniają suwerenność, sojusze i planowanie długoterminowe.",
  author: "Anna Kowalska",
  published: "09/07/2026",
  read: "6 min czytania",
  readMore: "Czytaj więcej",
  listHeader: "Ranking artykułów",
  toolbar: "Pasek narzędzi",
  modeSwitcher: "Tryb czytnika",
  modeItems: ["Jasny", "Sepia", "Ciemny"],
  social: "Obserwuj",
  overlayCategory: "Analiza",
  items: [
    "Przepływy kontenerowe powyżej szczytu 2019",
    "Nowy korytarz arktyczny",
    "AI w scoringu ryzyka celnego",
  ],
};

/** Realistic editorial sample copy for the given public language. */
export function getPreviewCopy(lang: ThemeDesignLang): PreviewCopy {
  return lang === "en" ? EN : PL;
}

const TAB_TITLES: Record<PreviewSection, readonly [pl: string, en: string]> = {
  "block-heading": ["Nagłówki bloków", "Block headings"],
  thumbnail: ["Miniatury", "Thumbnails"],
  "read-more": ["Czytaj więcej", "Read more"],
  meta: ["Meta wpisu", "Post meta"],
  toolbar: ["Toolbar", "Toolbar"],
  "mode-switch": ["Tryb jasny/ciemny", "Light/Dark mode"],
  social: ["Social", "Social"],
  "post-title": ["Tytuły wpisów", "Post titles"],
  "post-excerpt": ["Excerpt", "Excerpt"],
  "list-index": ["Numeracja list", "List index"],
  carousel: ["Karuzela", "Carousel"],
  overlay: ["Overlay wpisu", "Post overlay"],
};

/** Human label of the currently-previewed tab, in the preview language. */
export function getTabTitle(section: PreviewSection, lang: ThemeDesignLang): string {
  return TAB_TITLES[section][lang === "en" ? 1 : 0];
}
