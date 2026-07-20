// Checklista przed publikacją wpisu - jedna, czysta ocena kompletności
// redakcyjnej używana przez kartę w sidebarze edytora ORAZ bramkę przy
// przejściu w status published/scheduled. Bez React/Supabase: wejściem jest
// snapshot formularza edytora + liczby zaznaczonych taksonomii.
//
// Filozofia bramki: pozycje "required" nie BLOKUJĄ publikacji twardo -
// redakcja może świadomie opublikować mimo braków (confirm dialog z listą).
// Twarda blokada psułaby przypadki brzegowe (pilne noty, wpisy specjalne),
// a miękka bramka i tak eliminuje 90% przypadkowych braków.
//
// Uzupełnia (nie dubluje) scoring SEO z src/lib/seo/contentStatus.ts: tamten
// ocenia wyłącznie pola SEO dla widoku /admin/seo; ten patrzy na wpis
// redakcyjnie (okładka, kategoria, takeaways, parytet EN).

export type ChecklistLevel = "required" | "recommended";

export type ChecklistItemId =
  | "titlePl"
  | "cover"
  | "category"
  | "descriptionPl"
  | "takeaways"
  | "tags"
  | "enVersion"
  | "indexable";

export interface ChecklistItem {
  id: ChecklistItemId;
  level: ChecklistLevel;
  ok: boolean;
}

export interface PublishChecklistInput {
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  seo_description_pl: string | null;
  seo_description_en: string | null;
  seo_noindex: boolean;
  takeaways_pl: string[];
  categoriesCount: number;
  tagsCount: number;
}

export interface PublishChecklist {
  items: ChecklistItem[];
  missingRequired: ChecklistItem[];
  missingRecommended: ChecklistItem[];
  requiredOk: boolean;
  /** 0-100: required 4x15 pkt, recommended 4x10 pkt. */
  score: number;
}

const REQUIRED_POINTS = 15;
const RECOMMENDED_POINTS = 10;
/** Minimalna liczba takeaways, przy której sekcja "Dowiesz się" ma sens. */
const MIN_TAKEAWAYS = 3;

function has(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}

export function buildPublishChecklist(input: PublishChecklistInput): PublishChecklist {
  const items: ChecklistItem[] = [
    { id: "titlePl", level: "required", ok: has(input.title_pl) },
    { id: "cover", level: "required", ok: has(input.cover_image_url) },
    { id: "category", level: "required", ok: input.categoriesCount > 0 },
    {
      id: "descriptionPl",
      level: "required",
      ok: has(input.seo_description_pl) || has(input.excerpt_pl),
    },
    {
      id: "takeaways",
      level: "recommended",
      ok: input.takeaways_pl.filter((t) => t.trim().length > 0).length >= MIN_TAKEAWAYS,
    },
    { id: "tags", level: "recommended", ok: input.tagsCount > 0 },
    {
      id: "enVersion",
      level: "recommended",
      ok: has(input.title_en) && (has(input.excerpt_en) || has(input.seo_description_en)),
    },
    { id: "indexable", level: "recommended", ok: !input.seo_noindex },
  ];

  const missingRequired = items.filter((i) => i.level === "required" && !i.ok);
  const missingRecommended = items.filter((i) => i.level === "recommended" && !i.ok);
  const score = items.reduce(
    (acc, i) => acc + (i.ok ? (i.level === "required" ? REQUIRED_POINTS : RECOMMENDED_POINTS) : 0),
    0,
  );

  return {
    items,
    missingRequired,
    missingRecommended,
    requiredOk: missingRequired.length === 0,
    score,
  };
}

/** Statusy, których dotyczy bramka (wejście do publikacji, także planowanej). */
export function isPublishTransition(from: string, to: string): boolean {
  const publishing = to === "published" || to === "scheduled";
  const alreadyPublic = from === "published" || from === "scheduled";
  return publishing && !alreadyPublic;
}
