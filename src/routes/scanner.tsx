// Trasa aplikacji skanera on-site: `/scanner`.
//
// TO JEST INNA APLIKACJA NA TYM SAMYM ADRESIE. Nie ma nagłówka serwisu, nie ma
// stopki i nie ma nawigacji - wolontariusz przy bramce ma na ekranie czytnik,
// wynik i kolejkę, a każdy dodatkowy element to miejsce, w które można kliknąć
// przez pomyłkę w trakcie odprawy.
//
// `ssr: false` JEST KONIECZNE, NIE OSZCZĘDNOŚCIĄ. Poświadczenie urządzenia
// siedzi w `localStorage`, a kolejka skanów w IndexedDB - serwer nie widzi ani
// jednego, ani drugiego, więc renderowanie serwerowe dawałoby zawsze ekran
// parowania i podmieniało go po hydracji.
//
// `noindex, nofollow` i `referrer: no-referrer`: adres bywa otwierany z linku
// zawierającego POŚWIADCZENIE. Nie ma go w indeksie i nie wycieka w nagłówku
// odesłania.
//
// TOKEN JEDZIE WE FRAGMENCIE I ZNIKA Z ADRESU (OPS-07). Panel organizatora daje
// operatorowi link (albo kod QR) `/scanner#t=<token>` - fragmentu przeglądarka
// nie wysyła na serwer, więc poświadczenie nie trafia do logów. Trasa czyta go
// RAZ i od razu podmienia wpis w historii na czysty `/scanner`
// (`history.replaceState`), żeby nie został w historii, na zrzucie ekranu ani
// w pasku adresu. Trasa nie ma już `validateSearch` przyjmującego `t`: stary
// link `?t=` NIE paruje urządzenia (token już wyciekł do logów) - trasa
// zdejmuje go z adresu i prosi o nowy kod QR.
//
// OSOBNY ORIGIN (OPS-13). Gdy wdrożenie ma `VITE_SCANNER_ORIGIN`, `/scanner`
// pod originem portalu przenosi urządzenie pod origin skanera (token we
// fragmencie, po stronie przeglądarki) i kasuje dane skanera z originu portalu -
// chyba że leżą tam jeszcze niewysłane skany: wtedy skaner pracuje dalej
// z banerem, aż kolejka się opróżni (`scannerRelocation.ts`).
//
// CZĘŚĆ NIEDZIELONA JEST PUSTA Z ROZMYSŁEM. Opcje trasy poza `component`
// (`head`, dawniej `validateSearch`) jadą w chunku wejściowym KAŻDEJ strony
// serwisu - cała logika adresu mieszka w komponencie (osobny chunk skanera).
import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { ScannerApp } from "@/components/events/scanner/organisms/ScannerApp";
import {
  readScannerEntry,
  scannerEntryNeedsCleanup,
  scannerRelocationTarget,
  scannerUrl,
  type ScannerEntry,
} from "@/lib/events/scannerLink";
import { registerScannerServiceWorker } from "@/lib/events/scannerPwa";
import { holdsScannerWork, purgeScannerData } from "@/lib/events/scannerRelocation";
import { readStoredToken } from "@/lib/events/scannerStorage";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

export const Route = createFileRoute("/scanner")({
  ssr: false,
  // BEZ `validateSearch`: trasa nie przyjmuje żadnych parametrów zapytania -
  // poświadczenie jedzie wyłącznie we fragmencie (patrz nagłówek).
  head: () => ({
    meta: [
      { title: "Skaner NES" },
      {
        name: "description",
        content: "Odprawa uczestników, skan leadów i rejestr wydruku identyfikatorów.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
      { name: "theme-color", content: "#141414" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "NES Scan" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
    ],
    links: [
      // Manifest wisi PRZY TEJ TRASIE, nie w nagłówku całego serwisu:
      // instalowalny ma być skaner, a nie portal.
      { rel: "manifest", href: "/scanner/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/scanner/icon-192.png" },
    ],
  }),
  errorComponent: ScannerRouteError,
  notFoundComponent: ScannerRouteError,
  component: ScannerRoute,
});

type RouteState =
  | { phase: "reading" }
  | { phase: "relocating" }
  | { phase: "app"; entry: ScannerEntry; relocateTo: string | null };

function ScannerRoute() {
  ensureScannerI18n();
  const { t } = useTranslation();
  const entryRef = useRef<ScannerEntry | null>(null);
  const [state, setState] = useState<RouteState>({ phase: "reading" });

  useEffect(() => {
    // Wejście z adresu - czytane RAZ i od razu zdejmowane z paska. StrictMode
    // odpala efekt dwa razy, a za pierwszym razem fragment już znika z adresu -
    // odczyt zapamiętany w referencji wystarcza obu (wzorzec raportu sponsora).
    if (entryRef.current === null) {
      const { hash, search, pathname } = window.location;
      entryRef.current = readScannerEntry(hash, search);
      if (scannerEntryNeedsCleanup(hash, search)) {
        window.history.replaceState(window.history.state, "", pathname);
      }
    }
    const entry = entryRef.current;
    const target = scannerRelocationTarget(window.location.origin);
    if (target === null) {
      registerScannerServiceWorker();
      setState({ phase: "app", entry, relocateTo: null });
      return;
    }
    let cancelled = false;
    void holdsScannerWork().then(async (busy) => {
      if (cancelled) return;
      if (busy) {
        // Niewysłane skany pod tym originem - skaner pracuje tu dalej,
        // a baner prowadzi pod nowy adres, gdy kolejka się opróżni.
        setState({ phase: "app", entry, relocateTo: target });
        return;
      }
      // Token z linku ma pierwszeństwo; bez niego jedzie ten z pamięci, żeby
      // urządzenie nie wymagało ponownego parowania pod nowym adresem.
      const token = entry.token ?? readStoredToken();
      setState({ phase: "relocating" });
      await purgeScannerData();
      if (cancelled) return;
      window.location.replace(scannerUrl(target, { token, notice: entry.notice }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-4 sm:px-6">
      {state.phase === "app" ? (
        <ScannerApp
          initialToken={state.entry.token}
          notice={state.entry.notice}
          relocateTo={state.relocateTo}
        />
      ) : state.phase === "relocating" ? (
        <p role="status" className="py-12 text-center text-sm text-muted-foreground">
          {t("eventScanner.pairing.relocating")}
        </p>
      ) : null}
    </main>
  );
}

function ScannerRouteError() {
  return <FriendlyErrorPage variant="compact" />;
}
