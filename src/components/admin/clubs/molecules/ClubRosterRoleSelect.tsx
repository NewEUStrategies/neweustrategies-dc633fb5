// Molekuła: droplista ROLI W KLUBIE nad słownikiem `CLUB_MEMBER_ROLES`.
//
// CO BYŁA W ORGANIZMIE. `ClubMembersTab` miał trzy egzemplarze tej samej
// dropListy: w wierszu tabeli, w karcie mobilnej i w pasku operacji masowych.
// Dwa pierwsze siedziały w lokalnym komponencie `RoleSelect` na dole pliku,
// trzeci był wpisany wprost w JSX paska - z osobnym zawężeniem wartości
// (`asRole(v)`). Trzy kopie jednej kontrolki to trzy miejsca, w których
// droplista może rozjechać się z CHECK-iem po dodaniu roli w migracji.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać wszystkie role słownika i oddać rodzicowi
// wartość JUŻ ZAWĘŻONĄ do typu - Radix oddaje `string`, a mutacja przyjmuje
// `ClubMemberRole`, więc zawężenie musi zapaść dokładnie raz i tutaj.
//
// Świadomie NIE różni się od `ClubEnumSelect`: tamten składa etykietę
// z prefiksu i nie zna typu roli, więc każdy konsument sam zawężałby wynik.
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toAdminMemberRole } from "@/lib/clubs/adminMemberRoster";
import { CLUB_MEMBER_ROLES, type ClubMemberRole } from "@/lib/clubs/types";

export function ClubRosterRoleSelect({
  value,
  ariaLabel,
  disabled,
  className,
  onChange,
}: {
  value: ClubMemberRole;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  onChange: (role: ClubMemberRole) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(toAdminMemberRole(next))}
    >
      <SelectTrigger className={className ?? "h-8 w-full"} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CLUB_MEMBER_ROLES.map((role) => (
          <SelectItem key={role} value={role}>
            {t(`club.role.${role}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
