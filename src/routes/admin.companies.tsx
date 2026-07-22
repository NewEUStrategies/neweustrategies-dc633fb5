// Admin: lista firm CRM (`crm_companies`) w stylu HubSpot z pełnym zestawem:
// zakładki zapisanych widoków (`saved_views`), menedżer kolumn, chip-filtry,
// sortowanie kolumn, eksport CSV. Klik w wiersz otwiera drawer podsumowania;
// klik w nazwę firmy przenosi do pełnego widoku `/admin/companies/:id`.
// RLS scope'uje po tenancie (server functions używają `requireStaff`).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { listCrmCompanies } from "@/lib/crm-companies.functions";
import {
  listSavedViews,
  upsertSavedView,
  deleteSavedView,
} from "@/lib/crm-saved-views.functions";
import { CompanyDetailsDrawer } from "@/components/admin/crm/CompanyDetailsDrawer";
import { CompanyViewTabs, type SavedViewRow } from "@/components/admin/crm/CompanyViewTabs";
import { CompanyColumnManager } from "@/components/admin/crm/CompanyColumnManager";
import { CompanyFilterChips } from "@/components/admin/crm/CompanyFilterChips";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Search,
  ExternalLink,
  Globe,
  Users,
  Target,
  MapPin,
  ArrowUpDown,
  Download,
  Phone,
  Plus,
  ChevronRight,
} from "lucide-react";
import {
  BUILTIN_COMPANY_VIEWS,
  COMPANY_COLUMNS,
  DEFAULT_COMPANY_VIEW_CONFIG,
  applyCompanyFilter,
  applyCompanySort,
  parseCompanyViewConfig,
  rowsToCsv,
  type CompanyColumnKey,
  type CompanyFilter,
  type CompanySort,
  type CompanyViewConfig,
} from "@/lib/crm/companyViews";

type CompanyRow = {
  id: string;
  name: string;
  domain: string | null;
  country: string | null;
  branch: string | null;
  city: string | null;
  address: string | null;
  postal_code: string | null;
  website: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
  leads_count: number;
  contacts_count: number;
  last_lead_activity_at: string | null;
};

export const Route = createFileRoute("/admin/companies")({
  head: () => ({
    meta: [
      { title: "Firmy CRM | Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { company?: string; view?: string } => {
    const company =
      typeof search.company === "string" && /^[0-9a-f-]{36}$/i.test(search.company)
        ? search.company
        : undefined;
    const view = typeof search.view === "string" && search.view.length < 80 ? search.view : undefined;
    const out: { company?: string; view?: string } = {};
    if (company) out.company = company;
    if (view) out.view = view;
    return out;
  },
  component: AdminCompaniesPage,
});

const HUE_PALETTE = [210, 340, 32, 165, 262, 12, 195, 285, 55, 130];

function companyAccent(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = HUE_PALETTE[h % HUE_PALETTE.length];
  return {
    background: `hsl(${hue} 78% 96%)`,
    color: `hsl(${hue} 55% 32%)`,
    ring: `hsl(${hue} 60% 45% / 0.25)`,
  };
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelative(iso: string | null, lang: "pl" | "en"): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const day = 86_400_000;
  if (diff < day) return lang === "pl" ? "dzisiaj" : "today";
  if (diff < 2 * day) return lang === "pl" ? "wczoraj" : "yesterday";
  if (diff < 30 * day) {
    const n = Math.floor(diff / day);
    return lang === "pl" ? `${n} d temu` : `${n}d ago`;
  }
  return d.toLocaleDateString(lang === "pl" ? "pl-PL" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function LogoCell({ name, domain }: { name: string; domain: string | null }) {
  const accent = companyAccent(name);
  const [imgOk, setImgOk] = useState(true);
  const src = domain
    ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`
    : null;
  return (
    <div
      className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md text-[11px] font-semibold ring-1"
      style={{ background: accent.background, color: accent.color, boxShadow: `0 0 0 1px ${accent.ring}` }}
      aria-hidden
    >
      {src && imgOk ? (
        <img
          src={src}
          alt=""
          className="h-5 w-5 object-contain"
          onError={() => setImgOk(false)}
          loading="lazy"
        />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}

function AdminCompaniesPage() {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language?.startsWith("en") ? "en" : "pl";
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const { company: drawerId, view: urlView } = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();

  const setDrawerId = (id: string | null) => {
    void navigate({
      search: (prev: { company?: string; view?: string }) => ({
        ...prev,
        company: id ?? undefined,
      }),
      replace: false,
    });
  };

  const listFn = useServerFn(listCrmCompanies);
  const listSavedFn = useServerFn(listSavedViews);
  const upsertFn = useServerFn(upsertSavedView);
  const deleteFn = useServerFn(deleteSavedView);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [config, setConfig] = useState<CompanyViewConfig>(DEFAULT_COMPANY_VIEW_CONFIG);
  const [activeViewId, setActiveViewId] = useState<string>(urlView ?? "builtin:all");

  const setActive = (id: string, cfg: CompanyViewConfig) => {
    setActiveViewId(id);
    setConfig(cfg);
    void navigate({
      search: (prev: { company?: string; view?: string }) => ({ ...prev, view: id }),
      replace: true,
    });
  };

  const companiesQuery = useQuery({
    queryKey: ["admin", "crm-companies", search],
    queryFn: async () => {
      const res = await listFn({ data: { search: search || undefined, limit: 200 } });
      return JSON.parse(res.json) as CompanyRow[];
    },
    staleTime: 30_000,
  });

  const savedQuery = useQuery({
    queryKey: ["admin", "saved-views", "company"],
    queryFn: async () => {
      const res = await listSavedFn({ data: { entity: "company" } });
      return JSON.parse(res.json) as SavedViewRow[];
    },
    staleTime: 60_000,
  });

  const saved = savedQuery.data ?? [];

  // Podnieś aktywny widok z URL jeśli udostępniony link zawiera zapisany id.
  useEffect(() => {
    if (!urlView) return;
    const builtin = BUILTIN_COMPANY_VIEWS.find((v) => v.id === urlView);
    if (builtin) {
      setActiveViewId(builtin.id);
      setConfig(builtin.config);
      return;
    }
    const s = saved.find((v) => v.id === urlView);
    if (s) {
      setActiveViewId(s.id);
      setConfig(parseCompanyViewConfig(s.config));
    }
  }, [urlView, saved]);

  const createView = useMutation({
    mutationFn: async ({ name, isShared }: { name: string; isShared: boolean }) =>
      upsertFn({ data: { entity: "company", name, config, is_shared: isShared } }),
    onSuccess: async (res) => {
      toast.success(t("Widok zapisany", "View saved"));
      await qc.invalidateQueries({ queryKey: ["admin", "saved-views", "company"] });
      if (res.id) setActiveViewId(res.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renameView = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const v = saved.find((s) => s.id === id);
      if (!v) throw new Error("not_found");
      return upsertFn({
        data: {
          id,
          entity: "company",
          name,
          config: v.config,
          is_shared: v.is_shared,
        },
      });
    },
    onSuccess: async () => {
      toast.success(t("Nazwa zmieniona", "Renamed"));
      await qc.invalidateQueries({ queryKey: ["admin", "saved-views", "company"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleShared = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: boolean }) => {
      const v = saved.find((s) => s.id === id);
      if (!v) throw new Error("not_found");
      return upsertFn({
        data: { id, entity: "company", name: v.name, config: v.config, is_shared: next },
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "saved-views", "company"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeView = useMutation({
    mutationFn: async (id: string) => deleteFn({ data: { id } }),
    onSuccess: async () => {
      toast.success(t("Widok usunięty", "View deleted"));
      await qc.invalidateQueries({ queryKey: ["admin", "saved-views", "company"] });
      setActiveViewId("builtin:all");
      setConfig(DEFAULT_COMPANY_VIEW_CONFIG);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => companiesQuery.data ?? [], [companiesQuery.data]);

  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.country) set.add(r.country);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const branches = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.branch) set.add(r.branch);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(
    () => applyCompanySort(applyCompanyFilter(rows, config.filter), config.sort),
    [rows, config.filter, config.sort],
  );

  const stats = useMemo(() => {
    const withLeads = rows.filter((r) => r.leads_count > 0).length;
    const totalContacts = rows.reduce((s, r) => s + r.contacts_count, 0);
    const totalLeads = rows.reduce((s, r) => s + r.leads_count, 0);
    const now = Date.now();
    const newThisMonth = rows.filter(
      (r) => now - new Date(r.created_at).getTime() < 30 * 86_400_000,
    ).length;
    return { total: rows.length, withLeads, totalContacts, totalLeads, newThisMonth };
  }, [rows]);

  const setFilter = (f: CompanyFilter) => setConfig((c) => ({ ...c, filter: f }));
  const setColumns = (cols: CompanyColumnKey[]) =>
    setConfig((c) => ({ ...c, columns: cols }));

  const toggleSort = (key: CompanySort["key"]) => {
    setConfig((c) => {
      if (c.sort.key === key) {
        return { ...c, sort: { key, dir: c.sort.dir === "asc" ? "desc" : "asc" } };
      }
      const dir: "asc" | "desc" =
        key === "name" || key === "branch" || key === "country" ? "asc" : "desc";
      return { ...c, sort: { key, dir } };
    });
  };

  const allChecked = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const toggleAll = () => {
    setSelected((prev) => {
      if (allChecked) return new Set();
      const s = new Set(prev);
      for (const r of filtered) s.add(r.id);
      return s;
    });
  };

  const exportCsv = () => {
    const csv = rowsToCsv(filtered, config.columns, lang);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `companies-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t(`Wyeksportowano ${filtered.length} firm`, `Exported ${filtered.length} companies`));
  };

  const visibleCols = COMPANY_COLUMNS.filter((c) => config.columns.includes(c.key));

  return (
    <div className="mx-auto w-full max-w-[92rem] space-y-4 p-4 lg:p-6">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
            <Building2 className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">{t("Firmy", "Companies")}</h1>
            <p className="text-xs text-muted-foreground">
              {t(
                "Baza firm CRM z powiązanymi kontaktami i leadami",
                "CRM company database with linked contacts and leads",
              )}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/admin/crm">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {t("CRM", "CRM")}
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            className="h-8 gap-1.5 text-[12px]"
            disabled={filtered.length === 0}
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {t("Eksport CSV", "Export CSV")}
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-[12px]" disabled>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("Nowa firma", "New company")}
          </Button>
        </div>
      </header>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-5">
        <StatCard
          label={t("Wszystkie firmy", "Total companies")}
          value={stats.total}
          icon={<Building2 className="h-3.5 w-3.5" aria-hidden />}
        />
        <StatCard
          label={t("Kontakty", "Contacts")}
          value={stats.totalContacts}
          icon={<Users className="h-3.5 w-3.5" aria-hidden />}
          tone="sky"
        />
        <StatCard
          label={t("Leady", "Leads")}
          value={stats.totalLeads}
          icon={<Target className="h-3.5 w-3.5" aria-hidden />}
          tone="amber"
        />
        <StatCard
          label={t("Z leadami", "With leads")}
          value={stats.withLeads}
          icon={<Target className="h-3.5 w-3.5" aria-hidden />}
          tone="emerald"
        />
        <StatCard
          label={t("Nowe (30 dni)", "New (30d)")}
          value={stats.newThisMonth}
          icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
          tone="violet"
        />
      </section>

      {/* Saved view tabs */}
      <CompanyViewTabs
        lang={lang}
        activeId={activeViewId}
        onSelect={setActive}
        saved={saved}
        currentConfig={config}
        onCreate={async (name, isShared) => {
          await createView.mutateAsync({ name, isShared });
        }}
        onRename={async (id, name) => {
          await renameView.mutateAsync({ id, name });
        }}
        onDelete={async (id) => {
          await removeView.mutateAsync(id);
        }}
        onToggleShared={async (id, next) => {
          await toggleShared.mutateAsync({ id, next });
        }}
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Szukaj firmy, domeny, miasta…", "Search company, domain, city…")}
            className="h-8 pl-8 text-[12px]"
            aria-label={t("Szukaj firmy", "Search company")}
          />
        </div>
        <CompanyFilterChips
          lang={lang}
          value={config.filter}
          onChange={setFilter}
          countries={countries}
          branches={branches}
        />
        <div className="ml-auto flex items-center gap-2">
          <CompanyColumnManager lang={lang} active={config.columns} onChange={setColumns} />
        </div>
      </div>

      {/* Results meta */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {selected.size > 0 ? (
          <span className="rounded bg-primary/10 px-2 py-1 font-medium text-primary">
            {t(`${selected.size} zaznaczono`, `${selected.size} selected`)}
          </span>
        ) : (
          <span>
            {t(
              `${filtered.length} z ${rows.length} firm`,
              `${filtered.length} of ${rows.length} companies`,
            )}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-md border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="border-b bg-muted/40 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <th className="w-9 px-3 py-2 text-left">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={toggleAll}
                    aria-label={t("Zaznacz wszystkie", "Select all")}
                  />
                </th>
                {visibleCols.map((c) => (
                  <ColumnHeader
                    key={c.key}
                    column={c.key}
                    label={lang === "pl" ? c.labelPl : c.labelEn}
                    active={config.sort.key === c.key}
                    dir={config.sort.dir}
                    align={c.align}
                    sortable={c.sortable}
                    onClick={() =>
                      c.sortable && toggleSort(c.key as CompanySort["key"])
                    }
                  />
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {companiesQuery.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b last:border-b-0">
                    <td colSpan={visibleCols.length + 2} className="px-3 py-3">
                      <div className="h-9 animate-pulse rounded bg-muted/60" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleCols.length + 2}
                    className="px-6 py-12 text-center text-sm text-muted-foreground"
                  >
                    <Building2 className="mx-auto mb-2 h-8 w-8 opacity-40" aria-hidden />
                    {t("Brak firm spełniających kryteria.", "No companies match your filters.")}
                  </td>
                </tr>
              ) : (
                filtered.map((c) => {
                  const checked = selected.has(c.id);
                  return (
                    <tr
                      key={c.id}
                      className="group cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/40 data-[selected=true]:bg-primary/5"
                      data-selected={checked || undefined}
                      onClick={() =>
                        void navigate({ to: "/admin/companies/$id", params: { id: c.id } })
                      }
                    >
    </div>
  );
}

function Cell({
  row,
  col,
  lang,
}: {
  row: CompanyRow;
  col: CompanyColumnKey;
  lang: "pl" | "en";
}) {
  switch (col) {
    case "name":
      return (
        <div className="flex items-center gap-2.5">
          <LogoCell name={row.name} domain={row.domain} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-foreground">{row.name}</span>
              {row.website && (
                <a
                  href={row.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
                  aria-label={row.website}
                >
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              )}
            </div>
            {row.domain && (
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Globe className="h-2.5 w-2.5" aria-hidden />
                <span className="truncate">{row.domain}</span>
              </div>
            )}
          </div>
        </div>
      );
    case "domain":
      return row.domain ? (
        <span className="truncate text-[12px] text-muted-foreground">{row.domain}</span>
      ) : (
        <Dash />
      );
    case "branch":
      return row.branch ? (
        <Badge
          variant="secondary"
          className="rounded-md bg-secondary/60 px-2 py-0.5 text-[11px] font-normal"
        >
          {row.branch}
        </Badge>
      ) : (
        <Dash />
      );
    case "location": {
      const location = [row.city, row.country].filter(Boolean).join(", ");
      return location ? (
        <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
          <MapPin className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{location}</span>
        </span>
      ) : (
        <Dash />
      );
    }
    case "country":
      return row.country ? (
        <span className="text-[12px] text-muted-foreground">{row.country}</span>
      ) : (
        <Dash />
      );
    case "contacts":
      return <CountPill value={row.contacts_count} tone="sky" />;
    case "leads":
      return <CountPill value={row.leads_count} tone="amber" />;
    case "phone":
      return row.phone ? (
        <a
          href={`tel:${row.phone}`}
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <Phone className="h-3 w-3" aria-hidden />
          {row.phone}
        </a>
      ) : (
        <Dash />
      );
    case "website":
      return row.website ? (
        <a
          href={row.website}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 truncate text-[12px] text-primary hover:underline"
        >
          <span className="truncate">{row.website.replace(/^https?:\/\//, "")}</span>
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
        </a>
      ) : (
        <Dash />
      );
    case "lastActivity":
      return (
        <span className="text-[12px] text-muted-foreground">
          {formatRelative(row.last_lead_activity_at ?? row.updated_at, lang)}
        </span>
      );
    case "created":
      return (
        <span className="text-[12px] text-muted-foreground">
          {formatRelative(row.created_at, lang)}
        </span>
      );
    default:
      return null;
  }
}

function Dash() {
  return <span className="text-[11px] text-muted-foreground/60">-</span>;
}

function ColumnHeader({
  column,
  label,
  active,
  dir,
  onClick,
  align = "left",
  sortable,
}: {
  column: string;
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
  sortable?: boolean;
}) {
  return (
    <th
      className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"} font-medium`}
      data-col={column}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onClick}
          className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${
            active ? "text-foreground" : ""
          }`}
        >
          {label}
          <ArrowUpDown
            className={`h-3 w-3 transition-transform ${
              active ? "opacity-100" : "opacity-40"
            } ${active && dir === "asc" ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
      ) : (
        <span>{label}</span>
      )}
    </th>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone = "primary",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: "primary" | "sky" | "amber" | "emerald" | "violet";
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  };
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className={`grid h-6 w-6 place-items-center rounded ${tones[tone]}`}>{icon}</span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

function CountPill({ value, tone }: { value: number; tone: "sky" | "amber" }) {
  if (value === 0) {
    return <span className="text-[12px] text-muted-foreground/50">0</span>;
  }
  const tones: Record<string, string> = {
    sky: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  };
  return (
    <span
      className={`inline-flex min-w-[28px] items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${tones[tone]}`}
    >
      {value}
    </span>
  );
}
