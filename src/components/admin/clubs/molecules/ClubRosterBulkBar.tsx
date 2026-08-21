// Molekuła: PASEK OPERACJI MASOWYCH nad tabelą składu.
//
// CO BYŁA W ORGANIZMIE. Blok JSX-a widoczny warunkowo (`selected.size > 0`)
// z trzecim egzemplarzem dropListy roli i trzema inline'owymi handlerami.
// Pasek pojawia się DOPIERO po zaznaczeniu: pusty pasek z nieaktywną
// dropListą to szum nad każdą tabelą, a nie kontrolka.
//
// JEDNA ODPOWIEDZIALNOŚĆ: powiedzieć, ILU osób dotyczy operacja, i oddać
// trzy zdarzenia. Molekuła nie zna zaznaczenia - dostaje jego LICZNOŚĆ, bo
// pasek nie ma prawa dopisać ani odjąć nikomu roli na własną rękę.
//
// SŁOWNIK PANELU, NIE PUBLICZNY. Klucze `adminClubs.*` mieszkają
// w `i18n-clubs-admin`, który trzeba jawnie dociągnąć - inaczej molekuła
// renderuje GOŁY KLUCZ, czego nie widzi ani bramka parytetu, ani bramka
// rozjazdu kod<->słownik. Dlatego `ensureAdminClubsI18n()` stoi tutaj,
// a nie tylko w organizmie: molekuła bywa zamontowana bez niego.
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ClubRosterRoleSelect } from "./ClubRosterRoleSelect";
import type { ClubMemberRole } from "@/lib/clubs/types";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubRosterBulkBar({
  count,
  role,
  pending,
  onRoleChange,
  onApply,
  onClear,
}: {
  count: number;
  role: ClubMemberRole;
  pending: boolean;
  onRoleChange: (role: ClubMemberRole) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <span className="text-sm font-medium">{t("adminClubs.members.bulkSelected", { count })}</span>
      <ClubRosterRoleSelect
        value={role}
        ariaLabel={t("adminClubs.members.bulkRole")}
        className="w-full sm:w-[190px]"
        onChange={onRoleChange}
      />
      <Button size="sm" disabled={pending} onClick={onApply}>
        {t("adminClubs.members.bulkApply")}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={onClear}>
        {t("adminClubs.members.bulkClear")}
      </Button>
    </div>
  );
}
