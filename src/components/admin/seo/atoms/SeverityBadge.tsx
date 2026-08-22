// Atom: plakietka istotności uwagi SEO (błąd / ostrzeżenie).
//
// Bez I/O i bez stanu serwera: dostaje sam poziom istotności, oddaje ikonę
// i KLUCZ i18n nagłówka. Wyprowadzony z `SeoValidationSummary`, gdzie ta sama
// para "ikona + nagłówek zależny od istotności" była wklejona w JSX razem
// z logiką ról ARIA. Rozdzielenie ma konkretny cel dowodowy: rola `alert`
// (błąd, czytnik przerywa) i `status` (ostrzeżenie, czytnik dopowiada) to
// RÓŻNE zachowania i muszą być dowodzone bez renderowania listy uwag.
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "@/lib/lucide-shim";

export type SeoSeverity = "error" | "warning";

/** Klucz nagłówka podsumowania dla danego poziomu istotności. */
export function severityHeadingKey(severity: SeoSeverity): string {
  return severity === "error"
    ? "admin.seo.validation.errorHeading"
    : "admin.seo.validation.warnHeading";
}

/** Rola ARIA kontenera: błąd przerywa czytnik, ostrzeżenie tylko dopowiada. */
export function severityLiveRole(severity: SeoSeverity): "alert" | "status" {
  return severity === "error" ? "alert" : "status";
}

export function SeverityBadge({ severity }: { severity: SeoSeverity }) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="seo-severity-badge"
      data-severity={severity}
      className="flex items-center gap-2 font-medium"
    >
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
      <span>{t(severityHeadingKey(severity))}</span>
    </div>
  );
}
