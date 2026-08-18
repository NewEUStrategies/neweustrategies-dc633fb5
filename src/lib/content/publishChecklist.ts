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
  | "indexable"
  | "sponsoredDisclosure";

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
  /**
   * Braki w ujawnieniu komercyjnym (`disclosureGaps` z content/sponsored.ts).
   * Podawane gotowe, a nie liczone tutaj, żeby checklista miała JEDNO źródło
   * prawdy z bramką serwerową - dwie niezależne implementacje tej samej reguły
   * rozjechałyby się przy pierwszej zmianie prawa.
   */
  sponsoredGaps: readonly string[];
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

/**
 * Pozycje pokazywane w checkliście, ale NIE liczone do wyniku.
 *
 * `sponsoredDisclosure` jest poza punktacją z dwóch powodów. Po pierwsze skala
 * jest ogłoszona jako 0-100 (karta rysuje `score/100` i szerokość paska w %),
 * a dorzucenie piątej pozycji wymaganej dałoby maksimum 115 - pasek wyszedłby
 * za krawędź. Po drugie i ważniejsze: to nie jest miara JAKOŚCI wpisu. Materiał
 * bez relacji komercyjnej spełnia ją bezwarunkowo, więc punktowanie rozdawałoby
 * darmowe punkty każdemu zwykłemu tekstowi i zaniżało realną wartość pozostałych
 * pozycji. Pozycja pełni rolę bramki (missingRequired), nie składnika oceny.
 */
const UNSCORED: ReadonlySet<ChecklistItemId> = new Set(["sponsoredDisclosure"]);
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
    // Jedyna pozycja, której "required" nie jest miękkie w praktyce: serwer
    // ODRZUCA publikację z brakami w ujawnieniu (updatePost), bo to obowiązek
    // ustawowy, nie higiena redakcyjna. Pozycja jest tu, żeby redaktor zobaczył
    // brak w checkliście, a nie dopiero w komunikacie błędu.
    { id: "sponsoredDisclosure", level: "required", ok: input.sponsoredGaps.length === 0 },
  ];

  const missingRequired = items.filter((i) => i.level === "required" && !i.ok);
  const missingRecommended = items.filter((i) => i.level === "recommended" && !i.ok);
  const score = items.reduce(
    (acc, i) =>
      acc +
      (UNSCORED.has(i.id) || !i.ok
        ? 0
        : i.level === "required"
          ? REQUIRED_POINTS
          : RECOMMENDED_POINTS),
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
