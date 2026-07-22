// Admin: pełny widok firmy CRM w stylu HubSpot (3 kolumny):
//  - lewy rail: dane firmy + szybkie akcje (Notatka, Kontakt);
//  - główny obszar: zakładki Przegląd / Aktywność / Analityka;
//  - prawy sidebar: powiązania (Kontakty, Leady, Domena).
// Widoczne dla staff (`requireStaff` w server-fn); RLS zawęża po tenancie.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  Save,
  Pencil,
  ExternalLink,
  Globe,
  MapPin,
  Phone,
  Users,
  UserCircle2,
  Target,
  Activity,
  BarChart3,
  StickyNote,
  UserPlus,
  Copy,
  Calendar,
  ChevronRight,
} from "lucide-react";

import {
  getCrmCompany,
  updateCrmCompany,
  getCrmCompanyActivity,
  addCrmCompanyNote,
} from "@/lib/crm-companies.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

type Company = {
  id: string;
  tenant_id: string;
  name: string;
  domain: string | null;
  country: string | null;
  branch: string | null;
  city: string | null;
  address: string | null;
  postal_code: string | null;
  website: string | null;
  phone: string | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};
type LinkedProfile = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
  location: string | null;
  slug: string | null;
  contact_email: string | null;
  discoverable: boolean | null;
};
type LinkedLead = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  position: string | null;
  stage: string;
  tags: string[] | null;
  score: number | null;
  score_band: string | null;
  last_activity_at: string | null;
  created_at: string;
};
type ActivityEvent = {
  id: string;
  kind: "audit" | "note" | "lead_created";
  action: string;
  created_at: string;
  actor_id: string | null;
  lead_id: string | null;
  lead_label: string | null;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
};

type Tab = "overview" | "activity" | "analytics";

export const Route = createFileRoute("/admin/companies/$id")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => {
    const raw = search.tab;
    const tab: Tab | undefined =
      raw === "activity" || raw === "analytics" ? raw : raw === "overview" ? "overview" : undefined;
    return tab ? { tab } : {};
  },
  head: () => ({
    meta: [
      { title: "Firma | CRM | Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-3xl p-6 text-sm text-destructive" role="alert">
      {error.message}
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">
      Nie znaleziono firmy.
    </div>
  ),
  component: AdminCompanyDetailPage,
});

function AdminCompanyDetailPage() {
  const { id } = Route.useParams();
  const { tab = "overview" } = Route.useSearch();
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language?.startsWith("en") ? "en" : "pl";
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const navigate = Route.useNavigate();
  const rootNavigate = useNavigate();
  const qc = useQueryClient();
  const getFn = useServerFn(getCrmCompany);
  const updateFn = useServerFn(updateCrmCompany);
  const activityFn = useServerFn(getCrmCompanyActivity);
  const noteFn = useServerFn(addCrmCompanyNote);

  const query = useQuery({
    queryKey: ["admin", "crm-company", id],
    queryFn: async () => {
      const res = await getFn({ data: { id } });
      return JSON.parse(res.json) as {
        company: Company;
        profiles: LinkedProfile[];
        leads: LinkedLead[];
      };
    },
    staleTime: 15_000,
  });

  const activityQuery = useQuery({
    queryKey: ["admin", "crm-company-activity", id],
    queryFn: async () => {
      const res = await activityFn({ data: { id } });
      return JSON.parse(res.json) as ActivityEvent[];
    },
    enabled: tab === "activity" || tab === "overview",
    staleTime: 20_000,
  });

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Company>>({});
  const [noteText, setNoteText] = useState("");

  const startEdit = () => {
    if (!query.data) return;
    setForm({
      name: query.data.company.name,
      domain: query.data.company.domain,
      country: query.data.company.country,
      branch: query.data.company.branch,
      city: query.data.company.city,
      address: query.data.company.address,
      postal_code: query.data.company.postal_code,
      website: query.data.company.website,
      phone: query.data.company.phone,
    });
    setEditing(true);
  };

  const save = useMutation({
    mutationFn: async () => updateFn({ data: { id, ...form } }),
    onSuccess: async () => {
      toast.success(t("Zapisano zmiany", "Changes saved"));
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ["admin", "crm-company", id] });
      await qc.invalidateQueries({ queryKey: ["admin", "crm-companies"] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "error"),
  });

  const addNote = useMutation({
    mutationFn: async (body: string) => noteFn({ data: { company_id: id, body } }),
    onSuccess: async () => {
      toast.success(t("Notatka dodana", "Note added"));
      setNoteText("");
      await qc.invalidateQueries({ queryKey: ["admin", "crm-company-activity", id] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "error"),
  });

  const data = query.data;
  const c = data?.company;
  const profiles = data?.profiles ?? [];
  const leads = data?.leads ?? [];

  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(lang === "pl" ? "pl-PL" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [lang],
  );
  const fmtDate = useMemo(
    () => new Intl.DateTimeFormat(lang === "pl" ? "pl-PL" : "en-GB", { dateStyle: "medium" }),
    [lang],
  );

  const setTab = (next: Tab) =>
    void navigate({ search: { tab: next === "overview" ? undefined : next }, replace: true });

  const copy = async (value: string | null | undefined, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t(`Skopiowano: ${label}`, `Copied: ${label}`));
    } catch {
      toast.error(t("Nie udało się skopiować", "Copy failed"));
    }
  };

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-[92rem] p-6 text-sm text-muted-foreground">
        {t("Ładowanie…", "Loading…")}
      </div>
    );
  }
  if (!c) {
    return (
      <div className="mx-auto max-w-[92rem] p-6 text-sm text-muted-foreground">
        {t("Firma nieznaleziona.", "Company not found.")}
      </div>
    );
  }

  // Analityka: leady wg etapu i wg score band.
  const stageAgg = new Map<string, number>();
  const bandAgg = new Map<string, number>();
  for (const l of leads) {
    stageAgg.set(l.stage, (stageAgg.get(l.stage) ?? 0) + 1);
    if (l.score_band) bandAgg.set(l.score_band, (bandAgg.get(l.score_band) ?? 0) + 1);
  }
  const maxStage = Math.max(1, ...Array.from(stageAgg.values()));
  const maxBand = Math.max(1, ...Array.from(bandAgg.values()));

  const website = c.website
    ? c.website.startsWith("http")
      ? c.website
      : `https://${c.website}`
    : null;

  return (
    <div className="mx-auto w-full max-w-[92rem] space-y-4 p-4 lg:p-6">
      {/* Breadcrumbs + actions */}
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <Link
          to="/admin/companies"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {t("Firmy", "Companies")}
        </Link>
        <ChevronRight className="h-3 w-3 opacity-50" aria-hidden />
        <span className="truncate text-foreground">{c.name}</span>
        <div className="ml-auto flex items-center gap-2">
          {!editing ? (
            <Button size="sm" variant="outline" onClick={startEdit} className="h-8 gap-1.5 text-[12px]">
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              {t("Edytuj", "Edit")}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t("Anuluj", "Cancel")}
              </Button>
              <Button
                size="sm"
                onClick={() => save.mutate()}
                disabled={save.isPending || !form.name?.trim()}
                className="h-8 gap-1.5 text-[12px]"
              >
                <Save className="h-3.5 w-3.5" aria-hidden />
                {t("Zapisz", "Save")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Hero */}
      <header className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-4">
        <CompanyLogo name={c.name} domain={c.domain} size={56} />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight">{c.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            {c.branch && (
              <Badge variant="secondary" className="rounded px-2 py-0.5 text-[11px] font-normal">
                {c.branch}
              </Badge>
            )}
            {c.city && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" aria-hidden />
                {[c.city, c.country].filter(Boolean).join(", ")}
              </span>
            )}
            {website && (
              <a
                href={website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Globe className="h-3 w-3" aria-hidden />
                {c.domain ?? website.replace(/^https?:\/\//, "")}
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <MiniStat
            label={t("Kontakty", "Contacts")}
            value={profiles.length}
            icon={<UserCircle2 className="h-3.5 w-3.5" aria-hidden />}
          />
          <MiniStat
            label={t("Leady", "Leads")}
            value={leads.length}
            icon={<Target className="h-3.5 w-3.5" aria-hidden />}
          />
          <MiniStat
            label={t("Utworzono", "Created")}
            value={fmtDate.format(new Date(c.created_at))}
            icon={<Calendar className="h-3.5 w-3.5" aria-hidden />}
          />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* LEFT rail */}
        <aside className="lg:col-span-3 space-y-3">
          <section className="rounded-md border bg-card">
            <header className="border-b px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("Dane firmy", "About")}
            </header>
            <div className="space-y-2.5 p-3">
              {editing ? (
                <div className="grid gap-2.5">
                  <Field label={t("Nazwa", "Name")} required>
                    <Input
                      value={form.name ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    />
                  </Field>
                  <Field label={t("Domena", "Domain")}>
                    <Input
                      value={form.domain ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, domain: e.target.value || null }))
                      }
                    />
                  </Field>
                  <Field label={t("WWW", "Website")}>
                    <Input
                      value={form.website ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, website: e.target.value || null }))
                      }
                    />
                  </Field>
                  <Field label={t("Branża", "Industry")}>
                    <Input
                      value={form.branch ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, branch: e.target.value || null }))
                      }
                    />
                  </Field>
                  <Field label={t("Kraj", "Country")}>
                    <Input
                      value={form.country ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, country: e.target.value || null }))
                      }
                    />
                  </Field>
                  <Field label={t("Miasto", "City")}>
                    <Input
                      value={form.city ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, city: e.target.value || null }))
                      }
                    />
                  </Field>
                  <Field label={t("Adres", "Address")}>
                    <Input
                      value={form.address ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, address: e.target.value || null }))
                      }
                    />
                  </Field>
                  <Field label={t("Kod pocztowy", "Postal code")}>
                    <Input
                      value={form.postal_code ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, postal_code: e.target.value || null }))
                      }
                    />
                  </Field>
                  <Field label={t("Telefon", "Phone")}>
                    <Input
                      value={form.phone ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, phone: e.target.value || null }))
                      }
                    />
                  </Field>
                </div>
              ) : (
                <dl className="space-y-2.5">
                  <PropRow
                    label={t("Domena", "Domain")}
                    value={c.domain}
                    onCopy={() => copy(c.domain, t("Domena", "Domain"))}
                  />
                  <PropRow
                    label={t("WWW", "Website")}
                    value={
                      website ? (
                        <a
                          href={website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {c.domain ?? website.replace(/^https?:\/\//, "")}
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      ) : null
                    }
                  />
                  <PropRow label={t("Branża", "Industry")} value={c.branch} />
                  <PropRow label={t("Kraj", "Country")} value={c.country} />
                  <PropRow label={t("Miasto", "City")} value={c.city} />
                  <PropRow label={t("Adres", "Address")} value={c.address} />
                  <PropRow label={t("Kod pocztowy", "Postal code")} value={c.postal_code} />
                  <PropRow
                    label={t("Telefon", "Phone")}
                    value={
                      c.phone ? (
                        <a
                          href={`tel:${c.phone}`}
                          className="text-primary hover:underline"
                        >
                          {c.phone}
                        </a>
                      ) : null
                    }
                    onCopy={c.phone ? () => copy(c.phone, t("Telefon", "Phone")) : undefined}
                  />
                </dl>
              )}
            </div>
          </section>

          <section className="rounded-md border bg-card">
            <header className="border-b px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("Szybkie akcje", "Quick actions")}
            </header>
            <div className="grid gap-1 p-2">
              <QuickAction
                icon={<StickyNote className="h-3.5 w-3.5" aria-hidden />}
                label={t("Dodaj notatkę", "Add note")}
                onClick={() => setTab("activity")}
              />
              <QuickAction
                icon={<UserPlus className="h-3.5 w-3.5" aria-hidden />}
                label={t("Dodaj kontakt", "Add contact")}
                onClick={() =>
                  void rootNavigate({ to: "/admin/companies", search: { company: id } })
                }
              />
            </div>
          </section>
        </aside>

        {/* CENTER */}
        <main className="lg:col-span-6 space-y-3">
          <nav className="flex items-center gap-1 border-b">
            <TabBtn
              icon={<Building2 className="h-3.5 w-3.5" aria-hidden />}
              label={t("Przegląd", "Overview")}
              active={tab === "overview"}
              onClick={() => setTab("overview")}
            />
            <TabBtn
              icon={<Activity className="h-3.5 w-3.5" aria-hidden />}
              label={t("Aktywność", "Activity")}
              active={tab === "activity"}
              onClick={() => setTab("activity")}
            />
            <TabBtn
              icon={<BarChart3 className="h-3.5 w-3.5" aria-hidden />}
              label={t("Analityka", "Analytics")}
              active={tab === "analytics"}
              onClick={() => setTab("analytics")}
            />
          </nav>

          {tab === "overview" && (
            <div className="space-y-3">
              <section className="rounded-md border bg-card p-3">
                <h3 className="mb-2 text-[12px] font-medium">
                  {t("Ostatnia aktywność", "Recent activity")}
                </h3>
                <ActivityList
                  events={(activityQuery.data ?? []).slice(0, 6)}
                  fmt={fmt}
                  lang={lang}
                  emptyLabel={t("Brak aktywności.", "No activity yet.")}
                />
                <button
                  type="button"
                  onClick={() => setTab("activity")}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  {t("Zobacz wszystko", "View all")}
                  <ChevronRight className="h-3 w-3" aria-hidden />
                </button>
              </section>

              <section className="rounded-md border bg-card">
                <header className="flex items-center justify-between border-b p-3">
                  <h3 className="text-[12px] font-medium">
                    {t("Powiązane leady", "Linked leads")}{" "}
                    <span className="text-muted-foreground">({leads.length})</span>
                  </h3>
                </header>
                {leads.length === 0 ? (
                  <div className="p-4 text-[12px] text-muted-foreground">
                    {t("Brak powiązanych leadów.", "No linked leads.")}
                  </div>
                ) : (
                  <ul className="divide-y">
                    {leads.slice(0, 8).map((l) => {
                      const name =
                        [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email;
                      return (
                        <li key={l.id}>
                          <button
                            type="button"
                            onClick={() =>
                              rootNavigate({ to: "/admin/crm", search: { lead: l.id } })
                            }
                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-muted/60"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 truncate text-[13px] font-medium">
                                {name}
                                <Badge variant="secondary" className="text-[10px] uppercase">
                                  {l.stage}
                                </Badge>
                                {l.score_band && (
                                  <Badge variant="outline" className="text-[10px] uppercase">
                                    {l.score_band}
                                  </Badge>
                                )}
                              </div>
                              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                {[l.email, l.position].filter(Boolean).join(" · ")}
                              </div>
                            </div>
                            <ChevronRight
                              className="h-3.5 w-3.5 text-muted-foreground"
                              aria-hidden
                            />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          )}

          {tab === "activity" && (
            <div className="space-y-3">
              <section className="rounded-md border bg-card p-3">
                <h3 className="mb-2 text-[12px] font-medium">
                  {t("Dodaj notatkę", "Add note")}
                </h3>
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder={t("Krótka notatka wewnętrzna…", "Short internal note…")}
                  rows={3}
                  className="text-[12px]"
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => addNote.mutate(noteText.trim())}
                    disabled={!noteText.trim() || addNote.isPending}
                    className="h-8 gap-1.5 text-[12px]"
                  >
                    <StickyNote className="h-3.5 w-3.5" aria-hidden />
                    {t("Zapisz notatkę", "Save note")}
                  </Button>
                </div>
              </section>
              <section className="rounded-md border bg-card p-3">
                <h3 className="mb-2 text-[12px] font-medium">
                  {t("Historia", "History")}
                </h3>
                {activityQuery.isLoading ? (
                  <div className="text-[12px] text-muted-foreground">
                    {t("Ładowanie…", "Loading…")}
                  </div>
                ) : (
                  <ActivityList
                    events={activityQuery.data ?? []}
                    fmt={fmt}
                    lang={lang}
                    emptyLabel={t("Brak aktywności.", "No activity yet.")}
                  />
                )}
              </section>
            </div>
          )}

          {tab === "analytics" && (
            <div className="space-y-3">
              <section className="rounded-md border bg-card p-4">
                <h3 className="mb-3 text-[12px] font-medium">
                  {t("Leady wg etapu", "Leads by stage")}
                </h3>
                {stageAgg.size === 0 ? (
                  <p className="text-[12px] text-muted-foreground">
                    {t("Brak danych.", "No data.")}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {Array.from(stageAgg.entries())
                      .sort((a, b) => b[1] - a[1])
                      .map(([stage, count]) => (
                        <li key={stage} className="flex items-center gap-3 text-[12px]">
                          <span className="w-24 shrink-0 truncate uppercase tracking-wide text-muted-foreground">
                            {stage}
                          </span>
                          <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                            <div
                              className="h-full rounded bg-primary"
                              style={{ width: `${(count / maxStage) * 100}%` }}
                            />
                          </div>
                          <span className="w-8 shrink-0 text-right tabular-nums font-medium">
                            {count}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </section>
              <section className="rounded-md border bg-card p-4">
                <h3 className="mb-3 text-[12px] font-medium">
                  {t("Score band", "Score band")}
                </h3>
                {bandAgg.size === 0 ? (
                  <p className="text-[12px] text-muted-foreground">
                    {t("Brak danych.", "No data.")}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {Array.from(bandAgg.entries())
                      .sort((a, b) => b[1] - a[1])
                      .map(([band, count]) => (
                        <li key={band} className="flex items-center gap-3 text-[12px]">
                          <span className="w-24 shrink-0 truncate uppercase tracking-wide text-muted-foreground">
                            {band}
                          </span>
                          <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                            <div
                              className="h-full rounded bg-amber-500"
                              style={{ width: `${(count / maxBand) * 100}%` }}
                            />
                          </div>
                          <span className="w-8 shrink-0 text-right tabular-nums font-medium">
                            {count}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </main>

        {/* RIGHT sidebar */}
        <aside className="lg:col-span-3 space-y-3">
          <SidebarCard
            title={t("Kontakty", "Contacts")}
            count={profiles.length}
            icon={<UserCircle2 className="h-3.5 w-3.5" aria-hidden />}
          >
            {profiles.length === 0 ? (
              <Empty label={t("Brak kontaktów.", "No contacts.")} />
            ) : (
              <ul className="divide-y">
                {profiles.slice(0, 6).map((p) => {
                  const name =
                    p.display_name ||
                    [p.first_name, p.last_name].filter(Boolean).join(" ") ||
                    p.contact_email ||
                    p.id.slice(0, 8);
                  return (
                    <li key={p.id} className="flex items-center gap-2 px-2.5 py-2">
                      <div className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded bg-muted text-[10px] font-medium">
                        {p.avatar_url ? (
                          <img
                            src={p.avatar_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium">{name}</div>
                        {p.job_title && (
                          <div className="truncate text-[10px] text-muted-foreground">
                            {p.job_title}
                          </div>
                        )}
                      </div>
                      {p.slug && (
                        <Link
                          to="/author/$slug"
                          params={{ slug: p.slug }}
                          className="text-[10px] text-primary hover:underline"
                        >
                          {t("Profil", "Profile")}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </SidebarCard>

          <SidebarCard
            title={t("Leady", "Leads")}
            count={leads.length}
            icon={<Target className="h-3.5 w-3.5" aria-hidden />}
          >
            {leads.length === 0 ? (
              <Empty label={t("Brak leadów.", "No leads.")} />
            ) : (
              <ul className="divide-y">
                {leads.slice(0, 6).map((l) => {
                  const name =
                    [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email;
                  return (
                    <li key={l.id} className="flex items-center gap-2 px-2.5 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium">{name}</div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {l.stage}
                          {l.score_band ? ` · ${l.score_band}` : ""}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SidebarCard>

          <SidebarCard
            title={t("Meta", "Meta")}
            icon={<Building2 className="h-3.5 w-3.5" aria-hidden />}
          >
            <dl className="space-y-1.5 px-3 py-2 text-[11px]">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("Utworzono", "Created")}</dt>
                <dd className="text-right">{fmtDate.format(new Date(c.created_at))}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("Aktualizacja", "Updated")}</dt>
                <dd className="text-right">{fmtDate.format(new Date(c.updated_at))}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">ID</dt>
                <dd className="truncate text-right font-mono text-[10px]">{c.id.slice(0, 8)}</dd>
              </div>
            </dl>
          </SidebarCard>
        </aside>
      </div>
    </div>
  );
}

/* ---------------- Sub-components ---------------- */

function CompanyLogo({ name, domain, size = 40 }: { name: string; domain: string | null; size?: number }) {
  const [ok, setOk] = useState(true);
  const src = domain
    ? `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(domain)}`
    : null;
  return (
    <div
      className="grid shrink-0 place-items-center overflow-hidden rounded-md bg-primary/10 text-[13px] font-semibold text-primary"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {src && ok ? (
        <img
          src={src}
          alt=""
          className="h-2/3 w-2/3 object-contain"
          onError={() => setOk(false)}
        />
      ) : (
        <span>{name.slice(0, 2).toUpperCase()}</span>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-md bg-muted/60 px-3 py-2 text-[11px]">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function TabBtn({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
      {active && (
        <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
      )}
    </button>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}

function PropRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: React.ReactNode;
  onCopy?: () => void;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="group grid grid-cols-[100px_1fr_auto] items-start gap-2">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground pt-0.5">
        {label}
      </dt>
      <dd className="text-[12px]">
        {empty ? <span className="text-muted-foreground/60">-</span> : value}
      </dd>
      {onCopy && !empty && (
        <button
          type="button"
          onClick={onCopy}
          className="grid h-5 w-5 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
          aria-label="Copy"
        >
          <Copy className="h-3 w-3" aria-hidden />
        </button>
      )}
    </div>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-muted"
    >
      <span className="text-muted-foreground">{icon}</span>
      {label}
    </button>
  );
}

function SidebarCard({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border bg-card">
      <header className="flex items-center justify-between border-b px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {icon}
          {title}
        </span>
        {typeof count === "number" && (
          <span className="rounded bg-muted px-1.5 py-0 text-[10px] tabular-nums text-foreground">
            {count}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="px-3 py-4 text-[12px] text-muted-foreground">{label}</div>;
}

function ActivityList({
  events,
  fmt,
  lang,
  emptyLabel,
}: {
  events: ActivityEvent[];
  fmt: Intl.DateTimeFormat;
  lang: "pl" | "en";
  emptyLabel: string;
}) {
  if (!events || events.length === 0) {
    return <p className="text-[12px] text-muted-foreground">{emptyLabel}</p>;
  }
  const iconFor = (e: ActivityEvent) => {
    if (e.kind === "note") return <StickyNote className="h-3.5 w-3.5" aria-hidden />;
    if (e.kind === "lead_created") return <Target className="h-3.5 w-3.5" aria-hidden />;
    return <Activity className="h-3.5 w-3.5" aria-hidden />;
  };
  const labelFor = (e: ActivityEvent) => {
    if (e.kind === "note") return lang === "pl" ? "Notatka" : "Note";
    if (e.kind === "lead_created")
      return `${lang === "pl" ? "Nowy lead" : "New lead"}${e.lead_label ? ` · ${e.lead_label}` : ""}`;
    return e.action;
  };
  return (
    <ul className="space-y-2">
      {events.map((e) => (
        <li key={e.id} className="flex gap-2">
          <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded bg-muted text-muted-foreground">
            {iconFor(e)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[12px] font-medium">{labelFor(e)}</span>
              <time className="shrink-0 text-[10px] text-muted-foreground">
                {fmt.format(new Date(e.created_at))}
              </time>
            </div>
            {e.body && (
              <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-muted-foreground">
                {e.body}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
