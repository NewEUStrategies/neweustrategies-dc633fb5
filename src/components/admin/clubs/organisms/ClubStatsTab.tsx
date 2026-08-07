// Organizm: zakładka "Statystyki" edytora klubu.
//
// Karty, nie rozwijany raport - metryki klubu mają być widoczne od razu.
// Liczba tematów bez odpowiedzi wejdzie tu w etapie A3; do tego czasu karty
// tematów pokazują zero, a nie znikają, bo karta, która nagle się pojawia,
// czyta się jak awaria.
import { useTranslation } from "react-i18next";
import { Ban, Layers, MessagesSquare, ShieldCheck, UserCheck, UserCog, Users2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAdminClubStats } from "@/lib/clubs/useClubs";

type IconType = typeof Users2;

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: IconType;
  label: string;
  value: number | undefined;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value ?? "-"}</div>
      </CardContent>
    </Card>
  );
}

export function ClubStatsTab({ clubId }: { clubId: string }) {
  const { t } = useTranslation();
  const statsQ = useAdminClubStats(clubId);
  const s = statsQ.data;

  return (
    <div className="space-y-4">
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
        <StatCard icon={Ban} label={t("adminClubs.stats.banned")} value={s?.banned_count} />
        <StatCard
          icon={ShieldCheck}
          label={t("adminClubs.stats.leads")}
          value={s?.leads_count}
        />
        <StatCard
          icon={ShieldCheck}
          label={t("adminClubs.stats.moderators")}
          value={s?.moderators_count}
        />
      </div>
    </div>
  );
}
