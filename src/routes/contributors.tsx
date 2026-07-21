// Tablica kontrybutorów - reputacja/poziomy na bazie istniejących odznak
// i realnej aktywności (Q&A, wydarzenia, ankiety, komentarze, teksty
// gościnne). URL: /contributors
//
// Prywatność jak w katalogu /people: strona dla zalogowanych (AuthGate,
// noindex), na tablicy wyłącznie profile z opt-in discoverable i bez kont
// redakcyjnych - egzekwuje to RPC get_contributor_leaderboard, nie klient.
// Własny wynik (get_my_reputation) widzi każdy, także bez opt-in.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trophy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AuthGate } from "@/components/profile/AuthGate";
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { ReputationLevelChip } from "@/components/community/ReputationLevelChip";
import { ProfileBadges } from "@/components/profile/ProfileBadges";
import { useBadgesForUsers, type ProfileBadgeKind } from "@/lib/profile/badges";
import {
  levelName,
  nextLevelFor,
  progressToNextLevel,
  useContributorLeaderboard,
  useMyReputation,
  type LeaderboardEntry,
  type ReputationBreakdown,
} from "@/lib/community/reputation";
import { useAuth } from "@/hooks/useAuth";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-community";

export const Route = createFileRoute("/contributors")({
  component: ContributorsPage,
  head: () => ({
    meta: [{ title: "Tablica kontrybutorów" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

type WindowDays = 30 | 90 | 365;
const WINDOW_OPTIONS: WindowDays[] = [30, 90, 365];

function ContributorsPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureCommunityI18n();
  const { t } = useTranslation();
  return (
    <AuthGate
      fallbackTitle={t("community.reputation.membersOnlyTitle")}
      fallbackBody={t("community.reputation.membersOnlyBody")}
    >
      <ContributorsInner />
    </AuthGate>
  );
}

function windowLabelKey(days: WindowDays): string {
  return days === 30
    ? "community.reputation.window30"
    : days === 90
      ? "community.reputation.window90"
      : "community.reputation.window365";
}

function BreakdownChips({ breakdown }: { breakdown: ReputationBreakdown }) {
  const { t } = useTranslation();
  const entries = Object.entries(breakdown)
    .filter(([, value]) => (value?.points ?? 0) > 0)
    .sort(([, a], [, b]) => (b?.points ?? 0) - (a?.points ?? 0));
  if (entries.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <li
          key={key}
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground"
        >
          {t(`community.reputation.sources.${key}`)}
          <span className="font-semibold tabular-nums text-foreground">+{value?.points ?? 0}</span>
        </li>
      ))}
    </ul>
  );
}

function MyReputationCard({ days }: { days: WindowDays }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("en") ? "en" : "pl";
  const { user } = useAuth();
  const myQ = useMyReputation(days, user?.id);

  if (!myQ.data) return null;
  const my = myQ.data;
  const next = nextLevelFor(my.points);
  const progress = Math.round(progressToNextLevel(my.points) * 100);

  return (
    <section
      aria-label={t("community.reputation.yourScore")}
      className="mb-8 rounded-lg border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {t("community.reputation.yourScore")}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-2xl font-bold tabular-nums">
              {t("community.reputation.points", { count: my.points })}
            </span>
            <ReputationLevelChip points={my.points} size="md" />
            {my.position !== null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
                {t("community.reputation.positionLabel", { position: my.position })}
              </span>
            )}
          </p>
        </div>
        <div className="w-full max-w-56">
          <Progress value={progress} aria-hidden="true" />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {next
              ? t("community.reputation.nextLevel", {
                  level: levelName(next, lang),
                  points: Math.max(0, next.min - my.points),
                })
              : t("community.reputation.topLevel")}
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <BreakdownChips breakdown={my.breakdown} />
        {!my.board_visible && my.points > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("community.reputation.notVisible")}{" "}
            <Link to="/profile/privacy" className="font-medium text-primary hover:underline">
              {t("community.reputation.privacyCta")}
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}

function LeaderboardRow({
  entry,
  badges,
}: {
  entry: LeaderboardEntry;
  badges?: ProfileBadgeKind[];
}) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-3 p-3">
      <span
        className={
          entry.position <= 3
            ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold tabular-nums text-primary"
            : "flex h-7 w-7 shrink-0 items-center justify-center text-sm font-semibold tabular-nums text-muted-foreground"
        }
        aria-label={t("community.reputation.positionLabel", { position: entry.position })}
      >
        {entry.position}
      </span>
      <ChatAvatar name={entry.display_name} avatarUrl={entry.avatar_url} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-semibold">
          {entry.slug ? (
            <Link
              to="/author/$slug"
              params={{ slug: entry.slug }}
              className="truncate hover:underline"
            >
              {entry.display_name}
            </Link>
          ) : (
            <span className="truncate">{entry.display_name}</span>
          )}
          <ReputationLevelChip points={entry.points} />
          <ProfileBadges badges={badges} className="shrink-0" />
        </p>
        <div className="mt-1 hidden sm:block">
          <BreakdownChips breakdown={entry.breakdown} />
        </div>
      </div>
      <span className="shrink-0 text-sm font-bold tabular-nums">
        {t("community.reputation.points", { count: entry.points })}
      </span>
    </li>
  );
}

function ContributorsInner() {
  const { t } = useTranslation();
  const [days, setDays] = useState<WindowDays>(90);
  const boardQ = useContributorLeaderboard(days, 25);
  // Sygnały zaufania: odznaki dla całej tablicy jednym zapytaniem (jak /people).
  const badgesQ = useBadgesForUsers((boardQ.data ?? []).map((entry) => entry.user_id));

  return (
    <div className="container mx-auto max-w-4xl px-4 py-12 md:py-16">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-4xl font-bold tracking-tight">
            <Trophy className="h-8 w-8 text-primary" aria-hidden="true" />
            {t("community.reputation.boardTitle")}
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            {t("community.reputation.boardSubtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(days)}
            onValueChange={(next) => setDays(Number(next) as WindowDays)}
          >
            <SelectTrigger className="w-[140px]" aria-label={t("community.reputation.windowLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOW_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {t(windowLabelKey(option))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to="/people">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {t("community.reputation.peopleLink")}
            </Link>
          </Button>
        </div>
      </header>

      <MyReputationCard days={days} />

      {boardQ.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[60px] animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      )}
      {boardQ.isError && <p className="text-destructive">{t("community.common.loadError")}</p>}
      {boardQ.data && boardQ.data.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/70 p-10 text-center">
          <Trophy className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{t("community.reputation.empty")}</p>
        </div>
      )}
      {boardQ.data && boardQ.data.length > 0 && (
        <ol className="divide-y divide-border rounded-lg border border-border bg-card">
          {boardQ.data.map((entry) => (
            <LeaderboardRow
              key={entry.user_id}
              entry={entry}
              badges={badgesQ.data?.get(entry.user_id)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
