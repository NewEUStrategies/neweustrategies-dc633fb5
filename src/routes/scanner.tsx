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
// TOKEN Z ADRESU ZNIKA Z ADRESU. Panel organizatora daje operatorowi link
// (albo kod QR) z `?t=`; po pierwszym odczycie podmieniamy wpis w historii na
// czysty `/scanner`, żeby poświadczenie nie zostało w historii przeglądarki,
// na zrzucie ekranu ani w pasku adresu na widoku.
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { ScannerApp } from "@/components/events/scanner/organisms/ScannerApp";
import { isScannerToken } from "@/lib/events/scannerSession";
import { registerScannerServiceWorker } from "@/lib/events/scannerPwa";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

interface ScannerSearch {
  /** Poświadczenie urządzenia z linku wydanego w panelu. */
  t?: string;
}

export const Route = createFileRoute("/scanner")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): ScannerSearch => {
    const raw = typeof search.t === "string" ? search.t.trim() : "";
    return isScannerToken(raw) ? { t: raw } : {};
  },
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

function ScannerRoute() {
  ensureScannerI18n();
  const search = Route.useSearch();
  const navigate = useNavigate();
  // Token czytamy RAZ i od razu znika z adresu - patrz nagłówek pliku.
  const [initialToken] = useState<string | null>(search.t ?? null);

  useEffect(() => {
    registerScannerServiceWorker();
  }, []);

  useEffect(() => {
    if (search.t === undefined) return;
    void navigate({ to: "/scanner", search: {}, replace: true });
  }, [search.t, navigate]);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-4 sm:px-6">
      <ScannerApp initialToken={initialToken} />
    </main>
  );
}

function ScannerRouteError() {
  return <FriendlyErrorPage variant="compact" />;
}
