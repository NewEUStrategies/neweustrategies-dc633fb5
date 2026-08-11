// Specjalizacje klubów dyskusyjnych - publiczna, redakcyjna taksonomia
// pokazywana osobom NIEZALOGOWANYM.
//
// Świadomie osobna warstwa od `club_topics` (katalog administratora): tamten
// opisuje kluby, które realnie istnieją w bazie i bywa pusty, a ta lista jest
// obietnicą produktu na stronie wejściowej i musi być stabilna, indeksowalna
// i identyczna w PL/EN. Slug jest częścią URL-a (/club/specialization/$slug),
// więc nie zmienia się razem z etykietą.
import {
  Building2,
  Cpu,
  Globe2,
  Landmark,
  Palette,
  Scale,
  Ship,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface ClubSpecialization {
  /** Segment URL - niezmienny kontrakt publiczny. */
  slug: string;
  /** Sufiks klucza i18n: club.spec.items.<key>.title / .lead / .desc */
  key: string;
  icon: LucideIcon;
  /** Numer porządkowy w indeksie redakcyjnym (01-08). */
  index: string;
}

export const CLUB_SPECIALIZATIONS: readonly ClubSpecialization[] = [
  { slug: "defence-geopolitics", key: "defence", icon: Globe2, index: "01" },
  { slug: "finance-economy", key: "finance", icon: Building2, index: "02" },
  { slug: "transport", key: "transport", icon: Ship, index: "03" },
  { slug: "energy", key: "energy", icon: Zap, index: "04" },
  { slug: "technology-cybersecurity", key: "technology", icon: Cpu, index: "05" },
  { slug: "diplomacy-international-relations", key: "diplomacy", icon: Landmark, index: "06" },
  { slug: "legislation", key: "legislation", icon: Scale, index: "07" },
  { slug: "culture-history-policy", key: "culture", icon: Palette, index: "08" },
] as const;

export function findClubSpecialization(slug: string): ClubSpecialization | null {
  return CLUB_SPECIALIZATIONS.find((s) => s.slug === slug) ?? null;
}
