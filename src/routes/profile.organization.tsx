// Panel samoobsługi organizacji B2B (/profile/organization). Właściciel
// (rola 'owner' na miejscu) zaprasza własny zespół e-mailem, ponawia
// zaproszenia i zwalnia miejsca - bez udziału redakcji. Autorytet egzekwuje
// baza (org_add_seat / org_touch_seat_invite / RLS na organization_seats);
// zwykły członek widzi wariant informacyjny.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Mail, RefreshCw, Send, Trash2, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AuthGate } from "@/components/profile/AuthGate";
import { confirmDialog } from "@/lib/appDialogs";
import {
  useMyOrganization,
  useOrgSeats,
  useRemoveSeat,
  useClaimOrgSeats,
  type MyOrganization,
  type OrgSeatRow,
} from "@/lib/billing/membership";
import { useMembershipTiers, tierName } from "@/lib/billing/tiers";
import { inviteOrgSeat, resendOrgSeatInvite } from "@/lib/organizations/selfservice.functions";
import { ensureI18n as ensureProfileI18n } from "@/lib/i18n-profile";
import { ensureI18n as ensureMembershipI18n } from "@/lib/i18n-membership";

export const Route = createFileRoute("/profile/organization")({
  component: OrganizationPanel,
});

function OrganizationPanel() {
  ensureProfileI18n();
  ensureMembershipI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  // Idempotentny odbiór miejsc zaproszonych na e-mail konta.
  useClaimOrgSeats();
  const org = useMyOrganization();

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL") : "";

  return (
    <AuthGate>
      <div className="space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Building2 className="h-6 w-6" aria-hidden="true" />
            {t("membership.orgPanel.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("membership.orgPanel.subtitle")}</p>
        </div>

        {org.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("membership.loading")}</p>
        ) : org.data ? (
          <OrgOverview org={org.data} lang={lang} fmtDate={fmtDate} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("membership.orgPanel.noOrgTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("membership.orgPanel.noOrgBody")}</p>
              <Button asChild size="sm">
                <Link to="/pricing">{t("membership.orgPanel.contactCta")}</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AuthGate>
  );
}

function OrgOverview({
  org,
  lang,
  fmtDate,
}: {
  org: MyOrganization;
  lang: "pl" | "en";
  fmtDate: (iso: string | null) => string;
}) {
  const { t } = useTranslation();
  const tiers = useMembershipTiers();
  const tierRow = (tiers.data ?? []).find((x) => x.key === org.tier_key) ?? null;
  const isOwner = org.my_role === "owner";
  const usagePct =
    org.seats_limit > 0 ? Math.min(100, Math.round((org.seats_used / org.seats_limit) * 100)) : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              {org.name}
              <Badge variant={org.status === "active" ? "default" : "destructive"}>
                {org.status === "active"
                  ? t("membership.organization.statusActive")
                  : t("membership.organization.statusSuspended")}
              </Badge>
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {isOwner
                ? t("membership.organization.roleOwner")
                : t("membership.organization.roleMember")}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {tierRow && (
            <p className="text-sm text-muted-foreground">
              {t("membership.orgPanel.benefitsNote", { tier: tierName(tierRow, lang) })}
            </p>
          )}
          <div>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium">{t("membership.orgPanel.seatsUsed")}</span>
              <span className="tabular-nums text-muted-foreground">
                {t("membership.organization.seatsUsage", {
                  used: org.seats_used,
                  limit: org.seats_limit,
                })}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${usagePct}%` }}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {org.expires_at
              ? t("membership.orgPanel.expiresAt", { date: fmtDate(org.expires_at) })
              : t("membership.orgPanel.noExpiry")}
          </p>
          {org.status !== "active" && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {t("membership.orgPanel.suspendedNote")}
            </p>
          )}
        </CardContent>
      </Card>

      {isOwner ? (
        <SeatAdministration org={org} lang={lang} fmtDate={fmtDate} />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {t("membership.orgPanel.memberViewNote")}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SeatAdministration({
  org,
  lang,
  fmtDate,
}: {
  org: MyOrganization;
  lang: "pl" | "en";
  fmtDate: (iso: string | null) => string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const seats = useOrgSeats(org.org_id);
  const removeSeat = useRemoveSeat(org.org_id);
  const invite = useServerFn(inviteOrgSeat);
  const resend = useServerFn(resendOrgSeatInvite);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const seatsLeft = Math.max(0, org.seats_limit - (seats.data?.length ?? org.seats_used));

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["org-seats", org.org_id] });
    void qc.invalidateQueries({ queryKey: ["my-organization"] });
  };

  const onInvite = async () => {
    const value = email.trim().toLowerCase();
    if (!value || inviting) return;
    setInviting(true);
    try {
      const res = await invite({ data: { org_id: org.org_id, email: value, lang } });
      if (!res.ok) {
        const msg = res.error ?? "";
        if (msg.includes("limit")) toast.error(t("membership.organization.seatLimitReached"));
        else if (msg.includes("exists")) toast.error(t("membership.organization.seatExists"));
        else toast.error(t("membership.organization.inviteError"));
        return;
      }
      toast.success(
        res.emailSent
          ? t("membership.orgPanel.inviteSentEmail")
          : t("membership.orgPanel.inviteSentNoEmail"),
      );
      setEmail("");
      refresh();
    } catch {
      toast.error(t("membership.organization.inviteError"));
    } finally {
      setInviting(false);
    }
  };

  const onResend = async (seat: OrgSeatRow) => {
    if (resendingId) return;
    setResendingId(seat.id);
    try {
      const res = await resend({ data: { seat_id: seat.id, lang } });
      if (!res.ok) {
        toast.error(t("membership.orgPanel.resendError"));
        return;
      }
      toast.success(
        res.emailSent ? t("membership.orgPanel.resendOk") : t("membership.orgPanel.resendNoEmail"),
      );
      refresh();
    } catch {
      toast.error(t("membership.orgPanel.resendError"));
    } finally {
      setResendingId(null);
    }
  };

  const onRemove = async (seat: OrgSeatRow) => {
    const confirmed = await confirmDialog({
      title: t("membership.orgPanel.removeConfirmTitle", { email: seat.invited_email }),
      destructive: true,
      confirmLabel: t("membership.organization.remove"),
    });
    if (!confirmed) return;
    removeSeat.mutate(seat.id, {
      onSuccess: () => toast.success(t("membership.orgPanel.removeOk")),
      onError: () => toast.error(t("membership.orgPanel.removeError")),
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" aria-hidden="true" />
            {t("membership.orgPanel.inviteHeading")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onInvite();
                }
              }}
              placeholder={t("membership.orgPanel.invitePlaceholder")}
              className="sm:max-w-sm"
              disabled={org.status !== "active" || seatsLeft <= 0}
            />
            <Button
              onClick={() => void onInvite()}
              disabled={inviting || !email.trim() || org.status !== "active" || seatsLeft <= 0}
            >
              <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t("membership.orgPanel.inviteButton")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("membership.orgPanel.inviteHint")}</p>
          {seatsLeft <= 0 && (
            <p className="text-xs font-medium text-destructive">
              {t("membership.organization.seatLimitReached")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" aria-hidden="true" />
            {t("membership.orgPanel.membersHeading")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">{t("membership.orgPanel.colEmail")}</th>
                  <th className="p-2">{t("membership.orgPanel.colRole")}</th>
                  <th className="p-2">{t("membership.orgPanel.colStatus")}</th>
                  <th className="p-2">{t("membership.orgPanel.colJoined")}</th>
                  <th className="p-2 text-right">{t("membership.orgPanel.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {(seats.data ?? []).map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="max-w-[220px] truncate p-2 font-medium">{s.invited_email}</td>
                    <td className="p-2 text-muted-foreground">
                      {s.role === "owner"
                        ? t("membership.organization.roleOwner")
                        : t("membership.organization.roleMember")}
                    </td>
                    <td className="p-2">
                      <Badge
                        variant={s.claimed_at ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {s.claimed_at
                          ? t("membership.orgPanel.statusClaimed")
                          : t("membership.orgPanel.statusPending")}
                      </Badge>
                      {!s.claimed_at && s.last_invited_at && (
                        <span className="ml-2 text-[11px] text-muted-foreground">
                          {t("membership.orgPanel.lastInvited", {
                            date: fmtDate(s.last_invited_at),
                          })}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {s.claimed_at ? fmtDate(s.claimed_at) : "-"}
                    </td>
                    <td className="p-2">
                      <div className="flex items-center justify-end gap-1">
                        {!s.claimed_at && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => void onResend(s)}
                            disabled={resendingId === s.id || org.status !== "active"}
                            aria-label={t("membership.orgPanel.resend")}
                          >
                            <RefreshCw
                              className={
                                resendingId === s.id ? "mr-1 h-3 w-3 animate-spin" : "mr-1 h-3 w-3"
                              }
                              aria-hidden="true"
                            />
                            {t("membership.orgPanel.resend")}
                          </Button>
                        )}
                        {s.role !== "owner" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => void onRemove(s)}
                            disabled={removeSeat.isPending}
                            aria-label={t("membership.organization.remove")}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
