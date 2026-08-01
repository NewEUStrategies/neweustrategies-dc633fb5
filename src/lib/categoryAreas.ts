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
  { slug: "geopolityka", name_pl: "Geopolityka", name_en: "Geopolitics", color: "#CD393B" },
  { slug: "wojskowosc", name_pl: "Wojskowość", name_en: "Military", color: "#F24343" },
  { slug: "technologia", name_pl: "Technologia", name_en: "Technology", color: "#0ea5e9" },
  {
    slug: "cyberbezpieczenstwo",
    name_pl: "Cyberbezpieczeństwo",
    name_en: "Cybersecurity",
    color: "#7c3aed",
  },
  { slug: "finanse", name_pl: "Finanse", name_en: "Finance", color: "#81D365" },
  { slug: "gospodarka", name_pl: "Gospodarka", name_en: "Economy", color: "#81D365" },
  { slug: "transport", name_pl: "Transport", name_en: "Transport", color: "#FA9346" },
  { slug: "energetyka", name_pl: "Energetyka", name_en: "Energy", color: "#F8B632" },
  { slug: "historia", name_pl: "Historia", name_en: "History", color: "#78350f" },
  { slug: "dyplomacja", name_pl: "Dyplomacja", name_en: "Diplomacy", color: "#63B2F2" },
  {
    slug: "stosunki-miedzynarodowe",
    name_pl: "Stosunki międzynarodowe",
    name_en: "International Relations",
    color: "#63B2F2",
  },
  { slug: "wydarzenia", name_pl: "Wydarzenia", name_en: "Events", color: "#01112F" },
] as const;
