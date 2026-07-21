// /admin/community/engagement - przegląd zaangażowania i konwersji.
//
// Zasilany RPC get_engagement_overview() (jeden round-trip, staff-gated,
// SECURITY DEFINER): liczebność i przyrost członków, aktywni 7/30 dni jako
// unia realnych działań (wiadomości, komentarze, RSVP, głosy, Q&A,
// obserwacje trackera), lejek subskrypcji z rozkładem warstw, opt-in kanałów
// (push/digest) oraz puls modułów społeczności z top wydarzeniami.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Bell,
  Calendar,
  CalendarClock,
  Crown,
  FileEdit,
  HelpCircle,
  Landmark,
  Mail,
  MessagesSquare,
  UserCheck,
  UserPlus,
  Users,
  Vote,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchEngagementOverview } from "@/lib/admin/community";

export const Route = createFileRoute("/admin/community/engagement")({
  head: () => ({ meta: [{ title: "Engagement · Community · Admin" }] }),
  component: EngagementAdmin,
});

function EngagementAdmin() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const locale = isPl ? "pl-PL" : "en-GB";

  const q = useQuery({
    queryKey: ["admin-engagement-overview"],
    queryFn: fetchEngagementOverview,
    staleTime: 60_000,
  });

  const s = q.data;
  const pct = (part: number | undefined, whole: number | undefined): string => {
    if (!part || !whole || whole === 0) return "";
    return ` (${Math.round((part / whole) * 100)}%)`;
  };

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
          <CardTitle className="text-base">{isPl ? "Członkowie" : "Members"}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat icon={Users} label={isPl ? "Wszyscy" : "Total"} value={s?.members_total} />
          <Stat
            icon={UserPlus}
            label={isPl ? "Nowi (30 dni)" : "New (30d)"}
            value={s?.members_new_30d}
          />
          <Stat
            icon={UserCheck}
            label={isPl ? "Aktywni (7 dni)" : "Active (7d)"}
            value={s?.active_7d}
            suffix={pct(s?.active_7d, s?.members_total)}
          />
          <Stat
            icon={UserCheck}
            label={isPl ? "Aktywni (30 dni)" : "Active (30d)"}
            value={s?.active_30d}
            suffix={pct(s?.active_30d, s?.members_total)}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isPl ? "Subskrypcje i warstwy" : "Subscriptions and tiers"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Stat
              icon={Crown}
              label={isPl ? "Aktywne subskrypcje" : "Active subscriptions"}
              value={s?.subscriptions_active}
            />
            <TierBars
              tiers={s?.tier_distribution ?? {}}
              emptyLabel={
                isPl ? "Brak aktywnych subskrypcji płatnych." : "No active paid subscriptions."
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isPl ? "Kanały dotarcia (opt-in)" : "Reach channels (opt-in)"}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Stat icon={Bell} label={isPl ? "Web push" : "Web push"} value={s?.push_optin} />
            <Stat
              icon={Mail}
              label={isPl ? "Digest e-mail" : "Email digest"}
              value={s?.digest_optin}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isPl ? "Puls modułów społeczności" : "Community modules pulse"}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat
            icon={Calendar}
            label={isPl ? "Nadch. wydarzenia" : "Upcoming events"}
            value={s?.events_upcoming}
          />
          <Stat
            icon={MessagesSquare}
            label={isPl ? "RSVP „będę”" : 'RSVPs "going"'}
            value={s?.rsvps_upcoming}
          />
          <Stat
            icon={HelpCircle}
            label={isPl ? "Otwarte pytania Q&A" : "Open Q&A questions"}
            value={s?.qa_open_questions}
          />
          <Stat
            icon={Vote}
            label={isPl ? "Głosy (30 dni)" : "Poll votes (30d)"}
            value={s?.poll_votes_30d}
          />
          <Stat
            icon={FileEdit}
            label={isPl ? "Zgł. czekające" : "Pending pitches"}
            value={s?.submissions_pending}
          />
          <Stat
            icon={Landmark}
            label={isPl ? "Obserwacje trackera" : "Tracker follows"}
            value={s?.tracker_follows}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isPl ? "Najbliższe wydarzenia" : "Next events"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!s || s.top_upcoming_events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isPl
                ? "Brak opublikowanych nadchodzących wydarzeń."
                : "No published upcoming events."}
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {s.top_upcoming_events.map((event) => {
                const title = (isPl ? event.title_pl : event.title_en) ?? event.slug;
                return (
                  <li key={event.slug} className="flex items-center gap-3 py-2">
                    <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <Link
                        to="/events/$slug"
                        params={{ slug: event.slug }}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {title}
                      </Link>
                      <div className="text-xs tabular-nums text-muted-foreground">
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(event.starts_at))}
                      </div>
                    </div>
                    <Badge variant="secondary" className="shrink-0 font-normal tabular-nums">
                      {event.going} {isPl ? "będzie" : "going"}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isPl ? "Informacje" : "Info"}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {isPl
            ? "Dane z get_engagement_overview(): jeden odczyt agreguje aktywność (wiadomości, komentarze, RSVP, głosy, Q&A, obserwacje), lejek subskrypcji i puls modułów. Dla pełnej analityki (kohorty, retencja, funnel) użyj paneli CRM i Analytics."
            : "Data from get_engagement_overview(): a single read aggregates activity (messages, comments, RSVPs, votes, Q&A, follows), the subscription funnel and module pulse. For full analytics (cohorts, retention, funnel) use the CRM and Analytics panels."}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  suffix,
}: {
  icon: typeof Users;
  label: string;
  value: number | undefined;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">
        {value ?? "-"}
        {suffix && <span className="text-sm font-normal text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

/** Rozkład warstw członkostwa jako poziome paski proporcji. */
function TierBars({ tiers, emptyLabel }: { tiers: Record<string, number>; emptyLabel: string }) {
  const entries = Object.entries(tiers).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  const max = Math.max(...entries.map(([, count]) => count), 1);
  return (
    <ul className="space-y-1.5">
      {entries.map(([tier, count]) => (
        <li key={tier} className="flex items-center gap-2 text-sm">
          <span className="w-24 shrink-0 truncate text-xs text-muted-foreground" title={tier}>
            {tier}
          </span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-brand"
              style={{ width: `${Math.max(4, Math.round((count / max) * 100))}%` }}
            />
          </span>
          <span className="w-8 shrink-0 text-right tabular-nums">{count}</span>
        </li>
      ))}
    </ul>
  );
}
