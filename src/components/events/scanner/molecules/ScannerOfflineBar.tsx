// Molekuła: stan trybu offline w pasku sesji.
//
// OPERATOR MUSI WIEDZIEĆ, NA CZYM STOI, ZANIM STRACI ZASIĘG. Lista offline
// jest tyle warta, ile jest świeża: „1 234 osoby, stan z 9:12" mówi, czy
// wolno jej ufać po godzinie w hali. Do tego dwa sygnały, które wcześniej
// były niewidoczne: sesja podniesiona z pamięci urządzenia (baza jej jeszcze
// nie potwierdziła) i zegar telefonu rozjechany z serwerem (czas skanów jest
// korygowany, ale operator powinien go ustawić).
import { Clock3, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { uiLang } from "@/lib/i18n/format";
import { formatEventDateTime } from "@/lib/events/timezone";
import type { RosterState } from "@/lib/events/scannerRoster";
import type { ScannerRosterInfo } from "@/lib/events/useScanner";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

ensureScannerI18n();

export function ScannerOfflineBar({
  roster,
  state,
  timezone,
  online,
  sessionStale,
  clockOffsetMs,
  clockSkewed,
  onRefresh,
}: {
  roster: ScannerRosterInfo;
  state: RosterState;
  timezone: string | null;
  online: boolean;
  sessionStale: boolean;
  clockOffsetMs: number;
  clockSkewed: boolean;
  onRefresh: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const time =
    roster.generatedAt === null ? "" : formatEventDateTime(roster.generatedAt, timezone, lang);

  let line: string;
  if (state === "disabled") line = t("eventScanner.offline.rosterDisabled");
  else if (state === "none") {
    line = roster.syncing
      ? t("eventScanner.offline.rosterSyncing")
      : t("eventScanner.offline.rosterNone");
  } else if (state === "fresh") {
    line = t("eventScanner.offline.rosterFresh", { count: roster.count, time });
  } else {
    line = t("eventScanner.offline.rosterStale", { count: roster.count, time });
  }

  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <p
          className={
            state === "stale" || state === "none"
              ? "text-amber-700 dark:text-amber-300"
              : "text-muted-foreground"
          }
        >
          {line}
        </p>
        {state !== "disabled" && online && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={onRefresh}
            disabled={roster.syncing}
          >
            <RefreshCw
              className={roster.syncing ? "mr-1.5 h-3.5 w-3.5 animate-spin" : "mr-1.5 h-3.5 w-3.5"}
              aria-hidden="true"
            />
            {t("eventScanner.offline.refresh")}
          </Button>
        )}
      </div>

      {sessionStale && (
        <p className="text-muted-foreground">{t("eventScanner.session.staleSession")}</p>
      )}

      {clockSkewed && (
        <p className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
          <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("eventScanner.session.clockSkew", {
            count: Math.max(1, Math.round(Math.abs(clockOffsetMs) / 60_000)),
          })}
        </p>
      )}
    </div>
  );
}
