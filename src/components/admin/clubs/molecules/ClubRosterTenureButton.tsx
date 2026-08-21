// Molekuła: kadencja roli jako PRZYCISK, nie tekst.
//
// CO BYŁA W ORGANIZMIE. Lokalny komponent `TenureCell` z trzema gałęziami
// wpisanymi w JSX (`role_expires_at === null` / `isExpired(...)` / data)
// i z odczytem zegara w środku (`Date.now()` w `isExpired`). Renderował się
// dwa razy - w wierszu tabeli i w karcie mobilnej.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać stan kadencji i wpuścić do jej zmiany.
// Rozstrzygnięcie stanu należy do `memberTenure` w warstwie `lib`, a CHWILA
// przychodzi propsem - molekuła nie czyta zegara, bo komponent, który zna
// bieżący czas, nie da się sprawdzić bez zegara systemowego.
//
// Kolumna była wcześniej martwym odczytem: `club_scheduler_tick` wygasza role
// po terminie, a terminu nie dało się nigdzie ustawić.
//
// SŁOWNIK PANELU, NIE PUBLICZNY. Klucze `adminClubs.*` mieszkają
// w `i18n-clubs-admin`, który trzeba jawnie dociągnąć - inaczej molekuła
// renderuje GOŁY KLUCZ, czego nie widzi ani bramka parytetu, ani bramka
// rozjazdu kod<->słownik. Dlatego `ensureAdminClubsI18n()` stoi tutaj,
// a nie tylko w organizmie: molekuła bywa zamontowana bez niego.
import { useTranslation } from "react-i18next";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { memberTenure } from "@/lib/clubs/adminMemberRoster";
import { formatDateShort } from "@/lib/i18n/format";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubRosterTenureButton({
  expiresAt,
  nowMs,
  language,
  onEdit,
}: {
  expiresAt: string | null;
  nowMs: number;
  language: string | undefined;
  onEdit: () => void;
}) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();
  const tenure = memberTenure(expiresAt, nowMs);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-xs font-normal"
      onClick={onEdit}
    >
      <CalendarClock className="h-3.5 w-3.5 shrink-0" />
      {tenure.kind === "none" ? (
        <span className="text-muted-foreground">{t("adminClubs.members.tenureNone")}</span>
      ) : tenure.kind === "expired" ? (
        <span className="text-amber-700 dark:text-amber-300">
          {t("adminClubs.members.roleExpired")}
        </span>
      ) : (
        <span className="text-muted-foreground">{formatDateShort(tenure.at, language)}</span>
      )}
    </Button>
  );
}
