// Molekuła: „potrzebny drugi składnik logowania" - Ścieżki komunikacji i tor
// Sprzedaż w Lejku czytają dane kontaktów z CRM, a te wymagają sesji `aal2`
// (`requireCrmStaff`, SPEC §2.5).
//
// DLACZEGO OSOBNY KOMUNIKAT, A NIE BŁĄD ZAPYTANIA. Bez `aal2` serwer odmawia
// i zakładka pokazałaby ogólny błąd odczytu - admin nie wiedziałby, że
// wystarczy włączyć MFA. Tu mówimy, czego brakuje, DLACZEGO (dane osobowe
// kontaktów) i dajemy jeden przycisk do miejsca, gdzie to się włącza
// (`/profile/security`).
//
// Ikona `ShieldCheck` z zamkniętej listy huba (SPEC §6.8) jest dekoracją;
// treść niesie tytuł i zdanie. `role="status"` - komunikat zastępuje treść
// zakładki po nawigacji, więc czytnik ma go ogłosić sam.
import { useId } from "react";
import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";

export function MfaRequiredNotice() {
  ensureI18n();
  const { t } = useTranslation();
  const titleId = useId();

  return (
    <div
      role="status"
      aria-labelledby={titleId}
      data-testid="revenue-mfa-required"
      className="space-y-2 rounded-[6px] border border-border bg-muted/30 p-4"
    >
      <p id={titleId} className="m-0 flex items-center gap-2 text-sm font-semibold text-foreground">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t("adminRevenue.mfaTitle")}
      </p>
      <p className="m-0 text-sm text-muted-foreground">{t("adminRevenue.mfaBody")}</p>
      <Button asChild size="sm" className="h-7">
        <Link to="/profile/security">{t("adminRevenue.mfaAction")}</Link>
      </Button>
    </div>
  );
}
