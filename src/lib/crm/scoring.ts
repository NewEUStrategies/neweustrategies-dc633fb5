// CRM lead scoring - typy, domyślne wagi i pomocnicze funkcje wyświetlania.
//
// Źródłem prawdy dla LICZENIA jest baza (compute_crm_lead_score +
// crm_scoring_default_weights, migracja 20260718130000; sygnał page_view
// doszedł w 20260721113000). Ten moduł jest lustrem domyślnych wartości na
// potrzeby panelu ustawień i etykiet - zmiana wag w SQL wymaga aktualizacji
// tutaj (pilnuje tego test parzystości kluczy
// w src/lib/crm/__tests__/scoring.test.ts).

export type ScoreBand = "hot" | "warm" | "cool" | "cold";

export interface ScoreBreakdownEntry {
  key: string;
  count: number;
  points: number;
}

export interface ScoringWeight {
  points: number;
  cap: number;
}

export const SCORE_SIGNAL_KEYS = [
  // behawioralne (decay)
  "email_open",
  "email_click",
  "page_view",
  "contact_form",
  "event_rsvp",
  "resource_download",
  "comment",
  "purchase",
  "donation",
  // statusowe / fit (bez decay)
  "newsletter_confirmed",
  "marketing_consent",
  "has_company",
  "has_position",
  "has_phone",
  "has_linkedin",
] as const;

export type ScoreSignalKey = (typeof SCORE_SIGNAL_KEYS)[number];

/** Lustro crm_scoring_default_weights() z migracji - tylko do wyświetlania. */
export const DEFAULT_SCORING_WEIGHTS: Record<ScoreSignalKey, ScoringWeight> = {
  email_open: { points: 2, cap: 16 },
  email_click: { points: 6, cap: 30 },
  page_view: { points: 1, cap: 10 },
  contact_form: { points: 25, cap: 50 },
  event_rsvp: { points: 15, cap: 30 },
  resource_download: { points: 12, cap: 36 },
  comment: { points: 4, cap: 12 },
  purchase: { points: 40, cap: 80 },
  donation: { points: 25, cap: 50 },
  newsletter_confirmed: { points: 10, cap: 10 },
  marketing_consent: { points: 5, cap: 5 },
  has_company: { points: 4, cap: 4 },
  has_position: { points: 4, cap: 4 },
  has_phone: { points: 3, cap: 3 },
  has_linkedin: { points: 3, cap: 3 },
};

export interface ScoringSettings {
  enabled: boolean;
  half_life_days: number;
  horizon_days: number;
  hot_threshold: number;
  warm_threshold: number;
  cool_threshold: number;
  /** Nadpisania per sygnał - merge nad DEFAULT_SCORING_WEIGHTS. */
  weights: Partial<Record<ScoreSignalKey, Partial<ScoringWeight>>>;
}

export const DEFAULT_SCORING_SETTINGS: ScoringSettings = {
  enabled: true,
  half_life_days: 30,
  horizon_days: 365,
  hot_threshold: 80,
  warm_threshold: 45,
  cool_threshold: 20,
  weights: {},
};

export const SCORE_BANDS: ScoreBand[] = ["hot", "warm", "cool", "cold"];

export const SCORE_BAND_LABELS: Record<"pl" | "en", Record<ScoreBand, string>> = {
  pl: { hot: "Gorący", warm: "Ciepły", cool: "Chłodny", cold: "Zimny" },
  en: { hot: "Hot", warm: "Warm", cool: "Cool", cold: "Cold" },
};

export const SCORE_SIGNAL_LABELS: Record<"pl" | "en", Record<ScoreSignalKey, string>> = {
  pl: {
    email_open: "Otwarcia e-maili",
    email_click: "Kliknięcia w e-mailach",
    page_view: "Odsłony treści (zalogowani)",
    contact_form: "Formularze kontaktowe",
    event_rsvp: "Zapisy na wydarzenia",
    resource_download: "Pobrania z biblioteki",
    comment: "Komentarze",
    purchase: "Zakupy",
    donation: "Darowizny",
    newsletter_confirmed: "Potwierdzony newsletter",
    marketing_consent: "Zgoda marketingowa",
    has_company: "Podana organizacja",
    has_position: "Podane stanowisko",
    has_phone: "Podany telefon",
    has_linkedin: "Profil LinkedIn",
  },
  en: {
    email_open: "Email opens",
    email_click: "Email clicks",
    page_view: "Content views (signed-in)",
    contact_form: "Contact forms",
    event_rsvp: "Event RSVPs",
    resource_download: "Library downloads",
    comment: "Comments",
    purchase: "Purchases",
    donation: "Donations",
    newsletter_confirmed: "Confirmed newsletter",
    marketing_consent: "Marketing consent",
    has_company: "Company provided",
    has_position: "Position provided",
    has_phone: "Phone provided",
    has_linkedin: "LinkedIn profile",
  },
};

/**
 * Defensywny parser rozbicia wyniku (kolumna jsonb score_breakdown).
 * Złe wpisy odpadają zamiast wywracać UI (wzorzec parserów podcast/features).
 */
export function parseScoreBreakdown(value: unknown): ScoreBreakdownEntry[] {
  if (!Array.isArray(value)) return [];
  const out: ScoreBreakdownEntry[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const key = typeof r.key === "string" ? r.key : null;
    const count = typeof r.count === "number" && Number.isFinite(r.count) ? r.count : null;
    const points = typeof r.points === "number" && Number.isFinite(r.points) ? r.points : null;
    if (!key || count === null || points === null) continue;
    out.push({ key, count, points });
  }
  // Najcięższe sygnały na górze - panel czyta "dlaczego ten wynik" od razu.
  return out.sort((a, b) => b.points - a.points);
}

/** Pasmo z progów - lustro CASE z compute_crm_lead_score (podgląd w ustawieniach). */
export function bandFromScore(
  score: number,
  thresholds: Pick<ScoringSettings, "hot_threshold" | "warm_threshold" | "cool_threshold">,
): ScoreBand {
  if (score >= thresholds.hot_threshold) return "hot";
  if (score >= thresholds.warm_threshold) return "warm";
  if (score >= thresholds.cool_threshold) return "cool";
  return "cold";
}

/** Wagi po scaleniu nadpisań tenanta z domyślnymi (do tabeli w ustawieniach). */
export function mergedWeights(
  overrides: ScoringSettings["weights"] | null | undefined,
): Record<ScoreSignalKey, ScoringWeight> {
  const out = {} as Record<ScoreSignalKey, ScoringWeight>;
  for (const key of SCORE_SIGNAL_KEYS) {
    const base = DEFAULT_SCORING_WEIGHTS[key];
    const over = overrides?.[key];
    out[key] = {
      points: clampWeight(over?.points, base.points),
      cap: clampWeight(over?.cap, base.cap),
    };
  }
  return out;
}

function clampWeight(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), 0), 1000);
}

/** Parser wiersza ustawień z bazy (jsonb/nullable) -> pełny obiekt z domyślnymi. */
export function parseScoringSettings(row: unknown): ScoringSettings {
  if (typeof row !== "object" || row === null) return { ...DEFAULT_SCORING_SETTINGS };
  const r = row as Record<string, unknown>;
  const num = (v: unknown, fallback: number, min: number, max: number): number =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.min(Math.max(Math.round(v), min), max)
      : fallback;
  const d = DEFAULT_SCORING_SETTINGS;
  const weights =
    typeof r.weights === "object" && r.weights !== null && !Array.isArray(r.weights)
      ? (r.weights as ScoringSettings["weights"])
      : {};
  const settings: ScoringSettings = {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    half_life_days: num(r.half_life_days, d.half_life_days, 1, 365),
    horizon_days: num(r.horizon_days, d.horizon_days, 7, 1095),
    hot_threshold: num(r.hot_threshold, d.hot_threshold, 1, 10000),
    warm_threshold: num(r.warm_threshold, d.warm_threshold, 1, 10000),
    cool_threshold: num(r.cool_threshold, d.cool_threshold, 1, 10000),
    weights,
  };
  // Progi muszą maleć (CHECK w bazie) - niespójne wejście wraca do domyślnych.
  if (
    !(
      settings.hot_threshold > settings.warm_threshold &&
      settings.warm_threshold > settings.cool_threshold
    )
  ) {
    settings.hot_threshold = d.hot_threshold;
    settings.warm_threshold = d.warm_threshold;
    settings.cool_threshold = d.cool_threshold;
  }
  return settings;
}
