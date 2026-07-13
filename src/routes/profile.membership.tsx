// Hub członkostwa (/profile/membership). Pokazuje członkostwo jako PAKIET PRAW,
// nie badge: aktualny poziom + benefity, skąd wynika (subskrypcja / nadanie /
// organizacja), status wspierającego, zarządzanie miejscami organizacji oraz
// historię uczestnictwa (wydarzenia, pobrania z biblioteki).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Crown,
  Check,
  Building2,
  HandHeart,
  CalendarCheck,
  Download,
  Users,
  Trash2,
  Plus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  useCurrentTier,
  useMembershipTiers,
  parseTierBenefits,
  tierName,
} from "@/lib/billing/tiers";
import {
  useMyGrants,
  useMyDonations,
  useMyOrganization,
  useOrgSeats,
  useAddSeat,
  useRemoveSeat,
  useMyEventParticipation,
  useMyResourceDownloads,
  useClaimOrgSeats,
  type MyOrganization,
} from "@/lib/billing/membership";
import { formatMoney } from "@/lib/billing/types";
import "@/lib/i18n-profile";
import "@/lib/i18n-membership";

export const Route = createFileRoute("/profile/membership")({
  component: MembershipHub,
});

function MembershipHub() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  // Odbiór zaproszonych miejsc organizacji po wejściu (idempotentnie).
  useClaimOrgSeats();

  const currentTier = useCurrentTier();
  const tiers = useMembershipTiers();
  const grants = useMyGrants();
  const org = useMyOrganization();

  const tier = currentTier.data;
  const fullTier = (tiers.data ?? []).find((x) => x.key === tier?.key) ?? null;
  const benefits = fullTier ? parseTierBenefits(fullTier.benefits) : [];

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL") : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Crown className="h-6 w-6" aria-hidden="true" />
          {t("membership.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("membership.subtitle")}</p>
      </div>

      {/* Aktualny poziom + benefity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              {t("membership.currentLevel")}
              {tier && <Badge className="text-sm">{tierName(tier, lang)}</Badge>}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {t("membership.rank")}: {tier?.rank ?? 0}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {benefits.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("membership.benefitsHeading")}
              </p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {benefits.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>{lang === "en" ? b.en : b.pl}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/profile/subscription">{t("membership.manageSubscription")}</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/pricing">{t("membership.seePlans")}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Źródła poziomu (nadania) */}
      {(grants.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("membership.sources.heading")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {grants.data!.map((g) => (
                <li
                  key={g.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
                >
                  <span className="font-medium">
                    {t(`membership.sources.grant_${g.source}`, {
                      defaultValue: t("membership.sources.grant_manual"),
                    })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {g.expires_at
                      ? t("membership.sources.expires", { date: fmtDate(g.expires_at) })
                      : t("membership.sources.noExpiry")}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Wsparcie / darowizny */}
      <SupportSection fmtDate={fmtDate} />

      {/* Organizacja członkowska */}
      <OrganizationSection org={org.data ?? null} fmtDate={fmtDate} />

      {/* Historia uczestnictwa */}
      <ParticipationSection lang={lang} />
      <DownloadsSection lang={lang} />
    </div>
  );
}

function SupportSection({ fmtDate }: { fmtDate: (iso: string | null) => string }) {
  const { t, i18n } = useTranslation();
  const donations = useMyDonations();
  const rows = donations.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HandHeart className="h-4 w-4" aria-hidden="true" />
          {t("membership.support.heading")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{t("membership.support.none")}</p>
            <Button asChild size="sm" variant="outline">
              <Link to="/support" search={{ status: undefined }}>
                {t("membership.support.cta")}
              </Link>
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
              >
                <span className="font-medium tabular-nums">
                  {formatMoney(d.amount_cents, d.currency, i18n.language)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {fmtDate(d.created_at)}
                  {d.status === "refunded" ? ` · ${t("membership.support.refunded")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function OrganizationSection({
  org,
  fmtDate,
}: {
  org: MyOrganization | null;
  fmtDate: (iso: string | null) => string;
}) {
  const { t } = useTranslation();

  if (!org) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" aria-hidden="true" />
            {t("membership.organization.heading")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("membership.organization.none")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4" aria-hidden="true" />
          {org.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-xs uppercase text-muted-foreground">
              {t("membership.organization.role")}
            </div>
            <div className="text-sm font-medium">
              {org.my_role === "owner"
                ? t("membership.organization.roleOwner")
                : t("membership.organization.roleMember")}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">
              {t("membership.organization.seats")}
            </div>
            <div className="text-sm font-medium tabular-nums">
              {t("membership.organization.seatsUsage", {
                used: org.seats_used,
                limit: org.seats_limit,
              })}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">
              {t("membership.organization.status")}
            </div>
            <div className="text-sm font-medium">
              {org.status === "active"
                ? t("membership.organization.statusActive")
                : t("membership.organization.statusSuspended")}
            </div>
          </div>
        </div>
        {org.expires_at && (
          <p className="text-xs text-muted-foreground">
            {t("membership.sources.expires", { date: fmtDate(org.expires_at) })}
          </p>
        )}
        {org.my_role === "owner" && <SeatManager orgId={org.org_id} />}
      </CardContent>
    </Card>
  );
}

function SeatManager({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const seats = useOrgSeats(orgId);
  const addSeat = useAddSeat(orgId);
  const removeSeat = useRemoveSeat(orgId);
  const [email, setEmail] = useState("");

  const onAdd = () => {
    const value = email.trim().toLowerCase();
    if (!value) return;
    addSeat.mutate(value, {
      onSuccess: () => {
        toast.success(t("membership.organization.inviteSuccess"));
        setEmail("");
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("limit")) toast.error(t("membership.organization.seatLimitReached"));
        else if (msg.includes("exists")) toast.error(t("membership.organization.seatExists"));
        else toast.error(t("membership.organization.inviteError"));
      },
    });
  };

  return (
    <div className="rounded-md border border-border/60 p-3">
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        {t("membership.organization.seatsHeading")}
      </p>
      <ul className="mb-3 space-y-1.5">
        {(seats.data ?? []).map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{s.invited_email}</span>
            <span className="flex shrink-0 items-center gap-2">
              <Badge variant={s.claimed_at ? "default" : "secondary"} className="text-[10px]">
                {s.claimed_at
                  ? t("membership.organization.claimed")
                  : t("membership.organization.pending")}
              </Badge>
              {s.role !== "owner" && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => removeSeat.mutate(s.id)}
                  disabled={removeSeat.isPending}
                  aria-label={t("membership.organization.remove")}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("membership.organization.invitePlaceholder")}
          className="h-8"
        />
        <Button size="sm" onClick={onAdd} disabled={addSeat.isPending || !email.trim()}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {t("membership.organization.invite")}
        </Button>
      </div>
    </div>
  );
}

function ParticipationSection({ lang }: { lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const participation = useMyEventParticipation();
  const rows = participation.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarCheck className="h-4 w-4" aria-hidden="true" />
          {t("membership.events.heading")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("membership.events.none")}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((e) => {
              const title = lang === "en" ? e.title_en || e.title_pl : e.title_pl || e.title_en;
              const past = new Date(e.starts_at).getTime() < Date.now();
              const statusKey =
                e.rsvp_status === "going"
                  ? "membership.events.statusGoing"
                  : e.rsvp_status === "interested"
                    ? "membership.events.statusInterested"
                    : "membership.events.statusCancelled";
              return (
                <li
                  key={e.event_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
                >
                  <Link
                    to="/events/$slug"
                    params={{ slug: e.slug }}
                    className="min-w-0 truncate font-medium hover:text-primary"
                  >
                    {title}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="text-[10px]">
                      {t(statusKey)}
                    </Badge>
                    {past ? t("membership.events.past") : t("membership.events.upcoming")}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DownloadsSection({ lang }: { lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const downloads = useMyResourceDownloads();
  const rows = downloads.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Download className="h-4 w-4" aria-hidden="true" />
          {t("membership.downloads.heading")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{t("membership.downloads.none")}</p>
            <Button asChild size="sm" variant="outline">
              <Link to="/library">{t("membership.downloads.openLibrary")}</Link>
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((d) => {
              const title = lang === "en" ? d.title_en || d.title_pl : d.title_pl || d.title_en;
              return (
                <li
                  key={d.resource_id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">{title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(d.downloaded_at).toLocaleDateString(
                      lang === "en" ? "en-GB" : "pl-PL",
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
