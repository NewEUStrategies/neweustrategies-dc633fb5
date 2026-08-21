// Molekuła: WIERSZ TABELY składu (od `lg` w górę).
//
// CO BYŁA W ORGANIZMIE. Trzydzieści linii JSX-a w `rows.map()` z sześcioma
// inline'owymi handlerami i trzema warunkami widoczności. Ten sam zestaw
// operacji renderował się drugi raz kilkadziesiąt linii niżej jako karta
// mobilna, więc każda zmiana operacji wymagała dwóch identycznych poprawek
// w jednym pliku - i dokładnie tak powstał stan, w którym karta mobilna nie
// miała przycisku zatwierdzenia prośby.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać jeden wiersz składu i oddać rodzicowi
// zdarzenia. Molekuła nie zna klubu, nie woła mutacji i nie decyduje, czy
// operacja jest dozwolona - decyzję (`canApprove`) niesie widok wiersza.
//
// SŁOWNIK PANELU, NIE PUBLICZNY. Klucze `adminClubs.*` mieszkają
// w `i18n-clubs-admin`, który trzeba jawnie dociągnąć - inaczej molekuła
// renderuje GOŁY KLUCZ, czego nie widzi ani bramka parytetu, ani bramka
// rozjazdu kod<->słownik. Dlatego `ensureAdminClubsI18n()` stoi tutaj,
// a nie tylko w organizmie: molekuła bywa zamontowana bez niego.
import { useTranslation } from "react-i18next";
import { Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import { ClubMemberStatusBadge } from "../atoms/ClubBadges";
import { ClubRosterRoleSelect } from "./ClubRosterRoleSelect";
import { ClubRosterTenureButton } from "./ClubRosterTenureButton";
import type { AdminMemberRowView } from "@/lib/clubs/adminMemberRoster";
import type { ClubMemberRole } from "@/lib/clubs/types";
import { formatDateShort } from "@/lib/i18n/format";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

/**
 * Kontrakt obu wariantów wiersza - tabeli i karty. Jeden typ, bo to JEDEN
 * zestaw operacji w dwóch układach: gdyby warianty miały osobne propsy,
 * rozjazd funkcjonalny (brakujący przycisk na telefonie) znowu przeszedłby
 * przez kompilator.
 */
export interface ClubRosterMemberProps {
  view: AdminMemberRowView;
  selected: boolean;
  /** Chwila odniesienia dla kadencji - propsem, nie z zegara w środku. */
  nowMs: number;
  language: string | undefined;
  rolePending: boolean;
  removePending: boolean;
  onToggle: () => void;
  onRoleChange: (role: ClubMemberRole) => void;
  onApprove: () => void;
  onRemove: () => void;
  onEditTenure: () => void;
}

export function ClubRosterMemberRow({
  view,
  selected,
  nowMs,
  language,
  rolePending,
  removePending,
  onToggle,
  onRoleChange,
  onApprove,
  onRemove,
  onEditTenure,
}: ClubRosterMemberProps) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();

  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={view.displayName} />
      </TableCell>
      <TableCell>
        <div className="font-medium">{view.displayName}</div>
        {view.jobTitle === null ? null : (
          <div className="text-xs text-muted-foreground">{view.jobTitle}</div>
        )}
      </TableCell>
      <TableCell>
        <ClubRosterRoleSelect
          value={view.role}
          ariaLabel={t("adminClubs.columns.role")}
          disabled={rolePending}
          onChange={onRoleChange}
        />
      </TableCell>
      <TableCell>
        <ClubMemberStatusBadge status={view.status} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {formatDateShort(view.joinedAt, language)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm">
        <ClubRosterTenureButton
          expiresAt={view.expiresAt}
          nowMs={nowMs}
          language={language}
          onEdit={onEditTenure}
        />
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          {view.canApprove ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              disabled={rolePending}
              onClick={onApprove}
              aria-label={t("adminClubs.members.approve")}
            >
              <Check className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            disabled={removePending}
            // Dialog aplikacji, nie `window.confirm`: natywne okna zostały
            // świadomie usunięte z panelu, bo nie dają się ostylować ani
            // przetłumaczyć.
            onClick={onRemove}
            aria-label={t("adminClubs.members.removed")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
