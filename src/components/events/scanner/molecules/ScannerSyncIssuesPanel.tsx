// Molekuła: konflikty decyzji offline i skany odrzucone przez bazę.
//
// TO JEST JEDYNY ŚLAD SKANÓW, KTÓRYCH BAZA NIE PRZYJĘŁA. Poświadczenie
// unieważnione w trakcie pracy bez sieci oznacza, że zapisane offline skany
// nigdy nie trafią do dziennika - wcześniej znikały bez słowa. Teraz stoją
// tutaj, z eksportem do pliku (CSV albo JSON) dla organizatora, i znikają
// dopiero po świadomym wyczyszczeniu (z potwierdzeniem).
//
// KONFLIKT MA KIERUNEK. „Wpuszczony bez sieci, serwer odmawia" wymaga reakcji
// organizatora (ktoś wszedł mimo anulowanego zapisu); „odmowa bez sieci, serwer
// by wpuścił" znaczy, że człowiek został odesłany - trzeba go odnaleźć.
import { AlertTriangle, Download, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/lib/appDialogs";
import { uiLang } from "@/lib/i18n/format";
import { formatEventDateTime } from "@/lib/events/timezone";
import type { RejectedScan } from "@/lib/events/scannerOutbox";
import { scanOutcomeKey, scannerErrorMessage } from "@/lib/events/scannerErrors";
import {
  downloadTextFile,
  syncIssuesCsv,
  syncIssuesFileName,
  syncIssuesJson,
  type ConflictKind,
  type ScanConflict,
} from "@/lib/events/scannerSyncIssues";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

ensureScannerI18n();

const KIND_KEY: Record<ConflictKind, string> = {
  admitted_offline: "eventScanner.sync.kinds.admittedOffline",
  denied_offline: "eventScanner.sync.kinds.deniedOffline",
};

export function ScannerSyncIssuesPanel({
  conflicts,
  rejected,
  timezone,
  deviceLabel,
  eventSlug,
  onClear,
}: {
  conflicts: readonly ScanConflict[];
  rejected: readonly RejectedScan[];
  timezone: string | null;
  deviceLabel: string;
  eventSlug: string | null;
  onClear: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  const exportCsv = () => {
    const nowIso = new Date().toISOString();
    const data = syncIssuesCsv(conflicts, rejected, {
      type: t("eventScanner.sync.columns.type"),
      kind: t("eventScanner.sync.columns.kind"),
      scannedAt: t("eventScanner.sync.columns.scannedAt"),
      checkpoint: t("eventScanner.sync.columns.checkpoint"),
      direction: t("eventScanner.sync.columns.direction"),
      offlineOutcome: t("eventScanner.sync.columns.offlineOutcome"),
      serverResult: t("eventScanner.sync.columns.serverResult"),
      person: t("eventScanner.sync.columns.person"),
      registrationId: t("eventScanner.sync.columns.registrationId"),
      code: t("eventScanner.sync.columns.code"),
      reference: t("eventScanner.sync.columns.reference"),
      conflict: t("eventScanner.sync.columns.conflict"),
      rejected: t("eventScanner.sync.columns.rejected"),
    });
    downloadTextFile(syncIssuesFileName(eventSlug, nowIso, "csv"), "text/csv;charset=utf-8", data);
  };

  const exportJson = () => {
    const nowIso = new Date().toISOString();
    const data = syncIssuesJson(conflicts, rejected, {
      deviceLabel,
      eventSlug,
      exportedAt: nowIso,
    });
    downloadTextFile(syncIssuesFileName(eventSlug, nowIso, "json"), "application/json", data);
  };

  const clear = async () => {
    const confirmed = await confirmDialog({
      title: t("eventScanner.sync.clearTitle"),
      description: t("eventScanner.sync.clearDescription"),
      confirmLabel: t("eventScanner.sync.clear"),
      cancelLabel: t("eventScanner.sync.cancel"),
      destructive: true,
    });
    if (confirmed) onClear();
  };

  return (
    <section
      aria-labelledby="scanner-sync-issues-title"
      className="space-y-3 rounded-[6px] border border-destructive/40 bg-destructive/5 p-4"
    >
      <header className="space-y-1">
        <h2
          id="scanner-sync-issues-title"
          className="flex items-center gap-2 text-sm font-semibold text-destructive"
        >
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {t("eventScanner.sync.title")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("eventScanner.sync.hint")}</p>
      </header>

      {conflicts.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            {t("eventScanner.sync.conflicts", { count: conflicts.length })}
          </p>
          <ul className="space-y-1.5 text-xs">
            {conflicts.map((row) => (
              <li key={row.id} className="rounded-[6px] border border-border bg-card px-3 py-2">
                <p className="font-medium text-foreground">{t(KIND_KEY[row.kind])}</p>
                <p className="text-muted-foreground">
                  {[
                    row.personName,
                    formatEventDateTime(row.deviceScannedAt, timezone, lang),
                    `${t(scanOutcomeKey(row.offlineOutcome))} → ${t(scanOutcomeKey(row.serverOutcome))}`,
                  ]
                    .filter((part): part is string => part !== null && part !== "")
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rejected.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            {t("eventScanner.sync.rejected", { count: rejected.length })}
          </p>
          <ul className="space-y-1.5 text-xs">
            {rejected.map((row) => (
              <li
                key={`${row.item.id}-${row.rejectedAt}`}
                className="flex flex-wrap items-center gap-2 rounded-[6px] border border-border bg-card px-3 py-2"
              >
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{row.item.code}</code>
                <span className="text-muted-foreground">
                  {formatEventDateTime(row.item.deviceScannedAt, timezone, lang)}
                </span>
                <span className="text-destructive">{scannerErrorMessage(row.error)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={exportCsv}>
          <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t("eventScanner.sync.exportCsv")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={exportJson}>
          <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t("eventScanner.sync.exportJson")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => void clear()}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t("eventScanner.sync.clear")}
        </Button>
      </div>
    </section>
  );
}
