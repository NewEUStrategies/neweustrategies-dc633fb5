// /admin/community/badges - katalog odznak + ręczne przyznawanie/odbieranie.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { i18n } = useTranslation();
  const language = badgeLocale(i18n.language ?? "pl");
  const isPl = language === "pl";
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
      toast.success(isPl ? "Przyznano" : "Granted");
    },
    onError: (err: Error) => toast.error(err.message || (isPl ? "Błąd" : "Failed")),
  });

  const revokeM = useMutation({
    mutationFn: revokeBadge,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-badges"] });
      qc.invalidateQueries({ queryKey: ["profile-badges"] });
      toast.success(isPl ? "Odebrano" : "Revoked");
    },
    onError: () => toast.error(isPl ? "Błąd" : "Failed"),
  });

  const sourceLabel = (source: BadgeGrantSource): string => {
    const labels: Record<BadgeGrantSource, { pl: string; en: string }> = {
      manual: { pl: "Ręcznie", en: "Manual" },
      reputation: { pl: "Reputacja", en: "Reputation" },
      contributor_submission: { pl: "Przyjęty materiał", en: "Accepted submission" },
      system: { pl: "System", en: "System" },
    };
    return labels[source][language];
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Award className="w-4 h-4" />
        <h2 className="text-lg font-semibold">{isPl ? "Odznaki" : "Badges"}</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isPl ? "Przyznaj odznakę" : "Grant badge"}</CardTitle>
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
                    {isPl ? "Ręcznie lub automatycznie" : "Manual or automatic"}
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
                placeholder: isPl ? "Wybierz członka…" : "Select a member…",
                search: isPl ? "Szukaj po nazwisku…" : "Search by name…",
                hint: isPl ? "Wpisz min. 2 znaki" : "Type at least 2 characters",
                loading: isPl ? "Szukam…" : "Searching…",
                empty: isPl ? "Brak wyników" : "No results",
                clear: isPl ? "Wyczyść wybór" : "Clear selection",
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
              placeholder={isPl ? "Notatka (opcjonalnie)" : "Note (optional)"}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              aria-label={isPl ? "Notatka do odznaki" : "Badge note"}
            />
          </div>
          {duplicate && (
            <p className="text-xs text-amber-700 dark:text-amber-400" role="status">
              {isPl
                ? "Wybrany użytkownik ma już tę odznakę."
                : "The selected member already has this badge."}
            </p>
          )}
          <Button
            onClick={() => grantM.mutate()}
            disabled={!userId.trim() || duplicate || grantM.isPending}
          >
            <Plus className="w-4 h-4 mr-1" />
            {isPl ? "Przyznaj" : "Grant"}
          </Button>
        </CardContent>
      </Card>

      <VerificationDomainsCard language={language} tenantId={tenantId} />



      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isPl ? "Ostatnio przyznane" : "Recently granted"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(q.data ?? []).length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              {isPl ? "Brak odznak" : "No badges"}
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
                      {new Date(b.created_at).toLocaleString(isPl ? "pl-PL" : "en-GB")}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={isPl ? "Odbierz odznakę" : "Revoke badge"}
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: isPl ? "Odebrać odznakę?" : "Revoke badge?",
                        description: isPl
                          ? `${badgeLabel(b.badge, language)} - tej operacji nie można cofnąć.`
                          : `${badgeLabel(b.badge, language)} - this cannot be undone.`,
                        confirmLabel: isPl ? "Odbierz" : "Revoke",
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
