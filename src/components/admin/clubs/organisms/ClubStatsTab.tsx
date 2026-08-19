// Organizm: zakładka „Statystyki" edytora klubu - TRZY STANY zapytania.
//
// Dwa poziomy, nie jedna siatka liczników. Na górze trzy metryki ZDROWIA
// dyskusji plus rytm, niżej stan obsady. Kolejność jest tezą: klub umiera na
// tematy bez odpowiedzi, a nie na zbyt małą liczbę członków.
//
// Odczyt metryk (brak danych zamiast zera, progi koloru, liczniki
// w podpowiedziach) mieszka w `lib/clubs/adminClubStatsView` i ma tam własny
// test; rysunek kafla - w molekule `ClubFormStatCard`. Zostaje tu sklejenie:
// zapytanie w locie -> szkielet, awaria -> jedno zdanie, dane -> dwie sekcje
// kafli.
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { ClubFormStatCard } from "../molecules/ClubFormStatCard";
import { clubStatsHealthCards, clubStatsRosterCards } from "@/lib/clubs/adminClubStatsView";
import { useAdminClubStats } from "@/lib/clubs/useClubs";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

/** Liczba kafli szkieletu = liczba kafli obsady, żeby układ nie skakał. */
const SKELETON_TILES = [0, 1, 2, 3, 4, 5, 6, 7];

export function ClubStatsTab({ clubId }: { clubId: string }) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();
  const statsQ = useAdminClubStats(clubId);

  if (statsQ.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-busy="true">
        {SKELETON_TILES.map((i) => (
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

  // `statsQ.data` bywa `null`: RPC oddaje pustą tablicę dla klubu bez ani
  // jednego wiersza statystyk, a to nie jest awaria - to klub bez ruchu.
  const health = clubStatsHealthCards(statsQ.data);
  const roster = clubStatsRosterCards(statsQ.data);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">{t("adminClubs.stats.healthTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("adminClubs.stats.healthHint")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {health.map((card) => (
            <ClubFormStatCard key={card.id} card={card} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t("adminClubs.stats.title")}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
          {roster.map((card) => (
            <ClubFormStatCard key={card.id} card={card} />
          ))}
        </div>
      </section>
    </div>
  );
}
