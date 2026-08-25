// Organizm-scalający: cała aplikacja skanera.
//
// TRZY STANY, NIE JEDEN EKRAN. Bez poświadczenia widać parowanie; z wygasłym
// poświadczeniem widać dokładnie jedno zdanie i przycisk odłączenia (skanowanie
// nie ma prawa się udać, więc pokazywanie czytnika byłoby okrucieństwem);
// z ważnym poświadczeniem widać tryby, na które to poświadczenie pozwala.
//
// ZAKŁADKI TRYBÓW POCHODZĄ Z ZAKRESÓW, NIE Z KONFIGURACJI. Recepcja dostaje
// „Odprawa", stoisko partnera „Leady", stanowisko druku „Identyfikator" -
// a urządzenie z dwoma zakresami dostaje dwie zakładki. Tryb, którego
// poświadczenie nie niesie, po prostu nie istnieje na ekranie.
//
// PASEK SESJI ZOSTAJE ZAWSZE NA WIERZCHU. Wolontariusz musi widzieć bez
// przewijania: czy jest sieć, ile skanów czeka i ile godzin ważności zostało.
// To są trzy rzeczy, które decydują o tym, czy wolno mu odejść od bramki.
import { useMemo, useState } from "react";
import { LogOut, Signal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { availableModes, hoursUntilExpiry, type ScannerMode } from "@/lib/events/scannerSession";
import { useScannerRuntime } from "@/lib/events/useScanner";
import { ScannerStatusPill } from "@/components/events/scanner/atoms/ScannerStatusPill";
import { ScannerPairingCard } from "@/components/events/scanner/molecules/ScannerPairingCard";
import { ScannerOutboxPanel } from "@/components/events/scanner/molecules/ScannerOutboxPanel";
import { ScannerCheckinPanel } from "@/components/events/scanner/organisms/ScannerCheckinPanel";
import { ScannerLeadPanel } from "@/components/events/scanner/organisms/ScannerLeadPanel";
import { ScannerBadgePanel } from "@/components/events/scanner/organisms/ScannerBadgePanel";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

ensureScannerI18n();

/** Termin, od którego mówimy „wygasa dziś" zamiast liczyć godziny. */
const EXPIRY_WARNING_HOURS = 12;

export function ScannerApp({ initialToken }: { initialToken: string | null }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  // Token z adresu ma pierwszeństwo nad tym z pamięci urządzenia - rozstrzyga
  // to samo środowisko uruchomieniowe, żeby nie było dwóch wywołań `bootstrap`.
  const runtime = useScannerRuntime(initialToken);
  const [mode, setMode] = useState<ScannerMode | null>(null);

  const session = runtime.session;
  const modes = useMemo(() => (session === null ? [] : availableModes(session)), [session]);
  const activeMode = mode !== null && modes.includes(mode) ? mode : (modes[0] ?? null);

  if (session === null || runtime.status !== "ready") {
    if (runtime.status === "expired" && session !== null) {
      return (
        <section className="mx-auto w-full max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold text-foreground">{t("eventScanner.appName")}</h1>
          <p className="rounded-[6px] border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {t("eventScanner.session.expired")}
          </p>
          <Button type="button" variant="secondary" onClick={runtime.disconnect}>
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("eventScanner.session.disconnect")}
          </Button>
        </section>
      );
    }
    return (
      <ScannerPairingCard
        onConnect={runtime.connect}
        connecting={runtime.status === "connecting"}
        error={runtime.connectError}
        online={runtime.online}
      />
    );
  }

  const eventTitle = pickLocalized(
    { title_pl: session.event.titlePl, title_en: session.event.titleEn },
    "title",
    lang,
  );
  const hoursLeft = hoursUntilExpiry(session, new Date().toISOString());

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------ pasek sesji */}
      <header className="sticky top-0 z-10 -mx-4 space-y-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{eventTitle}</p>
            <p className="truncate text-xs text-muted-foreground">
              {t("eventScanner.session.deviceLabel")}: {session.label}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ScannerStatusPill
              online={runtime.online}
              pending={runtime.outboxCounts.pending}
              syncing={runtime.flushing}
            />
            <Button type="button" size="sm" variant="ghost" onClick={runtime.disconnect}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{t("eventScanner.session.disconnect")}</span>
            </Button>
          </div>
        </div>

        {hoursLeft !== null && hoursLeft <= EXPIRY_WARNING_HOURS && (
          <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
            <Signal className="h-3.5 w-3.5" aria-hidden="true" />
            {t("eventScanner.session.expiresSoon")}
          </p>
        )}

        {modes.length > 1 && (
          <nav aria-label={t("eventScanner.appName")} className="flex gap-2">
            {modes.map((item) => (
              <button
                key={item}
                type="button"
                aria-current={item === activeMode}
                onClick={() => setMode(item)}
                className={cn(
                  "flex-1 rounded-[6px] border px-3 py-2 text-sm transition-colors",
                  item === activeMode
                    ? "border-primary bg-primary/10 font-medium text-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                {t(`eventScanner.modes.${item}`)}
              </button>
            ))}
          </nav>
        )}
      </header>

      {/* ------------------------------------------------------------ tryb */}
      {activeMode === "checkin" && <ScannerCheckinPanel runtime={runtime} session={session} />}
      {activeMode === "lead" && <ScannerLeadPanel runtime={runtime} />}
      {activeMode === "badge" && runtime.token !== null && (
        <ScannerBadgePanel deviceToken={runtime.token} session={session} online={runtime.online} />
      )}
      {activeMode === null && (
        <p className="rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t("eventScanner.errors.deviceScopeMissing")}
        </p>
      )}

      {/* -------------------------------------------------------- kolejka */}
      {(runtime.outbox.length > 0 || !runtime.outboxPersistent) && (
        <ScannerOutboxPanel
          outbox={runtime.outbox}
          timezone={session.event.timezone}
          flushing={runtime.flushing}
          persistent={runtime.outboxPersistent}
          onFlush={runtime.flush}
          onDiscard={runtime.discard}
        />
      )}

      <p className="pb-6 text-center text-xs text-muted-foreground">
        <Badge variant="outline">{session.event.slug ?? ""}</Badge>
      </p>
    </div>
  );
}
