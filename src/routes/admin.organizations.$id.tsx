// Panel: pełna strona organizacji członkowskiej - premium edytor marki
// (kolory, logo poziome/pionowe w wariantach light/dark), dane, kontakt i
// zarządzanie miejscami. Wygląd zgodny z produkcyjnym layoutem admin (kompakt).
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { uiLocale } from "@/lib/i18n/format";
import { ensureI18n as ensureAdminOrganizationsI18n } from "@/lib/i18n-admin-organizations";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  Save,
  Trash2,
  Palette,
  Image as ImageIcon,
  Users,
  Settings2,
  Globe,
  Mail,
  MapPin,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import {
  runSeatGraceExpiry,
  runSeatGraceReminders,
  setTeamSeatGraceDays,
  setTeamSeatGraceReminderDays,
  setTeamSeatLimit,
} from "@/lib/organizations/teamSeats.functions";
import {
  DEFAULT_GRACE_DAYS,
  MAX_GRACE_DAYS,
  MAX_REMINDER_SLOTS,
  MIN_GRACE_DAYS,
  clampGraceDays,
  effectiveReminderDays,
  formatReminderDays,
  normalizeReminderDays,
  parseReminderDays,
  sameReminderDays,
} from "@/lib/organizations/teamSeats";

import { clampSeats, seatsAtRisk, summarizeSeats } from "@/lib/organizations/teamSeats";
import { billingKeys } from "@/lib/billing/keys";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";
import { ImageSlot } from "@/components/admin/ImageSlot";
import { useMembershipTiers, tierName, type MembershipTierRow } from "@/lib/billing/tiers";
import {
  fetchOrganizationById,
  updateOrganization,
  deleteOrganization,
  fetchAdminOrgSeats,
  addOrgSeat,
  removeOrgSeat,
  type OrganizationRow,
} from "@/lib/admin/membership-admin";

export const Route = createFileRoute("/admin/organizations/$id")({
  component: AdminOrganizationDetailPage,
});

type Lang = "pl" | "en";

const DEFAULT_PRIMARY = "#0F3460";
const DEFAULT_ACCENT = "#E94560";
const DEFAULT_INK = "#141414";

function AdminOrganizationDetailPage() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-admin-organizations.ts.
  ensureAdminOrganizationsI18n();
  const { id } = Route.useParams();
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();
  const navigate = useNavigate();

  const orgQ = useQuery({
    queryKey: billingKeys.admin.memberOrg(id),
    queryFn: () => fetchOrganizationById(id),
  });

  const tiersQ = useMembershipTiers();
  const tiers: MembershipTierRow[] = useMemo(() => tiersQ.data ?? [], [tiersQ.data]);
  const tierOptions = useMemo<MembershipTierRow[]>(() => {
    const high = tiers.filter((t) => t.rank >= 30);
    return high.length > 0 ? high : tiers;
  }, [tiers]);

  const [draft, setDraft] = useState<OrganizationRow | null>(null);
  useEffect(() => {
    if (orgQ.data && !draft) setDraft(orgQ.data);
  }, [orgQ.data, draft]);

  const isDirty = useMemo(
    () => (draft && orgQ.data ? JSON.stringify(draft) !== JSON.stringify(orgQ.data) : false),
    [draft, orgQ.data],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      const {
        id: _id,
        tenant_id: _t,
        created_at: _c,
        updated_at: _u,
        created_by: _b,
        crm_company_id: _cc,
        ...patch
      } = draft;
      void _id;
      void _t;
      void _c;
      void _u;
      void _b;
      void _cc;
      await updateOrganization(id, patch);
    },
    onSuccess: () => {
      toast.success(t("adminOrganizations.saved"));
      void qc.invalidateQueries({ queryKey: billingKeys.admin.memberOrg(id) });
      void qc.invalidateQueries({ queryKey: billingKeys.admin.memberOrgs() });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeOrg = useMutation({
    mutationFn: () => deleteOrganization(id),
    onSuccess: () => {
      toast.success(t("adminOrganizations.organizationDeleted"));
      void qc.invalidateQueries({ queryKey: billingKeys.admin.memberOrgs() });
      void navigate({ to: "/admin/organizations" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (orgQ.isLoading || !draft) {
    return <p className="p-5 text-sm text-muted-foreground">{t("adminOrganizations.loading")}</p>;
  }
  if (!orgQ.data) {
    return (
      <p className="p-5 text-sm text-muted-foreground">
        {t("adminOrganizations.organizationFound")}
      </p>
    );
  }

  const patch = (mut: (d: OrganizationRow) => OrganizationRow) =>
    setDraft((d) => (d ? mut({ ...d }) : d));
  const isActive = draft.status === "active";
  const primary = draft.brand_primary ?? DEFAULT_PRIMARY;
  const accent = draft.brand_accent ?? DEFAULT_ACCENT;
  const ink = draft.brand_ink ?? DEFAULT_INK;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-start gap-3">
          <Button asChild variant="ghost" size="sm" className="mt-0.5 h-8">
            <Link to="/admin/organizations">
              <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {t("adminOrganizations.back")}
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
              {draft.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="text-[10px]">
                {draft.tier_key}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {isActive ? t("adminOrganizations.active") : t("adminOrganizations.suspended")}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {t("adminOrganizations.seatLimit")}: {draft.seats_limit}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1">
            <Switch
              checked={isActive}
              onCheckedChange={(v) => patch((d) => ({ ...d, status: v ? "active" : "suspended" }))}
              aria-label={t("adminOrganizations.status")}
            />
            <span className="text-[11px] text-muted-foreground">
              {isActive ? t("adminOrganizations.active") : t("adminOrganizations.suspended")}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={removeOrg.isPending}
            onClick={() => {
              if (confirm(t("adminOrganizations.deleteConfirm", { name: draft.name })))
                removeOrg.mutate();
            }}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t("adminOrganizations.delete")}
          </Button>
          <Button
            size="sm"
            className="h-8"
            disabled={!isDirty || save.isPending}
            onClick={() => save.mutate()}
          >
            <Save className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {save.isPending ? t("adminOrganizations.saving") : t("adminOrganizations.save")}
          </Button>
        </div>
      </header>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="h-8">
          <TabsTrigger value="general" className="text-xs">
            <Settings2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t("adminOrganizations.general")}
          </TabsTrigger>
          <TabsTrigger value="branding" className="text-xs">
            <Palette className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t("adminOrganizations.branding")}
          </TabsTrigger>
          <TabsTrigger value="logos" className="text-xs">
            <ImageIcon className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t("adminOrganizations.logos")}
          </TabsTrigger>
          <TabsTrigger value="seats" className="text-xs">
            <Users className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t("adminOrganizations.seats")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <GeneralPane lang={lang} draft={draft} patch={patch} tierOptions={tierOptions} />
        </TabsContent>

        <TabsContent value="branding" className="mt-4">
          <BrandingPane
            primary={primary}
            accent={accent}
            ink={ink}
            onChange={(k, v) => patch((d) => ({ ...d, [k]: v }))}
          />
        </TabsContent>

        <TabsContent value="logos" className="mt-4">
          <LogosPane
            draft={draft}
            primary={primary}
            accent={accent}
            onChange={(k, v) => patch((d) => ({ ...d, [k]: v }))}
          />
        </TabsContent>

        <TabsContent value="seats" className="mt-4">
          <SeatsPane
            orgId={id}
            seatsLimit={draft.seats_limit}
            seatsSource={draft.seats_source}
            graceDays={draft.seats_grace_days ?? DEFAULT_GRACE_DAYS}
            reminderDays={effectiveReminderDays(draft.seats_grace_reminder_days)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// -------- Ogólne --------
function GeneralPane({
  lang,
  draft,
  patch,
  tierOptions,
}: {
  lang: Lang;
  draft: OrganizationRow;
  patch: (mut: (d: OrganizationRow) => OrganizationRow) => void;
  tierOptions: MembershipTierRow[];
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card title={t("adminOrganizations.basics")}>
          <div className="grid gap-3">
            <Field label={t("adminOrganizations.name")}>
              <Input
                value={draft.name}
                onChange={(e) => patch((d) => ({ ...d, name: e.target.value }))}
                className="h-8 text-sm"
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t("adminOrganizations.slugUrl")}>
                <Input
                  value={draft.slug ?? ""}
                  onChange={(e) =>
                    patch((d) => ({
                      ...d,
                      slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") || null,
                    }))
                  }
                  className="h-8 text-sm"
                />
              </Field>
              <Field label={t("adminOrganizations.sector")}>
                <Input
                  value={draft.sector ?? ""}
                  onChange={(e) => patch((d) => ({ ...d, sector: e.target.value || null }))}
                  className="h-8 text-sm"
                />
              </Field>
            </div>
            <Field label={t("adminOrganizations.description")}>
              <Textarea
                value={draft.description ?? ""}
                onChange={(e) => patch((d) => ({ ...d, description: e.target.value || null }))}
                className="min-h-20 text-sm"
              />
            </Field>
          </div>
        </Card>

        <Card title={t("adminOrganizations.contactLocation")}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label={
                <>
                  <Mail className="mr-1 inline h-3 w-3" aria-hidden="true" />
                  {t("adminOrganizations.email")}
                </>
              }
            >
              <Input
                type="email"
                value={draft.contact_email ?? ""}
                onChange={(e) => patch((d) => ({ ...d, contact_email: e.target.value || null }))}
                className="h-8 text-sm"
              />
            </Field>
            <Field
              label={
                <>
                  <Globe className="mr-1 inline h-3 w-3" aria-hidden="true" />
                  {t("adminOrganizations.website")}
                </>
              }
            >
              <Input
                type="url"
                value={draft.website_url ?? ""}
                onChange={(e) => patch((d) => ({ ...d, website_url: e.target.value || null }))}
                className="h-8 text-sm"
              />
            </Field>
            <Field
              label={
                <>
                  <MapPin className="mr-1 inline h-3 w-3" aria-hidden="true" />
                  {t("adminOrganizations.city")}
                </>
              }
            >
              <Input
                value={draft.city ?? ""}
                onChange={(e) => patch((d) => ({ ...d, city: e.target.value || null }))}
                className="h-8 text-sm"
              />
            </Field>
            <Field label={t("adminOrganizations.country")}>
              <Input
                value={draft.country ?? ""}
                onChange={(e) => patch((d) => ({ ...d, country: e.target.value || null }))}
                className="h-8 text-sm"
              />
            </Field>
          </div>
        </Card>

        <Card title={t("adminOrganizations.internalNote")}>
          <Textarea
            value={draft.note ?? ""}
            onChange={(e) => patch((d) => ({ ...d, note: e.target.value || null }))}
            className="min-h-16 text-sm"
          />
        </Card>
      </div>

      <aside className="space-y-4">
        <Card title={t("adminOrganizations.membership")}>
          <div className="space-y-3">
            <Field label={t("adminOrganizations.tier")}>
              <Select
                value={draft.tier_key}
                onValueChange={(v) => patch((d) => ({ ...d, tier_key: v }))}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tierOptions.map((tier) => (
                    <SelectItem key={tier.key} value={tier.key}>
                      {tier.key} ({tierName(tier, lang)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("adminOrganizations.seatLimitLabel")}>
              <Input
                type="number"
                value={draft.seats_limit}
                readOnly
                disabled
                className="h-8 text-sm"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {draft.seats_source === "subscription"
                  ? t("adminOrganizations.seatCountComesPaidTeam")
                  : t("adminOrganizations.changeSeatCountSeatsTab")}
              </p>
            </Field>
          </div>
        </Card>

        {/* Mostek do kartoteki sprzedażowej: link utrzymuje trigger DB
            (upsert firmy CRM po nazwie), więc karta jest tylko podglądem. */}
        <Card title={t("adminOrganizations.crmCompany")}>
          {draft.crm_company_id ? (
            <div className="space-y-2 text-sm">
              <p className="text-xs text-muted-foreground">
                {t("adminOrganizations.organisationLinkedSalesRecordLeads")}
              </p>
              <Button asChild size="sm" variant="outline" className="w-full">
                <Link to="/admin/companies/$id" params={{ id: draft.crm_company_id }}>
                  {t("adminOrganizations.openCompanyRecord")}
                </Link>
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("adminOrganizations.crmRecordLinkCreatedAutomatically")}
            </p>
          )}
        </Card>
      </aside>
    </div>
  );
}

// -------- Marka (kolory) --------
function BrandingPane({
  primary,
  accent,
  ink,
  onChange,
}: {
  primary: string;
  accent: string;
  ink: string;
  onChange: (key: "brand_primary" | "brand_accent" | "brand_ink", v: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t("adminOrganizations.brandColors")}>
        <div className="grid gap-3">
          <ColorRow
            label={t("adminOrganizations.primary")}
            value={primary}
            onChange={(v) => onChange("brand_primary", v || null)}
            defaultValue={DEFAULT_PRIMARY}
          />
          <ColorRow
            label={t("adminOrganizations.accent")}
            value={accent}
            onChange={(v) => onChange("brand_accent", v || null)}
            defaultValue={DEFAULT_ACCENT}
          />
          <ColorRow
            label={t("adminOrganizations.inkText")}
            value={ink}
            onChange={(v) => onChange("brand_ink", v || null)}
            defaultValue={DEFAULT_INK}
          />
        </div>
      </Card>

      <Card title={t("adminOrganizations.brandPreview")}>
        <div className="space-y-3">
          <div
            className="rounded-lg p-5 shadow-sm ring-1 ring-black/5"
            style={{ background: primary, color: "#fff" }}
          >
            <p className="text-[10px] uppercase tracking-widest opacity-70">Primary</p>
            <p className="mt-1 text-lg font-semibold">Aa Bb Cc 1234</p>
            <div className="mt-3 flex gap-2">
              <span
                className="rounded-md px-3 py-1 text-xs font-medium"
                style={{ background: accent, color: "#fff" }}
              >
                {t("adminOrganizations.accentButton")}
              </span>
              <span
                className="rounded-md border px-3 py-1 text-xs font-medium"
                style={{ borderColor: "#ffffff40" }}
              >
                {t("adminOrganizations.outline")}
              </span>
            </div>
          </div>
          <div
            className="rounded-lg border p-5"
            style={{ background: "#fff", color: ink, borderColor: "#00000010" }}
          >
            <p className="text-[10px] uppercase tracking-widest opacity-60">Light surface</p>
            <p className="mt-1 text-lg font-semibold" style={{ color: primary }}>
              {t("adminOrganizations.brandHeading")}
            </p>
            <p className="text-xs" style={{ color: ink, opacity: 0.75 }}>
              {t("adminOrganizations.bodyCopyInkLightSurface")}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
  defaultValue,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  defaultValue: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card/40 p-2.5">
      <div className="min-w-0">
        <Label className="text-[11px] font-medium text-muted-foreground">{label}</Label>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{value}</p>
      </div>
      <div className="shrink-0">
        <AdminColorPicker
          value={value}
          onChange={(v) => onChange(v ?? "")}
          inheritedValue={defaultValue}
          allowReset={true}
          ariaLabel={label}
        />
      </div>
    </div>
  );
}

// -------- Logo (poziome/pionowe, light/dark) + podglądy na tłach --------
function LogosPane({
  draft,
  primary,
  accent,
  onChange,
}: {
  draft: OrganizationRow;
  primary: string;
  accent: string;
  onChange: (
    key: "logo_h_light" | "logo_h_dark" | "logo_v_light" | "logo_v_dark" | "logo_favicon",
    v: string | null,
  ) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <LogoSlot
          label={t("adminOrganizations.horizontalLightTheme")}
          desc={t("adminOrganizations.lightBackgroundsUsuallyDarkLogo")}
          value={draft.logo_h_light ?? ""}
          onChange={(v) => onChange("logo_h_light", v || null)}
        />
        <LogoSlot
          label={t("adminOrganizations.horizontalDarkTheme")}
          desc={t("adminOrganizations.darkBackgroundsUsuallyLightLogo")}
          value={draft.logo_h_dark ?? ""}
          onChange={(v) => onChange("logo_h_dark", v || null)}
        />
        <LogoSlot
          label={t("adminOrganizations.verticalLightTheme")}
          desc={t("adminOrganizations.squareStackedLogoLightBg")}
          value={draft.logo_v_light ?? ""}
          onChange={(v) => onChange("logo_v_light", v || null)}
        />
        <LogoSlot
          label={t("adminOrganizations.verticalDarkTheme")}
          desc={t("adminOrganizations.squareStackedLogoDarkBg")}
          value={draft.logo_v_dark ?? ""}
          onChange={(v) => onChange("logo_v_dark", v || null)}
        />
      </div>

      <Card title={t("adminOrganizations.previewBackgrounds")}>
        <p className="mb-3 text-[11px] text-muted-foreground">
          {t("adminOrganizations.seeHowLogoLooksWhite")}
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <PreviewTile
            label={t("adminOrganizations.white")}
            bg="#ffffff"
            src={draft.logo_h_light ?? draft.logo_v_light}
            variant="horizontal"
          />
          <PreviewTile
            label={t("adminOrganizations.dark")}
            bg="#0F172A"
            src={draft.logo_h_dark ?? draft.logo_v_dark}
            variant="horizontal"
          />
          <PreviewTile
            label={t("adminOrganizations.primaryShort")}
            bg={primary}
            src={draft.logo_h_dark ?? draft.logo_v_dark}
            variant="horizontal"
          />
          <PreviewTile
            label={t("adminOrganizations.accentShort")}
            bg={accent}
            src={draft.logo_h_dark ?? draft.logo_v_dark}
            variant="horizontal"
          />
          <PreviewTile
            label={t("adminOrganizations.whiteVertical")}
            bg="#ffffff"
            src={draft.logo_v_light ?? draft.logo_h_light}
            variant="vertical"
          />
          <PreviewTile
            label={t("adminOrganizations.darkVertical")}
            bg="#0F172A"
            src={draft.logo_v_dark ?? draft.logo_h_dark}
            variant="vertical"
          />
          <PreviewTile
            label={t("adminOrganizations.brandGradient")}
            bg={`linear-gradient(135deg, ${primary}, ${accent})`}
            src={draft.logo_h_dark ?? draft.logo_v_dark}
            variant="horizontal"
          />
          <PreviewTile
            label={t("adminOrganizations.greySurface")}
            bg="#F1F5F9"
            src={draft.logo_h_light ?? draft.logo_v_light}
            variant="horizontal"
          />
        </div>
      </Card>

      <Card title={t("adminOrganizations.favicon")}>
        <div className="max-w-sm">
          <ImageSlot
            label={t("adminOrganizations.squareIcon32512px")}
            value={draft.logo_favicon ?? ""}
            onChange={(v) => onChange("logo_favicon", v || null)}
            folder="orgs"
            hint={t("adminOrganizations.usedEmailsExports")}
          />
        </div>
      </Card>
    </div>
  );
}

function LogoSlot({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-3">
      <div className="mb-2">
        <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </Label>
        <p className="text-[10px] text-muted-foreground/70">{desc}</p>
      </div>
      <ImageSlot label="" value={value} onChange={onChange} folder="orgs" />
    </div>
  );
}

function PreviewTile({
  label,
  bg,
  src,
  variant,
}: {
  label: string;
  bg: string;
  src: string | null;
  variant: "horizontal" | "vertical";
}) {
  return (
    <div className="space-y-1">
      <div
        className="flex items-center justify-center rounded-md border border-black/10 shadow-inner"
        style={{
          background: bg,
          minHeight: variant === "vertical" ? 140 : 90,
          padding: variant === "vertical" ? 16 : 12,
        }}
      >
        {src ? (
          <img
            src={src}
            alt=""
            className={variant === "vertical" ? "max-h-28 max-w-full" : "max-h-14 max-w-full"}
            style={{ objectFit: "contain" }}
          />
        ) : (
          <span className="text-[10px] text-muted-foreground/70">(brak / no logo)</span>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

// -------- Miejsca --------
function SeatsPane({
  orgId,
  seatsLimit,
  seatsSource,
  graceDays,
  reminderDays,
}: {
  orgId: string;
  seatsLimit: number;
  seatsSource: string;
  graceDays: number;
  reminderDays: number[];
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const seatsKey = billingKeys.admin.orgSeats(orgId);

  const seatsQ = useQuery({ queryKey: seatsKey, queryFn: () => fetchAdminOrgSeats(orgId) });
  const seats = useMemo(() => seatsQ.data ?? [], [seatsQ.data]);
  const used = seats.length;
  const atLimit = used >= seatsLimit;

  // Panel liczby miejsc: zmiana idzie przez funkcję serwerową (u operatora
  // najpierw, potem limit), a podgląd pokazuje, kto straci dostęp.
  const setSeats = useServerFn(setTeamSeatLimit);
  const [nextSeats, setNextSeats] = useState(seatsLimit);
  useEffect(() => setNextSeats(seatsLimit), [seatsLimit]);
  const atRisk = useMemo(
    () => seatsAtRisk(seats, nextSeats).map((s) => s.invited_email),
    [seats, nextSeats],
  );
  const summary = useMemo(() => summarizeSeats(seats, seatsLimit), [seats, seatsLimit]);

  const applySeats = useMutation({
    mutationFn: async () => {
      const res = await setSeats({ data: { org_id: orgId, seats: clampSeats(nextSeats) } });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      toast.success(
        t("adminOrganizations.seatLimitUpdated", {
          limit: res.seatsLimit,
          suspended: res.suspended,
        }),
      );
      void qc.invalidateQueries({ queryKey: seatsKey });
      void qc.invalidateQueries({ queryKey: billingKeys.admin.memberOrg(orgId) });
    },
    onError: (err: Error) =>
      toast.error(
        err.message.includes("provider")
          ? t("adminOrganizations.paymentProviderRejectedChange")
          : t("adminOrganizations.couldChangeSeatLimit"),
      ),
  });

  // Okres karencji: ile dni osoby ponad limit zachowują dostęp, zanim
  // faktycznie go stracą. 0 = odcięcie od razu przy zmianie limitu.
  const setGrace = useServerFn(setTeamSeatGraceDays);
  const runExpiry = useServerFn(runSeatGraceExpiry);
  const runReminders = useServerFn(runSeatGraceReminders);
  const [nextGrace, setNextGrace] = useState(graceDays);
  useEffect(() => setNextGrace(graceDays), [graceDays]);

  const applyGrace = useMutation({
    mutationFn: async () => {
      const res = await setGrace({ data: { org_id: orgId, days: clampGraceDays(nextGrace) } });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      toast.success(t("adminOrganizations.gracePeriodUpdated", { days: res.graceDays }));
      void qc.invalidateQueries({ queryKey: seatsKey });
      void qc.invalidateQueries({ queryKey: billingKeys.admin.memberOrg(orgId) });
    },
    onError: () => toast.error(t("adminOrganizations.couldChangeGracePeriod")),
  });

  const expireNow = useMutation({
    mutationFn: async () => {
      const res = await runExpiry();
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      toast.success(t("adminOrganizations.seatsExpired", { count: res.expired }));
      void qc.invalidateQueries({ queryKey: seatsKey });
    },
    onError: () => toast.error(t("adminOrganizations.couldCloseGracePeriods")),
  });

  // Progi przypomnień w trakcie karencji - konfigurowalne per organizacja
  // (np. 14/7/3/1). Pole tekstowe + szybkie przełączniki popularnych wartości.
  const setReminderDays = useServerFn(setTeamSeatGraceReminderDays);
  const [daysText, setDaysText] = useState(() => formatReminderDays(reminderDays));
  useEffect(() => setDaysText(formatReminderDays(reminderDays)), [reminderDays]);
  const parsedDays = useMemo(() => parseReminderDays(daysText), [daysText]);
  const daysDirty = !sameReminderDays(parsedDays, reminderDays);

  const applyReminderDays = useMutation({
    mutationFn: async () => {
      const res = await setReminderDays({ data: { org_id: orgId, days: parsedDays } });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      toast.success(
        res.days.length > 0
          ? t("adminOrganizations.remindersDays", { days: res.days.join(", ") })
          : t("adminOrganizations.remindersDisabled"),
      );
      void qc.invalidateQueries({ queryKey: billingKeys.admin.memberOrg(orgId) });
    },
    onError: () => toast.error(t("adminOrganizations.couldSaveReminderDays")),
  });

  const toggleDay = (day: number) => {
    const next = parsedDays.includes(day)
      ? parsedDays.filter((n) => n !== day)
      : normalizeReminderDays([...parsedDays, day]);
    setDaysText(formatReminderDays(next));
  };

  // Ręczny przebieg przypomnień - zaplecze robi to raz na dobę.

  const sendReminders = useMutation({
    mutationFn: async () => {
      const res = await runReminders({ data: {} });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => toast.success(t("adminOrganizations.remindersSent", { count: res.sent })),
    onError: () => toast.error(t("adminOrganizations.couldSendReminders")),
  });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "member">("member");

  const addSeat = useMutation({
    mutationFn: () => addOrgSeat(orgId, email.trim(), role),
    onSuccess: () => {
      toast.success(t("adminOrganizations.seatAdded"));
      setEmail("");
      void qc.invalidateQueries({ queryKey: seatsKey });
    },
    onError: (err: Error) => {
      const msg = err.message.toLowerCase();
      if (msg.includes("limit")) toast.error(t("adminOrganizations.seatLimitReached"));
      else if (msg.includes("exists")) toast.error(t("adminOrganizations.seatAlreadyExists"));
      else if (msg.includes("invalid email")) toast.error(t("adminOrganizations.invalidEmail"));
      else toast.error(t("adminOrganizations.couldAddSeat"));
    },
  });

  const removeSeat = useMutation({
    mutationFn: (seatId: string) => removeOrgSeat(seatId),
    onSuccess: () => {
      toast.success(t("adminOrganizations.seatRemoved"));
      void qc.invalidateQueries({ queryKey: seatsKey });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card
      title={
        <span className="flex items-center justify-between">
          <span>{t("adminOrganizations.seats")}</span>
          <span
            className={`text-[10px] tabular-nums ${atLimit ? "font-semibold text-destructive" : "text-muted-foreground"}`}
          >
            {summary.active}/{seatsLimit}
            {summary.suspended > 0 ? ` (+${summary.suspended})` : ""}
          </span>
        </span>
      }
    >
      {/* Liczba opłaconych miejsc planu Zespół */}
      <div className="mb-3 space-y-2 rounded-md border border-border/60 bg-muted/20 p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            type="number"
            min={1}
            max={500}
            value={nextSeats}
            onChange={(e) => setNextSeats(clampSeats(Number(e.target.value)))}
            className="h-8 w-24 text-sm"
            aria-label={t("adminOrganizations.seatCount")}
          />
          <Button
            size="sm"
            className="h-8"
            disabled={applySeats.isPending || clampSeats(nextSeats) === seatsLimit}
            onClick={() => applySeats.mutate()}
          >
            {applySeats.isPending
              ? t("adminOrganizations.saving")
              : t("adminOrganizations.applySeatCount")}
          </Button>
          <Badge variant="outline" className="text-[10px]">
            {seatsSource === "subscription"
              ? t("adminOrganizations.subscription")
              : t("adminOrganizations.manual")}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {seatsSource === "subscription"
            ? t("adminOrganizations.changeUpdatesPaidSubscriptionIncreases")
            : t("adminOrganizations.seatsAboveLimitStayOrganisation")}
        </p>
        {atRisk.length > 0 ? (
          <p className="text-[10px] font-medium text-destructive">
            {clampGraceDays(graceDays) > 0
              ? t("adminOrganizations.willEnterGrace", { days: clampGraceDays(graceDays) })
              : t("adminOrganizations.loseAccessImmediately")}{" "}
            {atRisk.join(", ")}
          </p>
        ) : null}
      </div>

      {/* Okres karencji po zmniejszeniu liczby miejsc */}
      <div className="mb-3 space-y-2 rounded-md border border-border/60 bg-muted/20 p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            type="number"
            min={MIN_GRACE_DAYS}
            max={MAX_GRACE_DAYS}
            value={nextGrace}
            onChange={(e) => setNextGrace(clampGraceDays(Number(e.target.value)))}
            className="h-8 w-24 text-sm"
            aria-label={t("adminOrganizations.gracePeriodDays")}
          />
          <Button
            size="sm"
            variant="secondary"
            className="h-8"
            disabled={
              applyGrace.isPending || clampGraceDays(nextGrace) === clampGraceDays(graceDays)
            }
            onClick={() => applyGrace.mutate()}
          >
            {applyGrace.isPending
              ? t("adminOrganizations.saving")
              : t("adminOrganizations.applyGracePeriod")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            disabled={expireNow.isPending}
            onClick={() => expireNow.mutate()}
          >
            {t("adminOrganizations.closeOverdue")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            disabled={sendReminders.isPending}
            onClick={() => sendReminders.mutate()}
          >
            {t("adminOrganizations.sendReminders")}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {t("adminOrganizations.afterSeatReductionPeopleAbove")}
        </p>
      </div>

      {/* Progi przypomnień w trakcie karencji (np. 14/7/3/1) */}
      <div className="mb-3 space-y-2 rounded-md border border-border/60 bg-muted/20 p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {[30, 14, 7, 3, 1].map((day) => {
            const on = parsedDays.includes(day);
            return (
              <Button
                key={day}
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                className="h-7 px-2 text-[11px] tabular-nums"
                aria-pressed={on}
                onClick={() => toggleDay(day)}
              >
                {t("adminOrganizations.dayCount", { count: day })}
              </Button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            value={daysText}
            onChange={(e) => setDaysText(e.target.value)}
            placeholder="14, 7, 3, 1"
            className="h-8 w-40 text-sm tabular-nums"
            aria-label={t("adminOrganizations.reminderDays")}
          />
          <Button
            size="sm"
            variant="secondary"
            className="h-8"
            disabled={applyReminderDays.isPending || !daysDirty}
            onClick={() => applyReminderDays.mutate()}
          >
            {applyReminderDays.isPending
              ? t("adminOrganizations.saving")
              : t("adminOrganizations.saveReminders")}
          </Button>
          <Badge variant="outline" className="text-[10px] tabular-nums">
            {parsedDays.length > 0
              ? t("adminOrganizations.reminderSlots", {
                  used: parsedDays.length,
                  max: MAX_REMINDER_SLOTS,
                })
              : t("adminOrganizations.disabled")}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {t("adminOrganizations.howManyDaysBeforeAccess")}
        </p>
      </div>

      {seatsQ.isLoading ? (
        <p className="text-xs text-muted-foreground">{t("adminOrganizations.loading")}</p>
      ) : seats.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("adminOrganizations.seatsYetAddFirstAccount")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {seats.map((seat) => (
            <li
              key={seat.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-xs font-medium">{seat.invited_email}</span>
                <span className="flex items-center gap-1">
                  <Badge
                    variant={seat.role === "owner" ? "default" : "secondary"}
                    className="text-[10px]"
                  >
                    {seat.role === "owner"
                      ? t("adminOrganizations.owner")
                      : t("adminOrganizations.member")}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {seat.claimed_at
                      ? t("adminOrganizations.activeSeats")
                      : t("adminOrganizations.invited")}
                  </Badge>
                  {seat.status === "grace" ? (
                    <Badge className="bg-[#FA9346] text-[10px] text-white hover:bg-[#FA9346]">
                      {seat.grace_until
                        ? t("adminOrganizations.graceUntil", {
                            date: new Date(seat.grace_until).toLocaleDateString(
                              uiLocale(i18n.language),
                            ),
                          })
                        : t("adminOrganizations.grace")}
                    </Badge>
                  ) : seat.status === "suspended" ? (
                    <Badge variant="destructive" className="text-[10px]">
                      {t("adminOrganizations.access")}
                    </Badge>
                  ) : null}
                </span>
              </div>
              {seat.role !== "owner" ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={t("adminOrganizations.removeSeat")}
                  disabled={removeSeat.isPending}
                  onClick={() => removeSeat.mutate(seat.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
        <div className="relative min-w-0 flex-1">
          <Mail
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("adminOrganizations.accountEmail")}
            className="h-8 pl-8 text-sm"
          />
        </div>
        <Select value={role} onValueChange={(v) => setRole(v as "owner" | "member")}>
          <SelectTrigger className="h-8 w-28 shrink-0 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">{t("adminOrganizations.member")}</SelectItem>
            <SelectItem value="owner">{t("adminOrganizations.owner")}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="h-8 shrink-0"
          disabled={!email.trim() || addSeat.isPending || atLimit}
          onClick={() => addSeat.mutate()}
        >
          {t("adminOrganizations.addSeat")}
        </Button>
      </div>
    </Card>
  );
}

// -------- Prezentacja --------
function Card({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border/60 bg-card/40 p-4">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
