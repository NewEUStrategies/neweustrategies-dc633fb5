// Organizm: REJESTR WYDRUKU identyfikatora.
//
// TO NIE JEST DRUKARKA, TYLKO DZIENNIK. `event_badge_print_record` zapisuje,
// KTO i DLACZEGO dostał identyfikator, razem z wersją szablonu - sam wydruk
// wychodzi ze stanowiska drukującego. Rozdzielenie jest celowe: rejestr ma się
// zgadzać nawet wtedy, gdy drukarka zatnie papier, a szablon zmieni się
// w trakcie imprezy.
//
// WYDRUK WYMAGA SIECI I MÓWI O TYM WPROST. Każde wywołanie wstawia NOWY wiersz
// rejestru, więc ponowienie po zgubionej odpowiedzi zostawiłoby ślad wydruku,
// którego nikt nie wydrukował - a to jest dokument rozliczenia z drukarnią.
// Dlatego ten tryb, jako jedyny, nie ma kolejki offline (patrz nagłówek
// `scannerOutbox`).
//
// POWÓD JEST WYBOREM CZŁOWIEKA, NIE DOMYSŁEM. Baza umie zgadnąć („był wydruk
// -> reprint_lost"), ale to zgadywanie psuje statystykę reklamacji. Operator
// wskazuje powód jednym kliknięciem, zanim naciśnie „zapisz".
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BADGE_PRINT_REASONS, type BadgePrintReason } from "@/lib/events/onsiteEnums";
import { recordBadgePrintScan, type BadgePrintScanResult } from "@/lib/events/scannerApi";
import { scannerErrorMessage } from "@/lib/events/scannerErrors";
import type { ScannerSession } from "@/lib/events/scannerSession";
import { ScanOutcomeBanner } from "@/components/events/scanner/atoms/ScanOutcomeBanner";
import { ScanPersonCard } from "@/components/events/scanner/molecules/ScanPersonCard";
import { ScannerCodeInput } from "@/components/events/scanner/molecules/ScannerCodeInput";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

ensureScannerI18n();

const COPIES = [1, 2, 3] as const;

export function ScannerBadgePanel({
  deviceToken,
  session,
  online,
}: {
  deviceToken: string;
  session: ScannerSession;
  online: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<BadgePrintReason>("first_issue");
  const [copies, setCopies] = useState(1);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<BadgePrintScanResult | null>(null);

  const scan = (code: string) => {
    setBusy(true);
    setFailure(null);
    recordBadgePrintScan({ deviceToken, code, reason, copies })
      .then((next) => {
        setBusy(false);
        setResult(next);
        if (next.outcome === "printed") toast.success(t("eventScanner.outcomes.printed"));
      })
      .catch((error: unknown) => {
        setBusy(false);
        setResult(null);
        setFailure(scannerErrorMessage(error));
      });
  };

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-[6px] border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">{t("eventScanner.badge.title")}</h2>

        <div className="space-y-2">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">
            {t("eventScanner.badge.reasonLabel")}
          </span>
          <div className="flex flex-wrap gap-2">
            {BADGE_PRINT_REASONS.map((item) => (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={item === reason ? "secondary" : "outline"}
                aria-pressed={item === reason}
                onClick={() => setReason(item)}
              >
                {t(`eventScanner.badge.reasons.${item}`)}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("eventScanner.badge.copies")}
          </span>
          {COPIES.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={value === copies ? "secondary" : "outline"}
              aria-pressed={value === copies}
              onClick={() => setCopies(value)}
              className="w-10"
            >
              {value}
            </Button>
          ))}
        </div>

        {!online && (
          <p className="rounded-[6px] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            {t("eventScanner.badge.requiresNetwork")}
          </p>
        )}
      </section>

      <ScannerCodeInput onCode={scan} busy={busy} disabled={!online} />

      {failure !== null && (
        <ScanOutcomeBanner
          tone="denied"
          title={t("eventScanner.outcomes.unknown")}
          hint={failure}
        />
      )}

      {result !== null && (
        <div className="space-y-3">
          <ScanOutcomeBanner
            tone={result.outcome === "printed" ? "granted" : "warning"}
            title={
              result.outcome === "printed"
                ? t("eventScanner.outcomes.printed")
                : result.outcome === "wrong_event"
                  ? t("eventScanner.outcomes.wrongEvent")
                  : t("eventScanner.outcomes.unknownCode")
            }
          />

          {result.outcome === "printed" && (
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {t("eventScanner.badge.previousPrints", { count: result.previousPrints })}
              </Badge>
              {result.reason !== null && (
                <Badge variant="secondary">
                  {t(`eventScanner.badge.reasons.${result.reason}`)}
                </Badge>
              )}
            </div>
          )}

          {result.person !== null && (
            <ScanPersonCard person={result.person} timezone={session.event.timezone} />
          )}
        </div>
      )}
    </div>
  );
}
