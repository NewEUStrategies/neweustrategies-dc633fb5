// Kanoniczna lista 12 głównych obszarów tematycznych z rekomendowaną
// (nie-żółtą) kolorystyką pigułek. Współdzielona przez admin (seed/reset)
// oraz backend (migracja seedująca po slugach).
export interface CoreCategoryArea {
  slug: string;
  name_pl: string;
  name_en: string;
  color: string;
}

export const CORE_CATEGORY_AREAS: readonly CoreCategoryArea[] = [
  { slug: "geopolityka", name_pl: "Geopolityka", name_en: "Geopolitics", color: "#1f3a8a" },
  { slug: "wojskowosc", name_pl: "Wojskowość", name_en: "Military", color: "#4a5d23" },
  { slug: "technologia", name_pl: "Technologia", name_en: "Technology", color: "#0ea5e9" },
  {
    slug: "cyberbezpieczenstwo",
    name_pl: "Cyberbezpieczeństwo",
    name_en: "Cybersecurity",
    color: "#7c3aed",
  },
  { slug: "finanse", name_pl: "Finanse", name_en: "Finance", color: "#059669" },
  { slug: "gospodarka", name_pl: "Gospodarka", name_en: "Economy", color: "#0d9488" },
  { slug: "transport", name_pl: "Transport", name_en: "Transport", color: "#ea580c" },
  { slug: "energetyka", name_pl: "Energetyka", name_en: "Energy", color: "#dc2626" },
  { slug: "historia", name_pl: "Historia", name_en: "History", color: "#78350f" },
  { slug: "dyplomacja", name_pl: "Dyplomacja", name_en: "Diplomacy", color: "#be185d" },
  {
    slug: "stosunki-miedzynarodowe",
    name_pl: "Stosunki międzynarodowe",
    name_en: "International Relations",
    color: "#475569",
  },
  { slug: "wydarzenia", name_pl: "Wydarzenia", name_en: "Events", color: "#111827" },
] as const;
