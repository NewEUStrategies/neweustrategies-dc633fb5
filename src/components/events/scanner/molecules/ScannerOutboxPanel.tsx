// Molekuła: kolejka skanów czekających na sieć.
//
// KOLEJKA MUSI BYĆ WIDOCZNA, ŻEBY BYŁA UCZCIWA. Skaner, który po cichu
// odkłada skany, jest gorszy od takiego, który odmawia: operator kończy zmianę,
// odłącza urządzenie i dowiaduje się o stracie tydzień później. Dlatego liczba
// stoi w pasku, a szczegóły - w tym panelu.
//
// „PONÓW" ZAMIAST „USUŃ" (OPS-05). Awaria przejściowa nie prowadzi już do
// „wymaga uwagi": pozycja, której ostatnia próba się nie udała, stoi w sekcji
// „czeka na ponowienie" z powodem i przyciskiem „Ponów" (a nad listą „Ponów
// wszystkie"). Skaner ponawia sam, ale operator, który właśnie wyszedł z windy,
// nie musi czekać minuty. „Wymaga uwagi" to wyłącznie odmowa bazy, której
// lista do wyjaśnienia nie zapisała na urządzeniu.
//
// USUNIĘCIE PYTA. Usunięty skan to obecność, której nie będzie w dzienniku,
// albo lead, którego partner nie dostanie - przycisk otwiera potwierdzenie.
//
// KOD WIDAĆ TYLKO Z POCZĄTKU (OPS-06). Ekran pokazuje kilka pierwszych znaków
// kodu z biletu - tyle wystarczy, żeby skojarzyć skan z osobą, a zrzut ekranu
// nie niesie poświadczenia wejścia.
//
// POWÓD MÓWI, CO SIĘ DZIEJE. Awaria transportu (termin żądania, `Failed to
// fetch`, brama 5xx) nie ma głowy `kod:`, więc słownik odmów dałby „coś nie
// zadziałało" - przy pozycji, która za chwilę wyjedzie sama. Operator widzi
// zamiast tego zdanie „brak sieci, skan czeka" - to samo, co przy skanie na żywo.
import { AlertTriangle, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/lib/appDialogs";
import { uiLang } from "@/lib/i18n/format";
import { formatEventDateTime } from "@/lib/events/timezone";
import { retryingItems, stuckItems, type OutboxItem } from "@/lib/events/scannerOutbox";
import { codePrefixOf } from "@/lib/events/scannerVault";
import { scanErrorKind } from "@/lib/events/scannerErrorKind";
import { scannerErrorMessage } from "@/lib/events/scannerErrors";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

ensureScannerI18n();

function prefixOf(item: OutboxItem): string {
  return item.codePrefix ?? (item.code === "" ? "" : codePrefixOf(item.code));
}

/** Zdanie powodu porażki - awaria transportu to „brak sieci", nie „coś nie zadziałało". */
function failureReason(lastError: string): string {
  return scannerErrorMessage(scanErrorKind(lastError) === "transport" ? "offline:" : lastError);
}

function OutboxRow({
  item,
  timezone,
  lang,
  onRetry,
  onDiscard,
}: {
  item: OutboxItem;
  timezone: string | null;
  lang: ReturnType<typeof uiLang>;
  onRetry?: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const { t } = useTranslation();
  const prefix = prefixOf(item);
  return (
    <li className="flex flex-wrap items-center gap-2 text-xs">
      {prefix !== "" && (
        <code
          className="rounded bg-muted px-1.5 py-0.5 font-mono"
          title={t("eventScanner.outbox.codePrefix", { prefix })}
        >
          {`${prefix}…`}
        </code>
      )}
      <span className="text-muted-foreground">
        {formatEventDateTime(item.deviceScannedAt, timezone, lang)}
      </span>
      {item.lastError !== null && (
        <span className="text-destructive">{failureReason(item.lastError)}</span>
      )}
      <span className="ml-auto flex gap-1">
        {onRetry !== undefined && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onRetry(item.id)}>
            <RotateCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t("eventScanner.outbox.retry")}
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={() => onDiscard(item.id)}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t("eventScanner.outbox.discard")}
        </Button>
      </span>
    </li>
  );
}

export function ScannerOutboxPanel({
  outbox,
  timezone,
  flushing,
  persistent,
  onFlush,
  onRetry,
  onRetryAll,
  onDiscard,
}: {
  outbox: readonly OutboxItem[];
  timezone: string | null;
  flushing: boolean;
  persistent: boolean;
  onFlush: () => void;
  onRetry: (id: string) => void;
  onRetryAll: () => void;
  onDiscard: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const stuck = stuckItems(outbox);
  const retrying = retryingItems(outbox);
  const pending = outbox.length - stuck.length;

  const discard = async (id: string) => {
    const confirmed = await confirmDialog({
      title: t("eventScanner.outbox.discardTitle"),
      description: t("eventScanner.outbox.discardDescription"),
      confirmLabel: t("eventScanner.outbox.discard"),
      cancelLabel: t("eventScanner.outbox.discardCancel"),
      destructive: true,
    });
    if (confirmed) onDiscard(id);
  };

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
        <p className="rounded-[6px] border border-brand/40 bg-brand/10 px-3 py-2 text-xs text-brand-ink dark:text-brand">
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

          {retrying.length > 0 && (
            <div className="space-y-2 rounded-[6px] border border-border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">
                  {t("eventScanner.outbox.retrying", { count: retrying.length })}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={flushing}
                  onClick={onRetryAll}
                >
                  <RotateCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {t("eventScanner.outbox.retryAll")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("eventScanner.outbox.retryingHint")}
              </p>
              <ul className="space-y-2">
                {retrying.map((item) => (
                  <OutboxRow
                    key={item.id}
                    item={item}
                    timezone={timezone}
                    lang={lang}
                    onRetry={onRetry}
                    onDiscard={(id) => void discard(id)}
                  />
                ))}
              </ul>
            </div>
          )}

          {stuck.length > 0 && (
            <div className="space-y-2 rounded-[6px] border border-destructive/40 bg-destructive/5 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {t("eventScanner.outbox.stuck", { count: stuck.length })}
              </p>
              <p className="text-xs text-muted-foreground">{t("eventScanner.outbox.stuckHint")}</p>
              <ul className="space-y-2">
                {stuck.map((item) => (
                  <OutboxRow
                    key={item.id}
                    item={item}
                    timezone={timezone}
                    lang={lang}
                    onDiscard={(id) => void discard(id)}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
