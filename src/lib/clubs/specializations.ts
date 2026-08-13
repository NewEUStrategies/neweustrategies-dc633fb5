// Specjalizacje klubów dyskusyjnych - redakcyjna taksonomia najwyższego
// poziomu, po której wchodzi się do katalogu klubów (anonim i zalogowany).
//
// Źródłem prawdy jest tabela `club_specializations` (panel: Klub -
// specjalizacje). Ta lista zostaje jako WARSTWA AWARYJNA i jako mapa ikon:
// pusty ekran w miejscu wizytówki modułu wygląda jak awaria, a slug jest
// częścią URL-a (/club/specialization/$slug), więc nie zmienia się razem
// z etykietą.
import {
  Building2,
  Cpu,
  Globe2,
  Landmark,
  Leaf,
  MessagesSquare,
  Palette,
  Scale,
  Shield,
  Ship,
  Users2,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { LocaleCode } from "@/lib/i18n/pickLocalized";

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

/** Ikony dopuszczone w panelu - nazwa trafia do bazy jako zwykły tekst. */
export const CLUB_SPECIALIZATION_ICONS: Readonly<Record<string, LucideIcon>> = {
  Globe2,
  Building2,
  Ship,
  Zap,
  Cpu,
  Landmark,
  Scale,
  Palette,
  Shield,
  Leaf,
  Users2,
  MessagesSquare,
};

export const CLUB_SPECIALIZATION_ICON_NAMES: readonly string[] =
  Object.keys(CLUB_SPECIALIZATION_ICONS);

export function resolveSpecializationIcon(name: string | null | undefined): LucideIcon {
  if (typeof name === "string" && name in CLUB_SPECIALIZATION_ICONS) {
    return CLUB_SPECIALIZATION_ICONS[name] as LucideIcon;
  }
  return Globe2;
}

/** Znormalizowany model widoku - zawsze ma komplet tekstów i ikonę. */
export interface ClubSpecializationView {
  slug: string;
  key: string;
  icon: LucideIcon;
  index: string;
  title: string;
  lead: string;
  desc: string;
  clubCount: number;
}

interface SpecializationSource {
  slug: string;
  key: string;
  label_pl: string;
  label_en: string;
  lead_pl: string | null;
  lead_en: string | null;
  desc_pl: string | null;
  desc_en: string | null;
  icon: string;
  sort_order: number;
  club_count?: number;
}

function pick(primary: string | null | undefined, fallback: string): string {
  const value = (primary ?? "").trim();
  return value.length > 0 ? value : fallback;
}

/**
 * Tekst specjalizacji - KOLEJNOŚĆ ŹRÓDEŁ jest tu tezą, nie szczegółem:
 *   1. wartość z bazy w JĘZYKU INTERFEJSU - administrator wpisał ją świadomie,
 *   2. tłumaczenie z i18n - dla ośmiu specjalizacji systemowych jest poprawne
 *      JĘZYKOWO, więc bije wartość z bazy w drugim języku,
 *   3. wartość z bazy w drugim języku - ostatnia deska dla specjalizacji
 *      WŁASNEJ, której nie ma w i18n i którą administrator opisał po jednemu.
 *
 * Punkt 3 nie istniał. Specjalizacja dodana z panelu i opisana wyłącznie po
 * polsku renderowała angielskiemu czytelnikowi kafel z numerem i ikoną,
 * ale bez tytułu i bez opisu - `tr()` nie zna jej klucza, więc zwracał "".
 * Dlatego to NIE jest zwykłe `pickLocalized`: ono postawiłoby drugi język
 * PRZED tłumaczeniem, czyli pokazałoby polski tytuł tam, gdzie i18n ma
 * poprawny angielski.
 */
function pickSpecText(
  own: string | null | undefined,
  translated: string,
  other: string | null | undefined,
): string {
  return pick(own, pick(translated, pick(other, "")));
}

/**
 * Buduje listę do wyświetlenia. Baza jest źródłem prawdy, a `translate`
 * (klucze `club.spec.items.*`) domyka teksty, których administrator nie
 * wypełnił - dzięki temu ośmiu systemowych specjalizacji nie trzeba
 * tłumaczyć dwa razy.
 */
export function buildSpecializationViews(
  rows: readonly SpecializationSource[],
  lang: LocaleCode,
  translate: (key: string) => string,
): ClubSpecializationView[] {
  const other: LocaleCode = lang === "pl" ? "en" : "pl";
  return rows.map((row, i) => {
    const known = findClubSpecialization(row.slug);
    const i18nKey = known?.key ?? row.key;
    const tr = (suffix: string): string => {
      if (known === null) return "";
      const full = `club.spec.items.${i18nKey}.${suffix}`;
      const value = translate(full);
      return value === full ? "" : value;
    };
    return {
      slug: row.slug,
      key: i18nKey,
      icon: known?.icon ?? resolveSpecializationIcon(row.icon),
      index: String(i + 1).padStart(2, "0"),
      title: pickSpecText(row[`label_${lang}`], tr("title"), row[`label_${other}`]),
      lead: pickSpecText(row[`lead_${lang}`], tr("lead"), row[`lead_${other}`]),
      desc: pickSpecText(row[`desc_${lang}`], tr("desc"), row[`desc_${other}`]),
      clubCount: Number(row.club_count ?? 0),
    };
  });
}

/** Warstwa awaryjna: osiem specjalizacji z tekstami wyłącznie z i18n. */
export function fallbackSpecializationSources(): SpecializationSource[] {
  return CLUB_SPECIALIZATIONS.map((spec, i) => ({
    slug: spec.slug,
    key: spec.key,
    label_pl: "",
    label_en: "",
    lead_pl: null,
    lead_en: null,
    desc_pl: null,
    desc_en: null,
    icon: "Globe2",
    sort_order: (i + 1) * 10,
    club_count: 0,
  }));
}
