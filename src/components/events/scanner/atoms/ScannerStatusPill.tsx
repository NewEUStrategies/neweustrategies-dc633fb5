// Atom: stan łączności i kolejki, zawsze widoczny.
//
// TO JEST NAJWAŻNIEJSZY NAPIS NA EKRANIE PO WYNIKU SKANU. Operator musi
// wiedzieć, czy to, co właśnie zapisał, jest już w bazie, czy czeka na zasięg -
// bo od tego zależy, czy wolno mu odłączyć urządzenie na koniec zmiany.
import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

ensureScannerI18n();

export function ScannerStatusPill({
  online,
  pending,
  syncing,
}: {
  online: boolean;
  pending: number;
  syncing: boolean;
}) {
  const { t } = useTranslation();

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

  return (
    <Badge variant="outline" className="gap-1.5">
      <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
      {t("eventScanner.session.online")}
    </Badge>
  );
}
