// /admin/community — dashboard z metrykami community + globalne toggles modułów.
// Toggle zapisywane w site_settings.community_modules; wartości są konsumowane
// przez runtime (useCommunityModules) i sterują dostępnością chat / events /
// Q&A / polls z poziomu UI produktu.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureAdminCommunityI18n } from "@/lib/i18n-admin-community";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  Calendar,
  Flag,
  HelpCircle,
  MessageCircle,
  Timer,
  RefreshCcw,
  Users,
  UsersRound,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminBiStrip } from "@/components/admin/analytics/AdminBiStrip";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchCommunityModules,
  fetchCommunityStats,
  purgeExpiredMessages,
  runEventReminders,
  updateCommunityModules,
  type CommunityModulesSettings,
} from "@/lib/admin/community";
import { fetchNetworkStats, fetchUserReports, resolveUserReport } from "@/lib/admin/network";

export const Route = createFileRoute("/admin/community/")({
  head: () => ({ meta: [{ title: "Community · Admin" }] }),
  component: CommunityOverview,
});

// Opcje TTL WSKAZUJA KLUCZE, nie napisy: para `labelPl`/`labelEn` w tablicy
// byla kolejnym rownoleglym slownikiem poza zasiegiem bramki parytetu.
const TTL_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "off", labelKey: "adminCommunity.overview.ttlOff" },
  { value: "86400", labelKey: "adminCommunity.overview.ttl24h" },
  { value: "604800", labelKey: "adminCommunity.overview.ttl7d" },
  { value: "7776000", labelKey: "adminCommunity.overview.ttl90d" },
];

function CommunityOverview() {
  ensureAdminCommunityI18n();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const statsQ = useQuery({
    queryKey: ["admin-community-stats"],
    queryFn: fetchCommunityStats,
    staleTime: 15_000,
  });
  const modulesQ = useQuery({
    queryKey: ["admin-community-modules"],
    queryFn: fetchCommunityModules,
    staleTime: 30_000,
  });

  const modules = modulesQ.data;

  const saveModules = useMutation({
    mutationFn: (patch: Partial<CommunityModulesSettings>) => updateCommunityModules(patch),
    onSuccess: (next) => {
      qc.setQueryData(["admin-community-modules"], next);
      qc.invalidateQueries({ queryKey: ["site_settings_public"] });
      toast.success(t("adminCommunity.overview.saved"));
    },
    onError: () => toast.error(t("adminCommunity.overview.failedSave")),
  });

  const purgeM = useMutation({
    mutationFn: purgeExpiredMessages,
    onSuccess: (count) => toast.success(t("adminCommunity.overview.purgedMessages", { count })),
    onError: () => toast.error(t("adminCommunity.overview.purgeFailed")),
  });

  const remindersM = useMutation({
    mutationFn: runEventReminders,
    onSuccess: (count) =>
      toast.success(t("adminCommunity.overview.remindersDispatched", { count })),
    onError: () => toast.error(t("adminCommunity.overview.remindersFailed")),
  });

  const stats = statsQ.data;
  const ttlValue = modules?.default_message_ttl_seconds
    ? String(modules.default_message_ttl_seconds)
    : "off";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("adminCommunity.overview.communityPanel")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("adminCommunity.overview.moderationConfigurationChatEvents")}
        </p>
      </header>

      {/* Analityka modułu 17 - te same funkcje serwerowe co /admin/analytics */}
      <AdminBiStrip days={14} />



      {/* Metryki */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          icon={Users}
          label={t("adminCommunity.overview.conversations")}
          value={stats?.conversations_total}
        />
        <StatCard
          icon={MessageCircle}
          label={t("adminCommunity.overview.messages24h")}
          value={stats?.messages_last_24h}
        />
        <StatCard
          icon={Calendar}
          label={t("adminCommunity.overview.upcoming")}
          value={stats?.events_upcoming}
        />
        <StatCard
          icon={Calendar}
          label={t("adminCommunity.overview.drafts")}
          value={stats?.events_drafts}
        />
        <StatCard
          icon={HelpCircle}
          label={t("adminCommunity.overview.openQ")}
          value={stats?.qa_sessions_open}
        />
        <StatCard
          icon={Activity}
          label={t("adminCommunity.overview.pendingQs")}
          value={stats?.qa_questions_pending}
        />
      </div>

      {/* Moduły */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("adminCommunity.overview.moduleAvailability")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("adminCommunity.overview.disablingModuleHidesFrom")}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleRow
              label={t("adminCommunity.overview.chat")}
              hint={t("adminCommunity.overview.userUserMessages")}
              checked={modules?.chat_enabled ?? true}
              disabled={saveModules.isPending || !modules}
              onChange={(v) => saveModules.mutate({ chat_enabled: v })}
            />
            <ToggleRow
              label={t("adminCommunity.overview.network")}
              hint={t("adminCommunity.overview.invitationsMemberMemberConnections")}
              checked={modules?.connections_enabled ?? true}
              disabled={saveModules.isPending || !modules}
              onChange={(v) => saveModules.mutate({ connections_enabled: v })}
            />
            <ToggleRow
              label={t("adminCommunity.overview.events")}
              hint={t("adminCommunity.overview.calendarRsvp")}
              checked={modules?.events_enabled ?? true}
              disabled={saveModules.isPending || !modules}
              onChange={(v) => saveModules.mutate({ events_enabled: v })}
            />
            <ToggleRow
              label="Q&A"
              hint={t("adminCommunity.overview.qSessions")}
              checked={modules?.qa_enabled ?? true}
              disabled={saveModules.isPending || !modules}
              onChange={(v) => saveModules.mutate({ qa_enabled: v })}
            />
            <ToggleRow
              label={t("adminCommunity.overview.polls")}
              hint={t("adminCommunity.overview.pollsVoting")}
              checked={modules?.polls_enabled ?? true}
              disabled={saveModules.isPending || !modules}
              onChange={(v) => saveModules.mutate({ polls_enabled: v })}
            />
            <ToggleRow
              label={t("adminCommunity.overview.contributorProgram")}
              hint={t("adminCommunity.overview.guestSubmissions")}
              checked={modules?.contributor_program_enabled ?? true}
              disabled={saveModules.isPending || !modules}
              onChange={(v) => saveModules.mutate({ contributor_program_enabled: v })}
            />
            <ToggleRow
              label={t("adminCommunity.overview.badges")}
              hint={t("adminCommunity.overview.profileBadges")}
              checked={modules?.badges_enabled ?? true}
              disabled={saveModules.isPending || !modules}
              onChange={(v) => saveModules.mutate({ badges_enabled: v })}
            />
            <ToggleRow
              label={t("adminCommunity.overview.pushNotifications")}
              hint={t("adminCommunity.overview.webPushDigests")}
              checked={modules?.push_enabled ?? true}
              disabled={saveModules.isPending || !modules}
              onChange={(v) => saveModules.mutate({ push_enabled: v })}
            />
            <ToggleRow
              label={t("adminCommunity.overview.discussionClubs")}
              hint={t("adminCommunity.overview.lastingMemberMemberDiscussion")}
              checked={modules?.clubs_enabled ?? false}
              disabled={saveModules.isPending || !modules}
              onChange={(v) => saveModules.mutate({ clubs_enabled: v })}
            />
            <ToggleRow
              label={t("adminCommunity.overview.expertRequests")}
              hint={t("adminCommunity.overview.expertRequestsHint")}
              checked={modules?.expert_requests_enabled ?? true}
              disabled={saveModules.isPending || !modules}
              onChange={(v) => saveModules.mutate({ expert_requests_enabled: v })}
            />
          </div>

          <div className="pt-4 border-t border-border/60 space-y-2">
            <Label className="text-sm">{t("adminCommunity.overview.defaultMessageTtl")}</Label>
            <div className="flex items-center gap-2">
              <Select
                value={ttlValue}
                onValueChange={(v) =>
                  saveModules.mutate({
                    default_message_ttl_seconds: v === "off" ? null : Number(v),
                  })
                }
                disabled={saveModules.isPending || !modules}
              >
                <SelectTrigger className="w-[240px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TTL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Timer className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("adminCommunity.overview.ttlControlsWhenMessages")}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Akcje serwisowe */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("adminCommunity.overview.maintenanceActions")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => purgeM.mutate()} disabled={purgeM.isPending}>
            <RefreshCcw className="w-4 h-4 mr-2" />
            {t("adminCommunity.overview.purgeExpiredMessages")}
          </Button>
          <Button
            variant="outline"
            onClick={() => remindersM.mutate()}
            disabled={remindersM.isPending}
          >
            <Calendar className="w-4 h-4 mr-2" />
            {t("adminCommunity.overview.runEventReminders")}
          </Button>
        </CardContent>
      </Card>

      <NetworkPanel />
    </div>
  );
}

// Sieć kontaktów: metryki tenanta ("społeczność, nie audytorium") + kolejka
// zgłoszeń użytkowników. RPC egzekwują is_staff() po stronie DB.
function NetworkPanel() {
  ensureAdminCommunityI18n();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const statsQ = useQuery({
    queryKey: ["admin-network-stats"],
    queryFn: fetchNetworkStats,
    staleTime: 30_000,
  });
  const reportsQ = useQuery({
    queryKey: ["admin-user-reports", "open"],
    queryFn: () => fetchUserReports("open"),
    staleTime: 15_000,
  });
  const resolveM = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "resolved" | "dismissed" }) =>
      resolveUserReport(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-user-reports"] });
      toast.success(t("adminCommunity.overview.reportResolved"));
    },
    onError: () => toast.error(t("adminCommunity.overview.failedResolve")),
  });

  const stats = statsQ.data;
  const reports = reportsQ.data ?? [];
  const rate =
    stats && Number(stats.responded_30d) > 0
      ? Math.round((Number(stats.accepted_30d) / Number(stats.responded_30d)) * 100)
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UsersRound className="w-4 h-4" />
          {t("adminCommunity.overview.network")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            icon={UsersRound}
            label={t("adminCommunity.overview.connections")}
            value={stats ? Number(stats.connections_total) : undefined}
          />
          <StatCard
            icon={Activity}
            label={t("adminCommunity.overview.pending")}
            value={stats ? Number(stats.pending_total) : undefined}
          />
          <StatCard
            icon={Users}
            label={t("adminCommunity.overview.invites30d")}
            value={stats ? Number(stats.invites_30d) : undefined}
          />
          <StatCard
            icon={Users}
            label={t("adminCommunity.overview.accepted30d")}
            value={stats ? Number(stats.accepted_30d) : undefined}
          />
          <StatCard
            icon={Activity}
            label={t("adminCommunity.overview.acceptance")}
            value={rate ?? undefined}
          />
          <StatCard
            icon={Users}
            label={t("adminCommunity.overview.connectedMembers")}
            value={stats ? Number(stats.members_with_connection) : undefined}
          />
        </div>

        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Flag className="w-4 h-4" />
            {t("adminCommunity.overview.userReports")}
            {reports.length > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold text-destructive-foreground">
                {reports.length}
              </span>
            )}
          </h3>
          {reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("adminCommunity.overview.noOpenReports")}
            </p>
          ) : (
            <ul className="space-y-2">
              {reports.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {r.reporter_name} → {r.reported_name}
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {r.reason}
                      </span>
                    </p>
                    {r.details && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.details}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resolveM.isPending}
                      onClick={() => resolveM.mutate({ id: r.id, action: "resolved" })}
                    >
                      {t("adminCommunity.overview.resolve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={resolveM.isPending}
                      onClick={() => resolveM.mutate({ id: r.id, action: "dismissed" })}
                    >
                      {t("adminCommunity.overview.dismiss")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: number | undefined;
}) {
  return (
    <Card>
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="w-3.5 h-3.5" />
          {label}
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value ?? "-"}</div>
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border/60 bg-muted/30">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
