// Atom: stan łączności i kolejki, zawsze widoczny.
//
// TO JEST NAJWAŻNIEJSZY NAPIS NA EKRANIE PO WYNIKU SKANU. Operator musi
// wiedzieć, czy to, co właśnie zapisał, jest już w bazie, czy czeka na zasięg -
// bo od tego zależy, czy wolno mu odłączyć urządzenie na koniec zmiany.
//
// BEZ SIECI SĄ DWA RÓŻNE STANY. Z listą offline skaner nadal DECYDUJE (kolor
// wyniku jest prawdziwy, tylko tymczasowy) - to stan „gotowy offline". Bez
// listy skan tylko czeka w kolejce i operator musi wpuszczać na własną
// odpowiedzialność - to stan alarmowy, czerwony. Sesja podniesiona z pamięci
// urządzenia (zimny start bez sieci) ma osobny napis, bo baza jej jeszcze nie
// potwierdziła.
import { CloudOff, HardDrive, ListChecks, RefreshCw, Wifi } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

ensureScannerI18n();

export function ScannerStatusPill({
  online,
  pending,
  syncing,
  offlineReady = false,
  sessionStale = false,
}: {
  online: boolean;
  pending: number;
  syncing: boolean;
  /** Urządzenie ma listę offline - bez sieci nadal podejmuje decyzje. */
  offlineReady?: boolean;
  /** Sesja z pamięci urządzenia, jeszcze niepotwierdzona przez bazę. */
  sessionStale?: boolean;
}) {
  const { t } = useTranslation();

  if (!online && offlineReady) {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
        {t("eventScanner.session.offlineReady")}
      </Badge>
    );
  }

  if (!online) {
    return (
      <Badge variant="destructive" className="gap-1.5">
        <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
        {t("eventScanner.session.offline")}
      </Badge>
    );
  }

  if (pending > 0) {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <RefreshCw
          className={syncing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
          aria-hidden="true"
        />
        {t("eventScanner.outbox.pending", { count: pending })}
      </Badge>
    );
  }

  if (sessionStale) {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
        {t("eventScanner.session.staleBadge")}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="gap-1.5">
      <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
      {t("eventScanner.session.online")}
    </Badge>
  );
}
