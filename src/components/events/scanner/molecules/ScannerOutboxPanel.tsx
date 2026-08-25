// Molekuła: kolejka skanów czekających na sieć.
//
// KOLEJKA MUSI BYĆ WIDOCZNA, ŻEBY BYŁA UCZCIWA. Skaner, który po cichu
// odkłada skany, jest gorszy od takiego, który odmawia: operator kończy zmianę,
// odłącza urządzenie i dowiaduje się o stracie tydzień później. Dlatego liczba
// stoi w pasku, a szczegóły - w tym panelu.
//
// „WYMAGA UWAGI" TO OSOBNA KATEGORIA. Pozycja po ośmiu nieudanych próbach nie
// jest już ponawiana; udawanie, że nadal „czeka", byłoby kłamstwem. Operator
// może ją pokazać organizatorowi albo świadomie usunąć.
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { uiLang } from "@/lib/i18n/format";
import { formatEventDateTime } from "@/lib/events/timezone";
import { stuckItems, type OutboxItem } from "@/lib/events/scannerOutbox";
import { scannerErrorMessage } from "@/lib/events/scannerErrors";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

ensureScannerI18n();

export function ScannerOutboxPanel({
  outbox,
  timezone,
  flushing,
  persistent,
  onFlush,
  onDiscard,
}: {
  outbox: readonly OutboxItem[];
  timezone: string | null;
  flushing: boolean;
  persistent: boolean;
  onFlush: () => void;
  onDiscard: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const stuck = stuckItems(outbox);
  const pending = outbox.length - stuck.length;

  return (
    <section className="space-y-3 rounded-[6px] border border-border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t("eventScanner.outbox.title")}</h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={outbox.length === 0 || flushing}
          onClick={onFlush}
        >
          <RefreshCw
            className={flushing ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"}
            aria-hidden="true"
          />
          {flushing ? t("eventScanner.outbox.syncing") : t("eventScanner.outbox.sync")}
        </Button>
      </header>

      {!persistent && (
        <p className="rounded-[6px] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {t("eventScanner.session.memoryOnly")}
        </p>
      )}

      {outbox.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("eventScanner.outbox.empty")}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t("eventScanner.outbox.pending", { count: pending })}
          </p>

          {stuck.length > 0 && (
            <div className="space-y-2 rounded-[6px] border border-destructive/40 bg-destructive/5 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {t("eventScanner.outbox.stuck", { count: stuck.length })}
              </p>
              <p className="text-xs text-muted-foreground">{t("eventScanner.outbox.stuckHint")}</p>
              <ul className="space-y-2">
                {stuck.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{item.code}</code>
                    <span className="text-muted-foreground">
                      {formatEventDateTime(item.deviceScannedAt, timezone, lang)}
                    </span>
                    {item.lastError !== null && (
                      <span className="text-destructive">
                        {scannerErrorMessage(item.lastError)}
                      </span>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => onDiscard(item.id)}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      {t("eventScanner.outbox.discard")}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
