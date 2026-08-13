// Organizm: zakładka "Statystyki" edytora klubu.
//
// Dwa poziomy, nie jedna siatka liczników. Na górze trzy metryki ZDROWIA
// dyskusji, niżej stan obsady. Kolejność jest tezą: klub umiera na tematy bez
// odpowiedzi, a nie na zbyt małą liczbę członków, więc "% bez odpowiedzi"
// stoi pierwszy i jako jedyny ma próg kolorystyczny.
//
// Progi są jawnymi stałymi, nie liczbami wklejonymi w JSX - żeby dyskusja
// "czy 40% to już źle" toczyła się w jednym miejscu.
import { useTranslation } from "react-i18next";
import {
  Ban,
  Clock,
  Layers,
  MessageCircleQuestion,
  MessagesSquare,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  UserCog,
  Users2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAdminClubStats } from "@/lib/clubs/useClubs";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

type IconType = typeof Users2;

/** Powyżej tego odsetka tematów bez odpowiedzi klub wymaga interwencji. */
const UNANSWERED_BAD_PCT = 40;
const UNANSWERED_WARN_PCT = 20;

/** Mediana czasu do pierwszej odpowiedzi, w godzinach. */
const FIRST_REPLY_BAD_HOURS = 72;
const FIRST_REPLY_WARN_HOURS = 24;

type Tone = "ok" | "warn" | "bad" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-destructive",
  neutral: "",
};

function toneFor(value: number | null | undefined, warn: number, bad: number): Tone {
  if (value === null || value === undefined) return "neutral";
  if (value >= bad) return "bad";
  if (value >= warn) return "warn";
  return "ok";
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
}: {
  icon: IconType;
  label: string;
  value: string | number | undefined;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </div>
        <div className={`text-2xl font-semibold tabular-nums ${TONE_CLASS[tone]}`}>
          {value ?? "-"}
        </div>
        {hint !== undefined ? (
          <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ClubStatsTab({ clubId }: { clubId: string }) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();
  const statsQ = useAdminClubStats(clubId);
  const s = statsQ.data;

  if (statsQ.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-busy="true">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-muted/50" />
        ))}
      </div>
    );
  }

  if (statsQ.isError) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-destructive">
          {t("adminClubs.loadError")}
        </CardContent>
      </Card>
    );
  }

  const unanswered = s?.unanswered_pct ?? null;
  const median = s?.median_first_reply_hours ?? null;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">{t("adminClubs.stats.healthTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("adminClubs.stats.healthHint")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={MessageCircleQuestion}
            label={t("adminClubs.stats.unanswered")}
            value={unanswered !== null ? `${Math.round(unanswered)}%` : undefined}
            hint={t("adminClubs.stats.unansweredHint", { count: s?.unanswered_count ?? 0 })}
            tone={toneFor(unanswered, UNANSWERED_WARN_PCT, UNANSWERED_BAD_PCT)}
          />
          <StatCard
            icon={Clock}
            label={t("adminClubs.stats.firstReply")}
            // Mediana bywa NULL: klub bez żadnej odpowiedzi nie ma mediany
            // i nie jest to zero godzin, tylko brak danych.
            value={
              median !== null ? t("adminClubs.stats.hours", { value: median.toFixed(1) }) : "-"
            }
            hint={t("adminClubs.stats.firstReplyHint")}
            tone={toneFor(median, FIRST_REPLY_WARN_HOURS, FIRST_REPLY_BAD_HOURS)}
          />
          <StatCard
            icon={TrendingUp}
            label={t("adminClubs.stats.threads30d")}
            value={s?.threads_30d}
            hint={t("adminClubs.stats.threads30dHint", { count: s?.thread_count ?? 0 })}
          />
          <StatCard
            icon={MessagesSquare}
            label={t("adminClubs.stats.replies30d")}
            value={s?.replies_30d}
            hint={t("adminClubs.stats.replies30dHint", { count: s?.reply_count ?? 0 })}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t("adminClubs.stats.title")}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
          <StatCard icon={Users2} label={t("adminClubs.stats.members")} value={s?.member_count} />
          <StatCard
            icon={UserCheck}
            label={t("adminClubs.stats.active30d")}
            value={s?.active_members_30d}
          />
          <StatCard
            icon={UserCog}
            label={t("adminClubs.stats.pending")}
            value={s?.pending_members}
          />
          <StatCard icon={Layers} label={t("adminClubs.stats.groups")} value={s?.group_count} />
          <StatCard
            icon={MessagesSquare}
            label={t("adminClubs.stats.threads")}
            value={s?.thread_count}
          />
          <StatCard icon={ShieldCheck} label={t("adminClubs.stats.leads")} value={s?.leads_count} />
          <StatCard
            icon={ShieldAlert}
            label={t("adminClubs.stats.moderators")}
            value={s?.moderators_count}
          />
          <StatCard icon={Ban} label={t("adminClubs.stats.banned")} value={s?.banned_count} />
        </div>
      </section>
    </div>
  );
}
