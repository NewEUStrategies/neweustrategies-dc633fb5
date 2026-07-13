// Strona edycji organizacji z zakładkami: Ogólne, Branding, Miejsca, Audit.
// Kompozycja spójna ze stroną publiczną (kontener max-w-6xl, kompaktowe karty),
// live preview brandingu po prawej sticky.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Landmark,
  Save,
  Trash2,
  Palette,
  Users,
  ClipboardList,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMembershipTiers, tierName, type MembershipTierRow } from "@/lib/billing/tiers";
import {
  fetchOrganization,
  updateOrganization,
  deleteOrganization,
  type OrganizationRow,
} from "@/lib/admin/membership-admin";
import {
  OrgGeneralForm,
  type OrgGeneralValue,
  makeSlug,
} from "@/components/admin/organizations/OrgGeneralForm";
import {
  OrgBrandingForm,
  type OrgBrandingValue,
} from "@/components/admin/organizations/OrgBrandingForm";
import { OrgBrandPreview } from "@/components/admin/organizations/OrgBrandPreview";
import { SeatManager } from "@/routes/admin.organizations";

export const Route = createFileRoute("/admin/organizations/$id")({
  component: EditOrganizationPage,
});

type Lang = "pl" | "en";

const DEFAULT_BRAND: OrgBrandingValue = {
  brand_primary: "#0f172a",
  brand_accent: "#f59e0b",
  brand_ink: "#ffffff",
  logo_h_light: null,
  logo_h_dark: null,
  logo_v_light: null,
  logo_v_dark: null,
  logo_favicon: null,
};

function orgToGeneral(org: OrganizationRow): OrgGeneralValue {
  return {
    name: org.name ?? "",
    slug: org.slug ?? "",
    tier_key: org.tier_key ?? "corporate",
    seats_limit: org.seats_limit ?? 5,
    contact_email: org.contact_email ?? "",
    note: org.note ?? "",
    description: org.description ?? "",
    website_url: org.website_url ?? "",
    sector: org.sector ?? "",
    city: org.city ?? "",
    country: org.country ?? "",
  };
}

function orgToBranding(org: OrganizationRow): OrgBrandingValue {
  return {
    brand_primary: org.brand_primary ?? DEFAULT_BRAND.brand_primary,
    brand_accent: org.brand_accent ?? DEFAULT_BRAND.brand_accent,
    brand_ink: org.brand_ink ?? DEFAULT_BRAND.brand_ink,
    logo_h_light: org.logo_h_light ?? null,
    logo_h_dark: org.logo_h_dark ?? null,
    logo_v_light: org.logo_v_light ?? null,
    logo_v_dark: org.logo_v_dark ?? null,
    logo_favicon: org.logo_favicon ?? null,
  };
}

function EditOrganizationPage() {
  const { id } = Route.useParams();
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const orgKey = ["admin", "member-org", id] as const;
  const orgQ = useQuery({ queryKey: orgKey, queryFn: () => fetchOrganization(id) });

  const tiersQ = useMembershipTiers();
  const tierOptions = useMemo<MembershipTierRow[]>(() => {
    const tiers = tiersQ.data ?? [];
    const high = tiers.filter((t) => t.rank >= 30);
    return high.length > 0 ? high : tiers;
  }, [tiersQ.data]);
  const tierLabel = (key: string): string => {
    const t = (tiersQ.data ?? []).find((x) => x.key === key);
    return t ? tierName(t, lang) : key;
  };

  const [general, setGeneral] = useState<OrgGeneralValue | null>(null);
  const [branding, setBranding] = useState<OrgBrandingValue>(DEFAULT_BRAND);

  useEffect(() => {
    if (orgQ.data) {
      setGeneral(orgToGeneral(orgQ.data));
      setBranding(orgToBranding(orgQ.data));
    }
  }, [orgQ.data]);

  const saveGeneral = useMutation({
    mutationFn: async () => {
      if (!general) return;
      await updateOrganization(id, {
        name: general.name.trim(),
        slug: general.slug.trim() ? makeSlug(general.slug) : null,
        tier_key: general.tier_key,
        seats_limit: general.seats_limit,
        contact_email: general.contact_email.trim() || null,
        note: general.note.trim() || null,
        description: general.description.trim() || null,
        website_url: general.website_url.trim() || null,
        sector: general.sector.trim() || null,
        city: general.city.trim() || null,
        country: general.country.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success(L("Zapisano", "Saved"));
      void qc.invalidateQueries({ queryKey: orgKey });
      void qc.invalidateQueries({ queryKey: ["admin", "member-orgs"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const setStatus = useMutation({
    mutationFn: (active: boolean) =>
      updateOrganization(id, { status: active ? "active" : "suspended" }),
    onSuccess: () => {
      toast.success(L("Zaktualizowano status", "Status updated"));
      void qc.invalidateQueries({ queryKey: orgKey });
      void qc.invalidateQueries({ queryKey: ["admin", "member-orgs"] });
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteOrganization(id),
    onSuccess: () => {
      toast.success(L("Usunięto", "Deleted"));
      void qc.invalidateQueries({ queryKey: ["admin", "member-orgs"] });
      void navigate({ to: "/admin/organizations" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (orgQ.isLoading || !general) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <p className="text-sm text-muted-foreground">{L("Wczytywanie...", "Loading...")}</p>
      </div>
    );
  }

  if (!orgQ.data) {
    return (
      <div className="mx-auto max-w-6xl p-6 space-y-3">
        <Link
          to="/admin/organizations"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {L("Wróć do listy", "Back to list")}
        </Link>
        <p className="text-sm">{L("Nie znaleziono organizacji.", "Organization not found.")}</p>
      </div>
    );
  }

  const org = orgQ.data;
  const isActive = org.status === "active";

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <header className="space-y-2">
        <Link
          to="/admin/organizations"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {L("Wróć do listy", "Back to list")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <Landmark className="h-5 w-5" />
              <span className="truncate">{org.name}</span>
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{tierLabel(org.tier_key)}</Badge>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {L("limit miejsc", "seat limit")}: {org.seats_limit}
              </span>
              <span className="flex items-center gap-1.5 rounded border border-border/60 px-2 py-0.5 text-[11px]">
                <Switch
                  checked={isActive}
                  onCheckedChange={(v) => setStatus.mutate(v)}
                  disabled={setStatus.isPending}
                  aria-label={L("Status", "Status")}
                />
                {isActive ? L("aktywna", "active") : L("wstrzymana", "suspended")}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (
                  confirm(
                    L(
                      `Usunąć "${org.name}"? Miejsca zostaną skasowane.`,
                      `Delete "${org.name}"? Its seats will be removed.`,
                    ),
                  )
                ) {
                  remove.mutate();
                }
              }}
              disabled={remove.isPending}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {L("Usuń", "Delete")}
            </Button>
          </div>
        </div>
      </header>

      <Tabs defaultValue="general">
        <TabsList className="h-9">
          <TabsTrigger value="general" className="text-xs">
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            {L("Ogólne", "General")}
          </TabsTrigger>
          <TabsTrigger value="branding" className="text-xs">
            <Palette className="mr-1.5 h-3.5 w-3.5" />
            {L("Branding", "Branding")}
          </TabsTrigger>
          <TabsTrigger value="seats" className="text-xs">
            <Users className="mr-1.5 h-3.5 w-3.5" />
            {L("Miejsca", "Seats")}
          </TabsTrigger>
          <TabsTrigger value="audit" className="text-xs">
            <ClipboardList className="mr-1.5 h-3.5 w-3.5" />
            {L("Audit", "Audit")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm">{L("Dane ogólne", "General details")}</CardTitle>
              <Button size="sm" onClick={() => saveGeneral.mutate()} disabled={saveGeneral.isPending}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {L("Zapisz", "Save")}
              </Button>
            </CardHeader>
            <CardContent>
              <OrgGeneralForm
                value={general}
                onChange={setGeneral}
                tierOptions={tierOptions}
                lang={lang}
                autoSlug={false}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="branding" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{L("Kolory i logo", "Colors & logos")}</CardTitle>
              </CardHeader>
              <CardContent>
                <OrgBrandingForm
                  orgId={id}
                  value={branding}
                  onChange={setBranding}
                  lang={lang}
                />
              </CardContent>
            </Card>

            <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">{L("Podgląd na żywo", "Live preview")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <OrgBrandPreview
                    lang={lang}
                    name={org.name}
                    brand={{
                      primary: branding.brand_primary,
                      accent: branding.brand_accent,
                      ink: branding.brand_ink,
                      logoHLight: branding.logo_h_light,
                      logoHDark: branding.logo_h_dark,
                      logoVLight: branding.logo_v_light,
                      logoVDark: branding.logo_v_dark,
                    }}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="seats" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{L("Miejsca członkowskie", "Membership seats")}</CardTitle>
            </CardHeader>
            <CardContent>
              <SeatManager lang={lang} orgId={id} seatsLimit={org.seats_limit} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{L("Metadane", "Metadata")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <MetaField label="ID" value={org.id} mono />
                <MetaField label={L("Utworzono", "Created")} value={new Date(org.created_at).toLocaleString()} />
                <MetaField
                  label={L("Zaktualizowano", "Updated")}
                  value={org.updated_at ? new Date(org.updated_at).toLocaleString() : "-"}
                />
                <MetaField label={L("Status", "Status")} value={org.status} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MetaField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 truncate text-xs ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
