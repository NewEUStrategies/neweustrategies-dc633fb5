// Organizm: ODPRAWA na punkcie kontrolnym.
//
// PUNKT I KIERUNEK STOJĄ NAD CZYTNIKIEM, NIE W USTAWIENIACH. Wolontariusz
// przenosi się między wejściem a salą w trakcie zmiany; ukrycie tego wyboru
// pod ikoną koła zębatego gwarantuje serię odpraw zapisanych w złym miejscu.
// Gdy poświadczenie ma punkt PRZYPIĘTY, wyboru nie ma wcale - baza i tak
// odmówi zmiany, więc pokazywanie przełącznika byłoby zaproszeniem do błędu.
//
// WYNIK ZOSTAJE NA EKRANIE DO NASTĘPNEGO SKANU. Znikające powiadomienie jest
// bezużyteczne przy bramce: operator patrzy najpierw na człowieka, potem na
// ekran. Dlatego wynik jest treścią strony, a nie „toastem".
//
// DECYZJĘ PODEJMUJE BAZA. `admit` przychodzi z `_event_checkin_write` razem
// z trybem punktu (`control` odmawia, `track` tylko liczy) - ekran go nie
// przelicza, bo dwa różne rachunki dałyby dwie różne odpowiedzi w tej samej
// sekundzie.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { formatEventDateTime } from "@/lib/events/timezone";
import type { CheckinDirection } from "@/lib/events/onsiteEnums";
import type { CheckinScanResult } from "@/lib/events/scannerApi";
import {
  checkpointDirections,
  findCheckpoint,
  type ScannerSession,
} from "@/lib/events/scannerSession";
import { scanOutcomeKey, scannerErrorMessage } from "@/lib/events/scannerErrors";
import type { ScannerRuntime } from "@/lib/events/useScanner";
import {
  ScanOutcomeBanner,
  type ScanTone,
} from "@/components/events/scanner/atoms/ScanOutcomeBanner";
import { ScanPersonCard } from "@/components/events/scanner/molecules/ScanPersonCard";
import { ScannerCodeInput } from "@/components/events/scanner/molecules/ScannerCodeInput";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

ensureScannerI18n();

function toneOf(result: CheckinScanResult): ScanTone {
  if (result.admit && result.outcome === "repeat") return "warning";
  if (result.admit) return "granted";
  if (result.outcome === "unknown_code" || result.outcome === "wrong_event") return "warning";
  return "denied";
}

function camel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}

export function ScannerCheckinPanel({
  runtime,
  session,
}: {
  runtime: ScannerRuntime;
  session: ScannerSession;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  const pinned = session.pinnedCheckpointId;
  const [checkpointId, setCheckpointId] = useState<string | null>(
    pinned ?? session.checkpoints[0]?.id ?? null,
  );
  const checkpoint = findCheckpoint(session, checkpointId);
  const directions = checkpointDirections(checkpoint);
  const [direction, setDirection] = useState<CheckinDirection>(directions[0]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckinScanResult | null>(null);
  const [queued, setQueued] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const activeDirection = directions.includes(direction) ? direction : directions[0];

  const scan = (code: string) => {
    setBusy(true);
    setFailure(null);
    runtime
      .submitCheckin({ code, checkpointId, direction: activeDirection })
      .then((outcome) => {
        setBusy(false);
        if (outcome.queued) {
          setResult(null);
          setQueued(true);
          toast.info(t("eventScanner.outbox.queuedToast"));
          return;
        }
        setQueued(false);
        setResult(outcome.result);
        if (outcome.result.deviceLocked) {
          toast.error(scannerErrorMessage("device_locked: too many unknown codes"));
        }
      })
      .catch((error: unknown) => {
        setBusy(false);
        setResult(null);
        setQueued(false);
        setFailure(scannerErrorMessage(error));
      });
  };

  const outcomeHintKey =
    result === null ? null : `eventScanner.outcomeHints.${camel(result.outcome)}`;
  const otherEventTitle =
    result === null
      ? ""
      : pickLocalized(
          { title_pl: result.otherEventTitlePl, title_en: result.otherEventTitleEn },
          "title",
          lang,
        );

  return (
    <div className="space-y-4">
      {/* --------------------------------------------------- punkt i kierunek */}
      <section className="space-y-3 rounded-[6px] border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("eventScanner.checkpoint.label")}
          </span>
          {pinned !== null && (
            <Badge variant="secondary">{t("eventScanner.checkpoint.pinned")}</Badge>
          )}
        </div>

        {session.checkpoints.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("eventScanner.checkpoint.none")}</p>
        ) : pinned !== null ? (
          <p className="text-base font-medium text-foreground">
            {pickLocalized(
              { name_pl: checkpoint?.namePl ?? null, name_en: checkpoint?.nameEn ?? null },
              "name",
              lang,
            )}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {session.checkpoints.map((item) => (
              <Button
                key={item.id}
                type="button"
                size="sm"
                variant={item.id === checkpointId ? "secondary" : "outline"}
                onClick={() => setCheckpointId(item.id)}
              >
                {pickLocalized({ name_pl: item.namePl, name_en: item.nameEn }, "name", lang)}
              </Button>
            ))}
          </div>
        )}

        {directions.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("eventScanner.directions.label")}
            </span>
            {directions.map((item) => (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={item === activeDirection ? "secondary" : "outline"}
                onClick={() => setDirection(item)}
              >
                {t(`eventScanner.directions.${item}`)}
              </Button>
            ))}
          </div>
        )}

        {checkpoint !== null && (
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {checkpoint.accessMode === "track" && (
              <span>{t("eventScanner.checkpoint.trackMode")}</span>
            )}
            {checkpoint.capacity !== null && (
              <span>{t("eventScanner.checkpoint.capacity", { count: checkpoint.capacity })}</span>
            )}
            {checkpoint.dedupeWindowSeconds > 0 && (
              <span>
                {t("eventScanner.checkpoint.dedupeWindow", {
                  count: checkpoint.dedupeWindowSeconds,
                })}
              </span>
            )}
          </div>
        )}
      </section>

      {/* ----------------------------------------------------------- czytnik */}
      <ScannerCodeInput
        onCode={scan}
        busy={busy}
        disabled={session.checkpoints.length === 0 || checkpointId === null}
      />

      {/* ------------------------------------------------------------ wynik */}
      {failure !== null && (
        <ScanOutcomeBanner
          tone="denied"
          title={t("eventScanner.outcomes.unknown")}
          hint={failure}
        />
      )}

      {queued && (
        <ScanOutcomeBanner
          tone="neutral"
          title={t("eventScanner.outcomes.saved")}
          hint={t("eventScanner.errors.offline")}
        />
      )}

      {result !== null && (
        <div className="space-y-3">
          <ScanOutcomeBanner
            tone={toneOf(result)}
            title={t(scanOutcomeKey(result.outcome))}
            hint={
              result.outcome === "wrong_event" && otherEventTitle !== ""
                ? t("eventScanner.outcomeHints.wrongEvent", { event: otherEventTitle })
                : outcomeHintKey !== null && i18n.exists(outcomeHintKey)
                  ? t(outcomeHintKey)
                  : null
            }
          />

          {result.previousCheckinAt !== null && (
            <p className="text-xs text-muted-foreground">
              {t("eventScanner.outcomeHints.previousCheckin", {
                when: formatEventDateTime(result.previousCheckinAt, session.event.timezone, lang),
              })}
            </p>
          )}

          {result.checkpoint.occupancy !== null && (
            <p className={cn("text-xs", "text-muted-foreground")}>
              {t("eventScanner.checkpoint.occupancy", { count: result.checkpoint.occupancy })}
            </p>
          )}

          {result.person !== null && (
            <ScanPersonCard person={result.person} timezone={session.event.timezone} />
          )}
        </div>
      )}
    </div>
  );
}
