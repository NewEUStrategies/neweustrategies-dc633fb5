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
// Tryb offline dokłada do paska stan listy offline (ile osób, z kiedy),
// sesję z pamięci urządzenia i ostrzeżenie o rozjechanym zegarze.
//
// LISTA DO WYJAŚNIENIA WIDAĆ W KAŻDYM STANIE. Konflikty i odrzucone skany
// zostają po unieważnieniu poświadczenia - dlatego panel stoi także na ekranie
// parowania i na ekranie „wygasło", a nie tylko przy działającej sesji.
//
// ODŁĄCZENIE PYTA, GDY JEST CO STRACIĆ (OPS-06). Odłączenie kasuje z telefonu
// token, kolejkę, listę osób i listę do wyjaśnienia. Gdy coś nie zostało
// wysłane albo przekazane organizatorowi, ekran najpierw o tym mówi.
//
// STARY LINK I NOWY ADRES. Link parowania w starym formacie (`?t=`) nie paruje
// urządzenia - ekran mówi, że trzeba nowego kodu QR (OPS-07). Skaner pod
// originem portalu, gdy wdrożenie ma osobny origin skanera, pokazuje baner
// z przyciskiem przeniesienia - aktywnym, gdy kolejka jest pusta (OPS-13).
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, LogOut, Signal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/lib/appDialogs";
import { cn } from "@/lib/utils";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { availableModes, hoursUntilExpiry, type ScannerMode } from "@/lib/events/scannerSession";
import { scannerUrl, type ScannerNotice } from "@/lib/events/scannerLink";
import { rosterState } from "@/lib/events/scannerRoster";
import { useScannerRuntime } from "@/lib/events/useScanner";
import { useScannerReadiness } from "@/lib/events/useScannerReadiness";
import { useNowMs } from "@/lib/time/useNowMs";
import { ScannerStatusPill } from "@/components/events/scanner/atoms/ScannerStatusPill";
import { ScannerPairingCard } from "@/components/events/scanner/molecules/ScannerPairingCard";
import { ScannerOutboxPanel } from "@/components/events/scanner/molecules/ScannerOutboxPanel";
import { ScannerOfflineBar } from "@/components/events/scanner/molecules/ScannerOfflineBar";
import { ScannerReadinessCard } from "@/components/events/scanner/molecules/ScannerReadinessCard";
import { ScannerSyncIssuesPanel } from "@/components/events/scanner/molecules/ScannerSyncIssuesPanel";
import { ScannerCheckinPanel } from "@/components/events/scanner/organisms/ScannerCheckinPanel";
import { ScannerLeadPanel } from "@/components/events/scanner/organisms/ScannerLeadPanel";
import { ScannerBadgePanel } from "@/components/events/scanner/organisms/ScannerBadgePanel";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

ensureScannerI18n();

/** Termin, od którego mówimy „wygasa dziś" zamiast liczyć godziny. */
const EXPIRY_WARNING_HOURS = 12;

export function ScannerApp({
  initialToken,
  notice = null,
  relocateTo = null,
}: {
  initialToken: string | null;
  /** Komunikat z adresu (stary link `?t=`). */
  notice?: ScannerNotice | null;
  /** Origin skanera, pod który to urządzenie ma się przenieść (OPS-13). */
  relocateTo?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  // Token z adresu ma pierwszeństwo nad tym z pamięci urządzenia - rozstrzyga
  // to samo środowisko uruchomieniowe, żeby nie było dwóch wywołań `bootstrap`.
  const runtime = useScannerRuntime(initialToken);
  const [mode, setMode] = useState<ScannerMode | null>(null);
  const [relocating, setRelocating] = useState(false);

  /** Coś, czego odłączenie nie może skasować bez pytania. */
  const holdsWork =
    runtime.outbox.length > 0 || runtime.rejected.length > 0 || runtime.conflicts.length > 0;

  /** `true` = urządzenie odłączone (po zgodzie, gdy było co stracić). */
  const disconnect = async (): Promise<boolean> => {
    if (holdsWork) {
      const confirmed = await confirmDialog({
        title: t("eventScanner.session.disconnectTitle"),
        description: t("eventScanner.session.disconnectUnsent"),
        confirmLabel: t("eventScanner.session.disconnectConfirm"),
        cancelLabel: t("eventScanner.session.disconnectCancel"),
        destructive: true,
      });
      if (!confirmed) return false;
    }
    await runtime.disconnect();
    return true;
  };

  /** Przeniesienie pod origin skanera: token jedzie we fragmencie, tu nic nie zostaje. */
  const relocate = async () => {
    if (relocateTo === null) return;
    const token = runtime.token;
    setRelocating(true);
    if (!(await disconnect())) {
      setRelocating(false);
      return;
    }
    window.location.replace(scannerUrl(relocateTo, { token }));
  };

  const banners = (
    <>
      {notice === "legacy_link" && (
        <p
          role="alert"
          className="rounded-[6px] border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {t("eventScanner.pairing.legacyLink")}
        </p>
      )}
      {relocateTo !== null && (
        <div className="space-y-2 rounded-[6px] border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand-ink dark:text-brand">
          <p>{t("eventScanner.session.relocation", { origin: relocateTo })}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={runtime.outbox.length > 0 || relocating}
            onClick={() => void relocate()}
          >
            <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("eventScanner.session.relocate")}
          </Button>
        </div>
      )}
    </>
  );

  const session = runtime.session;
  const modes = useMemo(() => (session === null ? [] : availableModes(session)), [session]);
  const activeMode = mode !== null && modes.includes(mode) ? mode : (modes[0] ?? null);
  const nowMs = useNowMs(30_000);
  const listState = rosterState({
    enabled: runtime.roster.enabled,
    generatedAt: runtime.roster.generatedAt,
    nowMs,
  });
  const readiness = useScannerReadiness(runtime.status === "ready" && !runtime.sessionStale);

  // Wynik wysyłki kolejki - jedno zdanie o tym, co wyszło, i osobne o tym,
  // co wymaga uwagi (konflikty, odrzucone).
  const lastFlush = runtime.lastFlush;
  useEffect(() => {
    if (lastFlush === null) return;
    if (lastFlush.sent > 0) {
      toast.success(t("eventScanner.outbox.flushedToast", { count: lastFlush.sent }));
    }
    if (lastFlush.conflicts > 0) {
      toast.warning(t("eventScanner.sync.flushedConflicts", { count: lastFlush.conflicts }));
    }
    if (lastFlush.rejected > 0) {
      toast.error(t("eventScanner.sync.flushedRejected", { count: lastFlush.rejected }));
    }
  }, [lastFlush, t]);

  const syncIssues =
    runtime.conflicts.length > 0 || runtime.rejected.length > 0 ? (
      <ScannerSyncIssuesPanel
        conflicts={runtime.conflicts}
        rejected={runtime.rejected}
        timezone={session?.event.timezone ?? null}
        deviceLabel={session?.label ?? ""}
        eventSlug={session?.event.slug ?? null}
        onClear={runtime.clearSyncIssues}
      />
    ) : null;

  if (session === null || runtime.status !== "ready") {
    if (runtime.status === "expired" && session !== null) {
      return (
        <section className="mx-auto w-full max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold text-foreground">{t("eventScanner.appName")}</h1>
          <div className="space-y-2 text-left">{banners}</div>
          <p className="rounded-[6px] border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {t("eventScanner.session.expired")}
          </p>
          {runtime.outbox.length > 0 && (
            <>
              <p className="text-sm text-muted-foreground">
                {t("eventScanner.session.expiredSyncing")}
              </p>
              <div className="text-left">
                <ScannerOutboxPanel
                  outbox={runtime.outbox}
                  timezone={session.event.timezone}
                  flushing={runtime.flushing}
                  persistent={runtime.outboxPersistent}
                  onFlush={runtime.retryAll}
                  onRetry={runtime.retry}
                  onRetryAll={runtime.retryAll}
                  onDiscard={runtime.discard}
                />
              </div>
            </>
          )}
          {syncIssues !== null && <div className="text-left">{syncIssues}</div>}
          <Button type="button" variant="secondary" onClick={() => void disconnect()}>
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("eventScanner.session.disconnect")}
          </Button>
        </section>
      );
    }
    return (
      <div className="space-y-6">
        {(notice !== null || relocateTo !== null) && (
          <div className="mx-auto w-full max-w-md space-y-2">{banners}</div>
        )}
        <ScannerPairingCard
          onConnect={runtime.connect}
          connecting={runtime.status === "connecting"}
          error={runtime.connectError}
          online={runtime.online}
        />
        {syncIssues !== null && <div className="mx-auto w-full max-w-md">{syncIssues}</div>}
      </div>
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
              offlineReady={listState === "fresh" || listState === "stale"}
              sessionStale={runtime.sessionStale}
            />
            <Button type="button" size="sm" variant="ghost" onClick={() => void disconnect()}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{t("eventScanner.session.disconnect")}</span>
            </Button>
          </div>
        </div>

        <ScannerOfflineBar
          roster={runtime.roster}
          state={listState}
          timezone={session.event.timezone}
          online={runtime.online}
          sessionStale={runtime.sessionStale}
          clockOffsetMs={runtime.clockOffsetMs}
          clockSkewed={runtime.clockSkewed}
          onRefresh={runtime.syncRoster}
        />

        {hoursLeft !== null && hoursLeft <= EXPIRY_WARNING_HOURS && (
          <p className="flex items-center gap-2 text-xs text-brand-ink dark:text-brand">
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

      {banners}

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
          onFlush={runtime.retryAll}
          onRetry={runtime.retry}
          onRetryAll={runtime.retryAll}
          onDiscard={runtime.discard}
        />
      )}

      {syncIssues}

      {modes.includes("checkin") && (
        <ScannerReadinessCard
          readiness={readiness}
          rosterState={listState}
          queuePersistent={runtime.outboxPersistent && runtime.offlineStoragePersistent}
        />
      )}

      <div className="pb-6 text-center text-xs text-muted-foreground">
        <Badge variant="outline">{session.event.slug ?? ""}</Badge>
      </div>
    </div>
  );
}
