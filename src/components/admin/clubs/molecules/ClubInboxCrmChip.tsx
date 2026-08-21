// Molekuła: WIDOCZNY stan synchronizacji jednego zgłoszenia z kartoteką CRM.
//
// CO BYŁO W ORGANIZMIE. Lokalny `CrmSyncChip` w `ClubApplicationsInbox`, razem
// z drabinką tonów, wyborem ikony i formatowaniem dwóch różnych dat.
//
// DLACZEGO TA MOLEKUŁA W OGÓLE ISTNIEJE - i to jest reguła, nie ozdoba.
// Cicha porażka synchronizacji jest najgorszym możliwym wynikiem tej ścieżki:
// redakcja widzi zgłoszenie w panelu i ZAKŁADA, że kartoteka w CRM istnieje.
// Ta ścieżka już raz zawiodła na produkcji (`source_type='club_application'`
// złamał CHECK na `crm_leads`), więc każdy wiersz niesie:
//   * stan ostatniej próby (ton + piktogram + nazwa stanu),
//   * DATĘ PRÓBY, nie tylko datę sukcesu - „nigdy nie próbowano” i „próbowano
//     i nie wyszło” to dwa różne stany kartoteki i nie wolno ich zlepiać,
//   * treść błędu z bazy pod kursorem,
//   * przycisk ponowienia - wszędzie poza stanem `ok`.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać stan CRM i oddać żądanie ponowienia.
// Molekuła nie woła mutacji i nie wie, czy ponowienie się udało - o tym mówi
// organizm toastem z `crmRetryToast`.
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClubInboxToneBadge } from "@/components/admin/clubs/atoms/ClubInboxToneBadge";
import { uiLocale } from "@/lib/i18n/format";
import { crmChipView } from "@/lib/clubs/adminApplicationsInbox";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";
import type { ClubApplicationAdminRow, ClubApplicationCrmStatus } from "@/lib/clubs/applyApi";

const ICON: Record<ClubApplicationCrmStatus, typeof CheckCircle2> = {
  ok: CheckCircle2,
  error: AlertTriangle,
  pending: RefreshCw,
};

export function ClubInboxCrmChip({
  row,
  onRetry,
  retrying,
}: {
  row: ClubApplicationAdminRow;
  onRetry: (id: string) => void;
  retrying: boolean;
}) {
  // Klucze `adminClubs.applications.*` żyją w słowniku PANELU - molekuła woła
  // `ensure` sama, bo bywa renderowana z listy, a nie tylko z organizmu.
  ensureAdminClubsI18n();
  const { t, i18n } = useTranslation();
  const locale = uiLocale(i18n.language);
  const view = crmChipView(row);
  const Icon = ICON[view.state];
  // Brak daty przy stanie `ok` (kartoteka jest, znacznika czasu nie ma)
  // pokazuje kreskę - pusty nawias w zdaniu wyglądałby jak brak synchronizacji.
  const when =
    view.detailIso === null
      ? "-"
      : new Date(view.detailIso).toLocaleString(locale, {
          dateStyle: "short",
          timeStyle: "short",
        });
  const detail =
    view.detailKey === "adminClubs.applications.crm.never"
      ? t(view.detailKey)
      : t(view.detailKey, { when });

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <ClubInboxToneBadge tone={view.tone} title={row.crm_error ?? detail}>
        <Icon className="mr-1 h-3 w-3" aria-hidden="true" />
        {t("adminClubs.applications.crm.label")}: {t(`adminClubs.applications.crm.${view.state}`)}
      </ClubInboxToneBadge>
      <span className="text-[11px] text-muted-foreground">{detail}</span>
      {view.canRetry ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={retrying}
          onClick={() => onRetry(row.id)}
        >
          <RefreshCw
            className={`mr-1 h-3 w-3 ${retrying ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {retrying
            ? t("adminClubs.applications.crm.retrying")
            : t("adminClubs.applications.crm.retry")}
        </Button>
      ) : null}
    </span>
  );
}
