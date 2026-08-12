// /admin/community/badges - katalog odznak + ręczne przyznawanie/odbieranie.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureAdminCommunityI18n } from "@/lib/i18n-admin-community";
import { dateLocaleFromLanguage } from "@/lib/i18n/dateLocale";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Award, Trash2, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MemberPicker } from "@/components/admin/community/MemberPicker";
import { confirmDialog } from "@/lib/appDialogs";
import { fetchBadges, grantBadge, revokeBadge, type BadgeGrantSource } from "@/lib/admin/badges";
import {
  BADGE_DEFINITIONS,
  badgeLabel,
  badgeLocale,
  isProfileBadgeKind,
  type ProfileBadgeKind,
} from "@/lib/profile/badgeCatalog";
import { ProfileBadge } from "@/components/atoms/ProfileBadge";
import { VerificationDomainsCard } from "@/components/admin/community/VerificationDomainsCard";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/admin/community/badges")({
  head: () => ({ meta: [{ title: "Badges · Community · Admin" }] }),
  component: BadgesAdmin,
});

function BadgesAdmin() {
  ensureAdminCommunityI18n();
  const { t, i18n } = useTranslation();
  const language = badgeLocale(i18n.language ?? "pl");
  const { tenantId } = useAuth();
  const qc = useQueryClient();
  const [userId, setUserId] = useState("");
  const [badgeKey, setBadgeKey] = useState<ProfileBadgeKind>("verified");
  const [note, setNote] = useState("");

  const q = useQuery({
    queryKey: ["admin-badges", tenantId ?? "none"],
    queryFn: () => fetchBadges(),
    enabled: !!tenantId,
    staleTime: 30_000,
  });

  const duplicate = (q.data ?? []).some(
    (badge) => badge.user_id === userId && badge.badge === badgeKey,
  );

  const grantM = useMutation({
    mutationFn: () => grantBadge(userId.trim(), badgeKey, note.trim() || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-badges"] });
      qc.invalidateQueries({ queryKey: ["profile-badges"] });
      setUserId("");
      setNote("");
      toast.success(t("adminCommunity.badges.granted"));
    },
    onError: (err: Error) => toast.error(err.message || t("adminCommunity.badges.failed")),
  });

  const revokeM = useMutation({
    mutationFn: revokeBadge,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-badges"] });
      qc.invalidateQueries({ queryKey: ["profile-badges"] });
      toast.success(t("adminCommunity.badges.revoked"));
    },
    onError: () => toast.error(t("adminCommunity.badges.failed")),
  });

  // Mapa WSKAZUJE KLUCZE, nie napisy: dotad trzymala pary `{ pl, en }` wprost
  // w komponencie, czyli kolejny rownolegly slownik poza zasiegiem bramki
  // parytetu. `Record<BadgeGrantSource, string>` nadal wymusza kompletnosc
  // wariantow enuma, a test slownika sprawdza, ze wskazany klucz istnieje.
  const SOURCE_LABEL_KEYS: Record<BadgeGrantSource, string> = {
    manual: "adminCommunity.badges.sourceManual",
    reputation: "adminCommunity.badges.sourceReputation",
    contributor_submission: "adminCommunity.badges.sourceContributorSubmission",
    system: "adminCommunity.badges.sourceSystem",
  };
  const sourceLabel = (source: BadgeGrantSource): string => t(SOURCE_LABEL_KEYS[source]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Award className="w-4 h-4" />
        <h2 className="text-lg font-semibold">{t("adminCommunity.badges.badges")}</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("adminCommunity.badges.grantBadge")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {BADGE_DEFINITIONS.map((definition) => (
              <button
                key={definition.key}
                type="button"
                onClick={() => setBadgeKey(definition.key)}
                aria-pressed={badgeKey === definition.key}
                className={`rounded-[6px] border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  badgeKey === definition.key
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <ProfileBadge badge={definition.key} language={language} size="md" />
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {definition.description[language]}
                </p>
                {definition.grantMode === "hybrid" && (
                  <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary">
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    {t("adminCommunity.badges.manualAutomatic")}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <MemberPicker
              value={userId}
              onChange={setUserId}
              labels={{
                placeholder: t("adminCommunity.badges.selectMember"),
                search: t("adminCommunity.badges.searchByName"),
                hint: t("adminCommunity.badges.typeAtLeast2"),
                loading: t("adminCommunity.badges.searching"),
                empty: t("adminCommunity.badges.noResults"),
                clear: t("adminCommunity.badges.clearSelection"),
              }}
            />
            <Select
              value={badgeKey}
              onValueChange={(value) => {
                if (isProfileBadgeKind(value)) setBadgeKey(value);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BADGE_DEFINITIONS.map((definition) => (
                  <SelectItem key={definition.key} value={definition.key}>
                    {definition.label[language]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder={t("adminCommunity.badges.noteOptional")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              aria-label={t("adminCommunity.badges.badgeNote")}
            />
          </div>
          {duplicate && (
            <p className="text-xs text-amber-700 dark:text-amber-400" role="status">
              {t("adminCommunity.badges.selectedMemberAlreadyHas")}
            </p>
          )}
          <Button
            onClick={() => grantM.mutate()}
            disabled={!userId.trim() || duplicate || grantM.isPending}
          >
            <Plus className="w-4 h-4 mr-1" />
            {t("adminCommunity.badges.grant")}
          </Button>
        </CardContent>
      </Card>

      <VerificationDomainsCard language={language} tenantId={tenantId} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("adminCommunity.badges.recentlyGranted")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(q.data ?? []).length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              {t("adminCommunity.badges.noBadges")}
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {(q.data ?? []).map((b) => (
                <li key={b.id} className="p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <ProfileBadge badge={b.badge} language={language} />
                      <Badge variant="outline">{sourceLabel(b.grant_source)}</Badge>
                    </div>
                    <div className="mt-1 truncate text-sm font-medium">
                      {b.member_display_name || b.member_email || b.user_id}
                    </div>
                    {b.member_email && b.member_display_name && (
                      <div className="truncate text-xs text-muted-foreground">{b.member_email}</div>
                    )}
                    {b.note && <div className="text-xs text-muted-foreground mt-1">{b.note}</div>}
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {new Date(b.created_at).toLocaleString(dateLocaleFromLanguage(i18n.language))}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("adminCommunity.badges.revokeBadge")}
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: t("adminCommunity.badges.revokeConfirmTitle"),
                        description: t("adminCommunity.badges.revokeConfirmBody", {
                          badge: badgeLabel(b.badge, language),
                        }),
                        confirmLabel: t("adminCommunity.badges.revoke"),
                        destructive: true,
                      });
                      if (ok) revokeM.mutate(b.id);
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
