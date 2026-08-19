// Definicje kolumn, filtrów oraz zapisanych widoków dla listy osób CRM
// (`/admin/crm`). Analogiczne do `companyViews.ts` - serwer trzyma `config`
// jako JSONB, tutaj mieszka walidacja (Zod), defaulty i helpery client-side.
import { z } from "zod";
import type { ScoreBand } from "@/lib/crm/scoring";
import {
  filterLeadRows,
  inferLeadSource,
  sortLeadRows,
  type LeadListFilterParams,
  type LeadSortDir,
  type LeadSortKey,
} from "@/lib/crm/leadListSpec";

/* ---------- Filtry ---------- */

export const LeadFilterSchema = z.object({
  stage: z
    .enum(["any", "new", "contacted", "qualified", "proposal", "won", "lost", "archived"])
    .default("any"),
  band: z.enum(["any", "hot", "warm", "cool", "cold"]).default("any"),
  source: z.enum(["any", "form", "newsletter", "import"]).default("any"),
  country: z.string().nullable().default(null),
  company: z.string().nullable().default(null),
  createdRange: z.enum(["any", "7d", "30d", "90d", "365d"]).default("any"),
  activityRange: z.enum(["any", "7d", "30d", "90d"]).default("any"),
  consentOnly: z.boolean().default(false),
});
export type LeadFilter = z.infer<typeof LeadFilterSchema>;

export const DEFAULT_LEAD_FILTER: LeadFilter = {
  stage: "any",
  band: "any",
  source: "any",
  country: null,
  company: null,
  createdRange: "any",
  activityRange: "any",
  consentOnly: false,
};

export function isDefaultLeadFilter(f: LeadFilter): boolean {
  return (
    f.stage === "any" &&
    f.band === "any" &&
    f.source === "any" &&
    f.country === null &&
    f.company === null &&
    f.createdRange === "any" &&
    f.activityRange === "any" &&
    f.consentOnly === false
  );
}

/* ---------- Kolumny ---------- */

export type LeadColumnKey =
  | "name"
  | "email"
  | "phone"
  | "position"
  | "company"
  | "country"
  | "stage"
  | "score"
  | "band"
  | "source"
  | "tags"
  | "consent"
  | "lastActivity"
  | "created"
  | "followUp";

export interface LeadColumnDef {
  key: LeadColumnKey;
  labelPl: string;
  labelEn: string;
  align?: "left" | "right";
  sortable?: boolean;
  required?: boolean;
  minWidth?: number;
}

export const LEAD_COLUMNS: readonly LeadColumnDef[] = [
  {
    key: "name",
    labelPl: "Osoba",
    labelEn: "Contact",
    sortable: true,
    required: true,
    minWidth: 240,
  },
  { key: "email", labelPl: "E-mail", labelEn: "Email", minWidth: 200 },
  { key: "phone", labelPl: "Telefon", labelEn: "Phone", minWidth: 140 },
  { key: "position", labelPl: "Stanowisko", labelEn: "Position", minWidth: 160 },
  { key: "company", labelPl: "Firma", labelEn: "Company", sortable: true, minWidth: 180 },
  { key: "country", labelPl: "Kraj", labelEn: "Country", sortable: true, minWidth: 120 },
  { key: "stage", labelPl: "Etap", labelEn: "Stage", sortable: true, minWidth: 120 },
  {
    key: "score",
    labelPl: "Score",
    labelEn: "Score",
    align: "right",
    sortable: true,
    minWidth: 96,
  },
  { key: "band", labelPl: "Poziom", labelEn: "Band", minWidth: 100 },
  { key: "source", labelPl: "Źródło", labelEn: "Source", minWidth: 120 },
  { key: "tags", labelPl: "Tagi", labelEn: "Tags", minWidth: 160 },
  { key: "consent", labelPl: "Zgoda", labelEn: "Consent", minWidth: 100 },
  {
    key: "lastActivity",
    labelPl: "Aktywność",
    labelEn: "Last activity",
    align: "right",
    sortable: true,
    minWidth: 140,
  },
  {
    key: "created",
    labelPl: "Utworzono",
    labelEn: "Created",
    align: "right",
    sortable: true,
    minWidth: 140,
  },
  {
    key: "followUp",
    labelPl: "Follow-up",
    labelEn: "Follow-up",
    align: "right",
    sortable: true,
    minWidth: 140,
  },
] as const;

export const LEAD_COLUMN_BY_KEY = Object.fromEntries(
  LEAD_COLUMNS.map((c) => [c.key, c] as const),
) as Record<LeadColumnKey, LeadColumnDef>;

/* ---------- Sortowanie ---------- */

export const LeadSortSchema = z.object({
  key: z.enum([
    "name",
    "company",
    "country",
    "stage",
    "score",
    "lastActivity",
    "created",
    "followUp",
  ]),
  dir: z.enum(["asc", "desc"]),
});
export type LeadSort = z.infer<typeof LeadSortSchema>;

export const DEFAULT_LEAD_SORT: LeadSort = { key: "lastActivity", dir: "desc" };

/* ---------- Konfiguracja widoku (persist) ---------- */

const LeadColumnKeySchema = z.enum([
  "name",
  "email",
  "phone",
  "position",
  "company",
  "country",
  "stage",
  "score",
  "band",
  "source",
  "tags",
  "consent",
  "lastActivity",
  "created",
  "followUp",
]);

export const LeadViewConfigSchema = z.object({
  columns: z
    .array(LeadColumnKeySchema)
    .min(1)
    .default(["name", "email", "company", "stage", "score", "lastActivity"]),
  filter: LeadFilterSchema.default(DEFAULT_LEAD_FILTER),
  sort: LeadSortSchema.default(DEFAULT_LEAD_SORT),
});
export type LeadViewConfig = z.infer<typeof LeadViewConfigSchema>;

export const DEFAULT_LEAD_VIEW_CONFIG: LeadViewConfig = {
  columns: ["name", "email", "company", "stage", "score", "lastActivity"],
  filter: DEFAULT_LEAD_FILTER,
  sort: DEFAULT_LEAD_SORT,
};

export function parseLeadViewConfig(raw: unknown): LeadViewConfig {
  const p = LeadViewConfigSchema.safeParse(raw);
  return p.success ? p.data : DEFAULT_LEAD_VIEW_CONFIG;
}

/* ---------- Wbudowane widoki ---------- */

export interface BuiltinLeadView {
  id: string;
  labelPl: string;
  labelEn: string;
  config: LeadViewConfig;
}

export const BUILTIN_LEAD_VIEWS: readonly BuiltinLeadView[] = [
  {
    id: "builtin:all",
    labelPl: "Wszystkie osoby",
    labelEn: "All contacts",
    config: DEFAULT_LEAD_VIEW_CONFIG,
  },
  {
    id: "builtin:hot",
    labelPl: "Gorące (hot)",
    labelEn: "Hot leads",
    config: {
      ...DEFAULT_LEAD_VIEW_CONFIG,
      columns: ["name", "email", "company", "stage", "score", "band", "lastActivity"],
      filter: { ...DEFAULT_LEAD_FILTER, band: "hot" },
      sort: { key: "score", dir: "desc" },
    },
  },
  {
    id: "builtin:new",
    labelPl: "Nowi (7 dni)",
    labelEn: "New (7 days)",
    config: {
      ...DEFAULT_LEAD_VIEW_CONFIG,
      filter: { ...DEFAULT_LEAD_FILTER, createdRange: "7d", stage: "new" },
      sort: { key: "created", dir: "desc" },
    },
  },
  {
    id: "builtin:qualified",
    labelPl: "Zakwalifikowani",
    labelEn: "Qualified",
    config: {
      ...DEFAULT_LEAD_VIEW_CONFIG,
      filter: { ...DEFAULT_LEAD_FILTER, stage: "qualified" },
      sort: { key: "score", dir: "desc" },
    },
  },
  {
    id: "builtin:won",
    labelPl: "Wygrane",
    labelEn: "Won",
    config: {
      ...DEFAULT_LEAD_VIEW_CONFIG,
      columns: ["name", "email", "company", "stage", "score", "created"],
      filter: { ...DEFAULT_LEAD_FILTER, stage: "won" },
      sort: { key: "lastActivity", dir: "desc" },
    },
  },
] as const;

/* ---------- Mapowanie widoku na parametry serwera ---------- */

// Każda wartość zakresu z LeadFilterSchema ma tu swój odpowiednik - typ jest
// TOTALNY, więc nie ma obronnego „a jeśli nie ma?", którego nikt nie wykona.
const RANGE_DAYS: Record<
  Exclude<LeadFilter["createdRange"] | LeadFilter["activityRange"], "any">,
  number
> = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 };

/**
 * Parametry listy leadów rozumiane przez listCrmLeads (crm.functions.ts).
 * Filtry są dokładnie tym, co opisuje `LeadListFilterSchema` - panel ustawia
 * ich podzbiór, ale KSZTAŁT jest jeden, wspólny z serwerem.
 */
export type LeadListServerParams = LeadListFilterParams & {
  sort: LeadSortKey;
  sort_dir: LeadSortDir;
};

const SORT_KEY_TO_SERVER: Record<LeadSort["key"], LeadSortKey> = {
  name: "name",
  company: "company",
  country: "country",
  stage: "stage",
  score: "score",
  lastActivity: "activity",
  created: "created",
  followUp: "followUp",
};

/**
 * Filtr widoku -> parametry filtra listy. Jedyne miejsce, które tłumaczy
 * „ostatnie 7 dni" na konkretną datę graniczną; klient i serwer dostają tę samą
 * datę, więc `applyLeadFilter` i SQL nie mogą się rozjechać na granicy zakresu.
 */
export function leadFilterToListParams(f: LeadFilter, now = Date.now()): LeadListFilterParams {
  const params: LeadListFilterParams = {};
  if (f.stage !== "any") params.stage = f.stage;
  if (f.band !== "any") params.band = f.band;
  if (f.source !== "any") params.source = f.source;
  if (f.country) params.country = f.country;
  if (f.company) params.company = f.company;
  if (f.consentOnly) params.consent_only = true;
  if (f.createdRange !== "any") {
    params.created_from = new Date(now - RANGE_DAYS[f.createdRange] * 86_400_000).toISOString();
  }
  if (f.activityRange !== "any") {
    params.activity_from = new Date(now - RANGE_DAYS[f.activityRange] * 86_400_000).toISOString();
  }
  return params;
}

/**
 * Tłumaczy konfigurację widoku (filtr + sort) na parametry listCrmLeads.
 * Przy paginacji serwerowej filtrowanie/sortowanie MUSI liczyć się w SQL -
 * inaczej strona i total kłamałyby o globalnym zbiorze.
 */
export function leadViewToServerParams(
  config: LeadViewConfig,
  now = Date.now(),
): LeadListServerParams {
  return {
    ...leadFilterToListParams(config.filter, now),
    sort: SORT_KEY_TO_SERVER[config.sort.key],
    sort_dir: config.sort.dir,
  };
}

/* ---------- Klientowa aplikacja filtrów ---------- */

export interface LeadRowShape {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  position?: string | null;
  company: string | null;
  country?: string | null;
  stage: "new" | "contacted" | "qualified" | "proposal" | "won" | "lost" | "archived";
  score: number;
  score_band: ScoreBand;
  tags: string[] | null;
  marketing_consent: boolean;
  newsletter_status: string | null;
  source_count: number | null;
  last_activity_at: string;
  created_at: string;
  follow_up_at: string | null;
}

/**
 * Filtr widoku na TABLICY wierszy. To ta sama reguła, którą serwer zamienia na
 * SQL - różni się wyłącznie wykonaniem (predykat zamiast zapytania). Wcześniej
 * była tu druga, niezależna implementacja; patrz nagłówek `leadListSpec.ts`.
 */
export function applyLeadFilter<T extends LeadRowShape>(
  rows: T[],
  filter: LeadFilter,
  now = Date.now(),
): T[] {
  return filterLeadRows(rows, leadFilterToListParams(filter, now));
}

/**
 * Sort widoku na TABLICY wierszy - kolumny, kierunek, miejsce NULL-i
 * i tiebreaker bierze z tego samego opisu, co `ORDER BY` w SQL.
 */
export function applyLeadSort<T extends LeadRowShape>(rows: T[], sort: LeadSort): T[] {
  return sortLeadRows(rows, SORT_KEY_TO_SERVER[sort.key], sort.dir);
}

/* ---------- Export CSV ---------- */

export function leadRowsToCsv<T extends LeadRowShape>(
  rows: T[],
  columns: LeadColumnKey[],
  lang: "pl" | "en",
): string {
  const escape = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n;]/.test(s) ? `"${s}"` : s;
  };
  const cols = columns.map((k) => LEAD_COLUMN_BY_KEY[k]);
  const header = cols.map((c) => (lang === "pl" ? c.labelPl : c.labelEn)).join(",");
  const body = rows.map((r) =>
    columns
      .map((k) => {
        switch (k) {
          case "name":
            return escape([r.first_name, r.last_name].filter(Boolean).join(" ") || r.email);
          case "email":
            return escape(r.email);
          case "phone":
            return escape(r.phone);
          case "position":
            return escape(r.position ?? null);
          case "company":
            return escape(r.company);
          case "country":
            return escape(r.country ?? null);
          case "stage":
            return escape(r.stage);
          case "score":
            // `crm_leads.score` jest NOT NULL DEFAULT 0 (migracja 20260718130000),
            // więc nie ma tu czego domykać `?? 0`.
            return escape(r.score);
          case "band":
            return escape(r.score_band);
          case "source":
            return escape(inferLeadSource(r));
          case "tags":
            return escape((r.tags ?? []).join(" | "));
          case "consent":
            return escape(r.marketing_consent ? "yes" : "no");
          case "lastActivity":
            return escape(r.last_activity_at);
          case "created":
            return escape(r.created_at);
          case "followUp":
            return escape(r.follow_up_at);
        }
      })
      .join(","),
  );
  return [header, ...body].join("\n");
}
