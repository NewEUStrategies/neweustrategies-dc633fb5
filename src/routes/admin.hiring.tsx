// Admin "Oferty pracy": pełne zarządzanie treścią strony /zatrudniamy.
// Zakładka "Oferty" to CRUD tabeli `career_roles` (dwujęzycznie PL/EN, punkty
// obowiązków i wymagań jako listy), zakładka "Sekcje" steruje widocznością
// i nagłówkami sekcji strony (`career_page_sections`).
// Zgłoszenia kandydatów są osobno, w /admin/careers.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BriefcaseBusiness, Download, Eye, EyeOff, Inbox, Plus, Save, Trash2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { ensureI18n as ensureCareersI18n } from "@/lib/i18n-careers";
import { useCurrentTenantId } from "@/lib/tenant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  CAREER_DEPARTMENTS,
  CAREER_SENIORITIES,
  type CareerDepartmentId,
  type CareerEngagement,
  type CareerSeniority,
} from "@/lib/careers/roles";
import {
  CAREER_SECTION_KEYS,
  careerRolesQueryOptions,
  type CareerLocation,
  type CareerRoleRow,
  type CareerSectionRow,
} from "@/lib/careers/catalog";
import { careerSectionsAdminQueryOptions, fallbackRoleRows } from "@/lib/careers/catalogAdmin";

export const Route = createFileRoute("/admin/hiring")({
  head: () => ({
    meta: [{ title: "Oferty pracy | Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminHiringPage,
});

const ENGAGEMENTS = [
  "full_time",
  "part_time",
  "contract",
  "internship",
] as const satisfies readonly CareerEngagement[];

const LOCATIONS = [
  "remote",
  "hybrid",
  "warsaw",
  "brussels",
] as const satisfies readonly CareerLocation[];

interface HiringDict {
  title: string;
  subtitle: string;
  tabs: { roles: string; sections: string; retention: string };
  inbox: string;
  add: string;
  importI18n: string;
  imported: string;
  save: string;
  saved: string;
  remove: string;
  removed: string;
  confirmRemove: string;
  empty: string;
  pickOne: string;
  published: string;
  draft: string;
  slug: string;
  order: string;
  department: string;
  engagement: string;
  seniority: string;
  location: string;
  titlePl: string;
  titleEn: string;
  summaryPl: string;
  summaryEn: string;
  respPl: string;
  respEn: string;
  reqPl: string;
  reqEn: string;
  listHint: string;
  sectionVisible: string;
  sectionTitle: string;
  sectionSubtitle: string;
  sectionHint: string;
  newRole: string;
  retentionHint: string;
  retentionDays: string;
  retentionDaysHint: string;
  graceHours: string;
  graceHoursHint: string;
  queueTitle: string;
  queueEmpty: string;
  queuePending: string;
}

const PL: HiringDict = {
  title: "Oferty pracy",
  subtitle: "Treść strony „Dołącz do zespołu” (/zatrudniamy): oferty i sekcje.",
  tabs: { roles: "Oferty", sections: "Sekcje strony", retention: "Retencja CV" },
  inbox: "Zgłoszenia kandydatów",
  add: "Nowa oferta",
  importI18n: "Importuj wbudowane oferty",
  imported: "Zaimportowano wbudowane oferty.",
  save: "Zapisz",
  saved: "Zapisano.",
  remove: "Usuń",
  removed: "Usunięto ofertę.",
  confirmRemove: "Usunąć tę ofertę na stałe?",
  empty: "Brak ofert w bazie - strona pokazuje katalog wbudowany.",
  pickOne: "Wybierz ofertę z listy albo dodaj nową.",
  published: "Opublikowana",
  draft: "Szkic",
  slug: "Identyfikator (slug)",
  order: "Kolejność",
  department: "Dział",
  engagement: "Wymiar",
  seniority: "Poziom",
  location: "Lokalizacja",
  titlePl: "Tytuł (PL)",
  titleEn: "Tytuł (EN)",
  summaryPl: "Opis (PL)",
  summaryEn: "Opis (EN)",
  respPl: "Zakres obowiązków (PL)",
  respEn: "Zakres obowiązków (EN)",
  reqPl: "Wymagania (PL)",
  reqEn: "Wymagania (EN)",
  listHint: "Jeden punkt w każdej linii.",
  sectionVisible: "Widoczna",
  sectionTitle: "Nagłówek (PL / EN)",
  sectionSubtitle: "Podtytuł (PL / EN)",
  sectionHint: "Puste pole = tekst domyślny ze słownika.",
  newRole: "Nowa oferta",
  retentionHint:
    "Pliki CV to dane osobowe kandydatów. Job „career-cv-retention” usuwa je z prywatnego bucketu w dwóch sytuacjach: gdy plik nie ma zgłoszenia (porzucony kreator) i gdy proces jest domknięty dłużej niż poniższy okres. Otwarty proces nie traci CV bez względu na wiek.",
  retentionDays: "Retencja CV po domknięciu procesu (dni)",
  retentionDaysHint: "Liczone od zmiany etapu na zatrudniony / odrzucony / wycofane. 1-3650.",
  graceHours: "Okno łaski dla pliku bez zgłoszenia (godziny)",
  graceHoursHint:
    "Plik ląduje w buckecie przy wyborze, przed wysyłką formularza - to okno chroni kandydata, który wypełnia kreator dłużej. 1-720.",
  queueTitle: "Kolejka usunięć",
  queueEmpty: "Kolejka pusta.",
  queuePending: "Pozycje czekające na usunięcie z magazynu:",
};

const EN: HiringDict = {
  title: "Job offers",
  subtitle: "Content of the “Join the team” page (/zatrudniamy): offers and sections.",
  tabs: { roles: "Offers", sections: "Page sections", retention: "CV retention" },
  inbox: "Applications",
  add: "New offer",
  importI18n: "Import built-in offers",
  imported: "Built-in offers imported.",
  save: "Save",
  saved: "Saved.",
  remove: "Delete",
  removed: "Offer deleted.",
  confirmRemove: "Delete this offer permanently?",
  empty: "No offers in the database - the page shows the built-in catalogue.",
  pickOne: "Pick an offer from the list or add a new one.",
  published: "Published",
  draft: "Draft",
  slug: "Identifier (slug)",
  order: "Order",
  department: "Department",
  engagement: "Engagement",
  seniority: "Seniority",
  location: "Location",
  titlePl: "Title (PL)",
  titleEn: "Title (EN)",
  summaryPl: "Summary (PL)",
  summaryEn: "Summary (EN)",
  respPl: "Responsibilities (PL)",
  respEn: "Responsibilities (EN)",
  reqPl: "Requirements (PL)",
  reqEn: "Requirements (EN)",
  listHint: "One bullet per line.",
  sectionVisible: "Visible",
  sectionTitle: "Heading (PL / EN)",
  sectionSubtitle: "Subtitle (PL / EN)",
  sectionHint: "Empty field = default dictionary copy.",
  newRole: "New offer",
  retentionHint:
    'CV files are candidate personal data. The "career-cv-retention" job removes them from the private bucket in two cases: a file with no application (abandoned form) and a process closed for longer than the window below. An open process never loses its CV, however old.',
  retentionDays: "CV retention after the process closes (days)",
  retentionDaysHint: "Counted from the move to hired / rejected / withdrawn. 1-3650.",
  graceHours: "Grace window for a file with no application (hours)",
  graceHoursHint:
    "The file lands in the bucket on pick, before the form is submitted - this window protects a candidate who fills the form slowly. 1-720.",
  queueTitle: "Deletion queue",
  queueEmpty: "Queue is empty.",
  queuePending: "Entries awaiting removal from storage:",
};

type RoleDraft = Omit<CareerRoleRow, "id"> & { id: string | null };

function emptyDraft(order: number): RoleDraft {
  return {
    id: null,
    slug: "",
    department: "analysis",
    engagement: "full_time",
    seniority: "mid",
    location: "hybrid",
    sort_order: order,
    is_published: false,
    title_pl: "",
    title_en: "",
    summary_pl: "",
    summary_en: "",
    responsibilities_pl: [],
    responsibilities_en: [],
    requirements_pl: [],
    requirements_en: [],
  };
}

const toText = (list: readonly string[]) => list.join("\n");
const toList = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Select<T extends string>({
  value,
  options,
  onChange,
  labelFor,
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  labelFor: (value: T) => string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="h-9 rounded-md border border-border bg-background px-2 text-sm"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {labelFor(option)}
        </option>
      ))}
    </select>
  );
}

function AdminHiringPage() {
  // Słownik `careers.*` rejestruje się przy ewaluacji modułu i mieszka w chunku
  // trasy publicznej - w chunku admina go NIE MA. Bez tego `getFixedT` zwracał
  // surowe klucze, a "Importuj wbudowane oferty" zapisywał do bazy tytuły w
  // postaci "careers.roles.<id>.title", które trafiały na stronę /zatrudniamy.
  ensureCareersI18n();
  const { t, i18n } = useTranslation();
  const L = i18n.language.startsWith("en") ? EN : PL;
  const qc = useQueryClient();
  // `career_roles` / `career_page_sections` są od migracji 20260814100000
  // scope'owane po najemcy. Kolumna ma DEFAULT `public_tenant_id()`, ale ON
  // CONFLICT (tenant_id, slug) wymaga wartości JAWNIE w payloadzie, a jawny
  // tenant to też druga bramka obok RLS (defense in depth, jak w lib/tenant).
  const tenantId = useCurrentTenantId();
  const [tab, setTab] = useState<"roles" | "sections" | "retention">("roles");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<RoleDraft | null>(null);

  const rolesQuery = useQuery(careerRolesQueryOptions(true));
  // Panel czyta TABELĘ (widok publiczny tnie nagłówki sekcji ukrytych do NULL,
  // a to właśnie one są tu przedmiotem edycji) - patrz 20260817230000.
  const sectionsQuery = useQuery(careerSectionsAdminQueryOptions());
  const rows = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);

  useEffect(() => {
    if (!selected) return;
    const row = rows.find((item) => item.id === selected);
    if (row) setDraft({ ...row });
  }, [selected, rows]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["career-roles"] });
    void qc.invalidateQueries({ queryKey: ["career-page-sections"] });
  };

  const saveRole = useMutation({
    mutationFn: async (value: RoleDraft) => {
      const slug = value.slug.trim() || slugify(value.title_pl || value.title_en);
      if (!slug) throw new Error(L.slug);
      const payload = {
        slug,
        department: value.department,
        engagement: value.engagement,
        seniority: value.seniority,
        location: value.location,
        sort_order: value.sort_order,
        is_published: value.is_published,
        title_pl: value.title_pl.trim(),
        title_en: value.title_en.trim(),
        summary_pl: value.summary_pl.trim(),
        summary_en: value.summary_en.trim(),
        responsibilities_pl: value.responsibilities_pl,
        responsibilities_en: value.responsibilities_en,
        requirements_pl: value.requirements_pl,
        requirements_en: value.requirements_en,
      };
      if (value.id) {
        const { error } = await supabase.from("career_roles").update(payload).eq("id", value.id);
        if (error) throw new Error(error.message);
        return value.id;
      }
      if (!tenantId) throw new Error("tenant_unresolved");
      const { data, error } = await supabase
        .from("career_roles")
        .insert({ ...payload, tenant_id: tenantId })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    },
    onSuccess: (id) => {
      toast.success(L.saved);
      setSelected(id);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeRole = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("career_roles").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(L.removed);
      setSelected(null);
      setDraft(null);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const importBuiltIn = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("tenant_unresolved");
      const tEn = i18n.getFixedT("en");
      const tPl = i18n.getFixedT("pl");
      // Unikalność slugu jest teraz PARĄ (tenant_id, slug) - `onConflict: "slug"`
      // celowałby w indeks, którego już nie ma, i import wywracałby się na
      // każdym powtórnym uruchomieniu.
      const payload = fallbackRoleRows(tPl, tEn).map((row) => ({ ...row, tenant_id: tenantId }));
      const { error } = await supabase
        .from("career_roles")
        .upsert(payload, { onConflict: "tenant_id,slug" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(L.imported);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveSection = useMutation({
    mutationFn: async (row: CareerSectionRow) => {
      if (!tenantId) throw new Error("tenant_unresolved");
      // UPSERT, nie UPDATE: seed sekcji dostał tylko najemca domyślny, więc u
      // każdego innego `update().eq("key")` nie trafiał w żaden wiersz i zapis
      // cicho nic nie robił. Klucz główny to teraz (tenant_id, key).
      const { error } = await supabase.from("career_page_sections").upsert(
        {
          tenant_id: tenantId,
          key: row.key,
          is_visible: row.is_visible,
          sort_order: row.sort_order,
          title_pl: row.title_pl,
          title_en: row.title_en,
          subtitle_pl: row.subtitle_pl,
          subtitle_en: row.subtitle_en,
        },
        { onConflict: "tenant_id,key" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(L.saved);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BriefcaseBusiness className="h-5 w-5 text-brand" />
          <div>
            <h1 className="text-xl font-semibold">{L.title}</h1>
            <p className="text-xs text-muted-foreground">{L.subtitle}</p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link to="/admin/careers">
            <Inbox className="h-4 w-4" />
            {L.inbox}
          </Link>
        </Button>
      </header>

      <div className="flex gap-1 border-b border-border">
        {(["roles", "sections", "retention"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === key
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {L.tabs[key]}
          </button>
        ))}
      </div>

      {tab === "roles" ? (
        <div className="grid gap-3 md:grid-cols-[320px_1fr]">
          <aside className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border p-2">
              <Button
                size="sm"
                className="h-8 flex-1 gap-1.5"
                onClick={() => {
                  setSelected(null);
                  setDraft(emptyDraft(rows.length * 10));
                }}
              >
                <Plus className="h-4 w-4" />
                {L.add}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                disabled={importBuiltIn.isPending}
                onClick={() => importBuiltIn.mutate()}
                title={L.importI18n}
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>
            <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
              {rows.length === 0 ? (
                <li className="p-3 text-xs text-muted-foreground">{L.empty}</li>
              ) : (
                rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(row.id)}
                      className={`flex w-full items-start gap-2 p-3 text-left text-sm hover:bg-muted ${
                        selected === row.id ? "bg-muted" : ""
                      }`}
                    >
                      {row.is_published ? (
                        <Eye className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                      ) : (
                        <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {row.title_pl || row.slug}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {t(`careers.departments.${row.department}`)} · {row.slug}
                        </span>
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </aside>

          <section className="rounded-md border border-border bg-card p-4">
            {!draft ? (
              <p className="text-sm text-muted-foreground">{L.pickOne}</p>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveRole.mutate(draft);
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">
                    {draft.id ? draft.title_pl || draft.slug : L.newRole}
                  </h2>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs font-medium">
                      <Switch
                        checked={draft.is_published}
                        onCheckedChange={(checked) => setDraft({ ...draft, is_published: checked })}
                      />
                      {draft.is_published ? L.published : L.draft}
                    </label>
                    {draft.id ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-destructive"
                        onClick={() => {
                          if (draft.id && window.confirm(L.confirmRemove)) {
                            removeRole.mutate(draft.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        {L.remove}
                      </Button>
                    ) : null}
                    <Button
                      type="submit"
                      size="sm"
                      className="gap-1.5"
                      disabled={saveRole.isPending}
                    >
                      <Save className="h-4 w-4" />
                      {L.save}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label={L.slug}>
                    <Input
                      value={draft.slug}
                      placeholder={slugify(draft.title_pl)}
                      onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
                    />
                  </Field>
                  <Field label={L.order}>
                    <Input
                      type="number"
                      value={draft.sort_order}
                      onChange={(event) =>
                        setDraft({ ...draft, sort_order: Number(event.target.value) || 0 })
                      }
                    />
                  </Field>
                  <Field label={L.department}>
                    <Select<CareerDepartmentId>
                      value={draft.department}
                      options={CAREER_DEPARTMENTS}
                      onChange={(value) => setDraft({ ...draft, department: value })}
                      labelFor={(value) => t(`careers.departments.${value}`)}
                    />
                  </Field>
                  <Field label={L.engagement}>
                    <Select<CareerEngagement>
                      value={draft.engagement}
                      options={ENGAGEMENTS}
                      onChange={(value) => setDraft({ ...draft, engagement: value })}
                      labelFor={(value) => t(`careers.engagement.${value}`)}
                    />
                  </Field>
                  <Field label={L.seniority}>
                    <Select<CareerSeniority>
                      value={draft.seniority}
                      options={CAREER_SENIORITIES}
                      onChange={(value) => setDraft({ ...draft, seniority: value })}
                      labelFor={(value) => t(`careers.seniority.${value}`)}
                    />
                  </Field>
                  <Field label={L.location}>
                    <Select<CareerLocation>
                      value={draft.location}
                      options={LOCATIONS}
                      onChange={(value) => setDraft({ ...draft, location: value })}
                      labelFor={(value) => t(`careers.location.${value}`)}
                    />
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={L.titlePl}>
                    <Input
                      value={draft.title_pl}
                      onChange={(event) => setDraft({ ...draft, title_pl: event.target.value })}
                    />
                  </Field>
                  <Field label={L.titleEn}>
                    <Input
                      value={draft.title_en}
                      onChange={(event) => setDraft({ ...draft, title_en: event.target.value })}
                    />
                  </Field>
                  <Field label={L.summaryPl}>
                    <Textarea
                      rows={3}
                      value={draft.summary_pl}
                      onChange={(event) => setDraft({ ...draft, summary_pl: event.target.value })}
                    />
                  </Field>
                  <Field label={L.summaryEn}>
                    <Textarea
                      rows={3}
                      value={draft.summary_en}
                      onChange={(event) => setDraft({ ...draft, summary_en: event.target.value })}
                    />
                  </Field>
                </div>

                <p className="text-[11px] text-muted-foreground">{L.listHint}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={L.respPl}>
                    <Textarea
                      rows={6}
                      value={toText(draft.responsibilities_pl)}
                      onChange={(event) =>
                        setDraft({ ...draft, responsibilities_pl: toList(event.target.value) })
                      }
                    />
                  </Field>
                  <Field label={L.respEn}>
                    <Textarea
                      rows={6}
                      value={toText(draft.responsibilities_en)}
                      onChange={(event) =>
                        setDraft({ ...draft, responsibilities_en: toList(event.target.value) })
                      }
                    />
                  </Field>
                  <Field label={L.reqPl}>
                    <Textarea
                      rows={6}
                      value={toText(draft.requirements_pl)}
                      onChange={(event) =>
                        setDraft({ ...draft, requirements_pl: toList(event.target.value) })
                      }
                    />
                  </Field>
                  <Field label={L.reqEn}>
                    <Textarea
                      rows={6}
                      value={toText(draft.requirements_en)}
                      onChange={(event) =>
                        setDraft({ ...draft, requirements_en: toList(event.target.value) })
                      }
                    />
                  </Field>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : tab === "sections" ? (
        <SectionsTab
          L={L}
          rows={sectionsQuery.data ?? []}
          onSave={(row) => saveSection.mutate(row)}
          saving={saveSection.isPending}
        />
      ) : (
        <RetentionTab L={L} tenantId={tenantId} />
      )}
    </div>
  );
}

/**
 * Ustawienia retencji plików CV.
 *
 * Okres retencji jest decyzją RODO, nie techniczną - dlatego siedzi w tabeli
 * `career_settings` per najemca, a nie w stałej w kodzie. Domyślne wartości
 * (365 dni / 24 h) obowiązują, dopóki nikt ich nie nadpisze, więc job działa
 * także bez wejścia na tę zakładkę.
 */
function RetentionTab({ L, tenantId }: { L: HiringDict; tenantId: string | null }) {
  const qc = useQueryClient();
  const [days, setDays] = useState("");
  const [hours, setHours] = useState("");

  const settings = useQuery({
    queryKey: ["admin-career-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("career_settings")
        .select("tenant_id,cv_retention_days,orphan_grace_hours")
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const queue = useQuery({
    queryKey: ["admin-career-cv-queue"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("career_cv_gc_queue")
        .select("id", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });

  useEffect(() => {
    setDays(String(settings.data?.cv_retention_days ?? 365));
    setHours(String(settings.data?.orphan_grace_hours ?? 24));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("tenant_unresolved");
      // UPSERT obsługuje oba przypadki: najemca, który nigdy nie ruszał
      // retencji, nie ma jeszcze wiersza i jedzie na wartościach domyślnych
      // z CHECK-ów tabeli.
      const { error } = await supabase.from("career_settings").upsert(
        {
          tenant_id: tenantId,
          cv_retention_days: Number(days),
          orphan_grace_hours: Number(hours),
        },
        { onConflict: "tenant_id" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(L.saved);
      qc.invalidateQueries({ queryKey: ["admin-career-settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">{L.retentionHint}</p>

      <section className="space-y-3 rounded-md border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={L.retentionDays}>
            <Input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{L.retentionDaysHint}</p>
          </Field>
          <Field label={L.graceHours}>
            <Input
              type="number"
              min={1}
              max={720}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{L.graceHoursHint}</p>
          </Field>
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            className="gap-1.5"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            <Save className="h-4 w-4" />
            {L.save}
          </Button>
        </div>
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">{L.queueTitle}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {queue.data ? `${L.queuePending} ${queue.data}` : L.queueEmpty}
        </p>
      </section>
    </div>
  );
}

function SectionsTab({
  L,
  rows,
  onSave,
  saving,
}: {
  L: HiringDict;
  rows: readonly CareerSectionRow[];
  onSave: (row: CareerSectionRow) => void;
  saving: boolean;
}) {
  const [local, setLocal] = useState<CareerSectionRow[]>([]);

  useEffect(() => {
    setLocal(rows.map((row) => ({ ...row })));
  }, [rows]);

  const ordered = useMemo(
    () =>
      [...local].sort(
        (a, b) =>
          CAREER_SECTION_KEYS.indexOf(a.key as (typeof CAREER_SECTION_KEYS)[number]) -
          CAREER_SECTION_KEYS.indexOf(b.key as (typeof CAREER_SECTION_KEYS)[number]),
      ),
    [local],
  );

  const patch = (key: string, changes: Partial<CareerSectionRow>) =>
    setLocal((prev) => prev.map((row) => (row.key === key ? { ...row, ...changes } : row)));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{L.sectionHint}</p>
      {ordered.map((row) => (
        <section key={row.key} className="rounded-md border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide">{row.key}</h2>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-medium">
                <Switch
                  checked={row.is_visible}
                  onCheckedChange={(checked) => patch(row.key, { is_visible: checked })}
                />
                {L.sectionVisible}
              </label>
              <Button size="sm" className="gap-1.5" disabled={saving} onClick={() => onSave(row)}>
                <Save className="h-4 w-4" />
                {L.save}
              </Button>
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={`${L.sectionTitle} · PL`}>
              <Input
                value={row.title_pl ?? ""}
                onChange={(event) => patch(row.key, { title_pl: event.target.value })}
              />
            </Field>
            <Field label={`${L.sectionTitle} · EN`}>
              <Input
                value={row.title_en ?? ""}
                onChange={(event) => patch(row.key, { title_en: event.target.value })}
              />
            </Field>
            <Field label={`${L.sectionSubtitle} · PL`}>
              <Textarea
                rows={2}
                value={row.subtitle_pl ?? ""}
                onChange={(event) => patch(row.key, { subtitle_pl: event.target.value })}
              />
            </Field>
            <Field label={`${L.sectionSubtitle} · EN`}>
              <Textarea
                rows={2}
                value={row.subtitle_en ?? ""}
                onChange={(event) => patch(row.key, { subtitle_en: event.target.value })}
              />
            </Field>
          </div>
        </section>
      ))}
    </div>
  );
}
