// Moduł "moje kluby" na stronie głównej - z sygnałem nowości i sterowaniem
// powiadomieniami w miejscu.
//
// DLACZEGO OSOBNO OD SIATKI KATALOGU. Siatka odpowiada na pytanie "jakie są
// kluby", ten panel na "co się u mnie zmieniło". To dwa różne pytania i dwa
// różne źródła: `club_list` zna klub, `club_my_memberships` zna MOJĄ relację
// z klubem - rolę, kadencję, poziom powiadomień i datę ostatniej wizyty.
//
// Kropka nowości bierze się z zestawienia `last_activity_at` z `last_read_at`.
// Świadomie nie ma licznika "3 nowe": baza nie liczy nieprzeczytanych, a
// liczba, której nie da się policzyć uczciwie, jest gorsza niż kropka.
//
// Poziom powiadomień siedzi tutaj, a nie tylko na /club/$slug/about, bo to
// jedyne miejsce, gdzie widać wszystkie kluby naraz - a wyciszenie jednego
// z czterech jest decyzją porównawczą.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { BellRing, MessagesSquare, Users2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSetClubNotifyLevel } from "@/lib/clubs/useClubs";
import { hasUnseenActivity, sortMemberships } from "@/lib/clubs/membershipSignals";
import {
  CLUB_NOTIFY_LEVELS,
  type ClubMembershipRow,
  type ClubNotifyLevel,
} from "@/lib/clubs/types";

export function ClubMembershipPanel({
  memberships,
  isPl,
  loading,
}: {
  memberships: readonly ClubMembershipRow[];
  isPl: boolean;
  loading: boolean;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/50" />
        ))}
      </div>
    );
  }

  if (memberships.length === 0) return null;

  const rows = sortMemberships(memberships);
  const unseen = rows.filter(hasUnseenActivity).length;

  return (
    <section className="mb-8" aria-labelledby="club-memberships-heading">
      <h2
        id="club-memberships-heading"
        className="mb-3 flex items-center gap-2 text-lg font-semibold"
      >
        <BellRing className="h-4 w-4" />
        {t("club.hub.membershipsTitle")}
        {unseen > 0 ? (
          <Badge variant="secondary" className="tabular-nums">
            {t("club.hub.unseenCount", { count: unseen })}
          </Badge>
        ) : null}
      </h2>

      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <MembershipRow key={row.club_id} row={row} isPl={isPl} />
        ))}
      </ul>
    </section>
  );
}

function MembershipRow({ row, isPl }: { row: ClubMembershipRow; isPl: boolean }) {
  const { t } = useTranslation();
  const notifyM = useSetClubNotifyLevel(row.club_id);
  const unseen = hasUnseenActivity(row);
  // RPC oddaje poziom jako `string` (SQL nie ma unii literałów), więc
  // zawężamy go tu z jawnym fallbackiem - nieznana wartość z nowszej migracji
  // ma nie wywrócić droplisty.
  const level: ClubNotifyLevel = (CLUB_NOTIFY_LEVELS as readonly string[]).includes(
    row.notify_level,
  )
    ? (row.notify_level as ClubNotifyLevel)
    : "all";

  const change = (next: ClubNotifyLevel) =>
    notifyM.mutate(next, {
      onSuccess: () => toast.success(t("club.hub.notifySaved")),
      onError: () => toast.error(t("adminClubs.saveFailed")),
    });

  return (
    <li className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <Link to="/club/$clubSlug" params={{ clubSlug: row.slug }} className="group min-w-0 flex-1">
          <span className="flex items-center gap-2">
            {/* Kropka, nie liczba - patrz nagłówek pliku. */}
            {unseen ? (
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-primary"
                aria-label={t("club.hub.unseenDot")}
              />
            ) : null}
            <span className="truncate font-medium group-hover:text-primary">
              {isPl ? row.name_pl : row.name_en}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{t(`club.role.${row.role}`, { defaultValue: row.role })}</span>
            <span className="inline-flex items-center gap-1">
              <Users2 className="h-3 w-3" />
              {row.member_count}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessagesSquare className="h-3 w-3" />
              {row.thread_count}
            </span>
          </span>
        </Link>
      </div>

      <div className="mt-2 border-t border-border/60 pt-2">
        <Select value={level} onValueChange={(v) => change(v as ClubNotifyLevel)}>
          <SelectTrigger
            className="h-8 text-xs"
            aria-label={t("club.hub.notifyLabel", {
              club: isPl ? row.name_pl : row.name_en,
            })}
            disabled={notifyM.isPending}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLUB_NOTIFY_LEVELS.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`club.notify.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </li>
  );
}
