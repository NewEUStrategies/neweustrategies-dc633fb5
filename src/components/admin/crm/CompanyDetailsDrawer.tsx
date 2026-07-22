// Panel szczegółów firmy (drawer) - używany w `/admin/companies`.
// Pokazuje dane firmy, powiązane kontakty (profiles) i leady, umożliwia
// edycję inline. Dane pochodzą z `getCrmCompany` (RLS w server-fn scope'uje
// po tenancie). Nie duplikuje strony `/admin/companies/$id` - stanowi jej
// lekką, szybką wersję z zachowaniem tej samej powierzchni danych.
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Building2,
  Globe,
  MapPin,
  Phone,
  Pencil,
  Save,
  X,
  Users,
  Target,
  ExternalLink,
  Mail,
  ArrowUpRight,
  Calendar,
  Copy,
  Check,
  UserPlus,
  Activity,
  StickyNote,
  Pencil as PencilIcon,
  PlusCircle,
} from "lucide-react";

import {
  getCrmCompany,
  updateCrmCompany,
  createCrmContactForCompany,
  getCrmCompanyActivity,
  addCrmCompanyNote,
} from "@/lib/crm-companies.functions";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
const Skeleton = ({ className = "" }: { className?: string }) => (
  <div className={`animate-pulse rounded bg-muted/60 ${className}`} />
);
import { LeadScoreBadge } from "@/components/admin/crm/LeadScoreBadge";
import type { ScoreBand } from "@/lib/crm/scoring";

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

interface Props {
  companyId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const HUE_PALETTE = [210, 340, 32, 165, 262, 12, 195, 285, 55, 130];
function accent(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = HUE_PALETTE[h % HUE_PALETTE.length];
  return {
    bg: `hsl(${hue} 78% 96%)`,
    fg: `hsl(${hue} 55% 32%)`,
    ring: `hsl(${hue} 60% 45% / 0.25)`,
  };
}
function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

const STAGE_TONE: Record<string, string> = {
  new: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  qualified: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  contacted: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  proposal: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  won: "bg-emerald-600/15 text-emerald-800 dark:text-emerald-200",
  lost: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

export function CompanyDetailsDrawer({ companyId, open, onOpenChange }: Props) {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const qc = useQueryClient();
  const getFn = useServerFn(getCrmCompany);
  const updateFn = useServerFn(updateCrmCompany);

  const query = useQuery({
    queryKey: ["admin", "crm-company", companyId],
    enabled: !!companyId && open,
    queryFn: async () => {
      const res = await getFn({ data: { id: companyId as string } });
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
  const [copied, setCopied] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [tab, setTab] = useState<"overview" | "contacts" | "leads" | "activity">("overview");

  useEffect(() => {
    if (!open) {
      setEditing(false);
      setForm({});
      setAddOpen(false);
      setTab("overview");
    }
  }, [open]);

  const company = query.data?.company;
  const profiles = query.data?.profiles ?? [];
  const leads = query.data?.leads ?? [];

  const startEdit = () => {
    if (!company) return;
    setForm({
      name: company.name,
      domain: company.domain,
      country: company.country,
      branch: company.branch,
      city: company.city,
      address: company.address,
      postal_code: company.postal_code,
      website: company.website,
      phone: company.phone,
    });
    setEditing(true);
  };

  const save = useMutation({
    mutationFn: async () =>
      updateFn({ data: { id: companyId as string, ...form } }),
    onSuccess: async () => {
      toast.success(t("Zapisano zmiany", "Changes saved"));
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ["admin", "crm-company", companyId] });
      await qc.invalidateQueries({ queryKey: ["admin", "crm-companies"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "error");
    },
  });

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((v) => (v === key ? null : v)), 1200);
    } catch {
      /* noop */
    }
  };

  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(lang === "pl" ? "pl-PL" : "en-GB", {
        dateStyle: "medium",
      }),
    [lang],
  );

  const acc = company ? accent(company.name) : accent("?");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-full p-0 sm:max-w-[560px]"
        aria-describedby={undefined}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <SheetHeader className="space-y-3 border-b p-4">
            {query.isLoading ? (
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ) : company ? (
              <>
                <div className="flex items-start gap-3">
                  <div
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-md text-sm font-semibold ring-1"
                    style={{ background: acc.bg, color: acc.fg, boxShadow: `0 0 0 1px ${acc.ring}` }}
                    aria-hidden
                  >
                    {company.domain ? (
                      <img
                        src={`https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(company.domain)}`}
                        alt=""
                        className="h-6 w-6 object-contain"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <span>{initials(company.name)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="truncate text-base font-semibold">
                      {company.name}
                    </SheetTitle>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                      {company.branch && (
                        <Badge variant="secondary" className="rounded px-1.5 py-0 text-[10px] font-normal">
                          {company.branch}
                        </Badge>
                      )}
                      {company.domain && (
                        <span className="inline-flex items-center gap-1">
                          <Globe className="h-3 w-3" aria-hidden />
                          {company.domain}
                        </span>
                      )}
                      {company.city && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" aria-hidden />
                          {[company.city, company.country].filter(Boolean).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Link
                      to="/admin/companies/$id"
                      params={{ id: company.id }}
                      onClick={() => onOpenChange(false)}
                      aria-label={t("Otwórz stronę firmy", "Open company page")}
                    >
                      <Button size="icon" variant="ghost" className="h-8 w-8">
                        <ArrowUpRight className="h-4 w-4" aria-hidden />
                      </Button>
                    </Link>
                  </div>
                </div>

                {/* Quick stats */}
                <div className="grid grid-cols-3 gap-2">
                  <QuickStat
                    icon={<Users className="h-3 w-3" aria-hidden />}
                    label={t("Kontakty", "Contacts")}
                    value={profiles.length}
                    tone="sky"
                  />
                  <QuickStat
                    icon={<Target className="h-3 w-3" aria-hidden />}
                    label={t("Leady", "Leads")}
                    value={leads.length}
                    tone="amber"
                  />
                  <QuickStat
                    icon={<Calendar className="h-3 w-3" aria-hidden />}
                    label={t("Utworzono", "Created")}
                    value={fmt.format(new Date(company.created_at))}
                    tone="violet"
                    small
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                  {!editing ? (
                    <>
                      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={startEdit}>
                        <Pencil className="h-3 w-3" aria-hidden />
                        {t("Edytuj", "Edit")}
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 gap-1.5"
                        onClick={() => setAddOpen(true)}
                      >
                        <UserPlus className="h-3 w-3" aria-hidden />
                        {t("Dodaj kontakt", "Add contact")}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5"
                        onClick={() => setEditing(false)}
                        disabled={save.isPending}
                      >
                        <X className="h-3 w-3" aria-hidden />
                        {t("Anuluj", "Cancel")}
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 gap-1.5"
                        onClick={() => save.mutate()}
                        disabled={save.isPending}
                      >
                        <Save className="h-3 w-3" aria-hidden />
                        {save.isPending ? t("Zapis…", "Saving…") : t("Zapisz", "Save")}
                      </Button>
                    </>
                  )}
                  {company.website && !editing && (
                    <a
                      href={company.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto"
                    >
                      <Button size="sm" variant="ghost" className="h-8 gap-1.5">
                        <ExternalLink className="h-3 w-3" aria-hidden />
                        {t("Strona", "Website")}
                      </Button>
                    </a>
                  )}
                </div>
              </>
            ) : (
              <SheetTitle className="text-sm text-muted-foreground">
                {t("Firma nieznaleziona.", "Company not found.")}
              </SheetTitle>
            )}
          </SheetHeader>

          {/* Body */}
          {company && (
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as typeof tab)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <TabsList className="mx-4 mt-3 grid w-auto grid-cols-4 rounded-md bg-muted/60">
                <TabsTrigger value="overview" className="text-xs">
                  {t("Dane", "Overview")}
                </TabsTrigger>
                <TabsTrigger value="contacts" className="text-xs">
                  {t(`Kontakty (${profiles.length})`, `Contacts (${profiles.length})`)}
                </TabsTrigger>
                <TabsTrigger value="leads" className="text-xs">
                  {t(`Leady (${leads.length})`, `Leads (${leads.length})`)}
                </TabsTrigger>
                <TabsTrigger value="activity" className="text-xs">
                  {t("Aktywność", "Activity")}
                </TabsTrigger>
              </TabsList>

              <ScrollArea className="min-h-0 flex-1">
                <div className="p-4">
                  <TabsContent value="overview" className="mt-0 space-y-3">
                    {editing ? (
                      <EditForm form={form} setForm={setForm} lang={lang} />
                    ) : (
                      <div className="grid gap-2.5">
                        <DetailRow
                          icon={<Building2 className="h-3.5 w-3.5" aria-hidden />}
                          label={t("Nazwa", "Name")}
                          value={company.name}
                          onCopy={() => copy(company.name, "name")}
                          copied={copied === "name"}
                        />
                        <DetailRow
                          icon={<Globe className="h-3.5 w-3.5" aria-hidden />}
                          label={t("Domena", "Domain")}
                          value={company.domain}
                          onCopy={company.domain ? () => copy(company.domain!, "domain") : undefined}
                          copied={copied === "domain"}
                        />
                        <DetailRow
                          icon={<ExternalLink className="h-3.5 w-3.5" aria-hidden />}
                          label={t("Strona www", "Website")}
                          value={company.website}
                          href={company.website ?? undefined}
                        />
                        <DetailRow
                          icon={<Phone className="h-3.5 w-3.5" aria-hidden />}
                          label={t("Telefon", "Phone")}
                          value={company.phone}
                          href={company.phone ? `tel:${company.phone}` : undefined}
                        />
                        <DetailRow
                          icon={<MapPin className="h-3.5 w-3.5" aria-hidden />}
                          label={t("Adres", "Address")}
                          value={
                            [company.address, company.postal_code, company.city, company.country]
                              .filter(Boolean)
                              .join(", ") || null
                          }
                        />
                        <DetailRow
                          icon={<Building2 className="h-3.5 w-3.5" aria-hidden />}
                          label={t("Branża", "Industry")}
                          value={company.branch}
                        />
                        <DetailRow
                          icon={<Calendar className="h-3.5 w-3.5" aria-hidden />}
                          label={t("Ostatnia aktualizacja", "Last updated")}
                          value={fmt.format(new Date(company.updated_at))}
                        />
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="contacts" className="mt-0 space-y-2">
                    <div className="flex items-center justify-between pb-1">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {t("Powiązane kontakty", "Linked contacts")}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1.5 text-[12px]"
                        onClick={() => setAddOpen(true)}
                      >
                        <UserPlus className="h-3 w-3" aria-hidden />
                        {t("Dodaj", "Add")}
                      </Button>
                    </div>
                    {profiles.length === 0 && leads.length === 0 ? (
                      <EmptyState
                        icon={<Users className="h-6 w-6" aria-hidden />}
                        text={t("Brak powiązanych kontaktów.", "No linked contacts.")}
                      />
                    ) : (
                      <>
                        {profiles.map((p) => (
                          <ContactCard
                            key={p.id}
                            p={p}
                            lang={lang}
                            onClose={() => onOpenChange(false)}
                          />
                        ))}
                      </>
                    )}
                  </TabsContent>

                  <TabsContent value="leads" className="mt-0 space-y-2">
                    {leads.length === 0 ? (
                      <EmptyState
                        icon={<Target className="h-6 w-6" aria-hidden />}
                        text={t("Brak leadów dla tej firmy.", "No leads for this company.")}
                      />
                    ) : (
                      leads.map((l) => (
                        <LeadCard
                          key={l.id}
                          l={l}
                          lang={lang}
                          fmt={fmt}
                          onClose={() => onOpenChange(false)}
                        />
                      ))
                    )}
                  </TabsContent>

                  <TabsContent value="activity" className="mt-0 space-y-2">
                    <ActivityFeed
                      companyId={company.id}
                      enabled={tab === "activity"}
                      lang={lang}
                    />
                  </TabsContent>
                </div>
              </ScrollArea>
            </Tabs>
          )}
        </div>
      </SheetContent>
      {company && (
        <AddContactDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          companyId={company.id}
          companyName={company.name}
          lang={lang}
        />
      )}
    </Sheet>
  );
}

function QuickStat({
  icon,
  label,
  value,
  tone,
  small,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone: "sky" | "amber" | "violet";
  small?: boolean;
}) {
  const tones: Record<string, string> = {
    sky: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  };
  return (
    <div className="rounded-md border bg-card p-2">
      <div className="flex items-center gap-1.5">
        <span className={`grid h-5 w-5 place-items-center rounded ${tones[tone]}`}>{icon}</span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <div className={`mt-1 font-semibold tabular-nums ${small ? "text-[12px]" : "text-base"}`}>
        {value}
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
  href,
  onCopy,
  copied,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  href?: string;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="group flex items-start gap-2.5 rounded-md border bg-card px-3 py-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {value ? (
          href ? (
            <a
              href={href}
              target={href.startsWith("http") ? "_blank" : undefined}
              rel="noopener noreferrer"
              className="block truncate text-[13px] text-foreground hover:text-primary hover:underline"
            >
              {value}
            </a>
          ) : (
            <div className="truncate text-[13px] text-foreground">{value}</div>
          )
        ) : (
          <div className="text-[12px] text-muted-foreground/60">-</div>
        )}
      </div>
      {onCopy && value && (
        <button
          type="button"
          onClick={onCopy}
          className="opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          aria-label="Copy"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          )}
        </button>
      )}
    </div>
  );
}

function EditForm({
  form,
  setForm,
  lang,
}: {
  form: Partial<Company>;
  setForm: (f: Partial<Company>) => void;
  lang: "pl" | "en";
}) {
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const set = <K extends keyof Company>(k: K, v: string) =>
    setForm({ ...form, [k]: v === "" ? null : v });
  const fields: Array<{ key: keyof Company; label: string; type?: string }> = [
    { key: "name", label: t("Nazwa", "Name") },
    { key: "domain", label: t("Domena", "Domain") },
    { key: "website", label: t("Strona www", "Website") },
    { key: "branch", label: t("Branża", "Industry") },
    { key: "phone", label: t("Telefon", "Phone") },
    { key: "address", label: t("Adres", "Address") },
    { key: "postal_code", label: t("Kod pocztowy", "Postal code") },
    { key: "city", label: t("Miasto", "City") },
    { key: "country", label: t("Kraj", "Country") },
  ];
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.key} className={f.key === "name" || f.key === "address" ? "sm:col-span-2" : ""}>
          <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {f.label}
          </Label>
          <Input
            className="mt-1 h-9 text-[13px]"
            value={(form[f.key] as string | null) ?? ""}
            onChange={(e) => set(f.key, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

function ContactCard({
  p,
  lang,
  onClose,
}: {
  p: LinkedProfile;
  lang: "pl" | "en";
  onClose: () => void;
}) {
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const name =
    p.display_name ||
    [p.first_name, p.last_name].filter(Boolean).join(" ") ||
    p.contact_email ||
    "-";
  const acc = accent(name);
  return (
    <div className="flex items-center gap-2.5 rounded-md border bg-card p-2.5 transition-colors hover:bg-muted/40">
      {p.avatar_url ? (
        <img src={p.avatar_url} alt="" className="h-9 w-9 rounded-md object-cover" loading="lazy" />
      ) : (
        <div
          className="grid h-9 w-9 place-items-center rounded-md text-[11px] font-semibold"
          style={{ background: acc.bg, color: acc.fg }}
          aria-hidden
        >
          {initials(name)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{name}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {[p.job_title, p.location].filter(Boolean).join(" - ") ||
            p.contact_email ||
            t("Brak opisu", "No details")}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {p.contact_email && (
          <a
            href={`mailto:${p.contact_email}`}
            className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={p.contact_email}
          >
            <Mail className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
        {p.slug && (
          <Link
            to="/author/$slug"
            params={{ slug: p.slug }}
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("Otwórz profil", "Open profile")}
          >
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}

function LeadCard({
  l,
  lang,
  fmt,
  onClose,
}: {
  l: LinkedLead;
  lang: "pl" | "en";
  fmt: Intl.DateTimeFormat;
  onClose: () => void;
}) {
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const name = [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email;
  const stageTone = STAGE_TONE[l.stage] ?? "bg-muted text-muted-foreground";
  return (
    <Link
      to="/admin/crm"
      onClick={onClose}
      className="block rounded-md border bg-card p-2.5 transition-colors hover:bg-muted/40"
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium">{name}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${stageTone}`}>
              {l.stage}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {l.position && <span>{l.position}</span>}
            <span className="truncate">{l.email}</span>
            {l.last_activity_at && (
              <span>
                {t("aktywność", "activity")}: {fmt.format(new Date(l.last_activity_at))}
              </span>
            )}
          </div>
        </div>
        {l.score !== null && l.score_band && (
          <LeadScoreBadge score={l.score} band={l.score_band as ScoreBand} lang={lang} />
        )}
      </div>
    </Link>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="grid place-items-center gap-2 rounded-md border border-dashed bg-muted/20 py-10 text-center text-[12px] text-muted-foreground">
      <span className="opacity-50">{icon}</span>
      {text}
    </div>
  );
}

// ---- Activity feed ------------------------------------------------------
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

function ActivityFeed({
  companyId,
  enabled,
  lang,
}: {
  companyId: string;
  enabled: boolean;
  lang: "pl" | "en";
}) {
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const fn = useServerFn(getCrmCompanyActivity);
  const q = useQuery({
    queryKey: ["admin", "crm-company-activity", companyId],
    enabled: enabled && !!companyId,
    queryFn: async () => {
      const res = await fn({ data: { id: companyId } });
      return JSON.parse(res.json) as ActivityEvent[];
    },
    staleTime: 15_000,
  });
  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(lang === "pl" ? "pl-PL" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [lang],
  );

  if (q.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  const events = q.data ?? [];
  if (events.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="h-6 w-6" aria-hidden />}
        text={t("Brak zarejestrowanych zdarzeń.", "No recorded activity.")}
      />
    );
  }
  return (
    <ol className="relative space-y-1.5 border-l border-border/60 pl-3.5">
      {events.map((e) => (
        <ActivityRow key={e.id} e={e} lang={lang} fmt={fmt} t={t} />
      ))}
    </ol>
  );
}

function ActivityRow({
  e,
  lang,
  fmt,
  t,
}: {
  e: ActivityEvent;
  lang: "pl" | "en";
  fmt: Intl.DateTimeFormat;
  t: (pl: string, en: string) => string;
}) {
  const { icon, tone, label } = describeAction(e, lang);
  const tones: Record<string, string> = {
    sky: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <li className="relative rounded-md border bg-card p-2.5">
      <span
        aria-hidden
        className={`absolute -left-[19px] top-3 grid h-5 w-5 place-items-center rounded-full ring-2 ring-background ${tones[tone]}`}
      >
        {icon}
      </span>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-foreground">{label}</div>
          {e.lead_label && (
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {t("Kontakt", "Contact")}: {e.lead_label}
            </div>
          )}
          {e.body && (
            <div className="mt-1 whitespace-pre-wrap rounded bg-muted/40 p-2 text-[12px] text-foreground/90">
              {e.body}
            </div>
          )}
          {e.metadata && Array.isArray((e.metadata as { fields?: unknown }).fields) &&
            (e.metadata as { fields: string[] }).fields.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {(e.metadata as { fields: string[] }).fields.map((f) => (
                  <span
                    key={f}
                    className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    {f}
                  </span>
                ))}
              </div>
            )}
        </div>
        <time
          className="shrink-0 text-[10px] tabular-nums text-muted-foreground"
          dateTime={e.created_at}
        >
          {fmt.format(new Date(e.created_at))}
        </time>
      </div>
    </li>
  );
}

function describeAction(
  e: ActivityEvent,
  lang: "pl" | "en",
): { icon: React.ReactNode; tone: "sky" | "amber" | "emerald" | "violet" | "muted"; label: string } {
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  if (e.kind === "note")
    return {
      icon: <StickyNote className="h-3 w-3" aria-hidden />,
      tone: "violet",
      label: t("Dodano notatkę", "Note added"),
    };
  if (e.kind === "lead_created" || e.action === "crm.contact.create")
    return {
      icon: <PlusCircle className="h-3 w-3" aria-hidden />,
      tone: "emerald",
      label: t("Utworzono kontakt", "Contact created"),
    };
  if (e.action === "crm.company.update")
    return {
      icon: <PencilIcon className="h-3 w-3" aria-hidden />,
      tone: "sky",
      label: t("Zaktualizowano firmę", "Company updated"),
    };
  if (e.action.startsWith("crm.lead."))
    return {
      icon: <Target className="h-3 w-3" aria-hidden />,
      tone: "amber",
      label: e.action.replace(/^crm\.lead\./, "Lead: "),
    };
  return {
    icon: <Activity className="h-3 w-3" aria-hidden />,
    tone: "muted",
    label: e.action,
  };
}

// ---- Add contact dialog -------------------------------------------------
function AddContactDialog({
  open,
  onOpenChange,
  companyId,
  companyName,
  lang,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  companyName: string;
  lang: "pl" | "en";
}) {
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const qc = useQueryClient();
  const createFn = useServerFn(createCrmContactForCompany);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [position, setPosition] = useState("");

  useEffect(() => {
    if (!open) {
      setEmail("");
      setFirstName("");
      setLastName("");
      setPhone("");
      setPosition("");
    }
  }, [open]);

  const create = useMutation({
    mutationFn: async () =>
      createFn({
        data: {
          company_id: companyId,
          email: email.trim(),
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          phone: phone.trim() || null,
          position: position.trim() || null,
        },
      }),
    onSuccess: async () => {
      toast.success(t("Dodano kontakt", "Contact added"));
      onOpenChange(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin", "crm-company", companyId] }),
        qc.invalidateQueries({ queryKey: ["admin", "crm-company-activity", companyId] }),
        qc.invalidateQueries({ queryKey: ["admin", "crm-companies"] }),
      ]);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "error";
      if (msg === "duplicate_email") {
        toast.error(
          t(
            "Kontakt z tym e-mailem już istnieje w tenancie.",
            "A contact with this email already exists in this tenant.",
          ),
        );
      } else {
        toast.error(msg);
      }
    },
  });

  const canSubmit = email.trim().length > 3 && email.includes("@") && !create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-base">
            {t("Dodaj kontakt", "Add contact")}
          </DialogTitle>
          <p className="text-[12px] text-muted-foreground">
            {t(
              `Nowy kontakt zostanie powiązany z firmą "${companyName}".`,
              `The new contact will be linked to "${companyName}".`,
            )}
          </p>
        </DialogHeader>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("E-mail", "Email")}
            </Label>
            <Input
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 h-9 text-[13px]"
              placeholder="jan.kowalski@example.com"
            />
          </div>
          <div>
            <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("Imię", "First name")}
            </Label>
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="mt-1 h-9 text-[13px]"
            />
          </div>
          <div>
            <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("Nazwisko", "Last name")}
            </Label>
            <Input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="mt-1 h-9 text-[13px]"
            />
          </div>
          <div>
            <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("Telefon", "Phone")}
            </Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 h-9 text-[13px]"
            />
          </div>
          <div>
            <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("Stanowisko", "Position")}
            </Label>
            <Input
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="mt-1 h-9 text-[13px]"
            />
          </div>
        </div>
        <DialogFooter className="gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            {t("Anuluj", "Cancel")}
          </Button>
          <Button
            size="sm"
            onClick={() => create.mutate()}
            disabled={!canSubmit}
            className="gap-1.5"
          >
            <UserPlus className="h-3 w-3" aria-hidden />
            {create.isPending ? t("Zapis…", "Saving…") : t("Dodaj kontakt", "Add contact")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
