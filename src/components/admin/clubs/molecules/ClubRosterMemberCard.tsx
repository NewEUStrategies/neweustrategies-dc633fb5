// Molekuła: KARTA składu (poniżej `lg`) - te same operacje, układ pionowy.
//
// CO BYŁA W ORGANIZMIE. Drugi przebieg `rows.map()` w tym samym pliku, z tymi
// samymi sześcioma handlerami wpisanymi po raz drugi. Tabela z sześcioma
// kolumnami scrollowała się w poziomie, przez co droplista roli i kosz
// lądowały poza ekranem telefonu - karta istnieje po to, żeby operacje
// zostały OSIĄGALNE, a nie żeby wyglądały inaczej.
//
// JEDNA ODPOWIEDZIALNOŚĆ i JEDEN KONTRAKT z wierszem tabeli
// (`ClubRosterMemberProps`) - dzięki temu operacja dodana w jednym wariancie
// nie da się zapomnieć w drugim.
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
import { ClubMemberStatusBadge } from "../atoms/ClubBadges";
import { ClubRosterRoleSelect } from "./ClubRosterRoleSelect";
import { ClubRosterTenureButton } from "./ClubRosterTenureButton";
import type { ClubRosterMemberProps } from "./ClubRosterMemberRow";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubRosterMemberCard({
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
    <li className="rounded-lg border border-border/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <Checkbox
            className="mt-0.5"
            checked={selected}
            onCheckedChange={onToggle}
            aria-label={view.displayName}
          />
          <div className="min-w-0">
            <p className="truncate font-medium">{view.displayName}</p>
            {view.jobTitle === null ? null : (
              <p className="truncate text-xs text-muted-foreground">{view.jobTitle}</p>
            )}
          </div>
        </div>
        <ClubMemberStatusBadge status={view.status} />
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <ClubRosterRoleSelect
          value={view.role}
          ariaLabel={t("adminClubs.columns.role")}
          disabled={rolePending}
          onChange={onRoleChange}
        />
        <div className="flex items-center text-sm">
          <ClubRosterTenureButton
            expiresAt={view.expiresAt}
            nowMs={nowMs}
            language={language}
            onEdit={onEditTenure}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1 border-t border-border/60 pt-2">
        {view.canApprove ? (
          <Button size="sm" className="h-8" disabled={rolePending} onClick={onApprove}>
            <Check className="mr-1.5 h-3.5 w-3.5" />
            {t("adminClubs.members.approve")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-destructive"
          disabled={removePending}
          onClick={onRemove}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          {t("common.delete")}
        </Button>
      </div>
    </li>
  );
}
