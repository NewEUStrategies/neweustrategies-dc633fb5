// Admin: szczegóły firmy CRM (`crm_companies`) + powiązane profile
// (`profiles.current_company_id`) i leady (`crm_leads.company_id`).
// Widoczne dla staff (`requireStaff` w server-fn); RLS scope'uje po tenancie.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { getCrmCompany, updateCrmCompany } from "@/lib/crm-companies.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  ExternalLink,
  Globe,
  MapPin,
  Phone,
  Users,
  UserCircle2,
  ArrowLeft,
  Save,
  Pencil,
} from "lucide-react";

const SearchSchema = z.object({});
export const Route = createFileRoute("/admin/companies/$id")({
  validateSearch: SearchSchema.parse,
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

function AdminCompanyDetailPage() {
  const { id } = Route.useParams();
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getFn = useServerFn(getCrmCompany);
  const updateFn = useServerFn(updateCrmCompany);

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

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Company>>({});

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
      toast.success(lang === "pl" ? "Zapisano zmiany" : "Changes saved");
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ["admin", "crm-company", id] });
      await qc.invalidateQueries({ queryKey: ["admin", "crm-companies"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "error");
    },
  });

  const data = query.data;
  const c = data?.company;
  const profiles = data?.profiles ?? [];
  const leads = data?.leads ?? [];

  const fmt = useMemo(
    () => new Intl.DateTimeFormat(lang === "pl" ? "pl-PL" : "en-GB", { dateStyle: "medium" }),
    [lang],
  );

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-6xl p-6 text-sm text-muted-foreground">
        {lang === "pl" ? "Ładowanie…" : "Loading…"}
      </div>
    );
  }
  if (!c) {
    return (
      <div className="mx-auto max-w-6xl p-6 text-sm text-muted-foreground">
        {lang === "pl" ? "Firma nieznaleziona." : "Company not found."}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <Link to="/admin/companies">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {lang === "pl" ? "Firmy" : "Companies"}
          </Button>
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <Building2 className="h-5 w-5 text-muted-foreground" aria-hidden />
          <h1 className="truncate text-xl font-semibold">{c.name}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!editing ? (
            <Button size="sm" variant="outline" onClick={startEdit} className="gap-1.5">
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              {lang === "pl" ? "Edytuj" : "Edit"}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {lang === "pl" ? "Anuluj" : "Cancel"}
              </Button>
              <Button
                size="sm"
                onClick={() => save.mutate()}
                disabled={save.isPending || !form.name?.trim()}
                className="gap-1.5"
              >
                <Save className="h-3.5 w-3.5" aria-hidden />
                {lang === "pl" ? "Zapisz" : "Save"}
              </Button>
            </>
          )}
        </div>
      </header>

      <section className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 rounded-md border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            {lang === "pl" ? "Dane firmy" : "Company details"}
          </h2>
          {editing ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={lang === "pl" ? "Nazwa" : "Name"} required>
                <Input
                  value={form.name ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </Field>
              <Field label={lang === "pl" ? "Domena" : "Domain"}>
                <Input
                  value={form.domain ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value || null }))}
                />
              </Field>
              <Field label={lang === "pl" ? "Kraj" : "Country"}>
                <Input
                  value={form.country ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, country: e.target.value || null }))}
                />
              </Field>
              <Field label={lang === "pl" ? "Oddział" : "Branch"}>
                <Input
                  value={form.branch ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value || null }))}
                />
              </Field>
              <Field label={lang === "pl" ? "Miasto" : "City"}>
                <Input
                  value={form.city ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value || null }))}
                />
              </Field>
              <Field label={lang === "pl" ? "Kod pocztowy" : "Postal code"}>
                <Input
                  value={form.postal_code ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, postal_code: e.target.value || null }))}
                />
              </Field>
              <Field label={lang === "pl" ? "Adres" : "Address"}>
                <Input
                  value={form.address ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value || null }))}
                />
              </Field>
              <Field label={lang === "pl" ? "WWW" : "Website"}>
                <Input
                  value={form.website ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, website: e.target.value || null }))}
                />
              </Field>
              <Field label={lang === "pl" ? "Telefon" : "Phone"}>
                <Input
                  value={form.phone ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value || null }))}
                />
              </Field>
            </div>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-2">
              <ReadRow label={lang === "pl" ? "Domena" : "Domain"} value={c.domain} />
              <ReadRow label={lang === "pl" ? "Oddział" : "Branch"} value={c.branch} />
              <ReadRow label={lang === "pl" ? "Kraj" : "Country"} value={c.country} />
              <ReadRow label={lang === "pl" ? "Miasto" : "City"} value={c.city} />
              <ReadRow label={lang === "pl" ? "Adres" : "Address"} value={c.address} />
              <ReadRow label={lang === "pl" ? "Kod pocztowy" : "Postal code"} value={c.postal_code} />
              <ReadRow
                label={lang === "pl" ? "WWW" : "Website"}
                value={
                  c.website ? (
                    <a
                      href={c.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {c.website}
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  ) : null
                }
              />
              <ReadRow label={lang === "pl" ? "Telefon" : "Phone"} value={c.phone} />
            </dl>
          )}
        </div>

        <aside className="space-y-3 rounded-md border bg-card p-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            {lang === "pl" ? "Podsumowanie" : "Summary"}
          </h2>
          <Stat
            icon={<UserCircle2 className="h-4 w-4" aria-hidden />}
            label={lang === "pl" ? "Powiązane profile" : "Linked profiles"}
            value={profiles.length}
          />
          <Stat
            icon={<Users className="h-4 w-4" aria-hidden />}
            label={lang === "pl" ? "Powiązane leady" : "Linked leads"}
            value={leads.length}
          />
          <Stat
            icon={<Globe className="h-4 w-4" aria-hidden />}
            label={lang === "pl" ? "Utworzono" : "Created"}
            value={fmt.format(new Date(c.created_at))}
          />
          <Stat
            icon={<MapPin className="h-4 w-4" aria-hidden />}
            label={lang === "pl" ? "Aktualizacja" : "Updated"}
            value={fmt.format(new Date(c.updated_at))}
          />
        </aside>
      </section>

      <section className="rounded-md border bg-card">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-sm font-medium">
            {lang === "pl" ? "Powiązane profile" : "Linked profiles"}{" "}
            <span className="text-muted-foreground">({profiles.length})</span>
          </h2>
        </div>
        {profiles.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            {lang === "pl" ? "Brak powiązanych profili." : "No linked profiles."}
          </div>
        ) : (
          <ul className="divide-y">
            {profiles.map((p) => {
              const name =
                p.display_name ||
                [p.first_name, p.last_name].filter(Boolean).join(" ") ||
                p.contact_email ||
                p.id.slice(0, 8);
              return (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                    {p.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-medium text-muted-foreground">
                        {name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[p.job_title, p.location].filter(Boolean).join(" - ") ||
                        (lang === "pl" ? "Brak stanowiska" : "No title")}
                    </div>
                  </div>
                  {p.slug && (
                    <Link
                      to="/author/$slug"
                      params={{ slug: p.slug }}
                      className="text-xs text-primary hover:underline"
                    >
                      {lang === "pl" ? "Profil" : "Profile"}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-md border bg-card">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-sm font-medium">
            {lang === "pl" ? "Powiązane leady CRM" : "Linked CRM leads"}{" "}
            <span className="text-muted-foreground">({leads.length})</span>
          </h2>
        </div>
        {leads.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            {lang === "pl" ? "Brak powiązanych leadów." : "No linked leads."}
          </div>
        ) : (
          <ul className="divide-y">
            {leads.map((l) => {
              const name =
                [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email;
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() =>
                      navigate({ to: "/admin/crm", search: { lead: l.id } })
                    }
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 truncate font-medium">
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
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[l.email, l.position, l.phone].filter(Boolean).join(" - ")}
                      </div>
                    </div>
                    {l.last_activity_at && (
                      <div className="hidden text-xs text-muted-foreground sm:block">
                        {fmt.format(new Date(l.last_activity_at))}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
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
      <Label className="text-xs text-muted-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}

function ReadRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">
        {value === null || value === undefined || value === "" ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-medium">{value}</span>
    </div>
  );
}
