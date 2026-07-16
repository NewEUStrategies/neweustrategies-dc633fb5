// Panel: pełna strona organizacji członkowskiej - premium edytor marki
// (kolory, logo poziome/pionowe w wariantach light/dark), dane, kontakt i
// zarządzanie miejscami. Wygląd zgodny z produkcyjnym layoutem admin (kompakt).
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
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
import { Button } from "@/components/ui/button";
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
const tr = (lang: Lang) => (pl: string, en: string) => (lang === "pl" ? pl : en);

const DEFAULT_PRIMARY = "#0F3460";
const DEFAULT_ACCENT = "#E94560";
const DEFAULT_INK = "#141414";

function AdminOrganizationDetailPage() {
  const { id } = Route.useParams();
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const L = tr(lang);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const orgQ = useQuery({
    queryKey: ["admin", "member-org", id] as const,
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
      const { id: _id, tenant_id: _t, created_at: _c, updated_at: _u, created_by: _b, ...patch } = draft;
      void _id;
      void _t;
      void _c;
      void _u;
      void _b;
      await updateOrganization(id, patch);
    },
    onSuccess: () => {
      toast.success(L("Zapisano", "Saved"));
      void qc.invalidateQueries({ queryKey: ["admin", "member-org", id] });
      void qc.invalidateQueries({ queryKey: ["admin", "member-orgs"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeOrg = useMutation({
    mutationFn: () => deleteOrganization(id),
    onSuccess: () => {
      toast.success(L("Usunięto organizację", "Organization deleted"));
      void qc.invalidateQueries({ queryKey: ["admin", "member-orgs"] });
      void navigate({ to: "/admin/organizations" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (orgQ.isLoading || !draft) {
    return <p className="p-5 text-sm text-muted-foreground">{L("Wczytywanie...", "Loading...")}</p>;
  }
  if (!orgQ.data) {
    return <p className="p-5 text-sm text-muted-foreground">{L("Nie znaleziono organizacji.", "Organization not found.")}</p>;
  }

  const patch = (mut: (d: OrganizationRow) => OrganizationRow) => setDraft((d) => (d ? mut({ ...d }) : d));
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
              {L("Wróć", "Back")}
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
              {draft.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="text-[10px]">{draft.tier_key}</Badge>
              <Badge variant="outline" className="text-[10px]">
                {isActive ? L("aktywna", "active") : L("wstrzymana", "suspended")}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {L("limit miejsc", "seat limit")}: {draft.seats_limit}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1">
            <Switch
              checked={isActive}
              onCheckedChange={(v) => patch((d) => ({ ...d, status: v ? "active" : "suspended" }))}
              aria-label={L("Status", "Status")}
            />
            <span className="text-[11px] text-muted-foreground">
              {isActive ? L("aktywna", "active") : L("wstrzymana", "suspended")}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={removeOrg.isPending}
            onClick={() => {
              if (
                confirm(
                  L(
                    `Usunąć organizację "${draft.name}"? Miejsca zostaną skasowane.`,
                    `Delete organization "${draft.name}"? Its seats will be removed.`,
                  ),
                )
              )
                removeOrg.mutate();
            }}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {L("Usuń", "Delete")}
          </Button>
          <Button size="sm" className="h-8" disabled={!isDirty || save.isPending} onClick={() => save.mutate()}>
            <Save className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {save.isPending ? L("Zapisywanie...", "Saving...") : L("Zapisz", "Save")}
          </Button>
        </div>
      </header>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="h-8">
          <TabsTrigger value="general" className="text-xs">
            <Settings2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {L("Ogólne", "General")}
          </TabsTrigger>
          <TabsTrigger value="branding" className="text-xs">
            <Palette className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {L("Marka", "Branding")}
          </TabsTrigger>
          <TabsTrigger value="logos" className="text-xs">
            <ImageIcon className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {L("Logo", "Logos")}
          </TabsTrigger>
          <TabsTrigger value="seats" className="text-xs">
            <Users className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {L("Miejsca", "Seats")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <GeneralPane
            lang={lang}
            draft={draft}
            patch={patch}
            tierOptions={tierOptions}
          />
        </TabsContent>

        <TabsContent value="branding" className="mt-4">
          <BrandingPane
            lang={lang}
            primary={primary}
            accent={accent}
            ink={ink}
            onChange={(k, v) => patch((d) => ({ ...d, [k]: v }))}
          />
        </TabsContent>

        <TabsContent value="logos" className="mt-4">
          <LogosPane
            lang={lang}
            draft={draft}
            primary={primary}
            accent={accent}
            onChange={(k, v) => patch((d) => ({ ...d, [k]: v }))}
          />
        </TabsContent>

        <TabsContent value="seats" className="mt-4">
          <SeatsPane lang={lang} orgId={id} seatsLimit={draft.seats_limit} />
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
  const L = tr(lang);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card title={L("Podstawowe", "Basics")}>
          <div className="grid gap-3">
            <Field label={L("Nazwa organizacji", "Name")}>
              <Input
                value={draft.name}
                onChange={(e) => patch((d) => ({ ...d, name: e.target.value }))}
                className="h-8 text-sm"
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={L("Slug (URL)", "Slug (URL)")}>
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
              <Field label={L("Sektor", "Sector")}>
                <Input
                  value={draft.sector ?? ""}
                  onChange={(e) => patch((d) => ({ ...d, sector: e.target.value || null }))}
                  className="h-8 text-sm"
                />
              </Field>
            </div>
            <Field label={L("Opis", "Description")}>
              <Textarea
                value={draft.description ?? ""}
                onChange={(e) => patch((d) => ({ ...d, description: e.target.value || null }))}
                className="min-h-20 text-sm"
              />
            </Field>
          </div>
        </Card>

        <Card title={L("Kontakt i adres", "Contact & location")}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={<><Mail className="mr-1 inline h-3 w-3" aria-hidden="true" />{L("E-mail", "Email")}</>}>
              <Input
                type="email"
                value={draft.contact_email ?? ""}
                onChange={(e) => patch((d) => ({ ...d, contact_email: e.target.value || null }))}
                className="h-8 text-sm"
              />
            </Field>
            <Field label={<><Globe className="mr-1 inline h-3 w-3" aria-hidden="true" />{L("Strona www", "Website")}</>}>
              <Input
                type="url"
                value={draft.website_url ?? ""}
                onChange={(e) => patch((d) => ({ ...d, website_url: e.target.value || null }))}
                className="h-8 text-sm"
              />
            </Field>
            <Field label={<><MapPin className="mr-1 inline h-3 w-3" aria-hidden="true" />{L("Miasto", "City")}</>}>
              <Input
                value={draft.city ?? ""}
                onChange={(e) => patch((d) => ({ ...d, city: e.target.value || null }))}
                className="h-8 text-sm"
              />
            </Field>
            <Field label={L("Kraj", "Country")}>
              <Input
                value={draft.country ?? ""}
                onChange={(e) => patch((d) => ({ ...d, country: e.target.value || null }))}
                className="h-8 text-sm"
              />
            </Field>
          </div>
        </Card>

        <Card title={L("Notatka wewnętrzna", "Internal note")}>
          <Textarea
            value={draft.note ?? ""}
            onChange={(e) => patch((d) => ({ ...d, note: e.target.value || null }))}
            className="min-h-16 text-sm"
          />
        </Card>
      </div>

      <aside className="space-y-4">
        <Card title={L("Członkostwo", "Membership")}>
          <div className="space-y-3">
            <Field label={L("Warstwa", "Tier")}>
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
            <Field label={L("Limit miejsc", "Seat limit")}>
              <Input
                type="number"
                min={1}
                max={500}
                value={draft.seats_limit}
                onChange={(e) =>
                  patch((d) => ({
                    ...d,
                    seats_limit: Math.max(1, Math.min(500, Number(e.target.value) || 1)),
                  }))
                }
                className="h-8 text-sm"
              />
            </Field>
          </div>
        </Card>
      </aside>
    </div>
  );
}

// -------- Marka (kolory) --------
function BrandingPane({
  lang,
  primary,
  accent,
  ink,
  onChange,
}: {
  lang: Lang;
  primary: string;
  accent: string;
  ink: string;
  onChange: (key: "brand_primary" | "brand_accent" | "brand_ink", v: string | null) => void;
}) {
  const L = tr(lang);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={L("Kolory marki", "Brand colors")}>
        <div className="grid gap-3">
          <ColorRow
            label={L("Primary (główny)", "Primary")}
            value={primary}
            onChange={(v) => onChange("brand_primary", v || null)}
            defaultValue={DEFAULT_PRIMARY}
          />
          <ColorRow
            label={L("Accent (akcent)", "Accent")}
            value={accent}
            onChange={(v) => onChange("brand_accent", v || null)}
            defaultValue={DEFAULT_ACCENT}
          />
          <ColorRow
            label={L("Ink (tekst)", "Ink (text)")}
            value={ink}
            onChange={(v) => onChange("brand_ink", v || null)}
            defaultValue={DEFAULT_INK}
          />
        </div>
      </Card>

      <Card title={L("Podgląd marki", "Brand preview")}>
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
                {L("Przycisk akcent", "Accent button")}
              </span>
              <span
                className="rounded-md border px-3 py-1 text-xs font-medium"
                style={{ borderColor: "#ffffff40" }}
              >
                {L("Kontur", "Outline")}
              </span>
            </div>
          </div>
          <div
            className="rounded-lg border p-5"
            style={{ background: "#fff", color: ink, borderColor: "#00000010" }}
          >
            <p className="text-[10px] uppercase tracking-widest opacity-60">Light surface</p>
            <p className="mt-1 text-lg font-semibold" style={{ color: primary }}>
              {L("Nagłówek marki", "Brand heading")}
            </p>
            <p className="text-xs" style={{ color: ink, opacity: 0.75 }}>
              {L("Treść w kolorze Ink na jasnym tle.", "Body copy in Ink on a light surface.")}
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
  lang,
  draft,
  primary,
  accent,
  onChange,
}: {
  lang: Lang;
  draft: OrganizationRow;
  primary: string;
  accent: string;
  onChange: (
    key:
      | "logo_h_light"
      | "logo_h_dark"
      | "logo_v_light"
      | "logo_v_dark"
      | "logo_favicon",
    v: string | null,
  ) => void;
}) {
  const L = tr(lang);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <LogoSlot
          label={L("Poziome - jasny motyw", "Horizontal - light theme")}
          desc={L("Na jasnym tle; zwykle ciemne logo.", "For light backgrounds; usually dark logo.")}
          value={draft.logo_h_light ?? ""}
          onChange={(v) => onChange("logo_h_light", v || null)}
        />
        <LogoSlot
          label={L("Poziome - ciemny motyw", "Horizontal - dark theme")}
          desc={L("Na ciemnym tle; zwykle jasne logo.", "For dark backgrounds; usually light logo.")}
          value={draft.logo_h_dark ?? ""}
          onChange={(v) => onChange("logo_h_dark", v || null)}
        />
        <LogoSlot
          label={L("Pionowe - jasny motyw", "Vertical - light theme")}
          desc={L("Kwadratowe / stackowane logo na jasnym tle.", "Square / stacked logo on light bg.")}
          value={draft.logo_v_light ?? ""}
          onChange={(v) => onChange("logo_v_light", v || null)}
        />
        <LogoSlot
          label={L("Pionowe - ciemny motyw", "Vertical - dark theme")}
          desc={L("Kwadratowe / stackowane logo na ciemnym tle.", "Square / stacked logo on dark bg.")}
          value={draft.logo_v_dark ?? ""}
          onChange={(v) => onChange("logo_v_dark", v || null)}
        />
      </div>

      <Card title={L("Podgląd na tłach", "Preview on backgrounds")}>
        <p className="mb-3 text-[11px] text-muted-foreground">
          {L(
            "Zobacz jak wygląda logo na białym, ciemnym oraz w kolorach marki - upewnij się, że wersje light/dark są dobrane poprawnie.",
            "See how the logo looks on white, dark and brand colors - ensure the light/dark versions are chosen correctly.",
          )}
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <PreviewTile
            label={L("Białe tło", "White")}
            bg="#ffffff"
            src={draft.logo_h_light ?? draft.logo_v_light}
            variant="horizontal"
          />
          <PreviewTile
            label={L("Ciemne tło", "Dark")}
            bg="#0F172A"
            src={draft.logo_h_dark ?? draft.logo_v_dark}
            variant="horizontal"
          />
          <PreviewTile
            label={L("Primary", "Primary")}
            bg={primary}
            src={draft.logo_h_dark ?? draft.logo_v_dark}
            variant="horizontal"
          />
          <PreviewTile
            label={L("Accent", "Accent")}
            bg={accent}
            src={draft.logo_h_dark ?? draft.logo_v_dark}
            variant="horizontal"
          />
          <PreviewTile
            label={L("Białe - pionowe", "White - vertical")}
            bg="#ffffff"
            src={draft.logo_v_light ?? draft.logo_h_light}
            variant="vertical"
          />
          <PreviewTile
            label={L("Ciemne - pionowe", "Dark - vertical")}
            bg="#0F172A"
            src={draft.logo_v_dark ?? draft.logo_h_dark}
            variant="vertical"
          />
          <PreviewTile
            label={L("Gradient marki", "Brand gradient")}
            bg={`linear-gradient(135deg, ${primary}, ${accent})`}
            src={draft.logo_h_dark ?? draft.logo_v_dark}
            variant="horizontal"
          />
          <PreviewTile
            label={L("Szara powierzchnia", "Grey surface")}
            bg="#F1F5F9"
            src={draft.logo_h_light ?? draft.logo_v_light}
            variant="horizontal"
          />
        </div>
      </Card>

      <Card title={L("Favicon", "Favicon")}>
        <div className="max-w-sm">
          <ImageSlot
            label={L("Kwadratowa ikona (32-512px)", "Square icon (32-512px)")}
            value={draft.logo_favicon ?? ""}
            onChange={(v) => onChange("logo_favicon", v || null)}
            folder="orgs"
            hint={L("Używane w emailach i eksporcie.", "Used in emails and exports.")}
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
          <span className="text-[10px] text-muted-foreground/70">
            (brak / no logo)
          </span>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

// -------- Miejsca --------
function SeatsPane({ lang, orgId, seatsLimit }: { lang: Lang; orgId: string; seatsLimit: number }) {
  const L = tr(lang);
  const qc = useQueryClient();
  const seatsKey = ["admin", "org-seats", orgId] as const;

  const seatsQ = useQuery({ queryKey: seatsKey, queryFn: () => fetchAdminOrgSeats(orgId) });
  const seats = seatsQ.data ?? [];
  const used = seats.length;
  const atLimit = used >= seatsLimit;

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "member">("member");

  const addSeat = useMutation({
    mutationFn: () => addOrgSeat(orgId, email.trim(), role),
    onSuccess: () => {
      toast.success(L("Dodano miejsce", "Seat added"));
      setEmail("");
      void qc.invalidateQueries({ queryKey: seatsKey });
    },
    onError: (err: Error) => {
      const msg = err.message.toLowerCase();
      if (msg.includes("limit")) toast.error(L("Osiągnięto limit miejsc", "Seat limit reached"));
      else if (msg.includes("exists")) toast.error(L("Miejsce już istnieje", "Seat already exists"));
      else if (msg.includes("invalid email")) toast.error(L("Nieprawidłowy e-mail", "Invalid email"));
      else toast.error(L("Nie udało się dodać miejsca", "Could not add seat"));
    },
  });

  const removeSeat = useMutation({
    mutationFn: (seatId: string) => removeOrgSeat(seatId),
    onSuccess: () => {
      toast.success(L("Usunięto miejsce", "Seat removed"));
      void qc.invalidateQueries({ queryKey: seatsKey });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card
      title={
        <span className="flex items-center justify-between">
          <span>{L("Miejsca", "Seats")}</span>
          <span className={`text-[10px] tabular-nums ${atLimit ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
            {used}/{seatsLimit}
          </span>
        </span>
      }
    >
      {seatsQ.isLoading ? (
        <p className="text-xs text-muted-foreground">{L("Wczytywanie...", "Loading...")}</p>
      ) : seats.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {L("Brak miejsc. Dodaj pierwsze konto.", "No seats yet. Add the first account.")}
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
                  <Badge variant={seat.role === "owner" ? "default" : "secondary"} className="text-[10px]">
                    {seat.role === "owner" ? L("właściciel", "owner") : L("członek", "member")}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {seat.claimed_at ? L("aktywne", "active") : L("zaproszony", "invited")}
                  </Badge>
                </span>
              </div>
              {seat.role !== "owner" ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={L("Usuń miejsce", "Remove seat")}
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
            placeholder={L("e-mail konta", "account email")}
            className="h-8 pl-8 text-sm"
          />
        </div>
        <Select value={role} onValueChange={(v) => setRole(v as "owner" | "member")}>
          <SelectTrigger className="h-8 w-28 shrink-0 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">{L("członek", "member")}</SelectItem>
            <SelectItem value="owner">{L("właściciel", "owner")}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="h-8 shrink-0"
          disabled={!email.trim() || addSeat.isPending || atLimit}
          onClick={() => addSeat.mutate()}
        >
          {L("Dodaj miejsce", "Add seat")}
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
