// Molekuła: karta gotowości do pracy bez sieci.
//
// CZTERY WARUNKI, KAŻDY Z ODPOWIEDZIĄ. Skaner przeżyje utratę zasięgu tylko
// wtedy, gdy: aplikacja jest zapisana na urządzeniu (Service Worker), lista
// offline jest świeża, kolejka zapisuje się na urządzeniu (IndexedDB),
// a przeglądarka nie wyczyści danych przy braku miejsca. Zielone warunki nie
// wymagają uwagi; bursztynowe mówią, co zrobić - i dla trwałego przechowywania
// dają przycisk, bo przeglądarka pyta o nie dopiero na gest człowieka.
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { RosterState } from "@/lib/events/scannerRoster";
import type { ScannerReadiness } from "@/lib/events/useScannerReadiness";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

ensureScannerI18n();

function Check({ ok, label }: { ok: boolean; label: string }) {
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <li
      className={
        ok
          ? "flex items-start gap-2 text-foreground"
          : "flex items-start gap-2 text-amber-700 dark:text-amber-300"
      }
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </li>
  );
}

export function ScannerReadinessCard({
  readiness,
  rosterState,
  queuePersistent,
}: {
  readiness: ScannerReadiness;
  rosterState: RosterState;
  queuePersistent: boolean;
}) {
  const { t } = useTranslation();

  const shellLabel =
    readiness.shell === "ready"
      ? t("eventScanner.readiness.shellReady")
      : readiness.shell === "partial"
        ? t("eventScanner.readiness.shellPartial", {
            cached: readiness.precache?.cached ?? 0,
            total: readiness.precache?.total ?? 0,
          })
        : readiness.shell === "checking"
          ? t("eventScanner.readiness.shellChecking")
          : t("eventScanner.readiness.shellMissing");

  const rosterLabel =
    rosterState === "fresh"
      ? t("eventScanner.readiness.rosterReady")
      : rosterState === "disabled"
        ? t("eventScanner.readiness.rosterDisabled")
        : t("eventScanner.readiness.rosterNotReady");

  const storageLabel =
    readiness.storagePersisted === true
      ? t("eventScanner.readiness.storagePersisted")
      : readiness.storagePersisted === false
        ? t("eventScanner.readiness.storageNotPersisted")
        : t("eventScanner.readiness.storageUnknown");

  return (
    <section
      aria-labelledby="scanner-readiness-title"
      className="space-y-3 rounded-[6px] border border-border bg-card p-4"
    >
      <h2 id="scanner-readiness-title" className="text-sm font-semibold text-foreground">
        {t("eventScanner.readiness.title")}
      </h2>
      <ul className="space-y-1.5 text-sm">
        <Check ok={readiness.shell === "ready"} label={shellLabel} />
        <Check ok={rosterState === "fresh"} label={rosterLabel} />
        <Check
          ok={queuePersistent}
          label={
            queuePersistent
              ? t("eventScanner.readiness.queuePersistent")
              : t("eventScanner.readiness.queueMemoryOnly")
          }
        />
        <Check ok={readiness.storagePersisted === true} label={storageLabel} />
      </ul>

      {readiness.storagePersisted === false && (
        <Button type="button" size="sm" variant="outline" onClick={readiness.requestPersist}>
          {t("eventScanner.readiness.requestPersist")}
        </Button>
      )}
      {readiness.persistRequest !== null && (
        <p role="status" className="text-xs text-muted-foreground">
          {readiness.persistRequest
            ? t("eventScanner.readiness.persistGranted")
            : t("eventScanner.readiness.persistDenied")}
        </p>
      )}
    </section>
  );
}
