// Czysty moduł domeny trackera legislacyjnego UE: etapy procedury, obszary
// polityki i dwujęzyczne etykiety. Zero zależności od React/Supabase, dzięki
// czemu logika postępu jest w pełni testowalna jednostkowo i współdzielona
// przez indeks, stronę dossier oraz panel admina.

/** Pozytywna ścieżka legislacyjna - kolejność jest znacząca (oś postępu). */
export const POLICY_STAGES = [
  "proposal",
  "parliament",
  "council",
  "trilogue",
  "adopted",
  "in_force",
] as const;

/** Etapy terminalne - dossier zakończone poza pozytywną ścieżką. */
export const TERMINAL_STAGES = ["rejected", "withdrawn"] as const;

export type PolicyStage = (typeof POLICY_STAGES)[number] | (typeof TERMINAL_STAGES)[number];

/** Czy etap kończy procedurę poza pozytywną ścieżką (odrzucone/wycofane)? */
export function isTerminal(stage: string): boolean {
  return (TERMINAL_STAGES as readonly string[]).includes(stage);
}

/**
 * Indeks etapu na pozytywnej ścieżce (0 = proposal ... 5 = in_force).
 * Etapy terminalne (i nieznane wartości) nie leżą na osi - zwracamy -1.
 */
export function stageIndex(stage: string): number {
  if (isTerminal(stage)) return -1;
  return (POLICY_STAGES as readonly string[]).indexOf(stage);
}

/**
 * Postęp procedury jako liczba 0..1 do pasków postępu.
 * proposal = 0, in_force = 1; etapy terminalne również = 1 (procedura
 * zakończona - nic już się nie wydarzy). Nieznane wartości -> 0.
 */
export function stageProgress(stage: string): number {
  if (isTerminal(stage)) return 1;
  const idx = stageIndex(stage);
  if (idx < 0) return 0;
  return idx / (POLICY_STAGES.length - 1);
}

export interface PolicyAreaLabel {
  key: string;
  pl: string;
  en: string;
}

/** 10 obszarów polityki zgodnych z CHECK-iem kolumny policy_area. */
export const POLICY_AREAS: PolicyAreaLabel[] = [
  { key: "general", pl: "Ogólne", en: "General" },
  { key: "energy", pl: "Energia", en: "Energy" },
  { key: "digital", pl: "Cyfryzacja", en: "Digital" },
  { key: "security", pl: "Bezpieczeństwo", en: "Security" },
  { key: "enlargement", pl: "Rozszerzenie", en: "Enlargement" },
  { key: "economy", pl: "Gospodarka", en: "Economy" },
  { key: "cohesion", pl: "Spójność", en: "Cohesion" },
  { key: "climate", pl: "Klimat", en: "Climate" },
  { key: "trade", pl: "Handel", en: "Trade" },
  { key: "migration", pl: "Migracja", en: "Migration" },
];

export interface StageLabel {
  key: PolicyStage;
  pl: string;
  en: string;
}

/** Etykiety wszystkich 8 etapów (6 ścieżki pozytywnej + 2 terminalne). */
export const STAGE_LABELS: StageLabel[] = [
  { key: "proposal", pl: "Projekt KE", en: "Commission proposal" },
  { key: "parliament", pl: "Parlament", en: "Parliament" },
  { key: "council", pl: "Rada", en: "Council" },
  { key: "trilogue", pl: "Trilog", en: "Trilogue" },
  { key: "adopted", pl: "Przyjęte", en: "Adopted" },
  { key: "in_force", pl: "Obowiązuje", en: "In force" },
  { key: "rejected", pl: "Odrzucone", en: "Rejected" },
  { key: "withdrawn", pl: "Wycofane", en: "Withdrawn" },
];

/** Etykieta etapu wg języka; nieznany etap zwraca surowy klucz (defensywnie). */
export function stageLabel(stage: string, lang: "pl" | "en"): string {
  const entry = STAGE_LABELS.find((s) => s.key === stage);
  return entry ? entry[lang] : stage;
}

/** Etykieta obszaru polityki wg języka; nieznany obszar -> surowy klucz. */
export function areaLabel(area: string, lang: "pl" | "en"): string {
  const entry = POLICY_AREAS.find((a) => a.key === area);
  return entry ? entry[lang] : area;
}
