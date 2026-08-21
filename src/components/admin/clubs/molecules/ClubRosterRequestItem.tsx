// Molekuła: POZYCJA KOLEJKI PRÓŚB o dostęp do klubu.
//
// CO BYŁA W ORGANIZMIE. Element `pending.map()` z linią stanowiska składaną
// w JSX-ie (`t(\`club.role.${asRole(row.role)}\`)` plus warunkowe
// ` · ${current_company}`) i dwoma inline'owymi handlerami. Kolejka próśb
// powstaje w KAŻDYM nowym klubie, bo `join_policy: 'request'` jest polityką
// domyślną - a jedyną drogą do jej obsłużenia było wcześniej ponowne
// „dodanie” osoby kartą wyżej, co przestawiało rolę na `member` i kasowało
// kadencję.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać, KTO prosi i O JAKĄ ROLĘ, oraz oddać dwa
// zdarzenia. Odrzucenie jest operacją NIEODWRACALNĄ, więc molekuła nie woła
// mutacji - oddaje zdarzenie, które rodzic prowadzi przez potwierdzenie.
//
// SŁOWNIK PANELU, NIE PUBLICZNY. Klucze `adminClubs.*` mieszkają
// w `i18n-clubs-admin`, który trzeba jawnie dociągnąć - inaczej molekuła
// renderuje GOŁY KLUCZ, czego nie widzi ani bramka parytetu, ani bramka
// rozjazdu kod<->słownik. Dlatego `ensureAdminClubsI18n()` stoi tutaj,
// a nie tylko w organizmie: molekuła bywa zamontowana bez niego.
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminMemberRequestView } from "@/lib/clubs/adminMemberRoster";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubRosterRequestItem({
  view,
  approvePending,
  rejectPending,
  onApprove,
  onReject,
}: {
  view: AdminMemberRequestView;
  approvePending: boolean;
  rejectPending: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card p-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{view.displayName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {t(view.roleKey)}
          {view.company === null ? "" : ` · ${view.company}`}
        </p>
      </div>
      <Button size="sm" className="h-8" disabled={approvePending} onClick={onApprove}>
        <Check className="mr-1.5 h-3.5 w-3.5" />
        {t("adminClubs.members.approve")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 text-destructive"
        disabled={rejectPending}
        onClick={onReject}
      >
        <X className="mr-1.5 h-3.5 w-3.5" />
        {t("adminClubs.members.reject")}
      </Button>
    </li>
  );
}
