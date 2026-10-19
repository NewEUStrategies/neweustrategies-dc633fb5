// Molekuła: „ta część huba nie jest dla Twojej roli" - zamiast treści, którą
// baza i tak zostawiłaby pustą (SPEC §2.5).
//
// DLACZEGO POWIADOMIENIE, A NIE PUSTA ZAKŁADKA. Polityki huba pytają
// o dokładną rolę (`has_role(…, 'admin')`, `is_admin_or_editor()`), więc
// autor albo redaktor na zakładce Przychód dostałby zera bez błędu - 0 MRR
// wygląda jak prawdziwy brak przychodu i wysyła w pościg za awarią, której
// nie ma. Powiadomienie mówi wprost, kto widzi tę część i co zrobić.
//
// `role="status"` + `data-testid="revenue-role-gate"` to kontrakt I0
// (`adminRevenueHubRoutes.test.tsx`): komunikat pojawia się w miejscu treści
// po nawigacji, więc czytnik ma go ogłosić bez szukania. Dwa warianty:
//   * `admin_or_editor` - hub w ogóle (autor, sam `super_admin`) - tekst
//     rdzenia I0 `adminRevenue.common.roleGate`;
//   * `admin` - zakładka tylko dla administratora (Przychód, Retencja, Dane
//     wejściowe), na którą redaktor wszedł z adresu.
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ensureI18n as ensureRevenueI18n } from "@/lib/i18n-admin-revenue";
import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";

export type HubRequiredRole = "admin" | "admin_or_editor";

const MESSAGE_KEY: Readonly<Record<HubRequiredRole, string>> = {
  admin: "adminRevenue.role.adminOnlyTab",
  admin_or_editor: "adminRevenue.common.roleGate",
};

const ROLE_KEY: Readonly<Record<HubRequiredRole, string>> = {
  admin: "adminRevenue.role.admin",
  admin_or_editor: "adminRevenue.role.adminOrEditor",
};

export interface RoleGateNoticeProps {
  requiredRole: HubRequiredRole;
}

export function RoleGateNotice({ requiredRole }: RoleGateNoticeProps) {
  ensureRevenueI18n();
  ensureI18n();
  const { t } = useTranslation();

  return (
    <div
      role="status"
      data-testid="revenue-role-gate"
      data-required-role={requiredRole}
      className="flex items-start gap-2 rounded-[6px] border border-border bg-muted/30 p-3 text-sm text-muted-foreground"
    >
      <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="m-0">{t(MESSAGE_KEY[requiredRole])}</p>
        <p className="m-0 text-xs">{t(ROLE_KEY[requiredRole])}</p>
      </div>
    </div>
  );
}
