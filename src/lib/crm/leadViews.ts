// Definicje kolumn, filtrów oraz zapisanych widoków dla listy osób CRM
// (`/admin/crm`). Analogiczne do `companyViews.ts` - serwer trzyma `config`
// jako JSONB, tutaj mieszka walidacja (Zod), defaulty i helpery client-side.
import { z } from "zod";
import type { ScoreBand } from "@/lib/crm/scoring";

/* ---------- Filtry ---------- */

export const LeadFilterSchema = z.object({
  stage: z.enum(["any", "new", "contacted", "qualified", "proposal", "won", "lost", "archived"]).default("any"),
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
  { key: "name", labelPl: "Osoba", labelEn: "Contact", sortable: true, required: true, minWidth: 240 },
  { key: "email", labelPl: "E-mail", labelEn: "Email", minWidth: 200 },
  { key: "phone", labelPl: "Telefon", labelEn: "Phone", minWidth: 140 },
  { key: "position", labelPl: "Stanowisko", labelEn: "Position", minWidth: 160 },
  { key: "company", labelPl: "Firma", labelEn: "Company", sortable: true, minWidth: 180 },
  { key: "country", labelPl: "Kraj", labelEn: "Country", sortable: true, minWidth: 120 },
  { key: "stage", labelPl: "Etap", labelEn: "Stage", sortable: true, minWidth: 120 },
  { key: "score", labelPl: "Score", labelEn: "Score", align: "right", sortable: true, minWidth: 96 },
  { key: "band", labelPl: "Poziom", labelEn: "Band", minWidth: 100 },
  { key: "source", labelPl: "Źródło", labelEn: "Source", minWidth: 120 },
  { key: "tags", labelPl: "Tagi", labelEn: "Tags", minWidth: 160 },
  { key: "consent", labelPl: "Zgoda", labelEn: "Consent", minWidth: 100 },
  { key: "lastActivity", labelPl: "Aktywność", labelEn: "Last activity", align: "right", sortable: true, minWidth: 140 },
  { key: "created", labelPl: "Utworzono", labelEn: "Created", align: "right", sortable: true, minWidth: 140 },
  { key: "followUp", labelPl: "Follow-up", labelEn: "Follow-up", align: "right", sortable: true, minWidth: 140 },
] as const;

export const LEAD_COLUMN_BY_KEY = Object.fromEntries(
  LEAD_COLUMNS.map((c) => [c.key, c] as const),
) as Record<LeadColumnKey, LeadColumnDef>;

/* ---------- Sortowanie ---------- */

export const LeadSortSchema = z.object({
  key: z.enum(["name", "company", "country", "stage", "score", "lastActivity", "created", "followUp"]),
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
  columns: z.array(LeadColumnKeySchema).min(1).default(["name", "email", "company", "stage", "score", "lastActivity"]),
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

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 };

function inferSource(r: LeadRowShape): "form" | "newsletter" | "import" {
  if (r.newsletter_status) return "newsletter";
  if ((r.source_count ?? 0) > 0) return "form";
  return "import";
}

export function applyLeadFilter<T extends LeadRowShape>(rows: T[], filter: LeadFilter): T[] {
  const now = Date.now();
  return rows.filter((r) => {
    if (filter.stage !== "any" && r.stage !== filter.stage) return false;
    if (filter.band !== "any" && r.score_band !== filter.band) return false;
    if (filter.source !== "any" && inferSource(r) !== filter.source) return false;
    if (filter.country && (r.country ?? "") !== filter.country) return false;
    if (filter.company && (r.company ?? "") !== filter.company) return false;
    if (filter.consentOnly && !r.marketing_consent) return false;
    if (filter.createdRange !== "any") {
      const d = RANGE_DAYS[filter.createdRange];
      if (d && now - new Date(r.created_at).getTime() > d * 86_400_000) return false;
    }
    if (filter.activityRange !== "any") {
      const d = RANGE_DAYS[filter.activityRange];
      if (d && now - new Date(r.last_activity_at).getTime() > d * 86_400_000) return false;
    }
    return true;
  });
}

const STAGE_ORDER: Record<LeadRowShape["stage"], number> = {
  new: 0,
  contacted: 1,
  qualified: 2,
  proposal: 3,
  won: 4,
  lost: 5,
  archived: 6,
};

export function applyLeadSort<T extends LeadRowShape>(rows: T[], sort: LeadSort): T[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  const displayName = (r: T) =>
    [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.email;
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort.key) {
      case "name":
        return displayName(a).localeCompare(displayName(b)) * dir;
      case "company":
        return (a.company ?? "").localeCompare(b.company ?? "") * dir;
      case "country":
        return (a.country ?? "").localeCompare(b.country ?? "") * dir;
      case "stage":
        return (STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]) * dir;
      case "score":
        return ((a.score ?? 0) - (b.score ?? 0)) * dir;
      case "created":
        return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
      case "followUp": {
        const fa = a.follow_up_at ? new Date(a.follow_up_at).getTime() : Number.POSITIVE_INFINITY;
        const fb = b.follow_up_at ? new Date(b.follow_up_at).getTime() : Number.POSITIVE_INFINITY;
        return (fa - fb) * dir;
      }
      case "lastActivity":
      default:
        return (new Date(a.last_activity_at).getTime() - new Date(b.last_activity_at).getTime()) * dir;
    }
  });
  return out;
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
          case "email": return escape(r.email);
          case "phone": return escape(r.phone);
          case "position": return escape(r.position ?? null);
          case "company": return escape(r.company);
          case "country": return escape(r.country ?? null);
          case "stage": return escape(r.stage);
          case "score": return escape(r.score ?? 0);
          case "band": return escape(r.score_band);
          case "source": return escape(inferSource(r));
          case "tags": return escape((r.tags ?? []).join(" | "));
          case "consent": return escape(r.marketing_consent ? "yes" : "no");
          case "lastActivity": return escape(r.last_activity_at);
          case "created": return escape(r.created_at);
          case "followUp": return escape(r.follow_up_at);
          default: return "";
        }
      })
      .join(","),
  );
  return [header, ...body].join("\n");
}
