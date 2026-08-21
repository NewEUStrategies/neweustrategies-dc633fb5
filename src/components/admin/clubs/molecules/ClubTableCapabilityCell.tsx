// Molekuła: JEDNA komórka macierzy uprawnień.
//
// Wyjęta z `organisms/ClubPermissionsTab.tsx` (lokalny `CapabilityCell`).
// Ikona niesie znaczenie, a nie dekorację - i to jest cała odpowiedzialność tej
// molekuły: `yes` zielony ptaszek, `cond` bursztynowe kółko zębate („zależy od
// ustawienia klubu albo grupy"), `no` szary minus. Etykieta tekstowa jedzie
// w `title` ORAZ w `sr-only`, bo tabela dziewięciu kolumn z samymi ikonami jest
// dla czytnika ekranu nieczytelna.
//
// Mapowanie wartości na etykietę bierzemy REKORDEM z `lib/clubs/adminClubPermissions.ts`
// - nie łańcuchem `if`-ów, który nową wartość macierzy pokazywałby jako minus,
// czyli jako „nie wolno".
import { useTranslation } from "react-i18next";
import { Check, Minus, Settings2 } from "lucide-react";
import { CAPABILITY_CELL_LABEL } from "@/lib/clubs/adminClubPermissions";
import type { CapabilityValue } from "@/lib/clubs/capabilityMatrix";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

const ICON: Record<CapabilityValue, typeof Check> = {
  yes: Check,
  cond: Settings2,
  no: Minus,
};

const ICON_CLASS: Record<CapabilityValue, string> = {
  yes: "h-4 w-4 text-emerald-600 dark:text-emerald-400",
  cond: "h-4 w-4 text-amber-600 dark:text-amber-400",
  no: "h-4 w-4 text-muted-foreground/60",
};

export function ClubTableCapabilityCell({ value }: { value: CapabilityValue }) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();
  const label = t(`adminClubs.permissions.value.${CAPABILITY_CELL_LABEL[value]}`);
  const Icon = ICON[value];

  return (
    <span className="inline-flex items-center justify-center" title={label}>
      <Icon className={ICON_CLASS[value]} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
