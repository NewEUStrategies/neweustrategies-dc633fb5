// /admin/community — dashboard z metrykami community + globalne toggles modułów.
// Toggle zapisywane w site_settings.community_modules; wartości są konsumowane
// przez runtime (useCommunityModules) i sterują dostępnością chat / events /
// Q&A / polls z poziomu UI produktu.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  Calendar,
  HelpCircle,
  MessageCircle,
  Timer,
  RefreshCcw,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export const Route = createFileRoute("/admin/community/")({
  head: () => ({ meta: [{ title: "Community · Admin" }] }),
  component: CommunityOverview,
});

const TTL_OPTIONS: { value: string; labelPl: string; labelEn: string }[] = [
  { value: "off", labelPl: "Bez limitu (domyślnie)", labelEn: "No limit (default)" },
  { value: "86400", labelPl: "24 godziny", labelEn: "24 hours" },
  { value: "604800", labelPl: "7 dni", labelEn: "7 days" },
  { value: "7776000", labelPl: "90 dni", labelEn: "90 days" },
];

function CommunityOverview() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
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
      toast.success(isPl ? "Zapisano" : "Saved");
    },
    onError: () => toast.error(isPl ? "Nie udało się zapisać" : "Failed to save"),
  });

  const purgeM = useMutation({
    mutationFn: purgeExpiredMessages,
    onSuccess: (count) =>
      toast.success(isPl ? `Wyczyszczono ${count} wiadomości` : `Purged ${count} messages`),
    onError: () => toast.error(isPl ? "Błąd purge" : "Purge failed"),
  });

  const remindersM = useMutation({
    mutationFn: runEventReminders,
    onSuccess: (count) =>
      toast.success(
        isPl ? `Wysłano ${count} przypomnień` : `Dispatched ${count} reminders`,
      ),
    onError: () => toast.error(isPl ? "Błąd przypomnień" : "Reminders failed"),
  });

  const stats = statsQ.data;
  const ttlValue = modules?.default_message_ttl_seconds
    ? String(modules.default_message_ttl_seconds)
    : "off";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">
          {isPl ? "Panel społeczności" : "Community panel"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isPl
            ? "Moderacja i konfiguracja modułów Chat, Wydarzenia i Q&A."
            : "Moderation and configuration of Chat, Events and Q&A modules."}
        </p>
      </header>

      {/* Metryki */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          icon={Users}
          label={isPl ? "Konwersacje" : "Conversations"}
          value={stats?.conversations_total}
        />
        <StatCard
          icon={MessageCircle}
          label={isPl ? "Wiad. / 24 h" : "Messages / 24h"}
          value={stats?.messages_last_24h}
        />
        <StatCard
          icon={Calendar}
          label={isPl ? "Nadchodzące" : "Upcoming"}
          value={stats?.events_upcoming}
        />
        <StatCard
          icon={Calendar}
          label={isPl ? "Wersje robocze" : "Drafts"}
          value={stats?.events_drafts}
        />
        <StatCard
          icon={HelpCircle}
          label={isPl ? "Otwarte Q&A" : "Open Q&A"}
          value={stats?.qa_sessions_open}
        />
        <StatCard
          icon={Activity}
          label={isPl ? "Pytania czek." : "Pending Qs"}
          value={stats?.qa_questions_pending}
        />
      </div>

      {/* Moduły */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isPl ? "Dostępność modułów" : "Module availability"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {isPl
              ? "Wyłączenie modułu ukrywa go w interfejsie użytkownika (nawigacja, przyciski akcji, mobilne skróty)."
              : "Disabling a module hides it from the user UI (navigation, action buttons, mobile shortcuts)."}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleRow
              label={isPl ? "Chat" : "Chat"}
              hint={isPl ? "Wiadomości między użytkownikami" : "User-to-user messages"}
              checked={modules?.chat_enabled ?? true}
              disabled={saveModules.isPending || !modules}
              onChange={(v) => saveModules.mutate({ chat_enabled: v })}
            />
            <ToggleRow
              label={isPl ? "Wydarzenia" : "Events"}
              hint={isPl ? "Kalendarz i RSVP" : "Calendar and RSVP"}
              checked={modules?.events_enabled ?? true}
              disabled={saveModules.isPending || !modules}
              onChange={(v) => saveModules.mutate({ events_enabled: v })}
            />
            <ToggleRow
              label="Q&A"
              hint={isPl ? "Sesje pytań i odpowiedzi" : "Q&A sessions"}
              checked={modules?.qa_enabled ?? true}
              disabled={saveModules.isPending || !modules}
              onChange={(v) => saveModules.mutate({ qa_enabled: v })}
            />
            <ToggleRow
              label={isPl ? "Ankiety" : "Polls"}
              hint={isPl ? "Głosowania i sondaże" : "Polls and voting"}
              checked={modules?.polls_enabled ?? true}
              disabled={saveModules.isPending || !modules}
              onChange={(v) => saveModules.mutate({ polls_enabled: v })}
            />
          </div>

          <div className="pt-4 border-t border-border/60 space-y-2">
            <Label className="text-sm">
              {isPl ? "Domyślny czas życia wiadomości" : "Default message TTL"}
            </Label>
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
                      {isPl ? o.labelPl : o.labelEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Timer className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">
              {isPl
                ? "TTL określa, po jakim czasie wiadomości są automatycznie kasowane. Cron chat-purge-expired-messages działa co 15 minut."
                : "TTL controls when messages are auto-purged. The chat-purge-expired-messages cron runs every 15 minutes."}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Akcje serwisowe */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isPl ? "Akcje serwisowe" : "Maintenance actions"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => purgeM.mutate()}
            disabled={purgeM.isPending}
          >
            <RefreshCcw className="w-4 h-4 mr-2" />
            {isPl ? "Wyczyść wygasłe wiadomości" : "Purge expired messages"}
          </Button>
          <Button
            variant="outline"
            onClick={() => remindersM.mutate()}
            disabled={remindersM.isPending}
          >
            <Calendar className="w-4 h-4 mr-2" />
            {isPl ? "Uruchom przypomnienia o wydarzeniach" : "Run event reminders"}
          </Button>
        </CardContent>
      </Card>
    </div>
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
