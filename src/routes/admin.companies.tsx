// Admin: lista firm CRM (`crm_companies`) w stylu HubSpot.
// Widok read-only z: statystykami, filtrami (kraj/branża), sortowaniem,
// wyszukiwarką, gęstą tabelą i wielo-zaznaczeniem. Klik w wiersz otwiera
// `/admin/companies/:id`. Zabezpieczone przez `requireStaff` w server-fn
// oraz `_authenticated` layout w AdminShell.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";

import { listCrmCompanies } from "@/lib/crm-companies.functions";
import { CompanyDetailsDrawer } from "@/components/admin/crm/CompanyDetailsDrawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Filter,
  Phone,
  Plus,
} from "lucide-react";

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

type SortKey = "name" | "leads" | "contacts" | "updated" | "country";
type SortDir = "asc" | "desc";

export const Route = createFileRoute("/admin/companies")({
  head: () => ({
    meta: [
      { title: "Firmy CRM | Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
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
  if (!iso) return lang === "pl" ? "-" : "-";
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
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState<string>("all");
  const [branch, setBranch] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const listFn = useServerFn(listCrmCompanies);

  const query = useQuery({
    queryKey: ["admin", "crm-companies", search],
    queryFn: async () => {
      const res = await listFn({ data: { search: search || undefined, limit: 200 } });
      return JSON.parse(res.json) as CompanyRow[];
    },
    staleTime: 30_000,
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);

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

  const filtered = useMemo(() => {
    let out = rows;
    if (country !== "all") out = out.filter((r) => r.country === country);
    if (branch !== "all") out = out.filter((r) => r.branch === branch);
    const dir = sortDir === "asc" ? 1 : -1;
    const sorted = [...out].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "leads":
          return (a.leads_count - b.leads_count) * dir;
        case "contacts":
          return (a.contacts_count - b.contacts_count) * dir;
        case "country":
          return (a.country ?? "").localeCompare(b.country ?? "") * dir;
        case "updated":
        default:
          return ((new Date(a.updated_at).getTime()) - (new Date(b.updated_at).getTime())) * dir;
      }
    });
    return sorted;
  }, [rows, country, branch, sortKey, sortDir]);

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

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" || key === "country" ? "asc" : "desc");
    }
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

  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);

  return (
    <div className="mx-auto w-full max-w-[92rem] space-y-5 p-4 lg:p-6">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
            <Building2 className="h-4.5 w-4.5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">{t("Firmy", "Companies")}</h1>
            <p className="text-xs text-muted-foreground">
              {t("Baza firm CRM z powiązanymi kontaktami i leadami", "CRM company database with linked contacts and leads")}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/admin/crm">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {t("CRM", "CRM")}
            </Button>
          </Link>
          <Button variant="outline" size="sm" className="gap-1.5" disabled>
            <Download className="h-3.5 w-3.5" aria-hidden />
            {t("Eksport", "Export")}
          </Button>
          <Button size="sm" className="gap-1.5" disabled>
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
          label={t("Nowe w tym miesiącu", "New this month")}
          value={stats.newThisMonth}
          icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
          tone="violet"
        />
      </section>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Szukaj firmy, domeny, miasta…", "Search company, domain, city…")}
            className="h-9 pl-8 text-[13px]"
            aria-label={t("Szukaj firmy", "Search company")}
          />
        </div>
        <Select value={country} onValueChange={setCountry}>
          <SelectTrigger className="h-9 w-[160px] text-[13px]">
            <MapPin className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <SelectValue placeholder={t("Kraj", "Country")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Wszystkie kraje", "All countries")}</SelectItem>
            {countries.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={branch} onValueChange={setBranch}>
          <SelectTrigger className="h-9 w-[180px] text-[13px]">
            <Filter className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <SelectValue placeholder={t("Branża", "Industry")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Wszystkie branże", "All industries")}</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
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
                <SortHeader
                  label={t("Firma", "Company")}
                  active={sortKey === "name"}
                  dir={sortDir}
                  onClick={() => toggleSort("name")}
                />
                <SortHeader
                  label={t("Branża", "Industry")}
                  active={sortKey === "country"}
                  dir={sortDir}
                  onClick={() => toggleSort("country")}
                  align="left"
                />
                <th className="px-3 py-2 text-left font-medium">{t("Lokalizacja", "Location")}</th>
                <SortHeader
                  label={t("Kontakty", "Contacts")}
                  active={sortKey === "contacts"}
                  dir={sortDir}
                  onClick={() => toggleSort("contacts")}
                  align="right"
                />
                <SortHeader
                  label={t("Leady", "Leads")}
                  active={sortKey === "leads"}
                  dir={sortDir}
                  onClick={() => toggleSort("leads")}
                  align="right"
                />
                <SortHeader
                  label={t("Aktywność", "Last activity")}
                  active={sortKey === "updated"}
                  dir={sortDir}
                  onClick={() => toggleSort("updated")}
                  align="right"
                />
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b last:border-b-0">
                    <td colSpan={8} className="px-3 py-3">
                      <div className="h-9 animate-pulse rounded bg-muted/60" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-sm text-muted-foreground">
                    <Building2 className="mx-auto mb-2 h-8 w-8 opacity-40" aria-hidden />
                    {t("Brak firm spełniających kryteria.", "No companies match your filters.")}
                  </td>
                </tr>
              ) : (
                filtered.map((c) => {
                  const checked = selected.has(c.id);
                  const location = [c.city, c.country].filter(Boolean).join(", ");
                  const lastActivity = c.last_lead_activity_at ?? c.updated_at;
                  return (
                    <tr
                      key={c.id}
                      className="group cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/40 data-[selected=true]:bg-primary/5"
                      data-selected={checked || undefined}
                      onClick={() => navigate({ to: "/admin/companies/$id", params: { id: c.id } })}
                    >
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setSelected((prev) => {
                              const s = new Set(prev);
                              if (v) s.add(c.id);
                              else s.delete(c.id);
                              return s;
                            });
                          }}
                          aria-label={c.name}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <LogoCell name={c.name} domain={c.domain} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-medium text-foreground">{c.name}</span>
                              {c.website && (
                                <a
                                  href={c.website}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label={c.website}
                                >
                                  <ExternalLink className="h-3 w-3" aria-hidden />
                                </a>
                              )}
                            </div>
                            {c.domain && (
                              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <Globe className="h-2.5 w-2.5" aria-hidden />
                                <span className="truncate">{c.domain}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {c.branch ? (
                          <Badge
                            variant="secondary"
                            className="rounded-md bg-secondary/60 px-2 py-0.5 text-[11px] font-normal"
                          >
                            {c.branch}
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/60">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {location ? (
                          <span className="inline-flex items-center gap-1 text-[12px]">
                            <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                            <span className="truncate">{location}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/60">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <CountPill value={c.contacts_count} tone="sky" />
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <CountPill value={c.leads_count} tone="amber" />
                      </td>
                      <td className="px-3 py-2.5 text-right text-[12px] text-muted-foreground">
                        {formatRelative(lastActivity, lang)}
                      </td>
                      <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        {c.phone && (
                          <a
                            href={`tel:${c.phone}`}
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                            aria-label={c.phone}
                          >
                            <Phone className="h-3 w-3" aria-hidden />
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"} font-medium`}>
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
