// /admin/community/engagement — przegląd zaangażowania i konwersji.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Users,
  UserPlus,
  Target,
  MessageSquare,
  Vote,
  Calendar,
  HelpCircle,
  FileEdit,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchEngagementSnapshot } from "@/lib/admin/community";

export const Route = createFileRoute("/admin/community/engagement")({
  head: () => ({ meta: [{ title: "Engagement · Community · Admin" }] }),
  component: EngagementAdmin,
});

function EngagementAdmin() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");

  const q = useQuery({
    queryKey: ["admin-engagement-snapshot"],
    queryFn: fetchEngagementSnapshot,
    staleTime: 60_000,
  });

  const s = q.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4" />
        <h2 className="text-lg font-semibold">
          {isPl ? "Zaangażowanie i konwersja" : "Engagement and conversion"}
        </h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isPl ? "Użytkownicy" : "Users"}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Stat icon={Users} label={isPl ? "Wszyscy" : "Total"} value={s?.total_users} />
          <Stat icon={UserPlus} label={isPl ? "Nowi (7 dni)" : "New (7d)"} value={s?.new_users_7d} />
          <Stat icon={Target} label={isPl ? "Leady CRM" : "CRM leads"} value={s?.crm_leads_total} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isPl ? "Aktywność (7 dni)" : "Activity (7d)"}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <Stat icon={MessageSquare} label={isPl ? "Komentarze" : "Comments"} value={s?.comments_last_7d} />
          <Stat icon={Vote} label={isPl ? "Głosy" : "Poll votes"} value={s?.poll_votes_last_7d} />
          <Stat icon={Calendar} label={isPl ? "RSVP" : "RSVPs"} value={s?.event_rsvps_upcoming} />
          <Stat icon={HelpCircle} label={isPl ? "Pytania Q&A" : "Q&A questions"} value={s?.qa_questions_last_7d} />
          <Stat icon={FileEdit} label={isPl ? "Zgł. czekające" : "Pending pitches"} value={s?.contributor_pending} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isPl ? "Informacje" : "Info"}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {isPl
            ? "Migawka odczytywana z tabel w czasie rzeczywistym. Dla pełnej analityki (kohorty, retencja, funnel) użyj panelu CRM i Analytics."
            : "Snapshot from live tables. For full analytics (cohorts, retention, funnel) use the CRM and Analytics panels."}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: number | undefined;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value ?? "-"}</div>
    </div>
  );
}
