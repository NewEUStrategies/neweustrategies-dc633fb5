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
// PRZENIESIENIE TYLKO PO POTWIERDZONYM SPRZĄTANIU. `purgeScannerData` zwraca
// `false`, gdy kasowanie IndexedDB się nie powiodło albo skaner pracuje w innej
// karcie - wtedy token i dane zostają pod originem portalu celowo. Przekierowanie
// mimo to zostawiałoby poświadczenie pod portalem, parowało origin skanera
// i pozwalało starej karcie skanować dalej. Trasa zostaje więc na miejscu,
// NIE wysyła tokenu i pokazuje „Spróbuj ponownie" (cały obieg od nowa, z
// pytaniem o niewysłaną pracę) albo „Pracuj dalej pod tym adresem" (skaner
// z banerem przeniesienia, jak przy niewysłanych skanach).
//
// CZĘŚĆ NIEDZIELONA JEST PUSTA Z ROZMYSŁEM. Opcje trasy poza `component`
// (`head`, dawniej `validateSearch`) jadą w chunku wejściowym KAŻDEJ strony
// serwisu - cała logika adresu mieszka w komponencie (osobny chunk skanera).
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { Button } from "@/components/ui/button";
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
  /** Sprzątanie originu portalu się nie powiodło - nic nie wyjechało. */
  | { phase: "blocked"; entry: ScannerEntry; target: string }
  | { phase: "app"; entry: ScannerEntry; relocateTo: string | null };

/**
 * Przeniesienie pod origin skanera albo powód, żeby zostać (patrz nagłówek).
 * `stale()` = trasa odmontowana albo obieg zastąpiony nowszym - wynik przepada.
 */
async function relocateOrStay(
  entry: ScannerEntry,
  target: string,
  stale: () => boolean,
  setState: Dispatch<SetStateAction<RouteState>>,
): Promise<void> {
  const busy = await holdsScannerWork();
  if (stale()) return;
  if (busy) {
    // Niewysłane skany pod tym originem - skaner pracuje tu dalej,
    // a baner prowadzi pod nowy adres, gdy kolejka się opróżni.
    setState({ phase: "app", entry, relocateTo: target });
    return;
  }
  // Token z linku ma pierwszeństwo; bez niego jedzie ten z pamięci, żeby
  // urządzenie nie wymagało ponownego parowania pod nowym adresem. Czytany
  // PRZED sprzątaniem, które go kasuje.
  const token = entry.token ?? readStoredToken();
  setState({ phase: "relocating" });
  const purged = await purgeScannerData();
  if (stale()) return;
  if (!purged) {
    setState({ phase: "blocked", entry, target });
    return;
  }
  window.location.replace(scannerUrl(target, { token, notice: entry.notice }));
}

function ScannerRoute() {
  ensureScannerI18n();
  const { t } = useTranslation();
  const entryRef = useRef<ScannerEntry | null>(null);
  /** Pokolenie obiegu przeniesienia - odmontowanie i ponowienie je unieważniają. */
  const runRef = useRef(0);
  const [state, setState] = useState<RouteState>({ phase: "reading" });

  const startRelocation = (entry: ScannerEntry, target: string) => {
    runRef.current += 1;
    const run = runRef.current;
    void relocateOrStay(entry, target, () => runRef.current !== run, setState);
  };

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
    startRelocation(entry, target);
    return () => {
      runRef.current += 1;
    };
    // Obieg startuje RAZ na wejście; `startRelocation` czyta wyłącznie referencje.
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
      ) : state.phase === "blocked" ? (
        <div
          role="alert"
          className="mx-auto mt-12 w-full max-w-md space-y-3 rounded-[6px] border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm text-destructive"
        >
          <p>{t("eventScanner.pairing.relocationBlocked", { origin: state.target })}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => startRelocation(state.entry, state.target)}
            >
              {t("eventScanner.pairing.relocationRetry")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setState({ phase: "app", entry: state.entry, relocateTo: state.target })
              }
            >
              {t("eventScanner.pairing.relocationStay")}
            </Button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function ScannerRouteError() {
  return <FriendlyErrorPage variant="compact" />;
}
