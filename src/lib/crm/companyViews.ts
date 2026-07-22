// Definicje kolumn, filtrów oraz zapisanych widoków dla listy firm CRM
// (`/admin/companies`). Serwer trzyma `config` jako JSONB - tutaj żyje jego
// walidacja (Zod) i domyślne wartości. Wszystko client-safe, bez side effects.
import { z } from "zod";

/* ---------- Filtry ---------- */

export const CompanyFilterSchema = z.object({
  country: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  hasLeads: z.enum(["any", "with", "without"]).default("any"),
  createdRange: z.enum(["any", "7d", "30d", "90d", "365d"]).default("any"),
  activityRange: z.enum(["any", "7d", "30d", "90d"]).default("any"),
  minLeads: z.number().int().min(0).nullable().default(null),
});
export type CompanyFilter = z.infer<typeof CompanyFilterSchema>;

export const DEFAULT_COMPANY_FILTER: CompanyFilter = {
  country: null,
  branch: null,
  hasLeads: "any",
  createdRange: "any",
  activityRange: "any",
  minLeads: null,
};

export function isDefaultFilter(f: CompanyFilter): boolean {
  return (
    f.country === null &&
    f.branch === null &&
    f.hasLeads === "any" &&
    f.createdRange === "any" &&
    f.activityRange === "any" &&
    (f.minLeads === null || f.minLeads === 0)
  );
}

/* ---------- Kolumny ---------- */

export type CompanyColumnKey =
  | "name"
  | "domain"
  | "branch"
  | "location"
  | "country"
  | "contacts"
  | "leads"
  | "phone"
  | "website"
  | "lastActivity"
  | "created";

export interface CompanyColumnDef {
  key: CompanyColumnKey;
  labelPl: string;
  labelEn: string;
  align?: "left" | "right";
  sortable?: boolean;
  required?: boolean; // nie da się ukryć (Firma)
  minWidth?: number;
}

export const COMPANY_COLUMNS: readonly CompanyColumnDef[] = [
  { key: "name", labelPl: "Firma", labelEn: "Company", sortable: true, required: true, minWidth: 260 },
  { key: "domain", labelPl: "Domena", labelEn: "Domain", minWidth: 140 },
  { key: "branch", labelPl: "Branża", labelEn: "Industry", sortable: true, minWidth: 140 },
  { key: "location", labelPl: "Lokalizacja", labelEn: "Location", minWidth: 160 },
  { key: "country", labelPl: "Kraj", labelEn: "Country", sortable: true, minWidth: 120 },
  { key: "contacts", labelPl: "Kontakty", labelEn: "Contacts", align: "right", sortable: true, minWidth: 96 },
  { key: "leads", labelPl: "Leady", labelEn: "Leads", align: "right", sortable: true, minWidth: 96 },
  { key: "phone", labelPl: "Telefon", labelEn: "Phone", minWidth: 140 },
  { key: "website", labelPl: "WWW", labelEn: "Website", minWidth: 160 },
  { key: "lastActivity", labelPl: "Aktywność", labelEn: "Last activity", align: "right", sortable: true, minWidth: 140 },
  { key: "created", labelPl: "Utworzono", labelEn: "Created", align: "right", sortable: true, minWidth: 140 },
] as const;

export const COMPANY_COLUMN_BY_KEY = Object.fromEntries(
  COMPANY_COLUMNS.map((c) => [c.key, c] as const),
) as Record<CompanyColumnKey, CompanyColumnDef>;

/* ---------- Sortowanie ---------- */

export const CompanySortSchema = z.object({
  key: z.enum(["name", "branch", "country", "contacts", "leads", "lastActivity", "created"]),
  dir: z.enum(["asc", "desc"]),
});
export type CompanySort = z.infer<typeof CompanySortSchema>;

export const DEFAULT_COMPANY_SORT: CompanySort = { key: "lastActivity", dir: "desc" };

/* ---------- Konfiguracja widoku (persist) ---------- */

const CompanyColumnKeySchema = z.enum([
  "name",
  "domain",
  "branch",
  "location",
  "country",
  "contacts",
  "leads",
  "phone",
  "website",
  "lastActivity",
  "created",
]);

export const CompanyViewConfigSchema = z.object({
  columns: z.array(CompanyColumnKeySchema).min(1).default(["name", "branch", "location", "contacts", "leads", "lastActivity"]),
  filter: CompanyFilterSchema.default(DEFAULT_COMPANY_FILTER),
  sort: CompanySortSchema.default(DEFAULT_COMPANY_SORT),
});
export type CompanyViewConfig = z.infer<typeof CompanyViewConfigSchema>;

export const DEFAULT_COMPANY_VIEW_CONFIG: CompanyViewConfig = {
  columns: ["name", "branch", "location", "contacts", "leads", "lastActivity"],
  filter: DEFAULT_COMPANY_FILTER,
  sort: DEFAULT_COMPANY_SORT,
};

export function parseCompanyViewConfig(raw: unknown): CompanyViewConfig {
  const p = CompanyViewConfigSchema.safeParse(raw);
  return p.success ? p.data : DEFAULT_COMPANY_VIEW_CONFIG;
}

/* ---------- Wbudowane widoki ---------- */

export interface BuiltinView {
  id: string;
  labelPl: string;
  labelEn: string;
  config: CompanyViewConfig;
}

export const BUILTIN_COMPANY_VIEWS: readonly BuiltinView[] = [
  {
    id: "builtin:all",
    labelPl: "Wszystkie firmy",
    labelEn: "All companies",
    config: DEFAULT_COMPANY_VIEW_CONFIG,
  },
  {
    id: "builtin:with-leads",
    labelPl: "Z leadami",
    labelEn: "With leads",
    config: {
      ...DEFAULT_COMPANY_VIEW_CONFIG,
      filter: { ...DEFAULT_COMPANY_FILTER, hasLeads: "with" },
      sort: { key: "leads", dir: "desc" },
    },
  },
  {
    id: "builtin:recent",
    labelPl: "Nowe (30 dni)",
    labelEn: "New (30 days)",
    config: {
      ...DEFAULT_COMPANY_VIEW_CONFIG,
      filter: { ...DEFAULT_COMPANY_FILTER, createdRange: "30d" },
      sort: { key: "created", dir: "desc" },
    },
  },
  {
    id: "builtin:active",
    labelPl: "Ostatnia aktywność",
    labelEn: "Recent activity",
    config: {
      ...DEFAULT_COMPANY_VIEW_CONFIG,
      filter: { ...DEFAULT_COMPANY_FILTER, activityRange: "30d" },
      sort: { key: "lastActivity", dir: "desc" },
    },
  },
] as const;

/* ---------- Aplikowanie filtrów po stronie klienta ---------- */

export interface CompanyRowShape {
  id: string;
  name: string;
  domain: string | null;
  country: string | null;
  branch: string | null;
  city: string | null;
  created_at: string;
  updated_at: string;
  leads_count: number;
  contacts_count: number;
  last_lead_activity_at: string | null;
}

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 };

export function applyCompanyFilter<T extends CompanyRowShape>(rows: T[], filter: CompanyFilter): T[] {
  const now = Date.now();
  return rows.filter((r) => {
    if (filter.country && r.country !== filter.country) return false;
    if (filter.branch && r.branch !== filter.branch) return false;
    if (filter.hasLeads === "with" && r.leads_count <= 0) return false;
    if (filter.hasLeads === "without" && r.leads_count > 0) return false;
    if (typeof filter.minLeads === "number" && filter.minLeads > 0 && r.leads_count < filter.minLeads) return false;
    if (filter.createdRange !== "any") {
      const d = RANGE_DAYS[filter.createdRange];
      if (d && now - new Date(r.created_at).getTime() > d * 86_400_000) return false;
    }
    if (filter.activityRange !== "any") {
      const d = RANGE_DAYS[filter.activityRange];
      const last = r.last_lead_activity_at ?? r.updated_at;
      if (d && now - new Date(last).getTime() > d * 86_400_000) return false;
    }
    return true;
  });
}

export function applyCompanySort<T extends CompanyRowShape>(rows: T[], sort: CompanySort): T[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort.key) {
      case "name":
        return a.name.localeCompare(b.name) * dir;
      case "branch":
        return (a.branch ?? "").localeCompare(b.branch ?? "") * dir;
      case "country":
        return (a.country ?? "").localeCompare(b.country ?? "") * dir;
      case "contacts":
        return (a.contacts_count - b.contacts_count) * dir;
      case "leads":
        return (a.leads_count - b.leads_count) * dir;
      case "created":
        return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
      case "lastActivity":
      default: {
        const la = new Date(a.last_lead_activity_at ?? a.updated_at).getTime();
        const lb = new Date(b.last_lead_activity_at ?? b.updated_at).getTime();
        return (la - lb) * dir;
      }
    }
  });
  return out;
}

/* ---------- Export CSV ---------- */

export function rowsToCsv<T extends CompanyRowShape>(
  rows: T[],
  columns: CompanyColumnKey[],
  lang: "pl" | "en",
): string {
  const escape = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n;]/.test(s) ? `"${s}"` : s;
  };
  const cols = columns.map((k) => COMPANY_COLUMN_BY_KEY[k]);
  const header = cols.map((c) => (lang === "pl" ? c.labelPl : c.labelEn)).join(",");
  const body = rows.map((r) =>
    columns
      .map((k) => {
        switch (k) {
          case "name": return escape(r.name);
          case "domain": return escape(r.domain);
          case "branch": return escape(r.branch);
          case "location": return escape([r.city, r.country].filter(Boolean).join(", "));
          case "country": return escape(r.country);
          case "contacts": return escape(r.contacts_count);
          case "leads": return escape(r.leads_count);
          case "phone": return escape((r as unknown as { phone: string | null }).phone ?? null);
          case "website": return escape((r as unknown as { website: string | null }).website ?? null);
          case "lastActivity": return escape(r.last_lead_activity_at ?? r.updated_at);
          case "created": return escape(r.created_at);
          default: return "";
        }
      })
      .join(","),
  );
  return [header, ...body].join("\n");
}
