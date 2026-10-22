// Molekuła: reguła Zespołu „3-20 miejsc" (cennik v6.2) w panelu organizacji.
//
// Decyzja właściciela 2026-10-20 (I9b): organizacja na progu `team` ma
// najwyżej 20 miejsc, powyżej - Enterprise. Bazę pilnują wyzwalacze
// (20261020160300); panel mówi to samo ZANIM admin kliknie, z liczbami
// z jednej stałej (`TEAM_TIER_MAX_SEATS`/`TEAM_TIER_MIN_SEATS`), żeby limit
// pokazywany i limit egzekwowany nie mogły się rozjechać (AGENTS.md:
// wspólne limity klient/serwer, odrzucenie zamiast przycięcia).
//
// Komunikaty:
//   * stan „x/20" - zawsze dla Zespołu z istniejącymi miejscami;
//   * liczba, którą baza odrzuci (`teamSeatLimitRejected` - wejście na
//     Zespół z limitem > 20 albo podniesienie ponad 20) -> `role="alert"`
//     z sugestią Enterprise (wołający blokuje zapis i wiąże pole przez
//     `aria-describedby={alertId}`);
//   * żądana liczba < 3 -> ostrzeżenie BEZ blokady (minimum to warunek
//     sprzedaży, nie przydziału);
//   * limit sprzed reguły > 20 -> zostaje, można go tylko obniżać;
//   * 20 aktywnych -> dodawanie zablokowane (także przy limicie > 20).
// Inne progi: nic.
import { useTranslation } from "react-i18next";

import { ensureI18n as ensureAdminOrganizationsI18n } from "@/lib/i18n-admin-organizations";
import {
  TEAM_TIER_KEY,
  TEAM_TIER_MAX_SEATS,
  TEAM_TIER_MIN_SEATS,
  teamSeatAddBlocked,
  teamSeatLimitRejected,
  teamSeatVerdict,
} from "@/lib/organizations/teamSeats";

export function TeamSeatCapNotice({
  tierKey,
  requestedSeats,
  base,
  activeSeats,
  alertId,
  showRejection = true,
}: {
  /** Próg, który organizacja będzie mieć po zapisie. */
  tierKey: string | null | undefined;
  /** Liczba miejsc, którą admin właśnie wpisuje albo zostawia. */
  requestedSeats: number;
  /** Stan w bazie (`null` - organizacja jeszcze nie istnieje). */
  base: { tierKey: string; seatsLimit: number } | null;
  /** Aktywne miejsca organizacji (`null` - nieznane, np. formularz zakładania). */
  activeSeats: number | null;
  /** Id komunikatu odmowy - cel `aria-describedby` pola liczby miejsc. */
  alertId?: string;
  /**
   * `false`, gdy odmowę pokazuje samo pole (`FloatingInput` z `error` ma
   * własny `role="alert"` i `aria-describedby`) - bez dwóch alertów naraz.
   */
  showRejection?: boolean;
}) {
  ensureAdminOrganizationsI18n();
  const { t } = useTranslation();
  if (tierKey !== TEAM_TIER_KEY) return null;

  const counts = { max: TEAM_TIER_MAX_SEATS, min: TEAM_TIER_MIN_SEATS };
  const rejected = teamSeatLimitRejected({ tierKey, seatsLimit: requestedSeats }, base);
  const legacyOver = base?.tierKey === TEAM_TIER_KEY && base.seatsLimit > TEAM_TIER_MAX_SEATS;
  const addBlocked = activeSeats !== null && teamSeatAddBlocked(tierKey, activeSeats);

  return (
    <div
      className="space-y-1 text-[11px] leading-snug"
      data-team-seat-cap={rejected ? "rejected" : teamSeatVerdict(tierKey, requestedSeats)}
    >
      {activeSeats !== null ? (
        <p className="tabular-nums text-muted-foreground">
          {t("adminOrganizations.teamCap.status", { ...counts, active: activeSeats })}
        </p>
      ) : null}
      {rejected && showRejection ? (
        <p id={alertId} role="alert" className="font-medium text-destructive">
          {t("adminOrganizations.teamCap.aboveMax", { ...counts, requested: requestedSeats })}
        </p>
      ) : null}
      {teamSeatVerdict(tierKey, requestedSeats) === "below_min" ? (
        <p className="text-muted-foreground">{t("adminOrganizations.teamCap.belowMin", counts)}</p>
      ) : null}
      {legacyOver ? (
        <p className="text-muted-foreground">
          {t("adminOrganizations.teamCap.legacyOver", { limit: base?.seatsLimit })}
        </p>
      ) : null}
      {addBlocked ? (
        <p className="font-medium text-foreground">
          {t("adminOrganizations.teamCap.addBlocked", counts)}
        </p>
      ) : null}
    </div>
  );
}
