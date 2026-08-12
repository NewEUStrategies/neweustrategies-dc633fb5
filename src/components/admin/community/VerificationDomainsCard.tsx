// Panel katalogu zaufanych domen + ręczne uruchomienie przeglądu weryfikacji.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, ShieldCheck, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmDialog } from "@/lib/appDialogs";
import { ensureI18n as ensureAdminCommunityI18n } from "@/lib/i18n-admin-community";
import { ProfileBadge } from "@/components/atoms/ProfileBadge";
import { FormSelect } from "@/components/atoms/FormSelect";
import { fetchMembershipTiers, tierName } from "@/lib/billing/tiers";
import type { BadgeLocale } from "@/lib/profile/badgeCatalog";
import {
  deleteVerificationDomain,
  fetchVerificationDomains,
  isValidVerificationDomain,
  normalizeDomainInput,
  runOrgVerificationSweep,
  upsertVerificationDomain,
} from "@/lib/admin/verificationDomains";

interface Props {
  language: BadgeLocale;
  tenantId: string | null | undefined;
}

export function VerificationDomainsCard({ language, tenantId }: Props) {
  ensureAdminCommunityI18n();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [domain, setDomain] = useState("");
  const [note, setNote] = useState("");
  const [requireConfirmed, setRequireConfirmed] = useState(true);
  // Domyślnie VIP: zespół NES ma pełny dostęp do materiałów bez zakupu.
  const [tierKey, setTierKey] = useState("vip");

  const tiersQ = useQuery({
    queryKey: ["admin-membership-tiers", tenantId ?? "none"],
    queryFn: fetchMembershipTiers,
    enabled: !!tenantId,
    staleTime: 60_000,
  });
  const tierOptions = [
    { value: "none", label: t("adminCommunity.verificationDomains.noMembershipGrant") },
    ...(tiersQ.data ?? []).map((t) => ({ value: t.key, label: tierName(t, language) })),
  ];
  const tierLabel = (key: string | null): string | null => {
    if (!key) return null;
    const row = (tiersQ.data ?? []).find((t) => t.key === key);
    return row ? tierName(row, language) : key.toUpperCase();
  };

  const q = useQuery({
    queryKey: ["admin-verification-domains", tenantId ?? "none"],
    queryFn: fetchVerificationDomains,
    enabled: !!tenantId,
    staleTime: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-verification-domains"] });
    qc.invalidateQueries({ queryKey: ["admin-badges"] });
    qc.invalidateQueries({ queryKey: ["profile-badges"] });
  };

  const addM = useMutation({
    mutationFn: () =>
      upsertVerificationDomain({
        domain,
        badge: "verified",
        note: note || undefined,
        requireEmailConfirmed: requireConfirmed,
        grantsTierKey: tierKey === "none" ? null : tierKey,
      }),
    onSuccess: () => {
      setDomain("");
      setNote("");
      invalidate();
      toast.success(t("adminCommunity.verificationDomains.domainSaved"));
    },
    onError: () => toast.error(t("adminCommunity.verificationDomains.couldNotSaveDomain")),
  });

  const toggleM = useMutation({
    mutationFn: (input: {
      domain: string;
      active: boolean;
      requireEmailConfirmed: boolean;
      grantsTierKey: string | null;
    }) =>
      upsertVerificationDomain({
        domain: input.domain,
        badge: "verified",
        active: input.active,
        requireEmailConfirmed: input.requireEmailConfirmed,
        grantsTierKey: input.grantsTierKey,
      }),
    onSuccess: () => invalidate(),
    onError: () => toast.error(t("adminCommunity.verificationDomains.couldNotUpdateDomain")),
  });

  const deleteM = useMutation({
    mutationFn: deleteVerificationDomain,
    onSuccess: () => {
      invalidate();
      toast.success(t("adminCommunity.verificationDomains.domainRemoved"));
    },
    onError: () => toast.error(t("adminCommunity.verificationDomains.couldNotRemoveDomain")),
  });

  const sweepM = useMutation({
    mutationFn: runOrgVerificationSweep,
    onSuccess: (result) => {
      invalidate();
      toast.success(
        t("adminCommunity.verificationDomains.sweepDone", {
          checked: result.checked,
          granted: result.granted,
          revoked: result.revoked,
        }),
      );
    },
    onError: () => toast.error(t("adminCommunity.verificationDomains.reviewFailed")),
  });

  const normalized = normalizeDomainInput(domain);
  const canAdd = isValidVerificationDomain(normalized) && !addM.isPending;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {t("adminCommunity.verificationDomains.domainVerification")}
          </CardTitle>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("adminCommunity.verificationDomains.accountWithConfirmedAddress")}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => sweepM.mutate()}
          disabled={sweepM.isPending}
        >
          <RefreshCw
            className={`mr-1 h-4 w-4 ${sweepM.isPending ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {t("adminCommunity.verificationDomains.runReview")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={t("adminCommunity.verificationDomains.domainCom")}
            aria-label={t("adminCommunity.verificationDomains.emailDomain")}
          />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={t("adminCommunity.verificationDomains.noteOptional")}
            aria-label={t("adminCommunity.verificationDomains.domainNote")}
          />
          <FormSelect
            value={tierKey}
            onValueChange={setTierKey}
            options={tierOptions}
            aria-label={t("adminCommunity.verificationDomains.grantedMembershipPlan")}
          />
          <div className="flex items-center justify-between gap-3 rounded-[6px] border border-border px-3">
            <span className="text-xs text-muted-foreground">
              {t("adminCommunity.verificationDomains.requireEmailConfirmation")}
            </span>
            <Switch
              checked={requireConfirmed}
              onCheckedChange={setRequireConfirmed}
              aria-label={t("adminCommunity.verificationDomains.requireEmailConfirmation")}
            />
          </div>
        </div>
        <Button onClick={() => addM.mutate()} disabled={!canAdd}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {t("adminCommunity.verificationDomains.addDomain")}
        </Button>

        {(q.data ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t("adminCommunity.verificationDomains.noTrustedDomains")}
          </p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-[6px] border border-border">
            {(q.data ?? []).map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{row.domain}</span>
                    <ProfileBadge badge={row.badge} language={language} />
                    {row.grants_tier_key && (
                      <Badge variant="secondary">
                        {t("adminCommunity.verificationDomains.plan")}
                        {tierLabel(row.grants_tier_key)}
                      </Badge>
                    )}
                    {!row.require_email_confirmed && (
                      <Badge variant="outline">
                        {t("adminCommunity.verificationDomains.noEmailConfirmation")}
                      </Badge>
                    )}
                  </div>
                  {row.note && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">{row.note}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={row.active}
                    onCheckedChange={(active) =>
                      toggleM.mutate({
                        domain: row.domain,
                        active,
                        requireEmailConfirmed: row.require_email_confirmed,
                        grantsTierKey: row.grants_tier_key,
                      })
                    }
                    aria-label={t("adminCommunity.verificationDomains.domainActive", {
                      domain: row.domain,
                    })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("adminCommunity.verificationDomains.removeDomain")}
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: t("adminCommunity.verificationDomains.removeConfirmTitle"),
                        description: t("adminCommunity.verificationDomains.removeConfirmBody", {
                          domain: row.domain,
                        }),
                        confirmLabel: t("adminCommunity.verificationDomains.remove"),
                        destructive: true,
                      });
                      if (ok) deleteM.mutate(row.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
